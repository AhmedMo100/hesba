import "server-only";

/**
 * @file sales.service.ts
 * @description Use cases behind `/api/sales`: list recent sales, record a one-line cash sale,
 * and undo a sale. Every query runs inside `withTenant` so Postgres RLS scopes it to the store.
 *
 * Extracted unchanged from `src/app/api/sales/route.ts` (ADR-0017). Behavior is pinned by
 * `tests/integration/sales-api.spec.ts`.
 *
 * @usedBy
 * - src/app/api/sales/route.ts
 *
 * @remarks
 * - A sale here is a single cash line. For ordinary products this module does not touch
 *   stock: it writes no stock movement and does not deplete batches.
 * - `opId` is generated on the server for each request, so the same request sent twice
 *   creates two sales — except for sandwiches.
 * - Sandwich sales (ADR-0018) take a separate path in the same transaction: the client's
 *   `opId` makes them idempotent, the ingredients are stock-checked under row locks and
 *   FEFO-depleted, and the line stores a cost snapshot (`cost_piasters`).
 * - The `sale_lines` table requires exactly one target per line
 *   (`chk_sale_lines_exactly_one_target`), and `sales`/`sale_lines` are append-only for the
 *   application role (no DELETE grant).
 * - Open issues for this module are tracked in `docs/audits/USER-FACING-ERRORS.md`.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/infra/db/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { depleteVariantFefoInTx } from "@/server/modules/inventory";
import {
  isSandwichProductInTx,
  prepareSandwichSaleInTx,
} from "@/server/modules/sandwiches";
import { toCairoDateString } from "@/domain/time";
import { normalizeArabic } from "@/domain/normalize";
import type { CreateSaleInput } from "@/schemas/sale";

/** Fallback product name used for unnamed cash sales. */
const CASH_SALE_NAME = "بيعة نقدية";

export interface SaleListItem {
  id: string;
  productId: string;
  name: string;
  amountPiasters: number;
  quantity: number;
  category: string;
  unit: string;
  timestamp: number;
  /** Line cost recorded at sale time (sandwich sales); null when none was recorded. */
  costPiasters: number | null;
}

export interface SalesOverview {
  sales: SaleListItem[];
  todaySales: SaleListItem[];
  todayTotalPiasters: number;
  todayCount: number;
}

const isValidUuid = (val?: string | null): val is string =>
  Boolean(
    val &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val),
  );

/**
 * Returns the store's 200 most recent sales, plus today's subset and total
 * ("today" is the Cairo calendar day).
 */
export async function listRecentSales(
  storeId: string,
  userId: string,
): Promise<SalesOverview> {
  const todayCairo = toCairoDateString(new Date());

  const sales = await withTenant(
    storeId,
    userId,
    async (tx) => {
      return tx.sale.findMany({
        where: { storeId },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          saleLines: {
            include: {
              storeProduct: true,
              storeVariant: {
                include: {
                  storeProduct: true,
                },
              },
            },
          },
        },
      });
    },
    prisma,
  );

  const formatted: SaleListItem[] = sales.map((s) => {
    const line = s.saleLines[0];
    const prod = line?.storeVariant?.storeProduct || line?.storeProduct;
    return {
      id: s.id,
      productId:
        prod?.id || line?.storeProductId || line?.storeVariantId || s.id,
      name: prod?.nameAr || CASH_SALE_NAME,
      amountPiasters: Number(s.totalPiasters),
      quantity: line?.quantityBaseUnits || 1,
      category: prod?.category || "عام",
      unit: prod?.unit || "piece",
      timestamp: s.createdAt.getTime(),
      costPiasters:
        line?.costPiasters != null ? Number(line.costPiasters) : null,
    };
  });

  const todaySales = formatted.filter(
    (s) => toCairoDateString(s.timestamp) === todayCairo,
  );
  const todayTotalPiasters = todaySales.reduce(
    (sum, s) => sum + s.amountPiasters,
    0,
  );

  return {
    sales: formatted,
    todaySales,
    todayTotalPiasters,
    todayCount: todaySales.length,
  };
}

/**
 * Records a completed one-line cash sale and returns its id.
 *
 * The sold item is resolved in order: `variantId` → `productId` (as a variant id, then as a
 * product id) → exact Arabic `name`. If nothing matches, a custom store product is created
 * so the sale keeps a readable name in history.
 *
 * The client's `id` is kept when it is a UUID (so the client can refer to the sale offline);
 * otherwise a server id is generated.
 *
 * When an item resolves to a variant, the line stores both the variant id and its product id.
 *
 * @returns The id of the created sale.
 * @throws A Prisma error when the insert violates a database constraint (surfaced as 500).
 */
export async function recordSale(
  storeId: string,
  userId: string,
  input: CreateSaleInput,
): Promise<{ id: string }> {
  const saleId = isValidUuid(input.id) ? input.id : crypto.randomUUID();
  const opId = crypto.randomUUID();

  // Sandwiches (ADR-0018) are idempotent by the client's opId, when it sends one.
  const sandwichOpId = input.opId ?? crypto.randomUUID();

  let created: { id: string };
  try {
    created = await withTenant(
      storeId,
      userId,
      async (tx) => {
        if (input.productId && isValidUuid(input.productId)) {
          if (await isSandwichProductInTx(tx, storeId, input.productId)) {
            return recordSandwichSaleInTx(tx, storeId, {
              saleId,
              opId: sandwichOpId,
              sandwichId: input.productId,
              count: input.quantityBase,
              createdAt: input.timestamp
                ? new Date(input.timestamp)
                : new Date(),
            });
          }
        }

        let targetVariantId: string | null = null;
        let targetProductId: string | null = null;

        if (input.variantId && isValidUuid(input.variantId)) {
          const varExists = await tx.storeVariant.findFirst({
            where: { id: input.variantId, storeId },
            select: { id: true, storeProductId: true },
          });
          if (varExists) {
            targetVariantId = varExists.id;
            targetProductId = varExists.storeProductId;
          }
        }

        if (
          !targetVariantId &&
          input.productId &&
          isValidUuid(input.productId)
        ) {
          const varExists = await tx.storeVariant.findFirst({
            where: { id: input.productId, storeId },
            select: { id: true, storeProductId: true },
          });
          if (varExists) {
            targetVariantId = varExists.id;
            targetProductId = varExists.storeProductId;
          } else {
            const prodExists = await tx.storeProduct.findFirst({
              where: { id: input.productId, storeId },
              include: { storeVariants: { take: 1 } },
            });
            if (prodExists) {
              targetProductId = prodExists.id;
              targetVariantId = prodExists.storeVariants[0]?.id || null;
            }
          }
        }

        if (!targetVariantId && !targetProductId && input.name) {
          const prodByName = await tx.storeProduct.findFirst({
            where: { storeId, nameAr: input.name },
            include: { storeVariants: { take: 1 } },
          });
          if (prodByName) {
            targetProductId = prodByName.id;
            targetVariantId = prodByName.storeVariants[0]?.id || null;
          }
        }

        // Unknown item: create a custom product so the sale keeps its name in history.
        if (!targetVariantId && !targetProductId) {
          const prodName = input.name || CASH_SALE_NAME;
          const isService = Boolean(
            input.machineId || input.label?.includes("كارت"),
          );
          const createdProd = await tx.storeProduct.create({
            data: {
              storeId,
              nameAr: prodName,
              nameNorm: normalizeArabic(prodName),
              category: isService ? "خدمات وفواتير" : "السلع الاستهلاكية",
              unit: input.isCarton ? "carton" : "piece",
              sellPricePiasters: BigInt(input.amountPiasters),
              isCustom: true,
              storeVariants: {
                create: {
                  storeId,
                  sellPricePiasters: BigInt(input.amountPiasters),
                  packQty: 1,
                },
              },
            },
            include: { storeVariants: true },
          });
          targetProductId = createdProd.id;
          targetVariantId = createdProd.storeVariants[0]?.id || null;
        }

        return tx.sale.create({
          data: {
            id: saleId,
            storeId,
            paymentMethod: "cash",
            totalPiasters: BigInt(input.amountPiasters),
            opId,
            createdAt: input.timestamp ? new Date(input.timestamp) : new Date(),
            saleLines: {
              create: {
                storeId,
                storeVariantId: targetVariantId,
                storeProductId: targetProductId,
                quantityBaseUnits: input.quantityBase,
                unitPricePiasters: BigInt(input.amountPiasters),
                totalPiasters: BigInt(input.amountPiasters),
              },
            },
          },
        });
      },
      prisma,
    );
  } catch (err) {
    // A concurrent retry of the same sandwich sale lost the race on (store_id, op_id):
    // return the sale that won instead of failing.
    if (
      input.opId &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await findSaleByOpId(storeId, userId, input.opId);
      if (existing) return { id: existing.id };
    }
    throw err;
  }

  return { id: created.id };
}

async function findSaleByOpId(
  storeId: string,
  userId: string,
  opId: string,
): Promise<{ id: string } | null> {
  return withTenant(
    storeId,
    userId,
    (tx) =>
      tx.sale.findFirst({ where: { storeId, opId }, select: { id: true } }),
    prisma,
  );
}

/**
 * Sells `count` sandwiches inside the sale transaction (ADR-0018):
 * 1. returns the existing sale when this `opId` was already recorded (idempotent retry);
 * 2. locks and checks the ingredients' stock (`prepareSandwichSaleInTx`) — a shortage rejects
 *    the whole sale;
 * 3. writes the sale and ONE line targeting only the sandwich product, at the sandwich's
 *    current price, with the cost snapshot `cost_piasters` = current recipe cost × count;
 * 4. FEFO-depletes every ingredient with `type: "sale"` movements linked to that line.
 *
 * The client's `amountPiasters` is not used: the total is the sandwich price × count.
 */
async function recordSandwichSaleInTx(
  tx: TenantTx,
  storeId: string,
  params: {
    saleId: string;
    opId: string;
    sandwichId: string;
    count: number;
    createdAt: Date;
  },
): Promise<{ id: string }> {
  const duplicate = await tx.sale.findFirst({
    where: { storeId, opId: params.opId },
    select: { id: true },
  });
  if (duplicate) return duplicate;

  const plan = await prepareSandwichSaleInTx(
    tx,
    storeId,
    params.sandwichId,
    params.count,
  );
  const count = BigInt(params.count);
  const unitPrice = BigInt(plan.sellPricePiasters);
  const total = unitPrice * count;

  const sale = await tx.sale.create({
    data: {
      id: params.saleId,
      storeId,
      paymentMethod: "cash",
      totalPiasters: total,
      opId: params.opId,
      createdAt: params.createdAt,
    },
    select: { id: true },
  });
  const line = await tx.saleLine.create({
    data: {
      storeId,
      saleId: sale.id,
      storeProductId: plan.sandwichId,
      quantityBaseUnits: params.count,
      unitPricePiasters: unitPrice,
      totalPiasters: total,
      costPiasters: BigInt(plan.unitCostPiasters) * count,
      createdAt: params.createdAt,
    },
    select: { id: true },
  });

  const now = new Date();
  for (const req of plan.requirements) {
    await depleteVariantFefoInTx(tx, storeId, {
      storeVariantId: req.variantId,
      storeProductId: req.productId,
      quantityBase: req.quantityBase,
      saleLineId: line.id,
      opId: null,
      now,
    });
  }

  return sale;
}

/**
 * Removes a sale and its lines (the client's "undo") by deleting the rows.
 *
 * @remarks The application role has no DELETE grant on `sales`, so the database rejects this
 * operation (the error propagates to the caller).
 */
export async function deleteSale(
  storeId: string,
  userId: string,
  saleId: string,
): Promise<void> {
  await withTenant(
    storeId,
    userId,
    async (tx) => {
      await tx.saleLine.deleteMany({ where: { storeId, saleId } });
      await tx.sale.deleteMany({ where: { storeId, id: saleId } });
    },
    prisma,
  );
}
