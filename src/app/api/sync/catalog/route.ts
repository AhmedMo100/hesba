import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/server/infra/db/client";
import { type Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

interface CursorPayload {
  u: string;
  id: string;
}

function decodeCursor(cursorStr: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursorStr, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed.u === "string" &&
      typeof parsed.id === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * GET /api/sync/catalog
 * Synchronizes public global catalog (brands, global_products, global_variants).
 * - Stable cursor based on updated_at + id
 * - ETag support with 304 Not Modified
 * - 204 No Content when cursor is current and no new items exist
 * - Public cache headers
 * - Strict secrecy: NEVER returns store prices, store identity, or stock quantities.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cursorParam = searchParams.get("cursor");
    const limitParam = searchParams.get("limit");

    let limit = 100;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 1000);
      }
    }

    const where: Prisma.GlobalProductWhereInput = {
      status: "approved",
    };

    let cursorData: CursorPayload | null = null;
    if (cursorParam) {
      cursorData = decodeCursor(cursorParam);
      if (cursorData) {
        const cursorDate = new Date(cursorData.u);
        where.OR = [
          { updatedAt: { gt: cursorDate } },
          {
            updatedAt: cursorDate,
            id: { gt: cursorData.id },
          },
        ];
      }
    }

    // Query limit + 1 to check if there is a next page
    const products = await prisma.globalProduct.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      include: {
        brand: {
          select: {
            id: true,
            nameAr: true,
            nameEn: true,
          },
        },
        globalVariants: {
          select: {
            id: true,
            globalProductId: true,
            flavor: true,
            sizeValue: true,
            sizeUnit: true,
            packQty: true,
            nameNorm: true,
          },
        },
      },
    });

    const hasMore = products.length > limit;
    const pageItems = hasMore ? products.slice(0, limit) : products;

    // If client provided a cursor and no items changed, return 204 No Content
    if (cursorParam && pageItems.length === 0) {
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    }

    // Collect unique brands from the returned products
    const brandsMap = new Map<
      string,
      { id: string; name_ar: string; name_en: string | null }
    >();
    for (const p of pageItems) {
      if (p.brand && !brandsMap.has(p.brand.id)) {
        brandsMap.set(p.brand.id, {
          id: p.brand.id,
          name_ar: p.brand.nameAr,
          name_en: p.brand.nameEn ?? null,
        });
      }
    }

    const lastProduct = pageItems[pageItems.length - 1];
    const nextCursor =
      hasMore && lastProduct
        ? encodeCursor({
            u: lastProduct.updatedAt.toISOString(),
            id: lastProduct.id,
          })
        : null;

    const payload = {
      brands: Array.from(brandsMap.values()),
      products: pageItems.map((p) => ({
        id: p.id,
        brand_id: p.brandId,
        name_ar: p.nameAr,
        name_en: p.nameEn,
        name_norm: p.nameNorm,
        category: p.category,
        type: p.type,
        updated_at: p.updatedAt.toISOString(),
      })),
      variants: pageItems.flatMap((p) =>
        p.globalVariants.map((v) => ({
          id: v.id,
          global_product_id: v.globalProductId,
          flavor: v.flavor,
          size_value: v.sizeValue ? Number(v.sizeValue) : null,
          size_unit: v.sizeUnit,
          pack_qty: v.packQty,
          name_norm: v.nameNorm,
        })),
      ),
      next_cursor: nextCursor,
      has_more: hasMore,
    };

    const bodyString = JSON.stringify(payload);
    const etag = `W/"${createHash("sha256").update(bodyString).digest("hex").slice(0, 27)}"`;

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    }

    return new Response(bodyString, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
