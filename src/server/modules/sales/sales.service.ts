import "server-only";

/**
 * @file sales.service.ts
 * @description Use cases behind `/api/sales`: list recent sales, record a sale, and void
 * (undo) a sale. Every query runs inside `withTenant` so Postgres RLS scopes it to the store.
 *
 * @usedBy
 * - src/app/api/sales/route.ts
 *
 * @remarks
 * - The server owns the whole sale (ADR-0019): `recordSale` writes the sale, its lines and
 *   the stock deduction (FEFO batches + `type: "sale"` movements) in ONE transaction, prices
 *   it from the shop's registered prices, and rejects a quantity above the stock (409). The
 *   client never deducts stock itself.
 * - Stock rows are locked before they are read (`lockStockLevelInTx`), so concurrent sales
 *   of the same product cannot both pass the stock check or overwrite each other.
 * - The client's `opId` makes a sale idempotent (unique `(store_id, op_id)`).
 * - Sandwich sales (ADR-0018) consume their ingredients the same way and store a cost
 *   snapshot (`cost_piasters`).
 * - The `sale_lines` table requires exactly one target per line
 *   (`chk_sale_lines_exactly_one_target`), and `sales` is append-only for the application role
 *   (no UPDATE/DELETE grant). Undo is `voidSale`: a `sale_voids` row plus reversing
 *   `sale_void` stock movements (ADR-0022) — the sale itself is never changed or deleted.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/infra/db/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import {
  depleteVariantFefoInTx,
  lockStockLevelInTx,
  lockStockLevelsInTx,
  restoreSaleTakesInTx,
} from "@/server/modules/inventory";
import { changeMachineBalanceInTx } from "@/server/modules/machines";
import { findPromotionInTx } from "@/server/modules/promotions";
import {
  isSandwichProductInTx,
  prepareSandwichSaleInTx,
} from "@/server/modules/sandwiches";
import { toCairoDateString } from "@/domain/time";
import { normalizeArabic } from "@/domain/normalize";
import { isWeightUnit } from "@/domain/recipe";
import {
  allocateByWeight,
  isServiceProduct,
  saleLineTotalPiasters,
} from "@/domain/sale-pricing";
import type {
  CreateSaleInput,
  RecordedSale,
  RecordedSaleLine,
  VoidSaleInput,
  VoidedSale,
} from "@/schemas/sale";

/** Fallback product name used for unnamed cash sales. */
const CASH_SALE_NAME = "بيعة نقدية";

/** Category given to a service sold by name before it existed in the shop's products. */
const SERVICE_SALE_CATEGORY = "خدمات وفواتير";

const ZERO = BigInt(0);

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
  /** True when the sale was undone (ADR-0022): listed for the record, never counted. */
  voided: boolean;
  /** When it was undone (epoch ms); null for an active sale. */
  voidedAt: number | null;
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
 * Returns the store's 200 most recent sales (voided ones included and flagged), plus today's
 * subset and total ("today" is the Cairo calendar day). The total and count cover only sales
 * that were not voided: this list is the Sales screen's only source of recorded sales (QA-09).
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
          saleVoid: { select: { createdAt: true } },
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
    // A promotion sale has one line per item: list it as one entry named after its items.
    const lineNames = s.saleLines.map(
      (l) =>
        (l.storeVariant?.storeProduct || l.storeProduct)?.nameAr ||
        CASH_SALE_NAME,
    );
    return {
      id: s.id,
      productId:
        prod?.id || line?.storeProductId || line?.storeVariantId || s.id,
      name:
        lineNames.length > 1
          ? lineNames.join(" + ")
          : prod?.nameAr || CASH_SALE_NAME,
      amountPiasters: Number(s.totalPiasters),
      quantity: s.saleLines.length > 1 ? 1 : line?.quantityBaseUnits || 1,
      category: prod?.category || "عام",
      unit: prod?.unit || "piece",
      timestamp: s.createdAt.getTime(),
      costPiasters:
        line?.costPiasters != null ? Number(line.costPiasters) : null,
      voided: s.saleVoid !== null,
      voidedAt: s.saleVoid ? s.saleVoid.createdAt.getTime() : null,
    };
  });

  const todaySales = formatted.filter(
    (s) => toCairoDateString(s.timestamp) === todayCairo,
  );
  const todayActive = todaySales.filter((s) => !s.voided);
  const todayTotalPiasters = todayActive.reduce(
    (sum, s) => sum + s.amountPiasters,
    0,
  );

  return {
    sales: formatted,
    todaySales,
    todayTotalPiasters,
    todayCount: todayActive.length,
  };
}

/**
 * Records a completed cash sale — the sale, its lines, the stock deduction (FEFO batches and
 * `type: "sale"` movements) — in ONE tenant transaction, and returns it as recorded (ADR-0019).
 * Any failure rolls back everything: there is never a sale without its stock deduction, or a
 * stock deduction without its sale.
 *
 * Kinds of sale:
 * - **Ordinary product:** resolved from `variantId`, else `productId` (a variant id, or a
 *   product id → its first active variant). Priced from the variant's registered selling
 *   price (`saleLineTotalPiasters`); the client's amount is ignored. The variant's stock row
 *   is locked first; a quantity above the stock is rejected with 409 and nothing is written.
 *   The line targets only the variant (`chk_sale_lines_exactly_one_target`).
 * - **Sandwich** (ADR-0018): `recordSandwichSaleInTx`.
 * - **Promotion:** `promotionId`; items and price come from the offer the shop saved.
 * - **Service** (no stock): the amount the customer paid is the client's `amountPiasters`,
 *   because it varies per transaction. A service not yet in the shop is created by name, as
 *   before.
 *
 * Idempotency: the client's `opId` is stored on the sale (unique per store). A second request
 * with the same `opId` — sequential or concurrent — returns the first sale and changes
 * nothing. Without an `opId` the server generates one, so each request is a new sale.
 *
 * The sale time is always the server's clock; the client's `timestamp` is ignored.
 *
 * @throws AppError 404 (unknown product or offer), 400 (hidden product, missing service
 *   amount, invalid offer), 409 with `details.shortages` (not enough stock).
 */
export async function recordSale(
  storeId: string,
  userId: string,
  input: CreateSaleInput,
): Promise<RecordedSale> {
  const saleId = isValidUuid(input.id) ? input.id : crypto.randomUUID();
  const opId = input.opId ?? crypto.randomUUID();
  const now = new Date();

  try {
    const recorded = await withTenant(
      storeId,
      userId,
      async (tx) => {
        const sale = await recordSaleKindInTx(tx);
        // A replayed opId must be the SAME sale; checked in this transaction (QA-27).
        if (sale.duplicate) {
          assertSameSaleRequest(
            sale,
            input,
            await isServiceSaleInTx(tx, storeId, sale.id),
          );
        }
        return sale;
      },
      prisma,
    );
    return recorded;
  } catch (err) {
    // A concurrent request with the same opId committed first: (store_id, op_id) is unique,
    // so this transaction rolled back entirely. Return the sale that won.
    if (
      input.opId &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await findSaleSummaryByOpId(storeId, userId, {
        ...input,
        opId: input.opId,
      });
      if (existing) return existing;
    }
    throw err;
  }

  async function recordSaleKindInTx(tx: TenantTx): Promise<RecordedSale> {
    if (input.promotionId) {
      return recordPromotionSaleInTx(tx, storeId, {
        saleId,
        opId,
        promotionId: input.promotionId,
        now,
      });
    }

    if (
      input.productId &&
      isValidUuid(input.productId) &&
      (await isSandwichProductInTx(tx, storeId, input.productId))
    ) {
      const sale = await recordSandwichSaleInTx(tx, storeId, {
        saleId,
        opId,
        sandwichId: input.productId,
        count: input.quantityBase,
        createdAt: now,
      });
      return loadSaleSummaryInTx(tx, storeId, sale.id, sale.duplicate);
    }

    const target = await resolveSaleTargetInTx(tx, storeId, input);
    if (target.isService) {
      return recordServiceSaleInTx(tx, storeId, {
        saleId,
        opId,
        target,
        quantityBase: input.quantityBase,
        amountPiasters: input.amountPiasters,
        machineId: input.machineId,
        machineDeductPiasters: input.machineDeductPiasters,
        now,
      });
    }
    return recordProductSaleInTx(tx, storeId, {
      saleId,
      opId,
      target,
      quantityBase: input.quantityBase,
      now,
    });
  }
}

/**
 * A replayed `opId` must be a retry of the SAME sale (QA-27): the same item and quantity (or
 * the same offer, or the same service amount). Otherwise the client reused an id for another
 * sale: 409, and the recorded sale is neither repeated nor reported as this one.
 *
 * Only a service sale's amount comes from the client, so only there is a different
 * `amountPiasters` a different sale; for goods, sandwiches and offers it is ignored.
 */
function assertSameSaleRequest(
  recorded: RecordedSale,
  input: CreateSaleInput,
  isServiceSale: boolean,
): void {
  const mismatch = () =>
    AppError.conflict("رقم العملية ده اتسجل قبل كده لبيعة مختلفة");
  if (input.promotionId) {
    if (recorded.lines.length === 0) throw mismatch();
    return;
  }
  const wanted = isValidUuid(input.variantId)
    ? input.variantId
    : isValidUuid(input.productId)
      ? input.productId
      : null;
  const line = recorded.lines.find(
    (l) =>
      wanted !== null && (l.variantId === wanted || l.productId === wanted),
  );
  if (wanted !== null && !line) throw mismatch();
  if (line && line.quantityBase !== input.quantityBase) throw mismatch();
  if (
    isServiceSale &&
    input.amountPiasters !== undefined &&
    recorded.totalPiasters !== input.amountPiasters
  ) {
    throw mismatch(); // a service sale retried with another amount
  }
}

/** True when the sale's lines are services (their amount was entered by the cashier). */
async function isServiceSaleInTx(
  tx: TenantTx,
  storeId: string,
  saleId: string,
): Promise<boolean> {
  const lines = await tx.saleLine.findMany({
    where: { storeId, saleId },
    select: {
      storeProduct: { select: { category: true, unit: true } },
      storeVariant: {
        select: { storeProduct: { select: { category: true, unit: true } } },
      },
    },
  });
  return (
    lines.length > 0 &&
    lines.every((l) => {
      const product = l.storeVariant?.storeProduct ?? l.storeProduct;
      return product !== null && isServiceProduct(product);
    })
  );
}

/** The product a sale line points at, resolved inside the sale transaction. */
interface SaleTarget {
  productId: string;
  name: string;
  unit: string;
  isActive: boolean;
  isService: boolean;
  productPricePiasters: bigint;
  /** The sold variant; null only for a service product without variants. */
  variant: { id: string; sellPricePiasters: bigint } | null;
}

/**
 * Resolves the sold item to a store product (and variant) of THIS store. Ids from another
 * store are not visible through RLS and also filtered by `storeId`, so they resolve to 404.
 */
async function resolveSaleTargetInTx(
  tx: TenantTx,
  storeId: string,
  input: CreateSaleInput,
): Promise<SaleTarget> {
  const productSelect = {
    id: true,
    nameAr: true,
    unit: true,
    category: true,
    isActive: true,
    sellPricePiasters: true,
  } as const;
  const toTarget = (
    product: {
      id: string;
      nameAr: string | null;
      unit: string;
      category: string | null;
      isActive: boolean;
      sellPricePiasters: bigint;
    },
    variant: { id: string; sellPricePiasters: bigint } | null,
  ): SaleTarget => ({
    productId: product.id,
    name: product.nameAr ?? CASH_SALE_NAME,
    unit: product.unit,
    isActive: product.isActive,
    isService: isServiceProduct(product),
    productPricePiasters: product.sellPricePiasters,
    variant,
  });

  // 1. A variant id (sent as variantId, or as productId by older clients)
  for (const id of [input.variantId, input.productId]) {
    if (!isValidUuid(id)) continue;
    const variant = await tx.storeVariant.findFirst({
      where: { id, storeId },
      select: {
        id: true,
        sellPricePiasters: true,
        storeProduct: { select: productSelect },
      },
    });
    if (variant?.storeProduct) {
      return toTarget(variant.storeProduct, {
        id: variant.id,
        sellPricePiasters: variant.sellPricePiasters,
      });
    }
  }

  // 2. A product id → its first active variant
  if (isValidUuid(input.productId)) {
    const product = await tx.storeProduct.findFirst({
      where: { id: input.productId, storeId },
      select: {
        ...productSelect,
        storeVariants: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true, sellPricePiasters: true },
        },
      },
    });
    if (product) return toTarget(product, product.storeVariants[0] ?? null);
  }

  // 3. A service sold by name (a catalog service not yet added to the shop): find it, or
  //    create it so the sale keeps a readable name. Goods are never created by name.
  if (input.machineId && input.name) {
    const existing = await tx.storeProduct.findFirst({
      where: { storeId, nameAr: input.name },
      select: {
        ...productSelect,
        storeVariants: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true, sellPricePiasters: true },
        },
      },
    });
    if (existing && isServiceProduct(existing)) {
      return toTarget(existing, existing.storeVariants[0] ?? null);
    }
    const price = BigInt(input.amountPiasters ?? 0);
    const created = await tx.storeProduct.create({
      data: {
        storeId,
        nameAr: input.name,
        nameNorm: normalizeArabic(input.name),
        category: SERVICE_SALE_CATEGORY,
        unit: "piece",
        sellPricePiasters: price,
        isCustom: true,
        storeVariants: {
          create: { storeId, sellPricePiasters: price, packQty: 1 },
        },
      },
      select: {
        ...productSelect,
        storeVariants: { select: { id: true, sellPricePiasters: true } },
      },
    });
    return toTarget(created, created.storeVariants[0] ?? null);
  }

  throw AppError.notFound("المنتج ده مش موجود في محلك");
}

/**
 * Sells `quantityBase` of an ordinary product. Locks the variant's stock row, re-checks the
 * `opId` (a concurrent duplicate waits for the lock and then finds the first sale), rejects a
 * shortage, then writes the sale, one variant line, and the FEFO stock deduction.
 */
async function recordProductSaleInTx(
  tx: TenantTx,
  storeId: string,
  params: {
    saleId: string;
    opId: string;
    target: SaleTarget;
    quantityBase: number;
    now: Date;
  },
): Promise<RecordedSale> {
  const { target, quantityBase, now } = params;
  if (!target.isActive) {
    throw AppError.badRequest("المنتج ده مخفي، أظهره الأول عشان تبيعه");
  }
  if (!target.variant) {
    throw shortageError([
      {
        variantId: null,
        name: target.name,
        unit: target.unit,
        neededBase: quantityBase,
        availableBase: 0,
      },
    ]);
  }
  const variantId = target.variant.id;

  const available = await lockStockLevelInTx(tx, storeId, variantId);
  const duplicate = await findSaleIdByOpIdInTx(tx, storeId, params.opId);
  if (duplicate) return loadSaleSummaryInTx(tx, storeId, duplicate, true);

  if (available < BigInt(quantityBase)) {
    throw shortageError([
      {
        variantId,
        name: target.name,
        unit: target.unit,
        neededBase: quantityBase,
        availableBase: Number(available < ZERO ? ZERO : available),
      },
    ]);
  }

  const unitPrice =
    target.variant.sellPricePiasters > ZERO
      ? target.variant.sellPricePiasters
      : target.productPricePiasters;
  const total = saleLineTotalPiasters(
    target.unit,
    toSafeNumber(unitPrice),
    quantityBase,
  );

  const sale = await tx.sale.create({
    data: {
      id: params.saleId,
      storeId,
      paymentMethod: "cash",
      totalPiasters: BigInt(total),
      opId: params.opId,
      createdAt: now,
    },
    select: { id: true },
  });
  const line = await tx.saleLine.create({
    data: {
      storeId,
      saleId: sale.id,
      storeVariantId: variantId,
      quantityBaseUnits: quantityBase,
      unitPricePiasters: unitPrice,
      totalPiasters: BigInt(total),
      createdAt: now,
    },
    select: { id: true },
  });
  const depleted = await depleteVariantFefoInTx(tx, storeId, {
    storeVariantId: variantId,
    storeProductId: target.productId,
    quantityBase: BigInt(quantityBase),
    saleLineId: line.id,
    opId: null,
    now,
  });
  // The line's cost is what this sale actually consumed, from the batches' recorded totals
  // (ADR-0021, QA-07). Null when any part's cost is unknown — never estimated.
  if (depleted.costPiasters !== null) {
    await tx.saleLine.update({
      where: { id: line.id },
      data: { costPiasters: BigInt(depleted.costPiasters) },
    });
  }

  return {
    id: sale.id,
    totalPiasters: total,
    duplicate: false,
    lines: [
      {
        productId: target.productId,
        variantId,
        quantityBase,
        totalPiasters: total,
        stockAfterBase: depleted.newBalance,
      },
    ],
  };
}

/**
 * Sells a service (top-up, bill, card). Services hold no stock; the amount is what the cashier
 * entered for this transaction.
 *
 * When the service is paid through a POS machine (`machineDeductPiasters` > 0), the machine is
 * charged INSIDE this transaction (ADR-0020): the machine row is locked, the balance must
 * cover the deduction (no overdraft), and the ledger row carries the sale's `opId`. The sale
 * and the machine deduction therefore commit or roll back together, and a retry with the same
 * `opId` charges the machine once.
 */
async function recordServiceSaleInTx(
  tx: TenantTx,
  storeId: string,
  params: {
    saleId: string;
    opId: string;
    target: SaleTarget;
    quantityBase: number;
    amountPiasters: number | undefined;
    machineId: string | null | undefined;
    machineDeductPiasters: number | null | undefined;
    now: Date;
  },
): Promise<RecordedSale> {
  const { target, now } = params;
  const duplicate = await findSaleIdByOpIdInTx(tx, storeId, params.opId);
  if (duplicate) return loadSaleSummaryInTx(tx, storeId, duplicate, true);

  const amount = params.amountPiasters ?? 0;
  if (amount <= 0) {
    throw AppError.badRequest("اكتب المبلغ اللي الزبون دفعه");
  }
  if (params.quantityBase !== 1) {
    throw AppError.badRequest("الخدمة بتتباع واحدة واحدة");
  }

  let machine: RecordedSale["machine"];
  const deduct = params.machineDeductPiasters ?? 0;
  if (deduct > 0) {
    if (deduct > amount) {
      throw AppError.badRequest(
        "المبلغ المخصوم من الماكينة أكبر من اللي الزبون دفعه",
      );
    }
    if (!isValidUuid(params.machineId)) {
      throw AppError.notFound("ماكينة الدفع غير موجودة أو تم حذفها");
    }
    const charged = await changeMachineBalanceInTx(
      tx,
      storeId,
      params.machineId,
      { kind: "delta", amountPiasters: -deduct },
      {
        opId: params.opId,
        source: `بيع خدمة: ${target.name}`,
        reference: params.saleId,
      },
    );
    if (charged.duplicate) {
      // A concurrent request with this opId committed the sale and the charge first.
      const winner = await findSaleIdByOpIdInTx(tx, storeId, params.opId);
      if (winner) return loadSaleSummaryInTx(tx, storeId, winner, true);
      throw AppError.conflict("العملية دي اتسجلت قبل كده");
    }
    machine = {
      machineId: charged.machineId,
      balanceAfterPiasters: charged.balanceAfterPiasters,
    };
  }

  const sale = await tx.sale.create({
    data: {
      id: params.saleId,
      storeId,
      paymentMethod: "cash",
      totalPiasters: BigInt(amount),
      opId: params.opId,
      createdAt: now,
    },
    select: { id: true },
  });
  await tx.saleLine.create({
    data: {
      storeId,
      saleId: sale.id,
      // Exactly one target: the variant when the service has one, else the product.
      storeVariantId: target.variant?.id ?? null,
      storeProductId: target.variant ? null : target.productId,
      quantityBaseUnits: 1,
      unitPricePiasters: BigInt(amount),
      totalPiasters: BigInt(amount),
      // A service paid through a machine costs the shop what the machine paid out (the
      // recorded charge); without a machine charge its cost is unknown (QA-07).
      costPiasters: machine ? BigInt(deduct) : null,
      createdAt: now,
    },
  });

  return {
    id: sale.id,
    totalPiasters: amount,
    duplicate: false,
    lines: [
      {
        productId: target.productId,
        variantId: target.variant?.id ?? null,
        quantityBase: 1,
        totalPiasters: amount,
        stockAfterBase: null,
      },
    ],
    ...(machine ? { machine } : {}),
  };
}

/**
 * Sells one published offer (bundle or single discount). The items and the offer price are
 * read from the shop's saved offer, never from the client. All items' stock rows are locked
 * (in id order), every item must be in stock, then the sale gets one line per item: its
 * `unit_price_piasters` is the item's regular selling price and its `total_piasters` is its
 * share of the offer price (split by regular value, `allocateByWeight`), so the lines add up
 * exactly to the offer price.
 */
async function recordPromotionSaleInTx(
  tx: TenantTx,
  storeId: string,
  params: { saleId: string; opId: string; promotionId: string; now: Date },
): Promise<RecordedSale> {
  const { now } = params;
  const promo = await findPromotionInTx(tx, storeId, params.promotionId);
  if (!promo) throw AppError.notFound("العرض ده مش موجود");
  const offerTotal = promo.promoPricePiasters;
  if (!Number.isSafeInteger(offerTotal) || offerTotal <= 0) {
    throw AppError.badRequest("سعر العرض غير صحيح");
  }
  if (!Array.isArray(promo.items) || promo.items.length === 0) {
    throw AppError.badRequest("العرض ده مافيهوش منتجات");
  }

  const items: Array<{
    variantId: string;
    productId: string;
    name: string;
    unit: string;
    quantityBase: number;
    unitPrice: bigint;
  }> = [];
  for (const item of promo.items) {
    const qty = item.quantityBase;
    if (
      !isValidUuid(item.variantId) ||
      !Number.isSafeInteger(qty) ||
      qty <= 0
    ) {
      throw AppError.badRequest("العرض ده فيه منتج غير صحيح");
    }
    const variant = await tx.storeVariant.findFirst({
      where: { id: item.variantId, storeId },
      select: {
        id: true,
        sellPricePiasters: true,
        storeProduct: {
          select: {
            id: true,
            nameAr: true,
            unit: true,
            isActive: true,
            sellPricePiasters: true,
          },
        },
      },
    });
    if (!variant?.storeProduct || !variant.storeProduct.isActive) {
      throw AppError.badRequest(
        `«${item.productName}» من العرض مش موجود في محلك`,
      );
    }
    items.push({
      variantId: variant.id,
      productId: variant.storeProduct.id,
      name: variant.storeProduct.nameAr ?? item.productName,
      unit: variant.storeProduct.unit,
      quantityBase: qty,
      unitPrice:
        variant.sellPricePiasters > ZERO
          ? variant.sellPricePiasters
          : variant.storeProduct.sellPricePiasters,
    });
  }

  const levels = await lockStockLevelsInTx(
    tx,
    storeId,
    items.map((i) => i.variantId),
  );
  const duplicate = await findSaleIdByOpIdInTx(tx, storeId, params.opId);
  if (duplicate) return loadSaleSummaryInTx(tx, storeId, duplicate, true);

  const needs = new Map<string, number>();
  for (const i of items) {
    needs.set(i.variantId, (needs.get(i.variantId) ?? 0) + i.quantityBase);
  }
  const shortages: SaleShortage[] = [];
  for (const [variantId, need] of needs) {
    const have = levels.get(variantId) ?? ZERO;
    if (have < BigInt(need)) {
      const item = items.find((i) => i.variantId === variantId)!;
      shortages.push({
        variantId,
        name: item.name,
        unit: item.unit,
        neededBase: need,
        availableBase: Number(have < ZERO ? ZERO : have),
      });
    }
  }
  if (shortages.length > 0) throw shortageError(shortages);

  const shares = allocateByWeight(
    offerTotal,
    items.map((i) =>
      saleLineTotalPiasters(i.unit, toSafeNumber(i.unitPrice), i.quantityBase),
    ),
  );

  const sale = await tx.sale.create({
    data: {
      id: params.saleId,
      storeId,
      paymentMethod: "cash",
      totalPiasters: BigInt(offerTotal),
      opId: params.opId,
      createdAt: now,
    },
    select: { id: true },
  });

  const lines: RecordedSaleLine[] = [];
  for (const [index, item] of items.entries()) {
    const share = shares[index] ?? 0;
    const line = await tx.saleLine.create({
      data: {
        storeId,
        saleId: sale.id,
        storeVariantId: item.variantId,
        quantityBaseUnits: item.quantityBase,
        unitPricePiasters: item.unitPrice,
        totalPiasters: BigInt(share),
        createdAt: now,
      },
      select: { id: true },
    });
    const depleted = await depleteVariantFefoInTx(tx, storeId, {
      storeVariantId: item.variantId,
      storeProductId: item.productId,
      quantityBase: BigInt(item.quantityBase),
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
    lines.push({
      productId: item.productId,
      variantId: item.variantId,
      quantityBase: item.quantityBase,
      totalPiasters: share,
      stockAfterBase: depleted.newBalance,
    });
  }

  return { id: sale.id, totalPiasters: offerTotal, duplicate: false, lines };
}

/** One item the stock cannot cover (same shape as the sandwich `IngredientShortage`). */
interface SaleShortage {
  variantId: string | null;
  name: string;
  unit: string;
  neededBase: number;
  availableBase: number;
}

function formatQuantity(base: number, unit: string): string {
  if (isWeightUnit(unit)) return `${base} جرام`;
  if (unit === "piece" || unit === "unit") return `${base} قطعة`;
  if (unit === "bag") return `${base} كيس`;
  if (unit === "carton") return `${base} كرتونة`;
  return `${base} ${unit}`;
}

function shortageError(shortages: SaleShortage[]): AppError {
  const parts = shortages.map(
    (s) =>
      `«${s.name}» محتاج ${formatQuantity(s.neededBase, s.unit)} والموجود ${formatQuantity(s.availableBase, s.unit)}`,
  );
  return new AppError(
    "CONFLICT",
    `الكمية في المخزن مش كفاية: ${parts.join("، ")}`,
    409,
    { shortages },
  );
}

function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw AppError.badRequest("السعر كبير قوي");
  }
  return n;
}

async function findSaleIdByOpIdInTx(
  tx: TenantTx,
  storeId: string,
  opId: string,
): Promise<string | null> {
  const sale = await tx.sale.findFirst({
    where: { storeId, opId },
    select: { id: true },
  });
  return sale?.id ?? null;
}

/**
 * A recorded sale in the `POST /api/sales` response shape. `stockAfterBase` is the variant's
 * current balance (for a replayed `opId` it reflects any later operations).
 */
async function loadSaleSummaryInTx(
  tx: TenantTx,
  storeId: string,
  saleId: string,
  duplicate: boolean,
): Promise<RecordedSale> {
  const sale = await tx.sale.findFirstOrThrow({
    where: { id: saleId, storeId },
    select: {
      id: true,
      totalPiasters: true,
      saleLines: {
        orderBy: { createdAt: "asc" },
        select: {
          storeProductId: true,
          storeVariantId: true,
          quantityBaseUnits: true,
          totalPiasters: true,
          storeVariant: { select: { storeProductId: true } },
        },
      },
    },
  });
  const variantIds = sale.saleLines
    .map((l) => l.storeVariantId)
    .filter((id): id is string => id !== null);
  const levels = await tx.stockLevel.findMany({
    where: { storeId, storeVariantId: { in: variantIds } },
    select: { storeVariantId: true, quantityBase: true },
  });
  const levelOf = new Map(
    levels.map((l) => [l.storeVariantId, Number(l.quantityBase)]),
  );
  return {
    id: sale.id,
    totalPiasters: Number(sale.totalPiasters),
    duplicate,
    lines: sale.saleLines.map((l) => ({
      productId: l.storeVariant?.storeProductId ?? l.storeProductId,
      variantId: l.storeVariantId,
      quantityBase: l.quantityBaseUnits,
      totalPiasters: Number(l.totalPiasters),
      stockAfterBase: l.storeVariantId
        ? (levelOf.get(l.storeVariantId) ?? 0)
        : null,
    })),
  };
}

/** The sale that won a concurrent same-`opId` race, after checking it is the same request. */
async function findSaleSummaryByOpId(
  storeId: string,
  userId: string,
  input: CreateSaleInput & { opId: string },
): Promise<RecordedSale | null> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const id = await findSaleIdByOpIdInTx(tx, storeId, input.opId);
      if (!id) return null;
      const sale = await loadSaleSummaryInTx(tx, storeId, id, true);
      assertSameSaleRequest(
        sale,
        input,
        await isServiceSaleInTx(tx, storeId, id),
      );
      return sale;
    },
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
): Promise<{ id: string; duplicate: boolean }> {
  const duplicate = await tx.sale.findFirst({
    where: { storeId, opId: params.opId },
    select: { id: true },
  });
  if (duplicate) return { id: duplicate.id, duplicate: true };

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

  return { id: sale.id, duplicate: false };
}

/**
 * Undoes a recorded sale with a reversing void (ADR-0022, QA-10) — never a delete. In ONE
 * tenant transaction:
 * 1. finds the sale in THIS store (another store's id is not visible → 404);
 * 2. records the void (`sale_voids`, append-only). It is unique per sale and per `opId`, so a
 *    concurrent second void waits for the first and then fails as a duplicate, rolling back
 *    entirely: the stock is never restored twice;
 * 3. puts back exactly what the sale took, from its recorded `type: "sale"` movements
 *    (`restoreSaleTakesInTx`): same batches, same quantities, whatever prices or stock are now;
 * 4. refunds the POS-machine charge of a service sale (the machine ledger, same transaction).
 *
 * The sale row, its lines and its movements stay as they were (auditable); lists and reports
 * leave voided sales out of revenue.
 *
 * Voiding a sale that is already void returns the existing void with `alreadyVoided: true`
 * and changes nothing (the same answer for a retried request with the same `opId`).
 *
 * @throws AppError 404 (unknown sale), 409 (the `opId` belongs to another sale's void, or the
 *   stock cannot be restored consistently).
 */
export async function voidSale(
  storeId: string,
  userId: string,
  input: VoidSaleInput,
): Promise<VoidedSale> {
  const opId = input.opId ?? crypto.randomUUID();
  const now = new Date();
  try {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id: input.saleId, storeId },
          select: {
            id: true,
            opId: true,
            totalPiasters: true,
            saleVoid: true,
            saleLines: { select: { id: true } },
          },
        });
        if (!sale) throw AppError.notFound("البيعة دي مش موجودة");

        const sameOp = await tx.saleVoid.findFirst({
          where: { storeId, opId },
        });
        if (sameOp && sameOp.saleId !== sale.id) {
          throw AppError.conflict("العملية دي اتسجلت قبل كده لبيعة تانية");
        }
        if (sale.saleVoid) {
          return alreadyVoidedResult(tx, storeId, sale.id);
        }

        const saleVoid = await tx.saleVoid.create({
          data: {
            storeId,
            saleId: sale.id,
            opId,
            reason: input.reason || null,
            voidedBy: userId,
            createdAt: now,
          },
        });

        const restored = await restoreSaleTakesInTx(tx, storeId, {
          saleLineIds: sale.saleLines.map((l) => l.id),
          opId,
          now,
        });

        // A service paid through a POS machine: give the machine back what the sale charged.
        let machine: VoidedSale["machine"];
        const charge = await tx.posMachineTopup.findFirst({
          where: { storeId, opId: sale.opId },
          select: { machineId: true, amountPiasters: true },
        });
        if (charge && charge.amountPiasters < ZERO) {
          const refund = await changeMachineBalanceInTx(
            tx,
            storeId,
            charge.machineId,
            { kind: "delta", amountPiasters: Number(-charge.amountPiasters) },
            {
              opId,
              source: "إلغاء بيعة خدمة",
              reference: sale.id,
            },
          );
          machine = {
            machineId: refund.machineId,
            balanceAfterPiasters: refund.balanceAfterPiasters,
          };
        }

        return {
          saleId: sale.id,
          voidId: saleVoid.id,
          voidedAt: saleVoid.createdAt.toISOString(),
          totalPiasters: Number(sale.totalPiasters),
          alreadyVoided: false,
          stock: [...restored].map(([variantId, balance]) => ({
            variantId,
            stockAfterBase: Number(balance),
          })),
          ...(machine ? { machine } : {}),
        };
      },
      prisma,
    );
  } catch (err) {
    // Another void of this sale (or with this opId) committed first; this one rolled back.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return withTenant(
        storeId,
        userId,
        (tx) => alreadyVoidedResult(tx, storeId, input.saleId),
        prisma,
      );
    }
    throw err;
  }
}

/** The existing void of a sale, reported without doing anything again. */
async function alreadyVoidedResult(
  tx: TenantTx,
  storeId: string,
  saleId: string,
): Promise<VoidedSale> {
  const sale = await tx.sale.findFirstOrThrow({
    where: { id: saleId, storeId },
    select: {
      totalPiasters: true,
      saleVoid: true,
      saleLines: { select: { storeVariantId: true } },
    },
  });
  if (!sale.saleVoid) throw AppError.conflict("البيعة دي لسه ما اتلغتش");
  const restored = await tx.stockMovement.findMany({
    where: { storeId, opId: sale.saleVoid.opId, type: "sale_void" },
    select: { storeVariantId: true },
  });
  const variantIds = [...new Set(restored.map((m) => m.storeVariantId))];
  const levels = await tx.stockLevel.findMany({
    where: { storeId, storeVariantId: { in: variantIds } },
    select: { storeVariantId: true, quantityBase: true },
  });
  return {
    saleId,
    voidId: sale.saleVoid.id,
    voidedAt: sale.saleVoid.createdAt.toISOString(),
    totalPiasters: Number(sale.totalPiasters),
    alreadyVoided: true,
    stock: levels.map((l) => ({
      variantId: l.storeVariantId,
      stockAfterBase: Number(l.quantityBase),
    })),
  };
}
