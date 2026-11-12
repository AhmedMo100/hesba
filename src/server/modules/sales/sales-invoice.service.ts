import "server-only";

/**
 * @file sales-invoice.service.ts
 * @description Multi-item invoices (cart checkout), credit sales, discounts, invoice payments
 * and returns (QA-31, ADR-0027).
 *
 * Built on the existing sale engine: the same tables (`sales`, `sale_lines`), the same stock
 * lock and FEFO depletion (ADR-0019/0021), the same server pricing (`saleLineTotalPiasters`),
 * and the people ledger for credit (`debt_entries`, ADR-0023) — no second receivables system.
 *
 * Rules:
 * - **Pricing:** every line is priced from the product's registered price; the client sends
 *   no price and no total. The invoice discount must be below the subtotal; it is split over
 *   the lines in proportion to their value (largest remainder), so the lines add up to the
 *   total exactly. Each line keeps its real unit price, its discount share and its total.
 * - **Payment method:** cash / wallet / card / debt, validated here. A credit sale (debt)
 *   needs a customer: the invoice and its receivable are written in the same transaction,
 *   linked by `sale_id`; a payment now is optional. Revenue is the invoice, at invoice time.
 * - **Payments** against a credit invoice are linked to it and cannot exceed what it still owes.
 * - **Returns** reference the sale and its lines. A line can return at most what was sold minus
 *   earlier returns. The value comes from the original line (its total after discount,
 *   pro rata, so a full return gives back exactly the line total). Stock goes back to the
 *   batches it came from. On a credit invoice the value first lowers what is still owed
 *   (a `reversal` entry); the rest — and every cash/card/wallet return — is paid back.
 * - Every write is idempotent by the client's `opId`, and atomic.
 *
 * @usedBy src/app/api/sales/checkout, src/app/api/sales/[id]/**
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/infra/db/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import {
  depleteVariantFefoInTx,
  lockSellableStockInTx,
  restoreReturnInTx,
  recordWasteInTx,
} from "@/server/modules/inventory";
import {
  customerAllocationInTx,
  lockLedgerOwnerInTx,
  writeInvoiceEntryInTx,
  type LedgerOwner,
} from "@/server/modules/people";
import {
  allocateByWeight,
  isServiceProduct,
  saleLineTotalPiasters,
} from "@/domain/sale-pricing";
import {
  lockSaleInTx,
  shortageError,
  toSafeNumber,
  type SaleShortage,
} from "./sales.service";
import { invoiceNumberOf } from "@/schemas/sale";
import type {
  CheckoutInput,
  CustomerInvoicesView,
  InvoiceStatus,
  PaymentMethod,
  SaleInvoice,
  SalePaymentInput,
  SaleReturnInput,
} from "@/schemas/sale";

const ZERO = BigInt(0);
const CASH_SALE_NAME = "بيعة نقدية";

const invoiceInclude = {
  customer: { select: { nameAr: true } },
  saleVoid: { select: { id: true } },
  saleReturns: { select: { amountPiasters: true } },
  debtEntries: { select: { direction: true, amountPiasters: true } },
  saleLines: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      storeVariantId: true,
      storeProductId: true,
      quantityBaseUnits: true,
      unitPricePiasters: true,
      discountPiasters: true,
      totalPiasters: true,
      returnLines: { select: { quantityBase: true } },
      storeProduct: { select: { nameAr: true, unit: true, category: true } },
      storeVariant: {
        select: {
          storeProduct: {
            select: { nameAr: true, unit: true, category: true },
          },
        },
      },
    },
  },
} satisfies Prisma.SaleInclude;

type InvoiceRow = Prisma.SaleGetPayload<{ include: typeof invoiceInclude }> & {
  /** What the invoice still owes after the customer's general payments (oldest first). */
  allocatedOutstanding?: bigint;
};

function toInvoice(s: InvoiceRow, duplicate?: boolean): SaleInvoice {
  const voided = s.saleVoid !== null;
  const outstanding =
    s.paymentMethod === "debt" ? (s.allocatedOutstanding ?? ZERO) : ZERO;
  return {
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    paymentMethod: s.paymentMethod as PaymentMethod,
    customerId: s.customerId,
    customerName: s.customer?.nameAr ?? null,
    subtotalPiasters: Number(s.totalPiasters + s.discountPiasters),
    discountPiasters: Number(s.discountPiasters),
    totalPiasters: Number(s.totalPiasters),
    returnedPiasters: Number(
      s.saleReturns.reduce((sum, r) => sum + r.amountPiasters, ZERO),
    ),
    outstandingPiasters: voided || outstanding < ZERO ? 0 : Number(outstanding),
    voided,
    ...(duplicate !== undefined ? { duplicate } : {}),
    lines: s.saleLines.map((l) => {
      const product = l.storeVariant?.storeProduct ?? l.storeProduct;
      return {
        id: l.id,
        variantId: l.storeVariantId,
        name: product?.nameAr ?? CASH_SALE_NAME,
        unit: product?.unit ?? "piece",
        quantityBase: l.quantityBaseUnits,
        unitPricePiasters: Number(l.unitPricePiasters),
        discountPiasters: Number(l.discountPiasters),
        totalPiasters: Number(l.totalPiasters),
        returnedQuantityBase: l.returnLines.reduce(
          (n, r) => n + r.quantityBase,
          0,
        ),
        returnable:
          l.storeVariantId !== null && !(product && isServiceProduct(product)),
      };
    }),
  };
}

async function loadInvoiceInTx(
  tx: TenantTx,
  storeId: string,
  saleId: string,
): Promise<InvoiceRow | null> {
  const s = await tx.sale.findFirst({
    where: { id: saleId, storeId },
    include: invoiceInclude,
  });
  if (s && s.paymentMethod === "debt" && s.customerId) {
    const allocation = await customerAllocationInTx(tx, storeId, s.customerId);
    return {
      ...s,
      allocatedOutstanding: allocation.remaining.get(s.id) ?? ZERO,
    };
  }
  return s;
}

function mergeLines(lines: CheckoutInput["lines"]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const l of lines)
    merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.quantityBase);
  return merged;
}

/** A replayed checkout `opId` must be the SAME invoice (QA-27). */
function assertSameCheckout(invoice: SaleInvoice, input: CheckoutInput): void {
  const want = mergeLines(input.lines);
  const got = new Map(
    invoice.lines.map((l) => [l.variantId ?? "", l.quantityBase]),
  );
  const same =
    want.size === got.size &&
    [...want].every(([v, q]) => got.get(v) === q) &&
    invoice.discountPiasters === input.discountPiasters &&
    invoice.paymentMethod === input.paymentMethod &&
    (invoice.customerId ?? null) === (input.customerId ?? null);
  if (!same)
    throw AppError.conflict("رقم العملية ده اتسجل قبل كده لفاتورة مختلفة");
}

/**
 * Sells a cart of stocked products as one invoice (see the file header for the rules).
 *
 * @throws AppError 404 (unknown product or customer), 400 (hidden product, service/sandwich
 *   in the cart, discount not below the subtotal, paid more than the total), 409 with
 *   `details.shortages` (not enough stock), 409 (opId reused for another invoice).
 */
export async function checkoutSale(
  storeId: string,
  userId: string,
  input: CheckoutInput,
): Promise<SaleInvoice> {
  const credit = input.paymentMethod === "debt";
  const owner: LedgerOwner | null =
    credit && input.customerId
      ? { table: "customers", customerId: input.customerId }
      : null;
  try {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        if (owner && !(await lockLedgerOwnerInTx(tx, storeId, owner))) {
          throw AppError.notFound("الزبون ده مش موجود أو اتحذف");
        }
        const merged = mergeLines(input.lines);
        const variantIds = [...merged.keys()];
        const balances = await lockSellableStockInTx(tx, storeId, variantIds);

        const dup = await tx.sale.findFirst({
          where: { storeId, opId: input.opId },
          select: { id: true },
        });
        if (dup) {
          const invoice = toInvoice(
            (await loadInvoiceInTx(tx, storeId, dup.id))!,
            true,
          );
          assertSameCheckout(invoice, input);
          return invoice;
        }

        const variants = await tx.storeVariant.findMany({
          where: { id: { in: variantIds }, storeId },
          select: {
            id: true,
            sellPricePiasters: true,
            storeProduct: {
              select: {
                id: true,
                nameAr: true,
                unit: true,
                kind: true,
                category: true,
                isActive: true,
                sellPricePiasters: true,
              },
            },
          },
        });
        const byId = new Map(variants.map((v) => [v.id, v]));
        const priced: Array<{
          variantId: string;
          productId: string;
          unit: string;
          quantityBase: number;
          unitPrice: bigint;
          gross: number;
        }> = [];
        const shortages: SaleShortage[] = [];
        for (const [variantId, quantityBase] of merged) {
          const v = byId.get(variantId);
          const p = v?.storeProduct;
          if (!v || !p)
            throw AppError.notFound("صنف في السلة مش موجود في محلك");
          const name = p.nameAr ?? CASH_SALE_NAME;
          if (!p.isActive)
            throw AppError.badRequest(`«${name}» مخفي، أظهره الأول عشان تبيعه`);
          if (p.kind === "sandwich" || isServiceProduct(p)) {
            throw AppError.badRequest(
              `«${name}» يتباع لوحده من شاشة البيع، مش من السلة`,
            );
          }
          const have = balances.get(variantId) ?? ZERO;
          if (have < BigInt(quantityBase)) {
            shortages.push({
              variantId,
              name,
              unit: p.unit,
              neededBase: quantityBase,
              availableBase: Number(have < ZERO ? ZERO : have),
            });
          }
          const unitPrice =
            v.sellPricePiasters > ZERO
              ? v.sellPricePiasters
              : p.sellPricePiasters;
          priced.push({
            variantId,
            productId: p.id,
            unit: p.unit,
            quantityBase,
            unitPrice,
            gross: saleLineTotalPiasters(
              p.unit,
              toSafeNumber(unitPrice),
              quantityBase,
            ),
          });
        }
        if (shortages.length > 0) throw shortageError(shortages);

        const subtotal = priced.reduce((s, l) => s + l.gross, 0);
        if (subtotal <= 0)
          throw AppError.badRequest("أصناف السلة مالهاش سعر بيع");
        if (input.discountPiasters >= subtotal) {
          throw AppError.badRequest("الخصم لازم يكون أقل من إجمالي الفاتورة", {
            subtotalPiasters: subtotal,
          });
        }
        const total = subtotal - input.discountPiasters;
        if (input.paidNowPiasters > total) {
          throw AppError.badRequest("المدفوع أكبر من إجمالي الفاتورة");
        }
        const shares = allocateByWeight(
          input.discountPiasters,
          priced.map((l) => l.gross),
        );

        const now = new Date();
        const sale = await tx.sale.create({
          data: {
            storeId,
            paymentMethod: input.paymentMethod,
            totalPiasters: BigInt(total),
            discountPiasters: BigInt(input.discountPiasters),
            customerId: credit ? input.customerId! : null,
            opId: input.opId,
            createdAt: now,
          },
          select: { id: true },
        });
        for (const [i, l] of priced.entries()) {
          const share = shares[i] ?? 0;
          const line = await tx.saleLine.create({
            data: {
              storeId,
              saleId: sale.id,
              storeVariantId: l.variantId,
              quantityBaseUnits: l.quantityBase,
              unitPricePiasters: l.unitPrice,
              discountPiasters: BigInt(share),
              totalPiasters: BigInt(l.gross - share),
              createdAt: now,
            },
            select: { id: true },
          });
          const depleted = await depleteVariantFefoInTx(tx, storeId, {
            storeVariantId: l.variantId,
            storeProductId: l.productId,
            quantityBase: BigInt(l.quantityBase),
            saleLineId: line.id,
            opId: null,
            now,
          });
          if (depleted.costPiasters !== null) {
            await tx.saleLine.update({
              where: { id: line.id },
              data: { costPiasters: BigInt(depleted.costPiasters) },
            });
          }
        }

        if (owner) {
          const debt = await writeInvoiceEntryInTx(tx, storeId, owner, {
            type: "debt",
            amountPiasters: BigInt(total),
            opId: input.opId,
            note: "فاتورة بيع آجل",
            saleId: sale.id,
            now,
          });
          if (input.paidNowPiasters > 0) {
            await writeInvoiceEntryInTx(tx, storeId, owner, {
              type: "payment",
              amountPiasters: BigInt(input.paidNowPiasters),
              opId: crypto.randomUUID(),
              note: "دفعة مع فاتورة البيع",
              saleId: sale.id,
              settlesEntryId: debt.id,
              now,
            });
          }
        }
        return toInvoice((await loadInvoiceInTx(tx, storeId, sale.id))!, false);
      },
      prisma,
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await withTenant(
        storeId,
        userId,
        async (tx) => {
          const s = await tx.sale.findFirst({
            where: { storeId, opId: input.opId },
            select: { id: true },
          });
          return s
            ? toInvoice((await loadInvoiceInTx(tx, storeId, s.id))!, true)
            : null;
        },
        prisma,
      );
      if (winner) {
        assertSameCheckout(winner, input);
        return winner;
      }
    }
    throw err;
  }
}

/**
 * The customer pays (part of) a credit invoice: a customer-ledger payment linked to it.
 *
 * @throws AppError 404, 400 (not a credit sale, or more than it owes), 409 (voided / opId reuse).
 */
export async function paySale(
  storeId: string,
  userId: string,
  saleId: string,
  input: SalePaymentInput,
): Promise<SaleInvoice> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const found = await loadInvoiceInTx(tx, storeId, saleId);
      if (!found) throw AppError.notFound("البيعة دي مش موجودة");
      if (found.paymentMethod !== "debt" || !found.customerId) {
        throw AppError.badRequest("البيعة دي مش آجل، مفيهاش باقي يتدفع");
      }
      const owner: LedgerOwner = {
        table: "customers",
        customerId: found.customerId,
      };
      if (!(await lockLedgerOwnerInTx(tx, storeId, owner))) {
        throw AppError.conflict("زبون الفاتورة دي اتحذف");
      }
      await lockSaleInTx(tx, saleId);
      const replay = await tx.debtEntry.findFirst({
        where: { storeId, opId: input.opId },
      });
      if (replay) {
        if (
          replay.saleId !== saleId ||
          replay.amountPiasters !== BigInt(input.amountPiasters)
        ) {
          throw AppError.conflict("رقم العملية ده اتسجل قبل كده لعملية مختلفة");
        }
        return toInvoice((await loadInvoiceInTx(tx, storeId, saleId))!, true);
      }
      const s = (await loadInvoiceInTx(tx, storeId, saleId))!;
      if (s.saleVoid) throw AppError.conflict("البيعة دي اتلغت");
      // What this invoice still owes after the customer's general payments too, so paying it
      // can never push the customer into a hidden credit.
      const outstanding = s.allocatedOutstanding ?? ZERO;
      const amount = BigInt(input.amountPiasters);
      if (amount > outstanding) {
        throw AppError.badRequest("المبلغ أكبر من الباقي على الفاتورة", {
          outstandingPiasters: Number(outstanding < ZERO ? ZERO : outstanding),
        });
      }
      const debt = await tx.debtEntry.findFirst({
        where: {
          storeId,
          saleId,
          entryKind: "transaction",
          direction: "owed_to_me",
        },
        select: { id: true },
      });
      await writeInvoiceEntryInTx(tx, storeId, owner, {
        type: "payment",
        amountPiasters: amount,
        opId: input.opId,
        note: "تحصيل فاتورة آجل",
        saleId,
        settlesEntryId: debt?.id ?? null,
        now: new Date(),
      });
      return toInvoice((await loadInvoiceInTx(tx, storeId, saleId))!, false);
    },
    prisma,
  );
}

/** The value of `qty` more of a line after `prev` already returned (exact for a full return). */
function returnValue(
  lineTotal: bigint,
  sold: number,
  prev: number,
  qty: number,
): bigint {
  const upTo = (n: number) => (lineTotal * BigInt(n)) / BigInt(sold);
  return upTo(prev + qty) - upTo(prev);
}

/**
 * Returns (part of) a sale — see the file header for the rules.
 *
 * @throws AppError 404, 400 (not this sale's line, not returnable, more than can be returned,
 *   nothing to give back), 409 (voided sale, opId reused for another return).
 */
export async function returnSale(
  storeId: string,
  userId: string,
  saleId: string,
  input: SaleReturnInput,
): Promise<SaleInvoice> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const found = await loadInvoiceInTx(tx, storeId, saleId);
      if (!found) throw AppError.notFound("البيعة دي مش موجودة");
      const owner: LedgerOwner | null =
        found.paymentMethod === "debt" && found.customerId
          ? { table: "customers", customerId: found.customerId }
          : null;
      if (owner && !(await lockLedgerOwnerInTx(tx, storeId, owner))) {
        throw AppError.conflict("زبون الفاتورة دي اتحذف");
      }
      await lockSaleInTx(tx, saleId);

      const wanted = new Map<string, number>();
      // Of each line's returned quantity, how much came back damaged (P4).
      const damaged = new Map<string, number>();
      for (const l of input.lines) {
        wanted.set(
          l.saleLineId,
          (wanted.get(l.saleLineId) ?? 0) + l.quantityBase,
        );
        if (l.condition === "damaged") {
          damaged.set(
            l.saleLineId,
            (damaged.get(l.saleLineId) ?? 0) + l.quantityBase,
          );
        }
      }
      const replay = await tx.saleReturn.findFirst({
        where: { storeId, opId: input.opId },
        include: {
          lines: { select: { saleLineId: true, quantityBase: true } },
        },
      });
      if (replay) {
        const got = new Map<string, number>();
        for (const l of replay.lines)
          got.set(l.saleLineId, (got.get(l.saleLineId) ?? 0) + l.quantityBase);
        const same =
          replay.saleId === saleId &&
          got.size === wanted.size &&
          [...wanted].every(([id, q]) => got.get(id) === q);
        if (!same)
          throw AppError.conflict("رقم العملية ده اتسجل قبل كده لمرتجع مختلف");
        return toInvoice((await loadInvoiceInTx(tx, storeId, saleId))!, true);
      }

      const s = toInvoice((await loadInvoiceInTx(tx, storeId, saleId))!);
      if (s.voided) throw AppError.conflict("البيعة دي اتلغت، مفيش حاجة ترجع");
      const lineById = new Map(s.lines.map((l) => [l.id, l]));
      const parts: Array<{ saleLineId: string; qty: number; amount: bigint }> =
        [];
      for (const [saleLineId, qty] of wanted) {
        const line = lineById.get(saleLineId);
        if (!line) throw AppError.badRequest("الصنف ده مش من البيعة دي");
        if (!line.returnable) {
          throw AppError.badRequest(`«${line.name}» مينفعش يترجع من هنا`);
        }
        const left = line.quantityBase - line.returnedQuantityBase;
        if (qty > left) {
          throw AppError.badRequest(
            `«${line.name}»: الكمية المرتجعة أكبر من اللي اتباع`,
            {
              saleLineId,
              returnableQuantityBase: left,
            },
          );
        }
        parts.push({
          saleLineId,
          qty,
          amount: returnValue(
            BigInt(line.totalPiasters),
            line.quantityBase,
            line.returnedQuantityBase,
            qty,
          ),
        });
      }
      const amount = parts.reduce((sum, p) => sum + p.amount, ZERO);
      if (amount <= ZERO)
        throw AppError.badRequest("الأصناف دي مالهاش قيمة ترجع");

      // A credit invoice: the return first lowers what is still owed; the rest is paid back.
      const outstanding = BigInt(s.outstandingPiasters);
      const credited = owner
        ? amount < outstanding
          ? amount
          : outstanding
        : ZERO;
      const refunded = amount - credited;
      const now = new Date();
      const ret = await tx.saleReturn.create({
        data: {
          storeId,
          saleId,
          opId: input.opId,
          amountPiasters: amount,
          creditedPiasters: credited,
          refundedPiasters: refunded,
          reason: input.reason?.trim() || null,
          createdBy: userId,
          createdAt: now,
        },
        select: { id: true },
      });
      for (const p of parts) {
        await tx.saleReturnLine.create({
          data: {
            storeId,
            returnId: ret.id,
            saleLineId: p.saleLineId,
            quantityBase: p.qty,
            amountPiasters: p.amount,
            createdAt: now,
          },
        });
        const restored = await restoreReturnInTx(tx, storeId, {
          saleLineId: p.saleLineId,
          quantityBase: BigInt(p.qty),
          opId: input.opId,
          now,
        });
        // Damaged goods: back into the very batches they came from (traceable), then out
        // again as a loss — never sellable stock, never a second refund.
        let toWaste = BigInt(damaged.get(p.saleLineId) ?? 0);
        if (toWaste > ZERO && restored) {
          for (const part of restored.parts) {
            if (toWaste <= ZERO) break;
            const q = part.quantityBase < toWaste ? part.quantityBase : toWaste;
            await recordWasteInTx(tx, storeId, {
              storeVariantId: restored.variantId,
              quantityBase: q,
              batchId: part.batchId,
              reason: "damaged_return",
              note: input.reason?.trim() || null,
              saleReturnId: ret.id,
            });
            toWaste -= q;
          }
        }
      }
      if (owner && credited > ZERO) {
        await writeInvoiceEntryInTx(tx, storeId, owner, {
          type: "reversal",
          amountPiasters: credited,
          opId: input.opId,
          note: "مرتجع من فاتورة آجل",
          saleId,
          now,
        });
      }
      return toInvoice((await loadInvoiceInTx(tx, storeId, saleId))!, false);
    },
    prisma,
  );
}

/** One sale as an invoice (lines, returns, what is still owed). @throws AppError 404 */
export async function getSaleInvoice(
  storeId: string,
  userId: string,
  saleId: string,
): Promise<SaleInvoice> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const s = await loadInvoiceInTx(tx, storeId, saleId);
      if (!s) throw AppError.notFound("البيعة دي مش موجودة");
      return toInvoice(s);
    },
    prisma,
  );
}

/**
 * A customer's credit invoices with products, payments and what each still owes (see
 * `CustomerInvoicesView`). @throws AppError 404 when the customer is not in this shop.
 */
export async function listCustomerInvoices(
  storeId: string,
  userId: string,
  customerId: string,
): Promise<CustomerInvoicesView> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, storeId, deletedAt: null },
        select: { id: true, nameAr: true, phone: true },
      });
      if (!customer) throw AppError.notFound("الزبون ده مش موجود");
      const entries = await tx.debtEntry.findMany({
        where: { storeId, customerId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          direction: true,
          amountPiasters: true,
          saleId: true,
          entryKind: true,
          noteAr: true,
          createdAt: true,
        },
      });
      const allocation = await customerAllocationInTx(tx, storeId, customerId);
      const sales = await tx.sale.findMany({
        where: { storeId, customerId, paymentMethod: "debt" },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: invoiceInclude,
      });
      let balance = ZERO;
      for (const e of entries) {
        balance +=
          e.direction === "owed_to_me" ? e.amountPiasters : -e.amountPiasters;
      }
      const invoices = sales.map((s) => {
        const linked = entries.filter((e) => e.saleId === s.id);
        const debt = linked
          .filter((e) => e.direction === "owed_to_me")
          .reduce((n, e) => n + e.amountPiasters, ZERO);
        const payments = linked.filter(
          (e) => e.direction === "i_owe" && e.entryKind !== "reversal",
        );
        const paid = payments.reduce((n, e) => n + e.amountPiasters, ZERO);
        const returnedOrVoided = linked
          .filter((e) => e.direction === "i_owe" && e.entryKind === "reversal")
          .reduce((n, e) => n + e.amountPiasters, ZERO);
        const owedOwn = debt - paid - returnedOrVoided;
        const remaining = allocation.remaining.get(s.id) ?? ZERO;
        const byGeneral = owedOwn > remaining ? owedOwn - remaining : ZERO;
        const voided = s.saleVoid !== null;
        const view = toInvoice(s);
        const status: InvoiceStatus = voided
          ? "voided"
          : remaining === ZERO
            ? "paid"
            : remaining < debt - returnedOrVoided
              ? "partial"
              : "unpaid";
        return {
          id: s.id,
          number: invoiceNumberOf(s.id),
          createdAt: s.createdAt.toISOString(),
          totalPiasters: Number(s.totalPiasters),
          returnedPiasters: view.returnedPiasters,
          paidPiasters: Number(paid),
          settledByGeneralPiasters: Number(byGeneral),
          remainingPiasters: voided ? 0 : Number(remaining),
          status,
          lines: view.lines.map((l) => ({
            name: l.name,
            unit: l.unit,
            quantityBase: l.quantityBase,
            returnedQuantityBase: l.returnedQuantityBase,
            unitPricePiasters: l.unitPricePiasters,
            totalPiasters: l.totalPiasters,
          })),
          payments: linked
            .filter((e) => e.direction === "i_owe")
            .map((e) => ({
              amountPiasters: Number(e.amountPiasters),
              createdAt: e.createdAt.toISOString(),
              kind: (e.entryKind === "reversal" ? "return" : "payment") as
                "payment" | "return",
            })),
        };
      });
      return {
        customer: {
          id: customer.id,
          name: customer.nameAr,
          phone: customer.phone,
        },
        balancePiasters: Number(balance),
        outstandingPiasters: Number(balance > ZERO ? balance : ZERO),
        creditPiasters: Number(balance < ZERO ? -balance : ZERO),
        otherDebtPiasters: Number(allocation.unlinkedRemaining),
        invoices,
        generalPayments: entries
          .filter((e) => !e.saleId && e.direction === "i_owe")
          .map((e) => ({
            amountPiasters: Number(e.amountPiasters),
            createdAt: e.createdAt.toISOString(),
            note: e.noteAr,
          }))
          .reverse(),
      };
    },
    prisma,
  );
}
