/**
 * @file scan-matcher.ts
 * @description Deterministic matching of what the scanner model SAW (brand, name, flavor,
 * size) to the shop's real products (ADR-0030). The model identifies; this code — and then the
 * shopkeeper — decides which Hesba product it is. Prices, stock, ids and units never come from
 * the model: they are carried over from the shop's records passed in.
 *
 * Conservative by design:
 * - a known brand, size or flavor that CONFLICTS with a product excludes it (a 1 L bottle is
 *   never matched to the 330 ml can);
 * - "matched" needs a strong score, a confident model and a clear lead over the runner-up;
 *   anything else is "uncertain" (the user must choose) or "unmatched" (manual search).
 */
import { calculateTrigramSimilarity } from "./product-matcher";
import { normalizeArabic, normalizeSize, normalizeUnit } from "./normalize";

export interface SeenProduct {
  imageIndex: number;
  brand: string | null;
  nameAr: string | null;
  nameEn: string | null;
  flavor: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  packaging: string | null;
  productType: string | null;
  quantity: number;
  confidence: number;
}

export interface ShopProduct {
  variantId: string;
  productId: string;
  name: string;
  brandAr: string | null;
  brandEn: string | null;
  flavor: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  packQty: number;
  unit: string;
  sellPricePiasters: number;
  stockBase: number;
}

export type ScanMatchStatus = "matched" | "uncertain" | "unmatched";

export interface ScanCandidate {
  product: ShopProduct;
  score: number;
}

export interface ScanMatch {
  /** Stable key of this line in the review list. */
  key: string;
  seen: SeenProduct;
  /** Photos the product was seen in (after merging duplicates). */
  imageIndexes: number[];
  /** Total units seen, summed over the photos it was merged from. */
  quantity: number;
  status: ScanMatchStatus;
  /** Best match first; at most 3. Empty when nothing is close. */
  candidates: ScanCandidate[];
}

export const MATCH_SCORE = 0.72;
export const UNCERTAIN_SCORE = 0.38;
export const MIN_MODEL_CONFIDENCE = 0.6;
export const MIN_LEAD = 0.12;

const SIZE_IN_NAME =
  /(\d+(?:[.,]\d+)?)\s*(مل|ملل|ml|لتر|ل|l|جم|جرام|g|gm|كجم|كيلو|kg)(?![\p{L}])/iu;

/** A size written in a product's name, e.g. «بيبسي كانز 330 مل» → 330 ml. */
export function sizeFromName(
  name: string,
): { value: number; unit: string } | null {
  const m = normalizeArabic(name).match(SIZE_IN_NAME);
  if (!m) return null;
  return { value: Number(m[1]!.replace(",", ".")), unit: normalizeUnit(m[2]!) };
}

function norm(s: string | null | undefined): string {
  return normalizeArabic(s ?? "");
}

function contains(haystack: string, needle: string): boolean {
  return Boolean(needle) && haystack.includes(needle);
}

/** The best similarity between any of the seen names and the product's searchable text. */
function nameScore(seen: SeenProduct, text: string, nameOnly: string): number {
  const names = [
    seen.nameAr,
    seen.nameEn,
    [seen.brand, seen.nameAr].filter(Boolean).join(" "),
  ]
    .map(norm)
    .filter(Boolean);
  let best = 0;
  for (const n of names) {
    const tokens = n.split(" ").filter((t) => t.length >= 2);
    const allIn = tokens.length > 0 && tokens.every((t) => text.includes(t));
    best = Math.max(
      best,
      calculateTrigramSimilarity(n, nameOnly),
      allIn ? 0.85 : 0,
      contains(nameOnly, n) ? 0.9 : 0,
    );
  }
  return best;
}

/** Scores one product for one seen item; `null` = excluded by a conflicting brand/size/flavor. */
export function scoreProduct(seen: SeenProduct, p: ShopProduct): number | null {
  const nameOnly = norm(p.name);
  const text = [
    nameOnly,
    norm(p.brandAr),
    norm(p.brandEn),
    norm(p.flavor),
  ].join(" ");

  let bonus = 0;
  // Brand: known on both sides and different = a different product.
  const seenBrand = norm(seen.brand);
  if (seenBrand) {
    const brands = [norm(p.brandAr), norm(p.brandEn)].filter(Boolean);
    const inText = contains(text, seenBrand);
    if (brands.length > 0 && !brands.includes(seenBrand) && !inText)
      return null;
    if (inText || brands.includes(seenBrand)) bonus += 0.1;
  }

  // Size: the variant's size, or the size written in the product's name.
  const seenSize = normalizeSize(seen.sizeValue, seen.sizeUnit);
  const fromName = sizeFromName(p.name);
  const productSize =
    normalizeSize(p.sizeValue, p.sizeUnit) ??
    (fromName ? normalizeSize(fromName.value, fromName.unit) : null);
  if (seenSize && productSize) {
    if (seenSize.baseUnit !== productSize.baseUnit) return null;
    if (seenSize.baseValue !== productSize.baseValue) return null;
    bonus += 0.15;
  } else if (seenSize && !productSize) {
    bonus -= 0.08; // the shop's product does not say its size: cannot be sure
  }

  // Flavor: known on both sides and different = a different product.
  const seenFlavor = norm(seen.flavor);
  if (seenFlavor) {
    const pFlavor = norm(p.flavor);
    if (pFlavor && pFlavor !== seenFlavor && !contains(nameOnly, seenFlavor))
      return null;
    if (pFlavor === seenFlavor || contains(nameOnly, seenFlavor)) bonus += 0.1;
    else bonus -= 0.3; // flavor not stated on the product: maybe another flavor
  }

  const base = nameScore(seen, text, nameOnly);
  if (base < 0.3) return base * 0.5;
  return Math.max(0, Math.min(1, base + bonus));
}

function classify(seen: SeenProduct, ranked: ScanCandidate[]): ScanMatchStatus {
  const best = ranked[0];
  if (!best || best.score < UNCERTAIN_SCORE) return "unmatched";
  const lead = best.score - (ranked[1]?.score ?? 0);
  if (
    best.score >= MATCH_SCORE &&
    seen.confidence >= MIN_MODEL_CONFIDENCE &&
    lead >= MIN_LEAD
  ) {
    return "matched";
  }
  return "uncertain";
}

/** Matches every seen item, then merges items that resolve to the same product. */
export function matchScan(
  seen: SeenProduct[],
  products: ShopProduct[],
): ScanMatch[] {
  const lines: ScanMatch[] = seen.map((s, i) => {
    const ranked = products
      .map((product) => ({ product, score: scoreProduct(s, product) }))
      .filter(
        (c): c is ScanCandidate =>
          c.score !== null && c.score >= UNCERTAIN_SCORE * 0.8,
      )
      .sort(
        (a, b) =>
          b.score - a.score || a.product.name.localeCompare(b.product.name),
      )
      .slice(0, 3)
      .map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 }));
    return {
      key: `s${i}`,
      seen: s,
      imageIndexes: [s.imageIndex],
      quantity: s.quantity,
      status: classify(s, ranked),
      candidates: ranked,
    };
  });

  // The same product seen in several places (or photos) becomes one line, quantities summed;
  // the review screen says it was seen more than once so the user can correct the count.
  const merged: ScanMatch[] = [];
  const byVariant = new Map<string, ScanMatch>();
  for (const line of lines) {
    const top =
      line.status === "matched"
        ? line.candidates[0]?.product.variantId
        : undefined;
    const existing = top ? byVariant.get(top) : undefined;
    if (existing) {
      existing.quantity += line.quantity;
      for (const ix of line.imageIndexes) {
        if (!existing.imageIndexes.includes(ix)) existing.imageIndexes.push(ix);
      }
      continue;
    }
    if (top) byVariant.set(top, line);
    merged.push(line);
  }
  return merged;
}
