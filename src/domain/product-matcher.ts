import { areSizesEqual, normalizeArabic, normalizeSize } from "./normalize";

export interface MatchableProduct {
  name: string;
  brand?: string | null;
  flavor?: string | null;
  sizeValue?: number | string | null;
  sizeUnit?: string | null;
  packQty?: number | null;
  category?: string | null;
}

export type MatchResultType = "exact_match" | "potential_match" | "no_match";

export interface MatchResult {
  matchType: MatchResultType;
  confidence: number;
  reason: string;
  details: {
    brandMatch: boolean;
    nameSimilarity: number;
    sizeMatch: boolean;
    flavorMatch: boolean;
    packQtyMatch: boolean;
  };
}

/**
 * Calculates trigram similarity (Dice coefficient over character 3-grams)
 * between two normalized Arabic strings. Returns a float between 0.0 and 1.0.
 */
export function calculateTrigramSimilarity(strA: string, strB: string): number {
  const a = normalizeArabic(strA);
  const b = normalizeArabic(strB);

  if (a === b) return 1.0;
  if (!a || !b) return 0.0;
  if (a.length < 3 || b.length < 3) {
    // Fallback for very short strings: token equality or Jaccard
    return a === b ? 1.0 : a.includes(b) || b.includes(a) ? 0.8 : 0.0;
  }

  const getTrigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i <= s.length - 3; i++) {
      const gram = s.substring(i, i + 3);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };

  const trigramsA = getTrigrams(a);
  const trigramsB = getTrigrams(b);

  let intersection = 0;
  for (const [gram, countA] of trigramsA.entries()) {
    const countB = trigramsB.get(gram);
    if (countB) {
      intersection += Math.min(countA, countB);
    }
  }

  const totalA = a.length - 2;
  const totalB = b.length - 2;
  return (2.0 * intersection) / (totalA + totalB);
}

/**
 * Compares two products across brand, name, flavor, size, unit, and pack quantity.
 * Strictly avoids falsely merging distinct products.
 *
 * Outcomes:
 * 1. exact_match: High confidence that candidate represents the exact same sellable variant.
 * 2. potential_match: High similarity with minor ambiguity (e.g. missing metadata on one side); requires review.
 * 3. no_match: Distinct products (different brands, conflicting sizes, conflicting flavors, or low similarity).
 */
export function matchProducts(
  candidate: MatchableProduct,
  target: MatchableProduct,
): MatchResult {
  const normCandidateName = normalizeArabic(candidate.name);
  const normTargetName = normalizeArabic(target.name);

  // 1. Brand matching
  const candBrand = normalizeArabic(candidate.brand ?? "");
  const targetBrand = normalizeArabic(target.brand ?? "");
  const hasBothBrands = Boolean(candBrand && targetBrand);
  const brandMatch = hasBothBrands
    ? candBrand === targetBrand
    : !candBrand && !targetBrand
      ? true
      : false;

  // If both have brands and they differ explicitly, they are DIFFERENT products!
  if (hasBothBrands && candBrand !== targetBrand) {
    return {
      matchType: "no_match",
      confidence: 0,
      reason: `Brands conflict: "${candidate.brand}" vs "${target.brand}"`,
      details: {
        brandMatch: false,
        nameSimilarity: calculateTrigramSimilarity(
          normCandidateName,
          normTargetName,
        ),
        sizeMatch: false,
        flavorMatch: false,
        packQtyMatch: false,
      },
    };
  }

  // 2. Flavor matching
  const candFlavor = normalizeArabic(candidate.flavor ?? "");
  const targetFlavor = normalizeArabic(target.flavor ?? "");
  const hasBothFlavors = Boolean(candFlavor && targetFlavor);
  const flavorMatch = hasBothFlavors
    ? candFlavor === targetFlavor
    : !candFlavor && !targetFlavor;

  // If both have flavors and they conflict (e.g. Cheese vs Chili), NEVER match!
  if (hasBothFlavors && candFlavor !== targetFlavor) {
    return {
      matchType: "no_match",
      confidence: 0,
      reason: `Flavors conflict: "${candidate.flavor}" vs "${target.flavor}"`,
      details: {
        brandMatch,
        nameSimilarity: calculateTrigramSimilarity(
          normCandidateName,
          normTargetName,
        ),
        sizeMatch: false,
        flavorMatch: false,
        packQtyMatch: false,
      },
    };
  }

  // 3. Size & Unit matching (1000g equals 1kg, 1000ml equals 1L)
  const candSizeNorm = normalizeSize(candidate.sizeValue, candidate.sizeUnit);
  const targetSizeNorm = normalizeSize(target.sizeValue, target.sizeUnit);
  const hasBothSizes = Boolean(candSizeNorm && targetSizeNorm);
  const sizeMatch = areSizesEqual(
    { value: candidate.sizeValue, unit: candidate.sizeUnit },
    { value: target.sizeValue, unit: target.sizeUnit },
  );

  // If both have sizes and they conflict, NEVER merge! (e.g. 250g vs 500g)
  if (hasBothSizes && !sizeMatch) {
    return {
      matchType: "no_match",
      confidence: 0,
      reason: `Sizes conflict: ${candidate.sizeValue}${candidate.sizeUnit} vs ${target.sizeValue}${target.sizeUnit}`,
      details: {
        brandMatch,
        nameSimilarity: calculateTrigramSimilarity(
          normCandidateName,
          normTargetName,
        ),
        sizeMatch: false,
        flavorMatch,
        packQtyMatch: false,
      },
    };
  }

  // 4. Pack Quantity matching
  const candPack = candidate.packQty ?? 1;
  const targetPack = target.packQty ?? 1;
  const packQtyMatch = candPack === targetPack;

  if (candPack !== targetPack) {
    return {
      matchType: "no_match",
      confidence: 0,
      reason: `Pack quantities conflict: pack of ${candPack} vs pack of ${targetPack}`,
      details: {
        brandMatch,
        nameSimilarity: calculateTrigramSimilarity(
          normCandidateName,
          normTargetName,
        ),
        sizeMatch,
        flavorMatch,
        packQtyMatch: false,
      },
    };
  }

  // 5. Name Similarity
  const nameSimilarity = calculateTrigramSimilarity(
    normCandidateName,
    normTargetName,
  );

  // Exact Match Evaluation
  // If base names match exactly (or similarity >= 0.92) AND sizes match AND flavors match AND brands match
  const isExactName =
    normCandidateName === normTargetName || nameSimilarity >= 0.92;
  const isSameFlavorOrBothEmpty =
    flavorMatch || (!candidate.flavor && !target.flavor);
  const isSameSizeOrBothEmpty =
    sizeMatch && (!candidate.sizeValue || hasBothSizes);

  if (
    isExactName &&
    brandMatch &&
    isSameFlavorOrBothEmpty &&
    isSameSizeOrBothEmpty &&
    packQtyMatch
  ) {
    return {
      matchType: "exact_match",
      confidence: 1.0,
      reason: "Confirmed exact match across all attributes",
      details: {
        brandMatch,
        nameSimilarity,
        sizeMatch,
        flavorMatch,
        packQtyMatch,
      },
    };
  }

  // Potential Match Evaluation (requires human review, never automatically merged)
  if (nameSimilarity >= 0.65) {
    // Only potential if brands do not actively conflict and sizes do not actively conflict
    const confidence = Number((nameSimilarity * 0.9).toFixed(2));
    return {
      matchType: "potential_match",
      confidence,
      reason:
        "High similarity but requires verification of packaging or variant details",
      details: {
        brandMatch,
        nameSimilarity,
        sizeMatch,
        flavorMatch,
        packQtyMatch,
      },
    };
  }

  return {
    matchType: "no_match",
    confidence: 0,
    reason: "Low similarity or distinct product definition",
    details: {
      brandMatch,
      nameSimilarity,
      sizeMatch,
      flavorMatch,
      packQtyMatch,
    },
  };
}
