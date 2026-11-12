/**
 * Arabic words for stored unit and pack codes (QA-43). Products store English codes
 * (`piece`, `carton`, `bag`, `kg`, ...) or a word the owner typed; the UI never shows a code.
 */

const UNIT_WORDS: Record<string, string> = {
  piece: "قطعة",
  unit: "قطعة",
  can: "علبة",
  jar: "برطمان",
  bag: "كيس",
  carton: "كرتونة",
  dozen: "دستة",
  box: "علبة",
  kg: "كجم",
  g: "جرام",
  gram: "جرام",
  ml: "مللي",
  l: "لتر",
};

/** Pack codes a variant's `sizeUnit` may hold (the product form's packaging choices). */
const PACK_CODES = new Set(["carton", "dozen", "bag", "box"]);

/** Size codes that describe one unit, never a pack (`sizeUnit` may hold these too). */
const SIZE_CODES = new Set(["piece", "unit", "kg", "g", "gram", "ml", "l"]);

/** The selling unit's word: `piece` → قطعة. A word the owner typed is kept as is. */
export function unitWord(unit?: string | null): string {
  const u = (unit ?? "").trim();
  if (!u) return "قطعة";
  return UNIT_WORDS[u.toLowerCase()] ?? u;
}

/**
 * The product's own pack word: `carton` → كرتونة, `bag` → كيس. When the product has no pack
 * word, a 12-pack is a دستة and anything else the neutral عبوة (never a guessed كرتونة).
 */
export function packWord(packName?: string | null, packQty?: number): string {
  const p = (packName ?? "").trim();
  const code = p.toLowerCase();
  if (p && PACK_CODES.has(code)) return UNIT_WORDS[code]!;
  if (p && !SIZE_CODES.has(code) && !/^[a-z]+$/i.test(p)) return p;
  return packQty === 12 ? "دستة" : "عبوة";
}
