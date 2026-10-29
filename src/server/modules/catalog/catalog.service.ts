import "server-only";
import { type PrismaClient } from "@prisma/client";
import { normalizeArabic } from "@/domain/normalize";
import { matchProducts } from "@/domain/product-matcher";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
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

    const { storeProduct, storeVariant, shareCustomProducts } = options?.tx
      ? await performTenantInserts(options.tx)
      : await withTenant(
          input.storeId,
          input.userId ?? null,
          performTenantInserts,
          this.prisma,
        );

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
}
