import { type HesbaDatabase } from "../db";
import { normalizeArabic } from "@/domain/normalize";

export interface CatalogVariantResult {
  id: string;
  globalProductId: string;
  flavor: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  packQty: number;
  nameNorm: string;
}

export interface CatalogSearchResult {
  product: {
    id: string;
    nameAr: string;
    nameEn: string | null;
    category: string;
    type: string;
  };
  brand: {
    id: string;
    nameAr: string;
  } | null;
  variants: CatalogVariantResult[];
  matchType: "exact" | "prefix" | "contains";
}

/**
 * Searches the local IndexedDB catalog completely offline.
 * Supports Arabic text normalization (hamzas, alif maqsura, taa marbuta, digits).
 * Returns matching products with their variants and brand.
 */
export async function searchOfflineCatalog(
  db: HesbaDatabase,
  query: string,
  options?: { limit?: number; category?: string },
): Promise<CatalogSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = options?.limit ?? 20;
  const normalizedQuery = normalizeArabic(trimmed);

  // 1. Fetch candidates from local IndexedDB
  // Use prefix match on name_norm if possible, or scan collection
  const products = await db.global_products
    .where("name_norm")
    .startsWith(normalizedQuery)
    .limit(limit)
    .toArray();

  let matchType: "exact" | "prefix" | "contains" = "prefix";

  // If few prefix matches, search for substring / word match
  if (products.length < limit) {
    const additional = await db.global_products
      .filter((p) => {
        if (options?.category && p.category !== options.category) return false;
        return (
          p.name_norm.includes(normalizedQuery) || p.name_ar.includes(trimmed)
        );
      })
      .limit(limit)
      .toArray();

    const existingIds = new Set(products.map((p) => p.id));
    for (const add of additional) {
      if (!existingIds.has(add.id) && products.length < limit) {
        products.push(add);
        existingIds.add(add.id);
        matchType = "contains";
      }
    }
  }

  if (products.length === 0) {
    return [];
  }

  // 2. Fetch associated brands and variants for found products
  const productIds = products.map((p) => p.id);
  const brandIds = products.map((p) => p.brand_id).filter(Boolean) as string[];

  const [allVariants, allBrands] = await Promise.all([
    db.global_variants.where("global_product_id").anyOf(productIds).toArray(),
    brandIds.length > 0
      ? db.global_brands.where("id").anyOf(brandIds).toArray()
      : Promise.resolve([]),
  ]);

  const brandsMap = new Map(allBrands.map((b) => [b.id, b]));
  const variantsMap = new Map<string, CatalogVariantResult[]>();

  for (const v of allVariants) {
    const list = variantsMap.get(v.global_product_id) || [];
    list.push({
      id: v.id,
      globalProductId: v.global_product_id,
      flavor: v.flavor ?? null,
      sizeValue: v.size_value ?? null,
      sizeUnit: v.size_unit ?? null,
      packQty: v.pack_qty ?? 1,
      nameNorm: v.name_norm,
    });
    variantsMap.set(v.global_product_id, list);
  }

  return products.map((p) => {
    const brand = p.brand_id ? brandsMap.get(p.brand_id) : null;
    const variants = variantsMap.get(p.id) || [];
    const isExact = p.name_norm === normalizedQuery;

    return {
      product: {
        id: p.id,
        nameAr: p.name_ar,
        nameEn: p.name_en ?? null,
        category: p.category,
        type: p.type,
      },
      brand: brand
        ? {
            id: brand.id,
            nameAr: brand.name_ar,
          }
        : null,
      variants,
      matchType: isExact ? "exact" : matchType,
    };
  });
}
