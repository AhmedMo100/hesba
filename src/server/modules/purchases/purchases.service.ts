import "server-only";

/**
 * @file purchases.service.ts
 * @description Supplier purchases (QA-30, ADR-0027): receiving a supplier invoice into stock and
 * onto the supplier's «عليك» ledger in ONE tenant transaction, paying it (in part or in full),
 * and cancelling it.
 *
 * Built on what exists — no second ledger:
 * - stock: a batch + an append-only `purchase` movement per line, under the variants' stock
 *   lock (ADR-0019 / ADR-0021), exactly like the Add-Stock intake;
 * - money: the people ledger (`debt_entries`, ADR-0023). The invoice's debt, its payments and
 *   its reversal are entries on the supplier, linked to the purchase by `purchase_id`.
 *
 * Rules:
 * - the total is the sum of the lines' costs, computed here; the time is the server's;
 * - the client's `opId` makes creation idempotent: a retry returns the first purchase, a
 *   reused `opId` with another invoice is a 409, and a failed attempt leaves nothing;
 * - a payment is linked to the invoice and cannot exceed what is still owed on it;
 * - cancelling is refused when any of the invoice's stock was already sold, wasted or
 *   adjusted (it would take out stock that is no longer there). Otherwise its batches are
 *   emptied with `purchase_void` movements and its whole debt is reversed; payments already
 *   made stay on the ledger, so the supplier then owes them back (a visible credit).
 *
 * @usedBy src/app/api/purchases/**
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/infra/db/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import {
  lockStockLevelsInTx,
  writeLevelInTx,
} from "@/server/modules/inventory";
import {
  invoiceOutstanding,
  lockLedgerOwnerInTx,
  writeInvoiceEntryInTx,
  type LedgerOwner,
} from "@/server/modules/people";
import { unitCostFromTotal } from "@/domain/stock/batch-cost";
import { isServiceProduct } from "@/domain/sale-pricing";
import type {
  CreatePurchaseInput,
  PurchasePaymentInput,
  PurchaseView,
  VoidPurchaseInput,
} from "@/schemas/purchase";

const ZERO = BigInt(0);

const purchaseInclude = {
  supplier: { select: { nameAr: true } },
  purchaseVoid: { select: { createdAt: true } },
  debtEntries: {
    select: {
      direction: true,
      amountPiasters: true,
      entryKind: true,
      settlesEntryId: true,
    },
  },
  purchaseLines: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      storeVariantId: true,
      quantityBaseUnits: true,
      totalCostPiasters: true,
      expiresOn: true,
      batchId: true,
      storeVariant: { select: { storeProduct: { select: { nameAr: true } } } },
    },
  },
} satisfies Prisma.PurchaseInclude;

type PurchaseRow = Prisma.PurchaseGetPayload<{
  include: typeof purchaseInclude;
}>;

function toView(p: PurchaseRow, duplicate?: boolean): PurchaseView {
  const voided = p.purchaseVoid !== null;
  // On the supplier's (payable) side, the debt direction is `i_owe`; a payment `owed_to_me`.
  const paid = p.debtEntries
    .filter(
      (e) => e.entryKind === "transaction" && e.direction === "owed_to_me",
    )
    .reduce((s, e) => s + e.amountPiasters, ZERO);
  const outstanding = invoiceOutstanding("payable", p.debtEntries);
  return {
    id: p.id,
    supplierId: p.supplierId,
    supplierName: p.supplier?.nameAr ?? null,
    totalPiasters: Number(p.totalPiasters),
    paidPiasters: Number(paid),
    outstandingPiasters: voided || outstanding < ZERO ? 0 : Number(outstanding),
    voided,
    voidedAt: p.purchaseVoid ? p.purchaseVoid.createdAt.toISOString() : null,
    note: p.note,
    createdAt: p.createdAt.toISOString(),
    ...(duplicate !== undefined ? { duplicate } : {}),
    lines: p.purchaseLines.map((l) => ({
      id: l.id,
      storeVariantId: l.storeVariantId,
      productName: l.storeVariant?.storeProduct?.nameAr ?? null,
      quantityBase: l.quantityBaseUnits,
      totalCostPiasters: Number(l.totalCostPiasters ?? ZERO),
      expiryDate: l.expiresOn ? l.expiresOn.toISOString().slice(0, 10) : null,
      batchId: l.batchId,
    })),
  };
}

async function loadPurchaseInTx(
  tx: TenantTx,
  storeId: string,
  purchaseId: string,
): Promise<PurchaseRow | null> {
  return tx.purchase.findFirst({
    where: { id: purchaseId, storeId },
    include: purchaseInclude,
  });
}

/** A replayed `opId` must be the SAME invoice (QA-27): same supplier, lines and payment. */
function assertSamePurchase(
  existing: PurchaseRow,
  input: CreatePurchaseInput,
): void {
  const view = toView(existing);
  const same =
    existing.supplierId === input.supplierId &&
    view.lines.length === input.lines.length &&
    view.lines.every((l, i) => {
      const want = input.lines[i]!;
      return (
        l.storeVariantId === want.storeVariantId &&
        l.quantityBase === want.quantityBase &&
        l.totalCostPiasters === want.totalCostPiasters
      );
    }) &&
    view.paidPiasters === (input.paidNowPiasters ?? 0);
  if (!same) {
    throw AppError.conflict("رقم العملية ده اتسجل قبل كده لفاتورة مختلفة");
  }
}

/**
 * Receives a supplier invoice: stock in, «عليك» up, and an optional payment now — atomically.
 *
 * @throws AppError 404 (unknown supplier or product), 400 (service/sandwich item, paid more
 *   than the total), 409 (opId reused for another invoice).
 */
export async function createPurchase(
  storeId: string,
  userId: string,
  input: CreatePurchaseInput,
): Promise<PurchaseView> {
  const owner: LedgerOwner = {
    table: "suppliers",
    supplierId: input.supplierId,
  };
  try {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        if (!(await lockLedgerOwnerInTx(tx, storeId, owner))) {
          throw AppError.notFound("المورد ده مش موجود أو اتحذف");
        }
        const existing = await tx.purchase.findFirst({
          where: { storeId, opId: input.opId },
          include: purchaseInclude,
        });
        if (existing) {
          assertSamePurchase(existing, input);
          return toView(existing, true);
        }

        // Every line must be a stocked product of THIS shop (RLS hides other shops' rows).
        const variantIds = [
          ...new Set(input.lines.map((l) => l.storeVariantId)),
        ];
        const variants = await tx.storeVariant.findMany({
          where: { id: { in: variantIds }, storeId },
          select: {
            id: true,
            storeProductId: true,
            storeProduct: {
              select: { unit: true, kind: true, category: true, nameAr: true },
            },
          },
        });
        const byId = new Map(variants.map((v) => [v.id, v]));
        for (const id of variantIds) {
          const v = byId.get(id);
          if (!v?.storeProduct) {
            throw AppError.notFound("صنف في الفاتورة مش موجود في محلك");
          }
          if (
            v.storeProduct.kind === "sandwich" ||
            isServiceProduct(v.storeProduct)
          ) {
            throw AppError.badRequest(
              `«${v.storeProduct.nameAr ?? "الصنف"}» مالوش مخزون، مينفعش يتشترى في فاتورة`,
            );
          }
        }

        const total = input.lines.reduce(
          (s, l) => s + BigInt(l.totalCostPiasters),
          ZERO,
        );
        const paidNow = BigInt(input.paidNowPiasters ?? 0);
        if (paidNow > total) {
          throw AppError.badRequest("المدفوع أكبر من إجمالي الفاتورة");
        }

        const now = new Date();
        const balances = await lockStockLevelsInTx(tx, storeId, variantIds);
        const purchase = await tx.purchase.create({
          data: {
            storeId,
            supplierId: input.supplierId,
            totalPiasters: total,
            opId: input.opId,
            note: input.note?.trim() || null,
            createdBy: userId,
            createdAt: now,
          },
          select: { id: true },
        });

        for (const line of input.lines) {
          const v = byId.get(line.storeVariantId)!;
          const qty = BigInt(line.quantityBase);
          const cost = BigInt(line.totalCostPiasters);
          const unitCost = unitCostFromTotal(cost, qty, v.storeProduct!.unit);
          const expiry = line.expiryDate
            ? new Date(`${line.expiryDate}T00:00:00Z`)
            : null;
          const batch = await tx.storeStockBatch.create({
            data: {
              storeId,
              storeVariantId: v.id,
              storeProductId: v.storeProductId,
              receivedQuantityBase: qty,
              remainingQuantityBase: qty,
              costPriceMinor: unitCost,
              costTotalMinor: cost,
              expiryDate: expiry,
              supplierId: input.supplierId,
              receivedAt: now,
              paid: paidNow >= total,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          const balance = (balances.get(v.id) ?? ZERO) + qty;
          balances.set(v.id, balance);
          await tx.stockMovement.create({
            data: {
              storeId,
              storeVariantId: v.id,
              storeProductId: v.storeProductId,
              batchId: batch.id,
              type: "purchase",
              quantityBase: qty,
              costPriceMinor: unitCost,
              balanceAfterBase: balance,
              negative: false,
              createdAt: now,
            },
          });
          await writeLevelInTx(tx, storeId, v.id, balance, now);
          await tx.purchaseLine.create({
            data: {
              storeId,
              purchaseId: purchase.id,
              storeProductId: v.storeProductId,
              storeVariantId: v.id,
              quantityBaseUnits: line.quantityBase,
              unitCostPiasters: unitCost ?? ZERO,
              totalCostPiasters: cost,
              expiresOn: expiry,
              batchId: batch.id,
              createdAt: now,
            },
          });
        }

        if (total > ZERO) {
          const debt = await writeInvoiceEntryInTx(tx, storeId, owner, {
            type: "debt",
            amountPiasters: total,
            opId: input.opId,
            note: input.note ?? "فاتورة شراء",
            purchaseId: purchase.id,
            now,
          });
          if (paidNow > ZERO) {
            await writeInvoiceEntryInTx(tx, storeId, owner, {
              type: "payment",
              amountPiasters: paidNow,
              opId: crypto.randomUUID(),
              note: "دفعة مع فاتورة الشراء",
              purchaseId: purchase.id,
              settlesEntryId: debt.id,
              now,
            });
          }
        }

        return toView(
          (await loadPurchaseInTx(tx, storeId, purchase.id))!,
          false,
        );
      },
      prisma,
    );
  } catch (err) {
    // A concurrent request with the same opId (for another supplier) committed first: the
    // unique (store_id, op_id) rolled this one back entirely. Return the winner if it is the
    // same invoice, else 409.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await withTenant(
        storeId,
        userId,
        (tx) =>
          tx.purchase.findFirst({
            where: { storeId, opId: input.opId },
            include: purchaseInclude,
          }),
        prisma,
      );
      if (winner) {
        assertSamePurchase(winner, input);
        return toView(winner, true);
      }
    }
    throw err;
  }
}

/**
 * Pays (part of) one purchase. The payment is a supplier-ledger entry linked to the invoice
 * and to its debt entry; it cannot exceed what is still owed on that invoice.
 *
 * @throws AppError 404 (unknown purchase), 409 (cancelled, or opId reused), 400 (more than owed).
 */
export async function payPurchase(
  storeId: string,
  userId: string,
  purchaseId: string,
  input: PurchasePaymentInput,
): Promise<PurchaseView> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const found = await loadPurchaseInTx(tx, storeId, purchaseId);
      if (!found) throw AppError.notFound("فاتورة الشراء دي مش موجودة");
      if (!found.supplierId) {
        throw AppError.conflict("مورد الفاتورة دي اتحذف");
      }
      const owner: LedgerOwner = {
        table: "suppliers",
        supplierId: found.supplierId,
      };
      if (!(await lockLedgerOwnerInTx(tx, storeId, owner))) {
        throw AppError.conflict("مورد الفاتورة دي اتحذف");
      }
      const replay = await tx.debtEntry.findFirst({
        where: { storeId, opId: input.opId },
      });
      if (replay) {
        if (
          replay.purchaseId !== purchaseId ||
          replay.amountPiasters !== BigInt(input.amountPiasters)
        ) {
          throw AppError.conflict("رقم العملية ده اتسجل قبل كده لعملية مختلفة");
        }
        return toView((await loadPurchaseInTx(tx, storeId, purchaseId))!, true);
      }
      // Re-read under the supplier lock: concurrent payments see each other.
      const p = (await loadPurchaseInTx(tx, storeId, purchaseId))!;
      if (p.purchaseVoid) throw AppError.conflict("فاتورة الشراء دي اتلغت");
      const outstanding = invoiceOutstanding("payable", p.debtEntries);
      const amount = BigInt(input.amountPiasters);
      if (amount > outstanding) {
        throw AppError.badRequest("المبلغ أكبر من الباقي على الفاتورة", {
          outstandingPiasters: Number(outstanding < ZERO ? ZERO : outstanding),
        });
      }
      const debt = await tx.debtEntry.findFirst({
        where: {
          storeId,
          purchaseId,
          entryKind: "transaction",
          direction: "i_owe",
        },
        select: { id: true },
      });
      await writeInvoiceEntryInTx(tx, storeId, owner, {
        type: "payment",
        amountPiasters: amount,
        opId: input.opId,
        note: input.note ?? "دفعة لفاتورة شراء",
        purchaseId,
        settlesEntryId: debt?.id ?? null,
        now: new Date(),
      });
      return toView((await loadPurchaseInTx(tx, storeId, purchaseId))!, false);
    },
    prisma,
  );
}

/**
 * Cancels a purchase: its stock goes out and its debt is reversed, atomically. A second
 * cancel (or a retry) returns the cancelled purchase and changes nothing.
 *
 * @throws AppError 404 (unknown purchase), 409 (some of its stock was already used, or the
 *   opId belongs to another operation).
 */
export async function voidPurchase(
  storeId: string,
  userId: string,
  purchaseId: string,
  input: VoidPurchaseInput,
): Promise<PurchaseView> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const found = await loadPurchaseInTx(tx, storeId, purchaseId);
      if (!found) throw AppError.notFound("فاتورة الشراء دي مش موجودة");
      const sameOp = await tx.purchaseVoid.findFirst({
        where: { storeId, opId: input.opId },
      });
      if (sameOp && sameOp.purchaseId !== purchaseId) {
        throw AppError.conflict("العملية دي اتسجلت قبل كده لفاتورة تانية");
      }
      const owner: LedgerOwner | null = found.supplierId
        ? { table: "suppliers", supplierId: found.supplierId }
        : null;
      if (owner && !(await lockLedgerOwnerInTx(tx, storeId, owner))) {
        throw AppError.conflict("مورد الفاتورة دي اتحذف");
      }
      const variantIds = [
        ...new Set(
          found.purchaseLines
            .map((l) => l.storeVariantId)
            .filter((id): id is string => id !== null),
        ),
      ];
      // Lock the stock first: a concurrent sale of this stock waits or has committed.
      const balances = await lockStockLevelsInTx(tx, storeId, variantIds);
      const p = (await loadPurchaseInTx(tx, storeId, purchaseId))!;
      if (p.purchaseVoid) return toView(p, true);

      const now = new Date();
      const batches = await tx.storeStockBatch.findMany({
        where: {
          storeId,
          id: {
            in: p.purchaseLines
              .map((l) => l.batchId)
              .filter((id): id is string => id !== null),
          },
        },
      });
      const batchById = new Map(batches.map((b) => [b.id, b]));
      for (const line of p.purchaseLines) {
        const b = line.batchId ? batchById.get(line.batchId) : undefined;
        if (!b || b.remainingQuantityBase !== b.receivedQuantityBase) {
          throw AppError.conflict(
            "اتباع أو اتصرف من بضاعة الفاتورة دي، مينفعش تتلغي — اعمل مرتجع أو تسوية بدالها",
          );
        }
      }

      await tx.purchaseVoid.create({
        data: {
          storeId,
          purchaseId,
          opId: input.opId,
          reason: input.reason?.trim() || null,
          voidedBy: userId,
          createdAt: now,
        },
      });
      for (const line of p.purchaseLines) {
        const b = batchById.get(line.batchId!)!;
        const qty = b.receivedQuantityBase;
        await tx.storeStockBatch.update({
          where: { id: b.id },
          data: { remainingQuantityBase: ZERO, updatedAt: now },
        });
        const balance = (balances.get(b.storeVariantId) ?? ZERO) - qty;
        balances.set(b.storeVariantId, balance);
        await tx.stockMovement.create({
          data: {
            storeId,
            storeVariantId: b.storeVariantId,
            storeProductId: b.storeProductId,
            batchId: b.id,
            type: "purchase_void",
            quantityBase: -qty,
            costPriceMinor: b.costPriceMinor,
            balanceAfterBase: balance,
            negative: balance < ZERO,
            opId: input.opId,
            createdAt: now,
          },
        });
        await writeLevelInTx(tx, storeId, b.storeVariantId, balance, now);
      }

      // The invoice is no longer owed: reverse its whole debt. Payments stay (real money).
      if (owner && p.totalPiasters > ZERO) {
        await writeInvoiceEntryInTx(tx, storeId, owner, {
          type: "reversal",
          amountPiasters: p.totalPiasters,
          opId: input.opId,
          note: "إلغاء فاتورة شراء",
          purchaseId,
          now,
        });
      }
      return toView((await loadPurchaseInTx(tx, storeId, purchaseId))!, false);
    },
    prisma,
  );
}

/** The shop's purchases, newest first (optionally one supplier's). */
export async function listPurchases(
  storeId: string,
  userId: string,
  filter: { supplierId?: string | null } = {},
): Promise<PurchaseView[]> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const rows = await tx.purchase.findMany({
        where: {
          storeId,
          ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: purchaseInclude,
      });
      return rows.map((r) => toView(r));
    },
    prisma,
  );
}

/** One purchase. @throws AppError 404 */
export async function getPurchase(
  storeId: string,
  userId: string,
  purchaseId: string,
): Promise<PurchaseView> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const p = await loadPurchaseInTx(tx, storeId, purchaseId);
      if (!p) throw AppError.notFound("فاتورة الشراء دي مش موجودة");
      return toView(p);
    },
    prisma,
  );
}
