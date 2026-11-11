import "server-only";

/**
 * @file catalog.service.ts
 * @description The store's product list: store-owned products and variants, merged with the
 * shared global catalog.
 *
 * @responsibility
 * Create/upsert store products and their variants (with an optional opening stock), list the
 * store's products together with global-catalog items, and hide/unhide or deactivate products
 * for this store only.
 *
 * @dependencies
 * `withTenant`, `domain/normalize` (Arabic search key), `domain/product-matcher`, and
 * `CommunitySuggestionsService` (custom products may be submitted to the community pool).
 *
 * @usedBy
 * `src/app/api/products/route.ts`.
 *
 * @remarks
 * Global catalog rows are shared by every store and never hold prices, stock or store
 * identity (AGENTS.md rule 8): a store's price and stock live only on its own
 * `store_products` / `store_variants`.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeArabic } from "@/domain/normalize";
import { matchProducts } from "@/domain/product-matcher";
import { totalFromUnitCost } from "@/domain/stock/batch-cost";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { CommunitySuggestionsService } from "./community-suggestions.service";

export interface CreateStoreProductInput {
  storeId: string;
  userId?: string | null;
  nameAr: string;
  category: string;
  unit: string;
  sellPricePiasters: bigint;
  brandName?: string | null;
  flavor?: string | null;
  sizeValue?: number | null;
  sizeUnit?: string | null;
  packQty?: number | null;
}

export interface CreateStoreProductResult {
  storeProductId: string;
  storeVariantId: string;
  isCustom: boolean;
  globalProductId: string | null;
  globalVariantId: string | null;
  candidateId?: string | null;
  suggestedToCommunity: boolean;
}

function getDefaultTelecomPrice(
  nameAr: string,
  category: string,
  flavor?: string | null,
): { sell: number; buy: number } {
  if (category === "كروت شحن") {
    if (flavor?.includes("100") || nameAr.includes("100"))
      return { sell: 11200, buy: 10600 };
    if (flavor?.includes("50") || nameAr.includes("50"))
      return { sell: 5600, buy: 5300 };
    if (flavor?.includes("25") || nameAr.includes("25"))
      return { sell: 2800, buy: 2650 };
    if (flavor?.includes("10") || nameAr.includes("10"))
      return { sell: 1100, buy: 1050 };
    return { sell: 1100, buy: 1050 };
  }
  if (category === "فواتير إنترنت") {
    return { sell: 500, buy: 0 };
  }
  if (category === "شحن رصيد") {
    return { sell: 300, buy: 0 };
  }
  if (category === "تحويل أموال") {
    return { sell: 500, buy: 0 };
  }
  return { sell: 0, buy: 0 };
}

export class CatalogService {
  private readonly communityService: CommunitySuggestionsService;

  constructor(private readonly prisma: PrismaClient) {
    this.communityService = new CommunitySuggestionsService(prisma);
  }

  /**
   * Adds a product to the store's inventory.
   * 1. Searches global catalog (global_products + global_variants) for exact matches.
   * 2. If matched, links store product to global product and variant.
   * 3. If no match, records as custom product (is_custom = true).
   * 4. If store has share_custom_products enabled, submits product as a candidate.
   * 5. Shop's sell price and inventory NEVER leak to the global catalog.
   */
  async addStoreProduct(
    input: CreateStoreProductInput,
    options?: { now?: Date; tx?: TenantTx },
  ): Promise<CreateStoreProductResult> {
    const now = options?.now ?? new Date();
    const nameNorm = normalizeArabic(input.nameAr);

    // 1. Search Global Catalog for match
    const candidates = await this.prisma.globalProduct.findMany({
      where: {
        category: input.category,
        status: "approved",
      },
      include: {
        brand: true,
        globalVariants: true,
      },
    });

    let matchedGlobalProduct: (typeof candidates)[number] | null = null;
    let matchedGlobalVariantId: string | null = null;

    for (const gp of candidates) {
      for (const gv of gp.globalVariants) {
        const match = matchProducts(
          {
            name: input.nameAr,
            brand: input.brandName,
            flavor: input.flavor,
            sizeValue: input.sizeValue,
            sizeUnit: input.sizeUnit,
            packQty: input.packQty,
            category: input.category,
          },
          {
            name: gp.nameAr,
            brand: gp.brand?.nameAr,
            flavor: gv.flavor,
            sizeValue: gv.sizeValue ? Number(gv.sizeValue) : null,
            sizeUnit: gv.sizeUnit,
            packQty: gv.packQty,
            category: gp.category,
          },
        );

        if (match.matchType === "exact_match") {
          matchedGlobalProduct = gp;
          matchedGlobalVariantId = gv.id;
          break;
        }
      }
      if (matchedGlobalProduct) break;
    }

    const isCustom = !matchedGlobalProduct;
    const globalProductId = matchedGlobalProduct
      ? matchedGlobalProduct.id
      : null;
    const globalVariantId = matchedGlobalVariantId;

    // 2. Execute tenant-isolated product & variant insertion
    const performTenantInserts = async (tx: TenantTx) => {
      const store = await tx.store.findUnique({
        where: { id: input.storeId },
        select: { shareCustomProducts: true },
      });

      // A shop holds each global catalog product once (unique store_id + global_product_id).
      // Adding it again is a clear 409, not a 500 (QA-23). Same-name CUSTOM products are
      // allowed (e.g. two sizes): names are not unique within a shop.
      if (globalProductId) {
        const already = await tx.storeProduct.findFirst({
          where: { storeId: input.storeId, globalProductId },
          select: { id: true },
        });
        if (already) throw duplicateGlobalProductError();
      }

      const storeProduct = await tx.storeProduct.create({
        data: {
          storeId: input.storeId,
          globalProductId,
          nameAr: input.nameAr,
          nameNorm,
          category: input.category,
          unit: input.unit,
          sellPricePiasters: input.sellPricePiasters,
          isCustom,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      const storeVariant = await tx.storeVariant.create({
        data: {
          storeId: input.storeId,
          storeProductId: storeProduct.id,
          productId: globalProductId,
          globalVariantId,
          flavor: input.flavor ?? null,
          sizeValue: input.sizeValue ?? null,
          sizeUnit: input.sizeUnit ?? null,
          packQty: input.packQty ?? 1,
          sellPricePiasters: input.sellPricePiasters,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      return {
        storeProduct,
        storeVariant,
        shareCustomProducts: store?.shareCustomProducts ?? true,
      };
    };

    let inserted: Awaited<ReturnType<typeof performTenantInserts>>;
    try {
      inserted = options?.tx
        ? await performTenantInserts(options.tx)
        : await withTenant(
            input.storeId,
            input.userId ?? null,
            performTenantInserts,
            this.prisma,
          );
    } catch (err) {
      // Two concurrent adds of the same global product: the unique index decides; the loser
      // rolled back entirely and gets the same 409.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw duplicateGlobalProductError();
      }
      throw err;
    }
    const { storeProduct, storeVariant, shareCustomProducts } = inserted;

    // 3. If custom product, check store sharing preference
    let candidateId: string | null = null;
    let suggestedToCommunity = false;

    if (isCustom && shareCustomProducts) {
      const submission = await this.communityService.submitCandidate(
        {
          submittingStoreId: input.storeId,
          nameAr: input.nameAr,
          brandName: input.brandName,
          category: input.category,
          flavor: input.flavor,
          sizeValue: input.sizeValue,
          sizeUnit: input.sizeUnit,
          packQty: input.packQty,
        },
        { now },
      );
      candidateId = submission.candidateId;
      suggestedToCommunity = true;
    }

    return {
      storeProductId: storeProduct.id,
      storeVariantId: storeVariant.id,
      isCustom,
      globalProductId,
      globalVariantId,
      candidateId,
      suggestedToCommunity,
    };
  }

  /**
   * Retrieves all products and variants for a store under tenant isolation.
   * Merges the unified Global Catalog (shared across all stores without row duplication)
   * with shop-specific price overrides and custom products created by this shop.
   */
  async getStoreProducts(
    storeId: string,
    userId: string | null = null,
    options?: {
      includeHidden?: boolean;
      search?: string;
      category?: string;
    },
  ) {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        // 1. Fetch this store's custom products and global overrides
        const storeOverrides = await tx.storeProduct.findMany({
          where: { storeId },
          include: {
            globalProduct: {
              include: {
                brand: true,
                globalVariants: true,
              },
            },
            storeVariants: {
              include: {
                stockLevels: true,
                storeStockBatches: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        });

        const overrideByGlobalId = new Map<
          string,
          (typeof storeOverrides)[number]
        >();
        const customProducts: (typeof storeOverrides)[number][] = [];

        for (const sp of storeOverrides) {
          if (sp.globalProductId) {
            overrideByGlobalId.set(sp.globalProductId, sp);
          } else {
            customProducts.push(sp);
          }
        }

        // 2. Fetch all approved global products from unified shared catalog
        const globalProducts = await this.prisma.globalProduct.findMany({
          where: { status: "approved" },
          include: {
            brand: true,
            globalVariants: true,
          },
          orderBy: { nameAr: "asc" },
        });

        // 3. Compose combined view
        type FormattedVariantItem = {
          id: string;
          flavor: string | null;
          size_value: number | null;
          sizeValue?: number | null;
          size_unit: string | null;
          sizeUnit?: string | null;
          pack_qty: number;
          packQty?: number;
          sell_price_piasters: number;
          sellPricePiasters?: bigint;
          buy_cost_piasters: number;
          buyPricePiasters?: bigint;
          stock_quantity: number;
          global_variant_id: string | null;
          globalVariantId?: string | null;
          is_active: boolean;
          isActive?: boolean;
          stockLevels?: Array<{ quantityBase: bigint }>;
          storeStockBatches?: Array<{ costPriceMinor: bigint }>;
        };

        type FormattedProductItem = {
          id: string;
          nameAr: string;
          name_ar: string;
          nameNorm: string;
          name_norm: string;
          category: string;
          unit: string;
          sellPricePiasters: bigint;
          sell_price_piasters: number;
          buyPricePiasters: bigint;
          buy_cost_piasters: number;
          stock_quantity: number;
          brandName: string | null;
          brand_name: string | null;
          isCustom: boolean;
          is_custom: boolean;
          addedByThisStore: boolean;
          added_by_this_store: boolean;
          isHidden: boolean;
          is_hidden: boolean;
          globalProductId: string | null;
          global_product_id: string | null;
          /** 'standard' or 'sandwich' (ADR-0018). */
          kind: string;
          globalProduct?: {
            id: string;
            nameAr: string;
            brand: { nameAr: string } | null;
          } | null;
          variants: FormattedVariantItem[];
          storeVariants: FormattedVariantItem[];
        };

        const result: FormattedProductItem[] = [];

        // Add unified global catalog items (with store overrides applied if any)
        for (const gp of globalProducts) {
          const override = overrideByGlobalId.get(gp.id);
          const isHidden = override ? !override.isActive : false;

          if (isHidden && !options?.includeHidden) {
            continue;
          }

          const primaryGlobalVar = gp.globalVariants[0];
          const overrideVar = override?.storeVariants[0];

          const defaultTelecom = getDefaultTelecomPrice(
            gp.nameAr,
            gp.category,
            primaryGlobalVar?.flavor,
          );
          const sellPrice = override
            ? Number(override.sellPricePiasters)
            : defaultTelecom.sell;
          const buyCost = override
            ? Number(
                overrideVar?.storeStockBatches[0]?.costPriceMinor ??
                  override.buyPricePiasters ??
                  overrideVar?.buyPricePiasters ??
                  0,
              )
            : defaultTelecom.buy;

          let productStock = 0;
          const variants: FormattedVariantItem[] =
            override && override.storeVariants.length > 0
              ? override.storeVariants.map((v) => {
                  const sPrice = Number(v.sellPricePiasters);
                  const bCost = Number(
                    v.storeStockBatches[0]?.costPriceMinor ??
                      v.buyPricePiasters ??
                      0,
                  );
                  const vStock =
                    v.stockLevels?.reduce(
                      (acc, sl) => acc + Number(sl.quantityBase),
                      0,
                    ) ?? 0;
                  productStock += vStock;
                  return {
                    id: v.id,
                    flavor: v.flavor,
                    size_value: v.sizeValue ? Number(v.sizeValue) : null,
                    sizeValue: v.sizeValue ? Number(v.sizeValue) : null,
                    size_unit: v.sizeUnit,
                    sizeUnit: v.sizeUnit,
                    pack_qty: v.packQty,
                    packQty: v.packQty,
                    sell_price_piasters: sPrice,
                    sellPricePiasters: BigInt(sPrice),
                    buy_cost_piasters: bCost,
                    buyPricePiasters: BigInt(bCost),
                    stock_quantity: vStock,
                    global_variant_id:
                      v.globalVariantId ?? primaryGlobalVar?.id ?? null,
                    globalVariantId:
                      v.globalVariantId ?? primaryGlobalVar?.id ?? null,
                    is_active: v.isActive,
                    isActive: v.isActive,
                    stockLevels: v.stockLevels ?? [],
                    storeStockBatches: [{ costPriceMinor: BigInt(bCost) }],
                  };
                })
              : gp.globalVariants.map((gv) => {
                  const def = getDefaultTelecomPrice(
                    gp.nameAr,
                    gp.category,
                    gv.flavor,
                  );
                  return {
                    id: gv.id,
                    flavor: gv.flavor,
                    size_value: gv.sizeValue ? Number(gv.sizeValue) : null,
                    sizeValue: gv.sizeValue ? Number(gv.sizeValue) : null,
                    size_unit: gv.sizeUnit,
                    sizeUnit: gv.sizeUnit,
                    pack_qty: gv.packQty,
                    packQty: gv.packQty,
                    sell_price_piasters: def.sell,
                    sellPricePiasters: BigInt(def.sell),
                    buy_cost_piasters: def.buy,
                    buyPricePiasters: BigInt(def.buy),
                    stock_quantity: 0,
                    global_variant_id: gv.id,
                    globalVariantId: gv.id,
                    is_active: true,
                    isActive: true,
                    stockLevels: [],
                    storeStockBatches: [{ costPriceMinor: BigInt(def.buy) }],
                  };
                });

          const item: FormattedProductItem = {
            id: override ? override.id : `gp_${gp.id}`,
            nameAr: override?.nameAr || gp.nameAr,
            name_ar: override?.nameAr || gp.nameAr,
            nameNorm: override?.nameNorm || gp.nameNorm,
            name_norm: override?.nameNorm || gp.nameNorm,
            category: override?.category || gp.category,
            unit:
              override?.unit ||
              (gp.globalVariants[0]?.sizeUnit === "kg" ||
              gp.globalVariants[0]?.sizeUnit === "g"
                ? "kg"
                : "piece"),
            sellPricePiasters: BigInt(sellPrice),
            sell_price_piasters: sellPrice,
            buyPricePiasters: BigInt(buyCost),
            buy_cost_piasters: buyCost,
            stock_quantity: productStock,
            brandName: gp.brand?.nameAr || null,
            brand_name: gp.brand?.nameAr || null,
            isCustom: false,
            is_custom: false,
            addedByThisStore: false,
            added_by_this_store: false,
            isHidden,
            is_hidden: isHidden,
            globalProductId: gp.id,
            global_product_id: gp.id,
            kind: override?.kind ?? "standard",
            globalProduct: {
              id: gp.id,
              nameAr: gp.nameAr,
              brand: gp.brand ? { nameAr: gp.brand.nameAr } : null,
            },
            variants,
            storeVariants: variants,
          };

          result.push(item);
        }

        // Add custom products created by this store
        for (const sp of customProducts) {
          const isHidden = !sp.isActive;
          if (isHidden && !options?.includeHidden) {
            continue;
          }

          const primaryVar = sp.storeVariants[0];
          const buyCost = Number(
            primaryVar?.storeStockBatches[0]?.costPriceMinor ??
              sp.buyPricePiasters ??
              primaryVar?.buyPricePiasters ??
              0,
          );
          const sellPrice = Number(sp.sellPricePiasters);

          let customStock = 0;
          const variants: FormattedVariantItem[] = sp.storeVariants.map((v) => {
            const vSell = Number(v.sellPricePiasters);
            const vBuy = Number(
              v.storeStockBatches[0]?.costPriceMinor ?? v.buyPricePiasters ?? 0,
            );
            const vStock =
              v.stockLevels?.reduce(
                (acc, sl) => acc + Number(sl.quantityBase),
                0,
              ) ?? 0;
            customStock += vStock;
            return {
              id: v.id,
              flavor: v.flavor,
              size_value: v.sizeValue ? Number(v.sizeValue) : null,
              sizeValue: v.sizeValue ? Number(v.sizeValue) : null,
              size_unit: v.sizeUnit,
              sizeUnit: v.sizeUnit,
              pack_qty: v.packQty,
              packQty: v.packQty,
              sell_price_piasters: vSell,
              sellPricePiasters: BigInt(vSell),
              buy_cost_piasters: vBuy,
              buyPricePiasters: BigInt(vBuy),
              stock_quantity: vStock,
              global_variant_id: null,
              globalVariantId: null,
              is_active: v.isActive,
              isActive: v.isActive,
              stockLevels: v.stockLevels ?? [],
              storeStockBatches: [{ costPriceMinor: BigInt(vBuy) }],
            };
          });

          const item: FormattedProductItem = {
            id: sp.id,
            nameAr: sp.nameAr || "",
            name_ar: sp.nameAr || "",
            nameNorm: sp.nameNorm || "",
            name_norm: sp.nameNorm || "",
            category: sp.category,
            unit: sp.unit,
            sellPricePiasters: BigInt(sellPrice),
            sell_price_piasters: sellPrice,
            buyPricePiasters: BigInt(buyCost),
            buy_cost_piasters: buyCost,
            stock_quantity: customStock,
            brandName: null,
            brand_name: null,
            isCustom: true,
            is_custom: true,
            addedByThisStore: true,
            added_by_this_store: true,
            isHidden,
            is_hidden: isHidden,
            globalProductId: null,
            global_product_id: null,
            kind: sp.kind,
            globalProduct: null,
            variants,
            storeVariants: variants,
          };

          result.push(item);
        }

        let filtered = result;
        if (options?.search && options.search.trim()) {
          const normQ = normalizeArabic(options.search.trim());
          filtered = filtered.filter(
            (p) =>
              p.name_norm.includes(normQ) ||
              (p.brand_name && normalizeArabic(p.brand_name).includes(normQ)),
          );
        }
        if (options?.category && options.category !== "all") {
          filtered = filtered.filter((p) => p.category === options.category);
        }

        return filtered;
      },
      this.prisma,
    );
  }

  /**
   * Hides a product for this store only (without deleting from global catalog).
   */
  async hideStoreProduct(
    storeId: string,
    userId: string | null,
    productIdOrGlobalId: string,
  ) {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        let actualGlobalId: string | null = null;
        let actualStoreProductId: string | null = null;

        if (productIdOrGlobalId.startsWith("gp_")) {
          actualGlobalId = productIdOrGlobalId.slice(3);
        } else {
          // Check if this is an existing storeProduct or a raw global product UUID
          const existing = await tx.storeProduct.findUnique({
            where: { id: productIdOrGlobalId },
          });
          if (existing) {
            actualStoreProductId = existing.id;
          } else {
            actualGlobalId = productIdOrGlobalId;
          }
        }

        if (actualStoreProductId) {
          await tx.storeProduct.update({
            where: { id: actualStoreProductId },
            data: { isActive: false, updatedAt: new Date() },
          });
          await tx.storeVariant.updateMany({
            where: { storeProductId: actualStoreProductId },
            data: { isActive: false, updatedAt: new Date() },
          });
        } else if (actualGlobalId) {
          const gp = await this.prisma.globalProduct.findUnique({
            where: { id: actualGlobalId },
            include: { globalVariants: true },
          });
          if (!gp) throw AppError.notFound("المنتج ده مش موجود");

          const existing = await tx.storeProduct.findFirst({
            where: { storeId, globalProductId: actualGlobalId },
          });

          if (existing) {
            await tx.storeProduct.update({
              where: { id: existing.id },
              data: {
                isActive: false,
                updatedAt: new Date(),
              },
            });
          } else {
            const isWeight =
              gp.globalVariants[0]?.sizeUnit === "kg" ||
              gp.globalVariants[0]?.sizeUnit === "g";
            await tx.storeProduct.create({
              data: {
                storeId,
                globalProductId: actualGlobalId,
                nameAr: gp.nameAr,
                nameNorm: gp.nameNorm,
                category: gp.category,
                unit: isWeight ? "kg" : "piece",
                sellPricePiasters: BigInt(0),
                buyPricePiasters: BigInt(0),
                isCustom: false,
                isActive: false,
              },
            });
          }
        }

        return { success: true };
      },
      this.prisma,
    );
  }

  /**
   * Unhides a previously hidden product for this store.
   */
  async unhideStoreProduct(
    storeId: string,
    userId: string | null,
    productIdOrGlobalId: string,
  ) {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const actualId = productIdOrGlobalId.startsWith("gp_")
          ? productIdOrGlobalId.slice(3)
          : productIdOrGlobalId;

        // Try unhiding by store product id first, then by globalProductId
        const byStoreProd = await tx.storeProduct.findFirst({
          where: { id: actualId, storeId },
        });

        if (byStoreProd) {
          await tx.storeProduct.update({
            where: { id: byStoreProd.id },
            data: { isActive: true, updatedAt: new Date() },
          });
          await tx.storeVariant.updateMany({
            where: { storeProductId: byStoreProd.id },
            data: { isActive: true, updatedAt: new Date() },
          });
        } else {
          await tx.storeProduct.updateMany({
            where: { globalProductId: actualId, storeId },
            data: { isActive: true, updatedAt: new Date() },
          });
        }

        return { success: true };
      },
      this.prisma,
    );
  }

  /**
   * Upserts a store product and its variants transactionally.
   * Enforces RLS and tenant ownership.
   */
  async upsertStoreProduct(
    storeId: string,
    userId: string | null,
    input: {
      id?: string;
      opId?: string;
      nameAr: string;
      category: string;
      unit: string;
      sellPricePiasters: number;
      buyCostPiasters?: number | null;
      initialQuantity?: number | null;
      barcode?: string | null;
      isCustom?: boolean;
      globalProductId?: string | null;
      brandName?: string | null;
      variants: Array<{
        id?: string;
        flavor?: string | null;
        sizeValue?: number | null;
        sizeUnit?: string | null;
        packQty?: number;
        sellPricePiasters: number;
        costPricePiasters?: number | null;
        barcode?: string | null;
        globalVariantId?: string | null;
        isActive?: boolean;
      }>;
    },
  ) {
    const nameNorm = normalizeArabic(input.nameAr);
    const now = new Date();

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const store = await tx.store.findUnique({
          where: { id: storeId },
          select: { shareCustomProducts: true },
        });

        let targetGlobalId = input.globalProductId ?? null;
        let storeProductId = input.id;

        if (storeProductId?.startsWith("gp_")) {
          targetGlobalId = storeProductId.slice(3);
          storeProductId = undefined;
        }

        // If this targets a global product, check if an override already exists
        if (!storeProductId && targetGlobalId) {
          const existingOverride = await tx.storeProduct.findFirst({
            where: { storeId, globalProductId: targetGlobalId },
          });
          if (existingOverride) {
            storeProductId = existingOverride.id;
          }
        }

        let isNewProduct = false;

        if (storeProductId) {
          // Verify ownership
          const existing = await tx.storeProduct.findFirst({
            where: { id: storeProductId, storeId },
          });
          if (!existing) {
            throw AppError.notFound("المنتج ده مش موجود في محلك");
          }
          if (existing.kind === "sandwich") {
            // Sandwiches are edited through the sandwiches module (ADR-0018); this path would
            // give them a stock variant and submit them to the community catalog.
            throw AppError.badRequest("عدّل الساندوتش من شاشة الساندوتش");
          }

          await tx.storeProduct.update({
            where: { id: storeProductId },
            data: {
              nameAr: input.nameAr,
              nameNorm,
              category: input.category,
              unit: input.unit,
              sellPricePiasters: BigInt(input.sellPricePiasters),
              buyPricePiasters: BigInt(input.buyCostPiasters ?? 0),
              isCustom: input.isCustom ?? existing.isCustom,
              globalProductId: targetGlobalId ?? existing.globalProductId,
              isActive: true,
              updatedAt: now,
            },
          });
        } else {
          isNewProduct = true;
          const created = await tx.storeProduct.create({
            data: {
              storeId,
              nameAr: input.nameAr,
              nameNorm,
              category: input.category,
              unit: input.unit,
              sellPricePiasters: BigInt(input.sellPricePiasters),
              buyPricePiasters: BigInt(input.buyCostPiasters ?? 0),
              isCustom: input.isCustom ?? !targetGlobalId,
              globalProductId: targetGlobalId,
              isActive: true,
              createdAt: now,
              updatedAt: now,
            },
          });
          storeProductId = created.id;
        }

        // Upsert variants
        const variantResults = [];
        for (const v of input.variants) {
          const varSell = BigInt(v.sellPricePiasters);
          const varBuy = BigInt(
            v.costPricePiasters ?? input.buyCostPiasters ?? 0,
          );

          let existingVar = null;
          if (v.id && !v.id.startsWith("gp_") && !v.id.startsWith("temp_")) {
            existingVar = await tx.storeVariant.findFirst({
              where: { id: v.id, storeId },
            });
          }

          if (existingVar) {
            const updatedVar = await tx.storeVariant.update({
              where: { id: existingVar.id },
              data: {
                storeProductId,
                flavor: v.flavor ?? null,
                sizeValue: v.sizeValue ? v.sizeValue : null,
                sizeUnit: v.sizeUnit ?? null,
                packQty: v.packQty ?? 1,
                sellPricePiasters: varSell,
                buyPricePiasters: varBuy,
                globalVariantId:
                  v.globalVariantId ?? existingVar.globalVariantId,
                isActive: v.isActive ?? true,
                updatedAt: now,
              },
            });
            variantResults.push(updatedVar);
          } else {
            let safeGlobalVariantId: string | null = null;
            const candidateGvId =
              v.globalVariantId ??
              (v.id?.startsWith("gp_") ? v.id.slice(3) : v.id);

            if (candidateGvId && !candidateGvId.startsWith("temp_")) {
              const gvExists = await tx.globalVariant.findUnique({
                where: { id: candidateGvId },
                select: { id: true },
              });
              if (gvExists) {
                safeGlobalVariantId = gvExists.id;
              }
            }

            const createdVar = await tx.storeVariant.create({
              data: {
                storeId,
                storeProductId,
                productId: targetGlobalId,
                flavor: v.flavor ?? null,
                sizeValue: v.sizeValue ? v.sizeValue : null,
                sizeUnit: v.sizeUnit ?? null,
                packQty: v.packQty ?? 1,
                sellPricePiasters: varSell,
                buyPricePiasters: varBuy,
                globalVariantId: safeGlobalVariantId,
                isActive: v.isActive ?? true,
                createdAt: now,
                updatedAt: now,
              },
            });
            variantResults.push(createdVar);
          }
        }

        // If newly created and initial stock quantity is provided, record initial batch & movement
        if (
          isNewProduct &&
          input.initialQuantity &&
          input.initialQuantity > 0
        ) {
          const primaryVariant = variantResults[0];
          if (primaryVariant) {
            const qtyBase = BigInt(Math.round(input.initialQuantity));
            // Initial stock is costed at the registered buy price per selling unit (ADR-0021):
            // the batch stores that unit cost and the total it implies; unknown when no price.
            const costMinor =
              input.buyCostPiasters && input.buyCostPiasters > 0
                ? BigInt(input.buyCostPiasters)
                : null;
            const costTotal = totalFromUnitCost(costMinor, qtyBase, input.unit);

            const batch = await tx.storeStockBatch.create({
              data: {
                storeId,
                storeVariantId: primaryVariant.id,
                storeProductId,
                receivedQuantityBase: qtyBase,
                remainingQuantityBase: qtyBase,
                costPriceMinor: costMinor,
                costTotalMinor: costTotal,
                receivedAt: now,
                paid: true,
                createdAt: now,
                updatedAt: now,
              },
            });

            await tx.stockLevel.upsert({
              where: {
                storeId_storeVariantId: {
                  storeId,
                  storeVariantId: primaryVariant.id,
                },
              },
              update: {
                quantityBase: qtyBase,
                updatedAt: now,
              },
              create: {
                storeId,
                storeVariantId: primaryVariant.id,
                quantityBase: qtyBase,
                updatedAt: now,
              },
            });

            await tx.stockMovement.create({
              data: {
                storeId,
                storeVariantId: primaryVariant.id,
                storeProductId,
                batchId: batch.id,
                type: "initial_stock",
                quantityBase: qtyBase,
                costPriceMinor: costMinor,
                balanceAfterBase: qtyBase,
                createdAt: now,
              },
            });
          }
        }

        // If custom and newly created, check community suggestions
        let candidateId: string | null = null;
        if (
          isNewProduct &&
          (input.isCustom ?? true) &&
          (store?.shareCustomProducts ?? true)
        ) {
          const firstVariant = input.variants[0];
          const submission = await this.communityService.submitCandidate(
            {
              submittingStoreId: storeId,
              nameAr: input.nameAr,
              brandName: input.brandName ?? null,
              category: input.category,
              flavor: firstVariant?.flavor ?? null,
              sizeValue: firstVariant?.sizeValue ?? null,
              sizeUnit: firstVariant?.sizeUnit ?? null,
              packQty: firstVariant?.packQty ?? 1,
            },
            { now, tx },
          );
          candidateId = submission.candidateId;
        }

        return {
          storeProductId,
          variants: variantResults,
          candidateId,
        };
      },
      this.prisma,
    );
  }

  /**
   * Deletes a product **this shop created** (`global_product_id` is null) — never a global
   * catalog record and never another shop's row (every query is store-scoped under RLS).
   *
   * - No history (no sale lines, stock movements, batches, purchase lines, waste records or
   *   supplier links): the product and its variants are physically removed (`deleted`).
   * - Any history: the product is archived with the existing hide mechanism (`archived`), so
   *   past invoices, movements and reports keep their references.
   * - Used as an ingredient in a sandwich recipe: refused (409) and the sandwiches are named;
   *   the recipe must be changed first so a sandwich never consumes a removed product.
   *
   * @throws AppError 404 (not in this shop), 400 (a catalog product: hide it instead),
   *   409 (used in a sandwich).
   */
  async deleteShopProduct(
    storeId: string,
    userId: string | null,
    productId: string,
  ): Promise<{ result: "deleted" | "archived"; productId: string }> {
    if (productId.startsWith("gp_")) {
      throw AppError.badRequest(
        "ده منتج من الكتالوج العام، مينفعش يتحذف. تقدر تخفيه من محلك بس",
      );
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        productId,
      )
    ) {
      throw AppError.notFound("المنتج ده مش موجود في محلك");
    }

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const product = await tx.storeProduct.findFirst({
          where: { id: productId, storeId },
          select: {
            id: true,
            globalProductId: true,
            storeVariants: { select: { id: true } },
          },
        });
        if (!product) {
          throw AppError.notFound("المنتج ده مش موجود في محلك");
        }
        if (product.globalProductId) {
          throw AppError.badRequest(
            "ده منتج من الكتالوج العام، مينفعش يتحذف. تقدر تخفيه من محلك بس",
          );
        }

        const variantIds = product.storeVariants.map((v) => v.id);
        const usedIn = await tx.sandwichIngredient.findMany({
          where: { storeId, ingredientVariantId: { in: variantIds } },
          select: { sandwichProduct: { select: { nameAr: true } } },
        });
        if (usedIn.length > 0) {
          const names = [
            ...new Set(usedIn.map((u) => u.sandwichProduct.nameAr ?? "")),
          ].join("، ");
          throw AppError.conflict(
            `المنتج ده داخل في ساندوتش (${names}). شيله من الساندوتش الأول`,
          );
        }

        const byVariant = { storeId, storeVariantId: { in: variantIds } };
        const [sales, movements, batches, purchases, waste, suppliers] =
          await Promise.all([
            tx.saleLine.count({
              where: {
                storeId,
                OR: [
                  { storeProductId: productId },
                  { storeVariantId: { in: variantIds } },
                ],
              },
            }),
            tx.stockMovement.count({ where: byVariant }),
            tx.storeStockBatch.count({ where: byVariant }),
            tx.purchaseLine.count({
              where: {
                storeId,
                OR: [
                  { storeProductId: productId },
                  { storeVariantId: { in: variantIds } },
                ],
              },
            }),
            tx.wasteRecord.count({ where: byVariant }),
            tx.supplierProduct.count({
              where: { storeId, storeProductId: productId },
            }),
          ]);
        const hasHistory =
          sales + movements + batches + purchases + waste + suppliers > 0;

        const now = new Date();
        if (hasHistory) {
          await tx.storeProduct.update({
            where: { id: productId },
            data: { isActive: false, updatedAt: now },
          });
          await tx.storeVariant.updateMany({
            where: { storeId, storeProductId: productId },
            data: { isActive: false, updatedAt: now },
          });
          return { result: "archived" as const, productId };
        }

        // No history: stock_levels rows (if any) can only be zero-balance caches.
        await tx.stockLevel.deleteMany({ where: byVariant });
        await tx.storeVariant.deleteMany({
          where: { storeId, storeProductId: productId },
        });
        await tx.storeProduct.delete({ where: { id: productId } });
        return { result: "deleted" as const, productId };
      },
      this.prisma,
    );
  }

  /**
   * Deactivates / hides a store product and its variants.
   */
  async deleteStoreProduct(
    storeId: string,
    userId: string | null,
    productId: string,
  ) {
    return this.hideStoreProduct(storeId, userId, productId);
  }
}

/** The product is already in the shop (QA-23). */
function duplicateGlobalProductError(): AppError {
  return new AppError(
    "CONFLICT",
    "المنتج ده موجود عندك بالفعل في المنتجات — عدّل سعره من هناك",
    409,
  );
}
