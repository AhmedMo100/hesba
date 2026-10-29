import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { CatalogService } from "@/server/modules/catalog";
import { upsertProductInputSchema } from "@/schemas/product";
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

    // Format BigInt values for JSON response
    const formatted = products.map((p) => ({
      id: p.id,
      name_ar: p.nameAr,
      name_norm: p.nameNorm,
      category: p.category,
      unit: p.unit,
      sell_price_piasters: Number(p.sellPricePiasters),
      is_custom: p.isCustom,
      global_product_id: p.globalProductId,
      variants: p.storeVariants.map((v) => ({
        id: v.id,
        flavor: v.flavor,
        size_value: v.sizeValue ? Number(v.sizeValue) : null,
        size_unit: v.sizeUnit,
        pack_qty: v.packQty,
        sell_price_piasters: Number(v.sellPricePiasters),
        global_variant_id: v.globalVariantId,
        is_active: v.isActive,
      })),
    }));

    return NextResponse.json({ products: formatted });
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

    return NextResponse.json({ success: true, data: result }, { status: 200 });
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
