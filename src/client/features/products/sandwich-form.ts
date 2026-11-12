/**
 * @file sandwich-form.ts
 * @description Pure state helpers for `SandwichFormModal`: turns what the user typed into a
 * live cost/profit preview and a validated request body. The cost rules themselves live in
 * `@/domain/recipe`; the server recalculates the cost on save, so this preview never
 * becomes the stored value.
 */

import {
  allowedRecipeUnits,
  calculateMarginPercent,
  calculateRecipeCost,
  isWeightUnit,
  toRecipeBaseQuantity,
  type RecipeInputUnit,
} from "@/domain/recipe";
import { normalizeNumberString, parseEgpToPiasters } from "@/domain/money";
import { normalizeArabic } from "@/domain/normalize";
import { t } from "@/client/shared/i18n";
import type { SandwichInput } from "@/schemas/sandwich";
import type {
  Sandwich,
  SandwichIngredientOption,
} from "@/client/shared/api/sandwiches";

/** One editable ingredient row. `quantity` is the raw text the user typed. */
export interface IngredientRow {
  key: string;
  variantId: string;
  quantity: string;
  unit: RecipeInputUnit;
}

export interface RowPreview {
  costPiasters: number | null;
  missingCost: boolean;
  error?:
    | "errProduct"
    | "errQuantity"
    | "errWholeGrams"
    | "errWholePieces"
    | "errDuplicate";
}

export interface SandwichPreview {
  rows: RowPreview[];
  costPiasters: number;
  sellPricePiasters: number;
  profitPiasters: number;
  marginPercent: number | null;
}

/**
 * Word for one base unit of a non-weighed ingredient: the product's own selling unit
 * (قطعة, كيس, علبة, …). A bag product's stock is counted in bags, so "1" means one bag.
 */
export function recipeUnitLabel(unit: string | null | undefined): string {
  if (!unit || unit === "piece" || unit === "unit")
    return t("sandwich.unitPiece");
  if (unit === "bag") return t("sandwich.unitBag");
  if (unit === "carton") return t("sandwich.unitCarton");
  return unit;
}

/** True for products stocked as whole packs (bag/carton): a recipe consumes whole packs. */
export function isWholePackUnit(unit: string | null | undefined): boolean {
  return (
    unit === "bag" || unit === "carton" || unit === "كرتونة" || unit === "كيس"
  );
}

/**
 * Ingredient priority groups for the picker (0 = first). A product joins a group when one of
 * its name words *starts with* a keyword (after normalizing Arabic and dropping a leading
 * "ال"), so "جبنة رومي" and "الجبنة البيضاء" match cheese, while "بسكويت بالجبنة" (a
 * cheese-flavoured biscuit) does not. Keywords include common spelling variants.
 */
const PRIORITY_KEYWORDS: ReadonlyArray<readonly string[]> = [
  // 1. cheese, luncheon
  ["جبن", "لانشون", "لانشن", "لانشيون", "cheese", "luncheon"],
  // 2. chips
  ["شيبسي", "شيبس", "chips", "chipsy"],
  // 3. ketchup, mayonnaise
  [
    "كاتشاب",
    "كاتشب",
    "كتشب",
    "كاتشوب",
    "مايونيز",
    "مايونيس",
    "ketchup",
    "mayo",
  ],
];
const OTHER_GROUP = PRIORITY_KEYWORDS.length;

function nameTokens(text: string | null | undefined): string[] {
  return normalizeArabic(text ?? "")
    .split(" ")
    .filter(Boolean)
    .map((tok) =>
      tok.startsWith("ال") && tok.length > 3 ? tok.slice(2) : tok,
    );
}

/** Priority group of an ingredient name (0–2 for common sandwich items, 3 for the rest). */
export function ingredientPriority(
  option: Pick<SandwichIngredientOption, "name">,
): number {
  // Ranked by the shop's own product name only. The English catalog name is used for search
  // but not for ranking: "بسكويت بالجبنة" is "Cheese crackers" in English, and must not be
  // promoted as cheese. A product whose own name is English is still ranked by it.
  const tokens = nameTokens(option.name);
  const group = PRIORITY_KEYWORDS.findIndex((keywords) =>
    tokens.some((tok) =>
      keywords.some((kw) => tok.startsWith(normalizeArabic(kw))),
    ),
  );
  return group === -1 ? OTHER_GROUP : group;
}

/**
 * Filters ingredient options by a search query and orders them by priority group, then by
 * name. Matching ignores case, diacritics and common Arabic letter variants; every word of
 * the query must appear in the Arabic or English name. Returns new arrays only — option
 * objects and ids are untouched.
 */
export function searchIngredientOptions(
  options: readonly SandwichIngredientOption[],
  query: string,
): Array<SandwichIngredientOption & { priority: number }> {
  const words = normalizeArabic(query).split(" ").filter(Boolean);
  return options
    .filter((o) => {
      if (words.length === 0) return true;
      const haystack = `${normalizeArabic(o.name)} ${normalizeArabic(o.nameEn ?? "")}`;
      return words.every((w) => haystack.includes(w));
    })
    .map((o) => ({ ...o, priority: ingredientPriority(o) }))
    .sort(
      (a, b) => a.priority - b.priority || a.name.localeCompare(b.name, "ar"),
    );
}

let rowCounter = 0;
export function newRowKey(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

export function emptyRow(): IngredientRow {
  return { key: newRowKey(), variantId: "", quantity: "", unit: "piece" };
}

/** Default recipe unit for a product: grams for weighed goods, pieces otherwise. */
export function defaultUnitFor(
  option: SandwichIngredientOption | undefined,
): RecipeInputUnit {
  return option && isWeightUnit(option.unit) ? "g" : "piece";
}

/** Rows for editing an existing sandwich (weights shown in grams). */
export function rowsFromSandwich(sandwich: Sandwich): IngredientRow[] {
  return sandwich.ingredients.map((ing) => ({
    key: newRowKey(),
    variantId: ing.variantId,
    quantity: String(ing.quantityBase),
    unit: ing.isWeight ? "g" : "piece",
  }));
}

function parseAmount(text: string): number {
  const clean = normalizeNumberString(text);
  if (!clean) return NaN;
  return Number(clean);
}

/** Live preview of every row's cost, the total cost, profit and margin. */
export function previewSandwich(
  rows: readonly IngredientRow[],
  options: readonly SandwichIngredientOption[],
  sellPriceText: string,
): SandwichPreview {
  const byId = new Map(options.map((o) => [o.variantId, o]));
  const seen = new Set<string>();
  const costInputs: Array<{
    quantityBase: number;
    buyPricePiasters: number;
    unit: string;
  }> = [];
  const costIndex: number[] = [];

  const rowPreviews: RowPreview[] = rows.map((row, i) => {
    const option = byId.get(row.variantId);
    if (!option)
      return { costPiasters: null, missingCost: false, error: "errProduct" };
    if (seen.has(row.variantId)) {
      return { costPiasters: null, missingCost: false, error: "errDuplicate" };
    }
    seen.add(row.variantId);
    const unit = allowedRecipeUnits(option.unit).includes(row.unit)
      ? row.unit
      : defaultUnitFor(option);
    const qty = toRecipeBaseQuantity(parseAmount(row.quantity), unit);
    if (!qty.ok) {
      const error =
        qty.reason === "fractional_base"
          ? option.isWeight
            ? "errWholeGrams"
            : "errWholePieces"
          : "errQuantity";
      return { costPiasters: null, missingCost: false, error };
    }
    costIndex[i] = costInputs.length;
    costInputs.push({
      quantityBase: qty.quantityBase,
      buyPricePiasters: option.buyPricePiasters,
      unit: option.unit,
    });
    return { costPiasters: 0, missingCost: option.buyPricePiasters <= 0 };
  });

  const cost = calculateRecipeCost(costInputs);
  rowPreviews.forEach((preview, i) => {
    const idx = costIndex[i];
    if (idx !== undefined && preview.costPiasters !== null) {
      preview.costPiasters = cost.lines[idx]?.costPiasters ?? 0;
    }
  });

  const sell = sellPriceText.trim() ? parseEgpToPiasters(sellPriceText) : 0;
  return {
    rows: rowPreviews,
    costPiasters: cost.totalPiasters,
    sellPricePiasters: sell,
    profitPiasters: sell - cost.totalPiasters,
    marginPercent: calculateMarginPercent(sell, cost.totalPiasters),
  };
}

export type FormErrors = Partial<
  Record<"name" | "price" | "ingredients", string>
> & { rows?: Record<string, string> };

/**
 * Validates the form and builds the request body. Returns the i18n keys of the errors (under
 * `sandwich.*`) when invalid.
 */
export function buildSandwichInput(
  name: string,
  sellPriceText: string,
  rows: readonly IngredientRow[],
  options: readonly SandwichIngredientOption[],
): { ok: true; input: SandwichInput } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  if (name.trim().length < 2) errors.name = "errName";
  const preview = previewSandwich(rows, options, sellPriceText);
  if (preview.sellPricePiasters <= 0) errors.price = "errPrice";
  if (rows.length === 0) errors.ingredients = "errNoIngredients";
  const rowErrors: Record<string, string> = {};
  preview.rows.forEach((r, i) => {
    const row = rows[i];
    if (r.error && row) rowErrors[row.key] = r.error;
  });
  if (Object.keys(rowErrors).length > 0) errors.rows = rowErrors;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const byId = new Map(options.map((o) => [o.variantId, o]));
  return {
    ok: true,
    input: {
      name: name.trim(),
      sellPricePiasters: preview.sellPricePiasters,
      ingredients: rows.map((row) => {
        const option = byId.get(row.variantId);
        const unit =
          option && !allowedRecipeUnits(option.unit).includes(row.unit)
            ? defaultUnitFor(option)
            : row.unit;
        return {
          variantId: row.variantId,
          quantity: parseAmount(row.quantity),
          unit,
        };
      }),
    },
  };
}
