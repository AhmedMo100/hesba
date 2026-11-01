import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { CatalogService } from "@/server/modules/catalog";
import { upsertProductInputSchema } from "@/schemas/product";
import { normalizeArabic } from "@/domain/normalize";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/products
 * Returns store products and variants for the authenticated session's store.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const catalogService = new CatalogService(prisma);
    const products = await catalogService.getStoreProducts(
      context.store.id,
      context.user.id,
    );

    // Format BigInt values and calculate stock levels for JSON response
    const formatted = products.map((p) => {
      let totalProductStock = 0;
      let latestBuyCost = 0;

      const formattedVariants = p.storeVariants.map((v) => {
        const variantStock = v.stockLevels.reduce(
          (acc, sl) => acc + Number(sl.quantityBase),
          0,
        );
        totalProductStock += variantStock;

        const variantCost = v.storeStockBatches[0]?.costPriceMinor
          ? Number(v.storeStockBatches[0].costPriceMinor)
          : 0;
        if (variantCost > 0 && latestBuyCost === 0) {
          latestBuyCost = variantCost;
        }

        return {
          id: v.id,
          flavor: v.flavor,
          size_value: v.sizeValue ? Number(v.sizeValue) : null,
          size_unit: v.sizeUnit,
          pack_qty: v.packQty,
          sell_price_piasters: Number(v.sellPricePiasters),
          buy_cost_piasters: variantCost,
          stock_quantity: variantStock,
          global_variant_id: v.globalVariantId,
          is_active: v.isActive,
        };
      });

      return {
        id: p.id,
        name_ar: p.nameAr,
        name_norm: p.nameNorm,
        category: p.category,
        unit: p.unit,
        sell_price_piasters: Number(p.sellPricePiasters),
        buy_cost_piasters: latestBuyCost,
        stock_quantity: totalProductStock,
        brand_name: p.globalProduct?.brand?.nameAr || null,
        is_custom: p.isCustom,
        global_product_id: p.globalProductId,
        variants: formattedVariants,
      };
    });

    const summary = {
      total: formatted.length,
      lowStock: formatted.filter((p) => {
        const threshold = p.unit === "kg" ? 2000 : 5;
        return p.stock_quantity > 0 && p.stock_quantity <= threshold;
      }).length,
      outOfStock: formatted.filter((p) => p.stock_quantity <= 0).length,
    };

    return NextResponse.json({ products: formatted, summary });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/products
 * Upserts a store product and variants with validation and tenant isolation.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();
    const input = upsertProductInputSchema.parse(body);

    const catalogService = new CatalogService(prisma);
    const result = await catalogService.upsertStoreProduct(
      context.store.id,
      context.user.id,
      input,
    );

    // Format BigInt and Decimal values safely to avoid JSON.stringify crash
    const formattedVariants = result.variants.map((v) => ({
      id: v.id,
      flavor: v.flavor,
      size_value: v.sizeValue ? Number(v.sizeValue) : null,
      size_unit: v.sizeUnit,
      pack_qty: v.packQty,
      sell_price_piasters: Number(v.sellPricePiasters),
      global_variant_id: v.globalVariantId,
      is_active: v.isActive,
    }));

    const formattedProduct = {
      id: result.storeProductId,
      name_ar: input.nameAr,
      name_norm: normalizeArabic(input.nameAr),
      category: input.category,
      unit: input.unit,
      sell_price_piasters: input.sellPricePiasters,
      is_custom: input.isCustom ?? true,
      global_product_id: input.globalProductId ?? null,
      variants: formattedVariants,
    };

    return NextResponse.json(
      {
        success: true,
        data: formattedProduct,
        candidateId: result.candidateId,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * DELETE /api/products?id=<productId>
 * Deactivates a store product and its variants.
 */
export async function DELETE(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("id");
    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 },
      );
    }

    const catalogService = new CatalogService(prisma);
    await catalogService.deleteStoreProduct(
      context.store.id,
      context.user.id,
      productId,
    );

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
