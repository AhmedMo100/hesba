import "server-only";

/**
 * @file sandwiches.service.ts
 * @description Sandwiches: store products of `kind = 'sandwich'` whose stock is their
 * ingredients (ADR-0018). Owns recipe CRUD, the live recipe cost, and the stock check a
 * sandwich sale needs.
 *
 * @usedBy
 * - src/app/api/sandwiches/** (create, edit, read, ingredient options)
 * - src/server/modules/sales (selling a sandwich, through `prepareSandwichSaleInTx`)
 *
 * @remarks
 * - A sandwich has no `store_variants` row and no stock of its own; its ingredients are
 *   existing stock variants of the same store.
 * - Cost is never stored on the sandwich. It is calculated on every read from each
 *   ingredient's registered purchase price (`calculateRecipeCost`), so it follows price
 *   changes. A sale snapshots the cost on its sale line instead.
 * - Hiding a sandwich reuses the products hide path (`CatalogService.hideStoreProduct`).
 * - Sandwiches are never submitted to the community catalog (they bypass
 *   `CatalogService.upsertStoreProduct`).
 * - Every query runs in `withTenant`; the `sandwich_ingredients` trigger additionally rejects
 *   a recipe line that points at another store's product.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/infra/db/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { lockStockLevelsInTx } from "@/server/modules/inventory";
import { normalizeArabic } from "@/domain/normalize";
import {
  SANDWICH_CATEGORY,
  allowedRecipeUnits,
  calculateMarginPercent,
  calculateProfitPiasters,
  calculateRecipeCost,
  isWeightUnit,
  maxUnitsFromStock,
  scaleRecipe,
  toRecipeBaseQuantity,
} from "@/domain/recipe";
import type { SandwichInput } from "@/schemas/sandwich";

const ZERO = BigInt(0);

/** One stock item that can be used as an ingredient. Money in piasters, stock in base units. */
export interface IngredientOption {
  variantId: string;
  productId: string;
  name: string;
  /** English name of the catalog product this item comes from (search only), if any. */
  nameEn: string | null;
  unit: string;
  isWeight: boolean;
  /** Registered purchase price: per kg for `kg`, per gram for `g`, per unit otherwise. */
  buyPricePiasters: number;
  stockBase: number;
}

export interface SandwichIngredientView {
  variantId: string;
  productId: string;
  name: string;
  unit: string;
  isWeight: boolean;
  quantityBase: number;
  buyPricePiasters: number;
  costPiasters: number;
  missingCost: boolean;
  stockBase: number;
}

export interface SandwichView {
  id: string;
  name: string;
  category: string;
  sellPricePiasters: number;
  /** Current cost of one sandwich from today's ingredient prices. */
  costPiasters: number;
  profitPiasters: number;
  marginPercent: number | null;
  isHidden: boolean;
  /** Whole sandwiches the current ingredient stock can make. */
  availableCount: number;
  hasMissingCost: boolean;
  ingredients: SandwichIngredientView[];
}

const sandwichInclude = {
  sandwichIngredients: {
    orderBy: { position: "asc" },
    include: {
      ingredientVariant: {
        include: { storeProduct: true, stockLevels: true },
      },
    },
  },
} satisfies Prisma.StoreProductInclude;

type SandwichRow = Prisma.StoreProductGetPayload<{
  include: typeof sandwichInclude;
}>;

type VariantWithProduct = Prisma.StoreVariantGetPayload<{
  include: { storeProduct: true; stockLevels: true };
}>;

/** Purchase price used for cost: the variant's, else the product's (both per selling unit). */
function resolveBuyPrice(variant: VariantWithProduct): number {
  const variantPrice = Number(variant.buyPricePiasters ?? ZERO);
  if (variantPrice > 0) return variantPrice;
  return Number(variant.storeProduct?.buyPricePiasters ?? ZERO);
}

function variantName(variant: VariantWithProduct): string {
  const base = variant.storeProduct?.nameAr ?? "";
  return variant.flavor ? `${base} — ${variant.flavor}` : base;
}

function stockOf(variant: VariantWithProduct): number {
  return Number(variant.stockLevels[0]?.quantityBase ?? ZERO);
}

function toView(row: SandwichRow): SandwichView {
  const lines = row.sandwichIngredients;
  const cost = calculateRecipeCost(
    lines.map((l) => ({
      quantityBase: l.quantityBase,
      buyPricePiasters: resolveBuyPrice(l.ingredientVariant),
      unit: l.ingredientVariant.storeProduct?.unit,
    })),
  );
  const sell = Number(row.sellPricePiasters);
  const stock = new Map(
    lines.map((l) => [l.ingredientVariantId, stockOf(l.ingredientVariant)]),
  );

  return {
    id: row.id,
    name: row.nameAr ?? "",
    category: row.category,
    sellPricePiasters: sell,
    costPiasters: cost.totalPiasters,
    profitPiasters: calculateProfitPiasters(sell, cost.totalPiasters),
    marginPercent: calculateMarginPercent(sell, cost.totalPiasters),
    isHidden: !row.isActive,
    availableCount: maxUnitsFromStock(
      lines.map((l) => ({
        variantId: l.ingredientVariantId,
        quantityBase: l.quantityBase,
      })),
      stock,
    ),
    hasMissingCost: cost.missingCostCount > 0,
    ingredients: lines.map((l, i) => {
      const v = l.ingredientVariant;
      const unit = v.storeProduct?.unit ?? "piece";
      return {
        variantId: v.id,
        productId: v.storeProductId ?? "",
        name: variantName(v),
        unit,
        isWeight: isWeightUnit(unit),
        quantityBase: l.quantityBase,
        buyPricePiasters: resolveBuyPrice(v),
        costPiasters: cost.lines[i]?.costPiasters ?? 0,
        missingCost: cost.lines[i]?.missingCost ?? true,
        stockBase: stockOf(v),
      };
    }),
  };
}

/**
 * Stock items that can go into a recipe: active variants of active, non-sandwich, non-service
 * products of this store.
 */
export async function listIngredientOptions(
  storeId: string,
  userId: string,
): Promise<IngredientOption[]> {
  const variants = await withTenant(
    storeId,
    userId,
    (tx) =>
      tx.storeVariant.findMany({
        where: {
          storeId,
          isActive: true,
          storeProduct: {
            isActive: true,
            kind: "standard",
            unit: { not: "service" },
          },
        },
        include: {
          storeProduct: {
            include: { globalProduct: { select: { nameEn: true } } },
          },
          stockLevels: true,
        },
      }),
    prisma,
  );

  return variants
    .map((v) => {
      const unit = v.storeProduct?.unit ?? "piece";
      return {
        variantId: v.id,
        productId: v.storeProductId ?? "",
        name: variantName(v),
        nameEn: v.storeProduct?.globalProduct?.nameEn ?? null,
        unit,
        isWeight: isWeightUnit(unit),
        buyPricePiasters: resolveBuyPrice(v),
        stockBase: stockOf(v),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** All sandwiches of the store with their live cost; hidden ones only when asked. */
export async function listSandwiches(
  storeId: string,
  userId: string,
  options: { includeHidden?: boolean } = {},
): Promise<SandwichView[]> {
  const rows = await withTenant(
    storeId,
    userId,
    (tx) =>
      tx.storeProduct.findMany({
        where: {
          storeId,
          kind: "sandwich",
          ...(options.includeHidden ? {} : { isActive: true }),
        },
        include: sandwichInclude,
        orderBy: { createdAt: "desc" },
      }),
    prisma,
  );
  return rows.map(toView);
}

/** One sandwich with its recipe and live cost. @throws AppError 404 when not in this store. */
export async function getSandwich(
  storeId: string,
  userId: string,
  sandwichId: string,
): Promise<SandwichView> {
  return withTenant(
    storeId,
    userId,
    (tx) => readSandwichInTx(tx, storeId, sandwichId),
    prisma,
  );
}

interface ResolvedLine {
  variantId: string;
  quantityBase: number;
  position: number;
}

/**
 * Validates recipe lines against this store's stock items and converts amounts to base units.
 * @throws AppError 400 naming the offending line.
 */
async function resolveRecipeLines(
  tx: TenantTx,
  storeId: string,
  ingredients: SandwichInput["ingredients"],
): Promise<ResolvedLine[]> {
  const ids = ingredients.map((i) => i.variantId);
  const variants = await tx.storeVariant.findMany({
    where: { storeId, id: { in: ids } },
    include: { storeProduct: true, stockLevels: true },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  return ingredients.map((ing, index) => {
    const field = { field: `ingredients.${index}` };
    const variant = byId.get(ing.variantId);
    if (!variant || !variant.storeProduct) {
      throw AppError.badRequest("منتج من المكونات مش موجود في محلك", field);
    }
    const product = variant.storeProduct;
    const name = variantName(variant);
    if (product.kind === "sandwich") {
      throw AppError.badRequest("مينفعش تحط ساندوتش جوه ساندوتش", field);
    }
    if (!variant.isActive || !product.isActive || product.unit === "service") {
      throw AppError.badRequest(`«${name}» مينفعش يتحط كمكوّن`, field);
    }
    if (!allowedRecipeUnits(product.unit).includes(ing.unit)) {
      throw AppError.badRequest(
        isWeightUnit(product.unit)
          ? `«${name}» بيتوزن، اكتب كميته بالجرام أو الكيلو`
          : `«${name}» بيتباع بالقطعة، اكتب كميته بالعدد`,
        field,
      );
    }
    const qty = toRecipeBaseQuantity(ing.quantity, ing.unit);
    if (!qty.ok) {
      throw AppError.badRequest(
        qty.reason === "fractional_base"
          ? isWeightUnit(product.unit)
            ? `كمية «${name}» لازم تكون جرامات صحيحة (مفيش كسور جرام)`
            : `كمية «${name}» لازم تكون عدد صحيح`
          : `كمية «${name}» غير صحيحة`,
        field,
      );
    }
    return {
      variantId: variant.id,
      quantityBase: qty.quantityBase,
      position: index,
    };
  });
}

async function assertNameFree(
  tx: TenantTx,
  storeId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const clash = await tx.storeProduct.findFirst({
    where: {
      storeId,
      kind: "sandwich",
      nameNorm: normalizeArabic(name),
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw AppError.conflict("فيه ساندوتش بنفس الاسم، اختار اسم تاني");
  }
}

/** Reads one sandwich with its recipe inside the caller's transaction. */
async function readSandwichInTx(
  tx: TenantTx,
  storeId: string,
  sandwichId: string,
): Promise<SandwichView> {
  const row = await tx.storeProduct.findFirst({
    where: { id: sandwichId, storeId, kind: "sandwich" },
    include: sandwichInclude,
  });
  if (!row) throw AppError.notFound("الساندوتش ده مش موجود");
  return toView(row);
}

/**
 * Creates a sandwich and its recipe, and returns it, in one transaction (one database
 * round-trip sequence: no second transaction to read the result back).
 */
export async function createSandwich(
  storeId: string,
  userId: string,
  input: SandwichInput,
): Promise<SandwichView> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      await assertNameFree(tx, storeId, input.name);
      const lines = await resolveRecipeLines(tx, storeId, input.ingredients);
      const created = await tx.storeProduct.create({
        data: {
          storeId,
          nameAr: input.name,
          nameNorm: normalizeArabic(input.name),
          category: SANDWICH_CATEGORY,
          unit: "piece",
          sellPricePiasters: BigInt(input.sellPricePiasters),
          buyPricePiasters: ZERO,
          isCustom: true,
          kind: "sandwich",
        },
        select: { id: true },
      });
      await tx.sandwichIngredient.createMany({
        data: lines.map((l) => ({
          storeId,
          sandwichProductId: created.id,
          ingredientVariantId: l.variantId,
          quantityBase: l.quantityBase,
          position: l.position,
        })),
      });
      return readSandwichInTx(tx, storeId, created.id);
    },
    prisma,
  );
}

/**
 * Replaces a sandwich's name, price and recipe. Past sales are untouched: each keeps its own
 * sale line (price, cost snapshot) and ingredient movements. Returns the updated sandwich
 * from the same transaction.
 */
export async function updateSandwich(
  storeId: string,
  userId: string,
  sandwichId: string,
  input: SandwichInput,
): Promise<SandwichView> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const existing = await tx.storeProduct.findFirst({
        where: { id: sandwichId, storeId, kind: "sandwich" },
        select: { id: true },
      });
      if (!existing) throw AppError.notFound("الساندوتش ده مش موجود");
      await assertNameFree(tx, storeId, input.name, sandwichId);
      const lines = await resolveRecipeLines(tx, storeId, input.ingredients);
      await tx.storeProduct.update({
        where: { id: sandwichId },
        data: {
          nameAr: input.name,
          nameNorm: normalizeArabic(input.name),
          sellPricePiasters: BigInt(input.sellPricePiasters),
          updatedAt: new Date(),
        },
      });
      await tx.sandwichIngredient.deleteMany({
        where: { storeId, sandwichProductId: sandwichId },
      });
      await tx.sandwichIngredient.createMany({
        data: lines.map((l) => ({
          storeId,
          sandwichProductId: sandwichId,
          ingredientVariantId: l.variantId,
          quantityBase: l.quantityBase,
          position: l.position,
        })),
      });
      return readSandwichInTx(tx, storeId, sandwichId);
    },
    prisma,
  );
}

/** True when `productId` is a sandwich of this store (used by the sale path to branch). */
export async function isSandwichProductInTx(
  tx: TenantTx,
  storeId: string,
  productId: string,
): Promise<boolean> {
  const row = await tx.storeProduct.findFirst({
    where: { id: productId, storeId, kind: "sandwich" },
    select: { id: true },
  });
  return Boolean(row);
}

export interface SandwichSalePlan {
  sandwichId: string;
  name: string;
  sellPricePiasters: number;
  /** Cost of ONE sandwich at this moment (snapshot for the sale line). */
  unitCostPiasters: number;
  requirements: Array<{
    variantId: string;
    productId: string | null;
    quantityBase: bigint;
  }>;
}

export interface IngredientShortage {
  variantId: string;
  name: string;
  unit: string;
  neededBase: number;
  availableBase: number;
}

function formatAmount(base: number, unit: string): string {
  if (isWeightUnit(unit)) return `${base} جرام`;
  if (unit === "piece" || unit === "unit") return `${base} قطعة`;
  if (unit === "bag") return `${base} كيس`;
  return `${base} ${unit}`;
}

/**
 * Plans selling `count` sandwiches inside the caller's sale transaction.
 *
 * Locks the ingredients' `stock_levels` rows (`FOR UPDATE`, in id order to avoid deadlocks),
 * so two concurrent sandwich sales cannot both pass the check. Rejects the whole sale when any
 * ingredient is short — nothing is deducted and stock never goes below zero through this
 * path.
 *
 * @throws AppError 404 (no such sandwich), 400 (hidden or empty recipe), 409 with
 *   `details.shortages` when the stock is not enough.
 */
export async function prepareSandwichSaleInTx(
  tx: TenantTx,
  storeId: string,
  sandwichId: string,
  count: number,
): Promise<SandwichSalePlan> {
  const row = await tx.storeProduct.findFirst({
    where: { id: sandwichId, storeId, kind: "sandwich" },
    include: sandwichInclude,
  });
  if (!row) throw AppError.notFound("الساندوتش ده مش موجود");
  if (!row.isActive) {
    throw AppError.badRequest("الساندوتش ده مخفي، أظهره الأول عشان تبيعه");
  }
  if (row.sandwichIngredients.length === 0) {
    throw AppError.badRequest("الساندوتش ده مالوش مكونات");
  }
  // A hidden ingredient is never sold through a sandwich (QA-41; hiding one is refused now,
  // this covers ingredients hidden before that rule).
  const hidden = row.sandwichIngredients.find(
    (l) =>
      !l.ingredientVariant.isActive ||
      l.ingredientVariant.storeProduct?.isActive === false,
  );
  if (hidden) {
    throw AppError.badRequest(
      `«${variantName(hidden.ingredientVariant)}» من مكونات الساندوتش مخفي، أظهره أو شيله من الساندوتش الأول`,
    );
  }

  const needs = scaleRecipe(
    row.sandwichIngredients.map((l) => ({
      variantId: l.ingredientVariantId,
      quantityBase: l.quantityBase,
    })),
    count,
  );
  // The shared stock lock (ADR-0019): every stock writer takes the same row locks, in id order.
  const available = await lockStockLevelsInTx(tx, storeId, [...needs.keys()]);

  const shortages: IngredientShortage[] = [];
  for (const line of row.sandwichIngredients) {
    const need = needs.get(line.ingredientVariantId) ?? ZERO;
    const have = available.get(line.ingredientVariantId) ?? ZERO;
    if (have < need) {
      shortages.push({
        variantId: line.ingredientVariantId,
        name: variantName(line.ingredientVariant),
        unit: line.ingredientVariant.storeProduct?.unit ?? "piece",
        neededBase: Number(need),
        availableBase: Number(have < ZERO ? ZERO : have),
      });
    }
  }
  if (shortages.length > 0) {
    const parts = shortages.map(
      (s) =>
        `«${s.name}» محتاج ${formatAmount(s.neededBase, s.unit)} والموجود ${formatAmount(s.availableBase, s.unit)}`,
    );
    throw new AppError(
      "CONFLICT",
      `المكونات مش كفاية: ${parts.join("، ")}`,
      409,
      { shortages },
    );
  }

  const view = toView(row);
  return {
    sandwichId: row.id,
    name: row.nameAr ?? "",
    sellPricePiasters: view.sellPricePiasters,
    unitCostPiasters: view.costPiasters,
    requirements: row.sandwichIngredients.map((l) => ({
      variantId: l.ingredientVariantId,
      productId: l.ingredientVariant.storeProductId,
      quantityBase: needs.get(l.ingredientVariantId) ?? ZERO,
    })),
  };
}
