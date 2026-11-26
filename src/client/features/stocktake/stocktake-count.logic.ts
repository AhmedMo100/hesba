/**
 * @file stocktake-count.logic.ts
 * @description The counting screen's rules, pure (ADR-0039), so they are tested apart:
 *
 * - **A repeated scan never makes a second record.** A product has one line per count. Scanning
 *   it again opens the same line with what was counted so far; what the owner types is ADDED to
 *   it («اتعدّ 17 · + 3 = 20»), and the total is saved — a total, never an increment, so the same
 *   save twice changes nothing. He can switch to «اكتب العدد من الأول» to replace it.
 * - **A carton product** can be counted in cartons and pieces: total = cartons × pack + pieces.
 * - **The difference** is the total counted − what Hesba holds. It is never turned into a sale by
 *   itself: a shortage needs the owner's reason, and only «اتباع ومتسجلش» counts as sold.
 */
import { toBaseQty } from "@/client/shared/quantity";

export type CountMode = "add" | "replace";

/** The pieces (or grams) typed: cartons × pack + the loose quantity. null = not a number. */
export function typedBase(
  unit: string,
  packQty: number,
  loose: string,
  cartons: string,
): number | null {
  const hasLoose = loose.trim() !== "";
  const hasCartons = packQty > 1 && cartons.trim() !== "";
  if (!hasLoose && !hasCartons) return null;
  const l = hasLoose ? toBaseQty(unit, loose) : 0;
  const c = hasCartons ? toBaseQty("piece", cartons) : 0;
  if (l === null || c === null) return null;
  return c * packQty + l;
}

/**
 * The total to save for a line: in «add» mode what was already counted plus what was typed; in
 * «replace» mode what was typed. null when nothing valid was typed.
 */
export function nextTotal(
  already: number | null,
  typed: number | null,
  mode: CountMode,
): number | null {
  if (typed === null) return null;
  if (mode === "add" && already !== null) return already + typed;
  return typed;
}

/** The difference shown and saved: counted − expected (null until something is counted). */
export function differenceOf(
  total: number | null,
  expected: number,
): number | null {
  return total === null ? null : total - expected;
}

/** A scan opens a line in «add» mode once it was counted, else as a first count. */
export function modeForScan(already: number | null): CountMode {
  return already === null ? "replace" : "add";
}

/** A normalised barcode as typed or read (spaces and a scanner's line ending removed). */
export function cleanBarcode(raw: string): string {
  return raw.replace(/\s+/g, "").trim();
}
