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
 * Merges global catalog with store overrides and custom products.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter"); // "all" | "active" | "hidden" | "custom"
    const search = searchParams.get("search") || undefined;
    const category = searchParams.get("category") || undefined;

    const catalogService = new CatalogService(prisma);
    const products = await catalogService.getStoreProducts(
      context.store.id,
      context.user.id,
      {
        includeHidden: filter === "hidden" || filter === "all",
        search,
        category,
      },
    );

    let displayProducts = products;
    if (filter === "hidden") {
      displayProducts = displayProducts.filter((p) => p.is_hidden);
    } else if (filter === "custom") {
      displayProducts = displayProducts.filter((p) => p.is_custom);
    }

    const formatted = displayProducts.map((p) => ({
      id: p.id,
      name_ar: p.name_ar,
      name_norm: p.name_norm,
      category: p.category,
      unit: p.unit,
      sell_price_piasters: Number(p.sell_price_piasters),
      buy_cost_piasters: Number(p.buy_cost_piasters),
      stock_quantity: Number(p.stock_quantity ?? 0),
      brand_name: p.brand_name || null,
      is_custom: p.is_custom,
      added_by_this_store: p.added_by_this_store,
      is_hidden: p.is_hidden,
      global_product_id: p.global_product_id,
      kind: p.kind,
      variants: p.variants.map((v) => ({
        id: v.id,
        flavor: v.flavor,
        size_value: v.size_value,
        size_unit: v.size_unit,
        pack_qty: v.pack_qty,
        sell_price_piasters: Number(v.sell_price_piasters),
        buy_cost_piasters: Number(v.buy_cost_piasters),
        stock_quantity: Number(v.stock_quantity ?? 0),
        global_variant_id: v.global_variant_id,
        is_active: v.is_active,
      })),
    }));

    const summary = {
      total: formatted.length,
      hiddenCount: products.filter((p) => p.is_hidden).length,
      customCount: products.filter((p) => p.is_custom).length,
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
 * PATCH /api/products?id=<productId>&action=<action>
 * Handles store product operations such as unhiding.
 */
export async function PATCH(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("id");
    const action = searchParams.get("action");

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 },
      );
    }

    const catalogService = new CatalogService(prisma);

    if (action === "unhide") {
      await catalogService.unhideStoreProduct(
        context.store.id,
        context.user.id,
        productId,
      );
      return NextResponse.json({ success: true, action: "unhide" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * DELETE /api/products?id=<productId>
 * Hides a store product and its variants for this store only.
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
    await catalogService.hideStoreProduct(
      context.store.id,
      context.user.id,
      productId,
    );

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
