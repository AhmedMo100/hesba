/**
 * @file recipe.ts
 * @description Pure rules for composite products ("sandwiches", ADR-0018): ingredient cost,
 * recipe cost, profit, recipe scaling and how many units the current stock can make.
 *
 * @remarks
 * - Money is integer piasters (AGENTS.md rule 5). Ingredient costs are computed exactly in
 *   **milli-piasters** (1/1000 piaster) with `bigint`, summed, and rounded to piasters **once**
 *   (half up). No floating-point money.
 * - Quantities are integer base units: grams for products sold by `kg`/`g`, otherwise one unit
 *   of the product's own selling unit (piece, علبة, …). Sub-gram amounts are not supported,
 *   matching the stock ledger's integer base units.
 * - Cost basis follows the registered purchase price of the ingredient product
 *   (`buyPricePiasters`): per kg for `kg` products, per gram for `g` products, per unit
 *   otherwise. A pack (e.g. bread bag of 10) is registered per piece by the product form, so
 *   its per-piece price is already the right basis; {@link perPieceCostFromPack} documents
 *   that conversion.
 */

/** Category every sandwich is filed under (shown as a chip on the Products screen). */
export const SANDWICH_CATEGORY = "ساندوتشات";

/** Most ingredients one recipe may hold (keeps forms and sale transactions small). */
export const MAX_RECIPE_INGREDIENTS = 30;

/** How a product's registered purchase price maps to its integer base unit. */
export type IngredientCostBasis = "per_kg" | "per_gram" | "per_unit";

/** Unit the user picks for an ingredient amount in the recipe form. */
export type RecipeInputUnit = "g" | "kg" | "piece";

const ZERO = BigInt(0);
const THOUSAND = BigInt(1000);
const HALF_THOUSAND = BigInt(500);

/** True when the product's stock is counted in grams (sold by kilo or gram). */
export function isWeightUnit(unit: string | null | undefined): boolean {
  return unit === "kg" || unit === "g";
}

/** Cost basis of a product's registered purchase price, from its selling unit. */
export function costBasisForUnit(
  unit: string | null | undefined,
): IngredientCostBasis {
  if (unit === "kg") return "per_kg";
  if (unit === "g") return "per_gram";
  return "per_unit";
}

/** Recipe units a product accepts: grams/kilos for weighed goods, pieces otherwise. */
export function allowedRecipeUnits(
  unit: string | null | undefined,
): RecipeInputUnit[] {
  return isWeightUnit(unit) ? ["g", "kg"] : ["piece"];
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${label} must be a non-negative safe integer, received: ${value}`,
    );
  }
}

function toSafeNumber(value: bigint, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return n;
}

/**
 * Exact cost of `quantityBase` base units, in milli-piasters.
 *
 * - `per_kg`: price is per 1000 g → cost = qty × price / 1000 piasters = qty × price milli.
 * - `per_gram` / `per_unit`: cost = qty × price piasters = qty × price × 1000 milli.
 */
export function ingredientCostMilli(
  quantityBase: number,
  buyPricePiasters: number,
  basis: IngredientCostBasis,
): bigint {
  assertNonNegativeSafeInteger(quantityBase, "Quantity");
  assertNonNegativeSafeInteger(buyPricePiasters, "Purchase price");
  const product = BigInt(quantityBase) * BigInt(buyPricePiasters);
  return basis === "per_kg" ? product : product * THOUSAND;
}

/** Rounds milli-piasters to whole piasters, half up (non-negative input). */
export function milliToPiasters(milli: bigint): number {
  if (milli < ZERO) {
    throw new RangeError("Cost cannot be negative");
  }
  return toSafeNumber((milli + HALF_THOUSAND) / THOUSAND, "Cost");
}

/** Cost of one ingredient line, rounded to piasters (for display). */
export function ingredientCostPiasters(
  quantityBase: number,
  buyPricePiasters: number,
  basis: IngredientCostBasis,
): number {
  return milliToPiasters(
    ingredientCostMilli(quantityBase, buyPricePiasters, basis),
  );
}

/**
 * Per-piece cost of a pack bought at `packPricePiasters` holding `packQty` pieces, rounded
 * half up (e.g. a 30 ج bread bag of 10 → 3 ج a piece).
 */
export function perPieceCostFromPack(
  packPricePiasters: number,
  packQty: number,
): number {
  assertNonNegativeSafeInteger(packPricePiasters, "Pack price");
  if (!Number.isSafeInteger(packQty) || packQty <= 0) {
    throw new RangeError(
      `Pack quantity must be a positive integer: ${packQty}`,
    );
  }
  const milli = (BigInt(packPricePiasters) * THOUSAND) / BigInt(packQty);
  return milliToPiasters(milli);
}

export interface RecipeCostLineInput {
  quantityBase: number;
  /** Registered purchase price in piasters (0 when the product has none). */
  buyPricePiasters: number;
  /** The ingredient product's selling unit (`kg`, `g`, `piece`, …). */
  unit: string | null | undefined;
}

export interface RecipeCostLine {
  costPiasters: number;
  /** True when the ingredient has no registered purchase price, so its cost counts as 0. */
  missingCost: boolean;
}

export interface RecipeCost {
  /** Cost of one recipe unit (one sandwich), rounded once from the exact sum. */
  totalPiasters: number;
  lines: RecipeCostLine[];
  missingCostCount: number;
}

/**
 * Cost of one unit of a recipe. Line costs are rounded only for display; the total is the
 * exact sum rounded once, so it may differ from the sum of the displayed lines by a piaster.
 */
export function calculateRecipeCost(
  lines: readonly RecipeCostLineInput[],
): RecipeCost {
  let totalMilli = ZERO;
  let missingCostCount = 0;
  const out: RecipeCostLine[] = lines.map((line) => {
    const basis = costBasisForUnit(line.unit);
    const milli = ingredientCostMilli(
      line.quantityBase,
      line.buyPricePiasters,
      basis,
    );
    totalMilli += milli;
    const missingCost = line.buyPricePiasters <= 0;
    if (missingCost) missingCostCount += 1;
    return { costPiasters: milliToPiasters(milli), missingCost };
  });
  return {
    totalPiasters: milliToPiasters(totalMilli),
    lines: out,
    missingCostCount,
  };
}

/** Expected profit per unit in piasters (negative when sold below cost). */
export function calculateProfitPiasters(
  sellPricePiasters: number,
  costPiasters: number,
): number {
  if (!Number.isSafeInteger(sellPricePiasters) || sellPricePiasters < 0) {
    throw new RangeError(`Invalid sell price: ${sellPricePiasters}`);
  }
  assertNonNegativeSafeInteger(costPiasters, "Cost");
  return sellPricePiasters - costPiasters;
}

/**
 * Profit margin as a percentage of the selling price, to one decimal place; `null` when the
 * selling price is zero. Display-only (not money).
 */
export function calculateMarginPercent(
  sellPricePiasters: number,
  costPiasters: number,
): number | null {
  if (sellPricePiasters <= 0) return null;
  const profit = calculateProfitPiasters(sellPricePiasters, costPiasters);
  return Math.round((profit * 1000) / sellPricePiasters) / 10;
}

export interface RecipeRequirementInput {
  variantId: string;
  quantityBase: number;
}

/**
 * Total base units of each ingredient needed to make `count` units. Lines for the same
 * variant are summed (the schema rejects duplicates, this keeps the rule total).
 */
export function scaleRecipe(
  lines: readonly RecipeRequirementInput[],
  count: number,
): Map<string, bigint> {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new RangeError(`Count must be a positive integer: ${count}`);
  }
  const needs = new Map<string, bigint>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantityBase) || line.quantityBase <= 0) {
      throw new RangeError(
        `Ingredient quantity must be a positive integer: ${line.quantityBase}`,
      );
    }
    const add = BigInt(line.quantityBase) * BigInt(count);
    needs.set(line.variantId, (needs.get(line.variantId) ?? ZERO) + add);
  }
  return needs;
}

/** How many whole units the stock can make (0 when any ingredient is missing). */
export function maxUnitsFromStock(
  lines: readonly RecipeRequirementInput[],
  stockByVariant: ReadonlyMap<string, number>,
): number {
  if (lines.length === 0) return 0;
  const perUnit = scaleRecipe(lines, 1);
  let max = Number.POSITIVE_INFINITY;
  for (const [variantId, need] of perUnit) {
    const stock = Math.max(0, stockByVariant.get(variantId) ?? 0);
    const possible = Math.floor(stock / Number(need));
    if (possible < max) max = possible;
  }
  return Number.isFinite(max) ? max : 0;
}

export type BaseQuantityResult =
  | { ok: true; quantityBase: number }
  | { ok: false; reason: "not_positive" | "fractional_base" | "too_large" };

/**
 * Converts a recipe amount to integer base units. Kilos convert to grams; the result must be
 * a whole number of grams/pieces (0.5 g or 1.5 pieces is rejected, not rounded).
 */
export function toRecipeBaseQuantity(
  amount: number,
  unit: RecipeInputUnit,
): BaseQuantityResult {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "not_positive" };
  }
  const scaled = unit === "kg" ? amount * 1000 : amount;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    return { ok: false, reason: "fractional_base" };
  }
  if (rounded <= 0) return { ok: false, reason: "not_positive" };
  if (rounded > 1_000_000) return { ok: false, reason: "too_large" };
  return { ok: true, quantityBase: rounded };
}
