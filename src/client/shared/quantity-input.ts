/**
 * @file quantity-input.ts
 * @description A quantity typed in the product's own selling unit — kilograms for weighed
 * goods, packs + loose units for packed goods, units otherwise — as integer base units (grams
 * or pieces), with the domain conversion rules. Shared by every form that takes a quantity.
 */
import { kilogramsToGrams, packsToPieces } from "@/domain/units";

export interface QuantityInput {
  /** Weighed goods: kilograms as typed (decimals allowed, Arabic digits accepted). */
  kg: string;
  packs: string;
  units: string;
}

const toNum = (v: string) => {
  const n = Number(
    v
      .trim()
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace("٫", "."),
  );
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The quantity in base units; 0 when nothing valid is typed. */
export function quantityBaseFromInput(
  input: QuantityInput,
  item: { unitMode: "piece" | "weight"; packQty: number },
): number {
  if (item.unitMode === "weight") {
    const kg = toNum(input.kg);
    return kg > 0 ? kilogramsToGrams(kg) : 0;
  }
  const pack = Math.max(1, item.packQty || 1);
  const packs = Math.floor(toNum(input.packs));
  const units = Math.floor(toNum(input.units));
  return (pack > 1 ? packsToPieces(packs, pack) : 0) + units;
}
