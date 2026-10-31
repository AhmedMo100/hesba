import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { GET } from "@/app/api/sync/catalog/route";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

describe("Catalog Sync Route Handler GET /api/sync/catalog (Phase 3.3 Integration)", () => {
  let prisma: PrismaClient;
  let testBrandId: string;
  let testProductId1: string;
  let testProductId2: string;
  let testVariantId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    await prisma.$connect();

    // Create a brand
    const brand = await prisma.brand.create({
      data: {
        nameAr: `ماركة تجريبية ${Date.now()}`,
        nameEn: "Test Brand Sync",
      },
    });
    testBrandId = brand.id;

    // Create 2 global products
    const p1 = await prisma.globalProduct.create({
      data: {
        brandId: testBrandId,
        nameAr: `منتج مزامنة 1 ${Date.now()}`,
        nameNorm: "منتج مزامنه 1",
        category: "الأرز والمكرونة والحبوب والبقوليات",
        type: "stock",
        status: "approved",
      },
    });
    testProductId1 = p1.id;

    const p2 = await prisma.globalProduct.create({
      data: {
        brandId: testBrandId,
        nameAr: `منتج مزامنة 2 ${Date.now()}`,
        nameNorm: "منتج مزامنه 2",
        category: "الأرز والمكرونة والحبوب والبقوليات",
        type: "stock",
        status: "approved",
      },
    });
    testProductId2 = p2.id;

    // Create variant
    const variant = await prisma.globalVariant.create({
      data: {
        globalProductId: testProductId1,
        flavor: "عادي",
        sizeValue: 1,
        sizeUnit: "kg",
        packQty: 10,
        nameNorm: "منتج مزامنه 1 عادي 1 kg",
      },
    });
    testVariantId = variant.id;
  });

  afterAll(async () => {
    await prisma.globalVariant.deleteMany({
      where: { id: testVariantId },
    });
    await prisma.globalProduct.deleteMany({
      where: { id: { in: [testProductId1, testProductId2] } },
    });
    await prisma.brand.deleteMany({
      where: { id: testBrandId },
    });
    await prisma.$disconnect();
  });

  it("returns 200 with global products, variants, brands, ETag, and Cache-Control", async () => {
    const request = new Request(
      "http://localhost:3000/api/sync/catalog?limit=100",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");
    const etag = response.headers.get("ETag");
    expect(etag).toBeDefined();

    const data = await response.json();
    expect(Array.isArray(data.products)).toBe(true);
    expect(Array.isArray(data.variants)).toBe(true);
    expect(Array.isArray(data.brands)).toBe(true);

    const foundProduct = data.products.find(
      (p: { id: string }) => p.id === testProductId1,
    );
    expect(foundProduct).toBeDefined();
    expect(foundProduct.name_ar).toContain("منتج مزامنة 1");

    // Zero leakage: confirm NO store_id, sell_price, or cost_price fields exist
    expect(foundProduct.store_id).toBeUndefined();
    expect(foundProduct.sell_price_piasters).toBeUndefined();
    expect(foundProduct.cost_piasters).toBeUndefined();
  });

  it("returns 304 Not Modified when client provides matching If-None-Match ETag", async () => {
    // 1. Initial request to obtain ETag
    const req1 = new Request("http://localhost:3000/api/sync/catalog");
    const res1 = await GET(req1);
    const etag = res1.headers.get("ETag");
    expect(etag).toBeTruthy();

    // 2. Conditional request with matching If-None-Match
    const req2 = new Request("http://localhost:3000/api/sync/catalog", {
      headers: { "If-None-Match": etag! },
    });
    const res2 = await GET(req2);
    expect(res2.status).toBe(304);
    expect(await res2.text()).toBe("");
  });

  it("supports pagination with limit and stable next_cursor", async () => {
    const req1 = new Request("http://localhost:3000/api/sync/catalog?limit=1");
    const res1 = await GET(req1);
    expect(res1.status).toBe(200);

    const data1 = await res1.json();
    expect(data1.products).toHaveLength(1);
    expect(data1.has_more).toBe(true);
    expect(data1.next_cursor).toBeTruthy();

    // Query second page using cursor
    const req2 = new Request(
      `http://localhost:3000/api/sync/catalog?limit=1&cursor=${encodeURIComponent(data1.next_cursor)}`,
    );
    const res2 = await GET(req2);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.products).toHaveLength(1);
    // Product in page 2 should be different from product in page 1
    expect(data2.products[0].id).not.toBe(data1.products[0].id);
  });

  it("returns 204 No Content when client passes cursor pointing past all current records", async () => {
    // Generate a future cursor
    const futurePayload = {
      u: new Date(Date.now() + 864000000).toISOString(),
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    };
    const futureCursor = Buffer.from(JSON.stringify(futurePayload)).toString(
      "base64url",
    );

    const req = new Request(
      `http://localhost:3000/api/sync/catalog?cursor=${encodeURIComponent(futureCursor)}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(204);
  });
});
