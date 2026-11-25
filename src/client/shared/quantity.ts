/**
 * @file quantity.ts
 * @description Quantities on the simple-mode screens: stock is kept in base units (grams for
 * goods sold by the kilo, pieces otherwise); the owner types kilos or pieces.
 */
import { normDigits } from "@/client/shared/i18n";

export const isKilo = (unit: string | null | undefined) => unit === "kg";

/** «1.25» kilos → 1250 grams; «3» pieces → 3. null when not a valid non-negative number. */
export function toBaseQty(
  unit: string | null | undefined,
  text: string,
): number | null {
  const t = normDigits(text).trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  if (isKilo(unit)) return Math.round(n * 1000);
  return Number.isInteger(n) ? n : null;
}

/** 1250 grams → «1.25 ك»; 3 pieces → «3». */
export function formatBaseQty(
  unit: string | null | undefined,
  base: number,
): string {
  if (isKilo(unit)) {
    const kilos = base / 1000;
    return `${Number(kilos.toFixed(3)).toLocaleString("en-US")} ك`;
  }
  return base.toLocaleString("en-US");
}

/** The unit word shown next to an input. */
export const qtyUnitWord = (unit: string | null | undefined) =>
  isKilo(unit) ? "كيلو" : "قطعة";

export interface StoreVariantOption {
  variantId: string;
  name: string;
  unit: string;
  category: string;
  stockBase: number;
}

/** Flattens `/api/products?scope=store` into one option per variant. */
export function variantOptions(data: unknown): StoreVariantOption[] {
  const products =
    (data as { products?: Array<Record<string, unknown>> })?.products ?? [];
  const out: StoreVariantOption[] = [];
  for (const p of products) {
    const variants = (p["variants"] as Array<Record<string, unknown>>) ?? [];
    const multi = variants.length > 1;
    for (const v of variants) {
      const flavor = (v["flavor"] as string | null) ?? null;
      out.push({
        variantId: String(v["id"]),
        name:
          String(p["name_ar"] ?? "صنف") +
          (multi && flavor ? ` — ${flavor}` : ""),
        unit: String(p["unit"] ?? "piece"),
        category: String(p["category"] ?? ""),
        stockBase: Number(v["stock_quantity"] ?? 0),
      });
    }
  }
  return out;
}

/**
 * The message when a money / stock operation failed. These operations are NOT queued offline:
 * nothing is shown as recorded before the server confirmed it, and a retry reuses the same
 * operation id (recorded once).
 */
export function failureMessage(err: unknown, fallback: string): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "العملية دي محتاجة نت ومتسجلتش. جرّب تاني لما النت يرجع — مش هتتسجل مرتين.";
  }
  return err instanceof Error && err.message ? err.message : fallback;
}
