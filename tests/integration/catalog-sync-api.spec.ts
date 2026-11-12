import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { GET } from "@/app/api/sync/catalog/route";
import { createSession } from "@/server/modules/auth";
import { SaleFixtures } from "./helpers/sale-fixtures";

// The catalog is downloaded by signed-in shops only (QA-53).
const f = new SaleFixtures();
let cookie = "";
function authed(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), cookie },
  });
}

const directUrl =
  // Fixtures only (seed, inspect, clean up): a test-database admin connection. The migrator
  // no longer sees shops' rows (ADR-0024); isolation itself is tested through the app role.
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";

describe("Catalog Sync Route Handler GET /api/sync/catalog (Phase 3.3 Integration)", () => {
  let prisma: PrismaClient;
  let testBrandId: string;
  let testProductId1: string;
  let testProductId2: string;
  let testVariantId: string;

  beforeAll(async () => {
    await f.setup();
    const session = await createSession(f.shopA.userId, f.shopA.storeId);
    cookie = `hesba_session=${session.rawToken}`;
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
    await f.teardown();
  });

  it("returns 200 with global products, variants, brands, ETag, and Cache-Control", async () => {
    const request = authed("http://localhost:3000/api/sync/catalog?limit=1000");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private");
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
    const req1 = authed("http://localhost:3000/api/sync/catalog");
    const res1 = await GET(req1);
    const etag = res1.headers.get("ETag");
    expect(etag).toBeTruthy();

    // 2. Conditional request with matching If-None-Match
    const req2 = authed("http://localhost:3000/api/sync/catalog", {
      headers: { "If-None-Match": etag! },
    });
    const res2 = await GET(req2);
    expect(res2.status).toBe(304);
    expect(await res2.text()).toBe("");
  });

  it("supports pagination with limit and stable next_cursor", async () => {
    const req1 = authed("http://localhost:3000/api/sync/catalog?limit=1");
    const res1 = await GET(req1);
    expect(res1.status).toBe(200);

    const data1 = await res1.json();
    expect(data1.products).toHaveLength(1);
    expect(data1.has_more).toBe(true);
    expect(data1.next_cursor).toBeTruthy();

    // Query second page using cursor
    const req2 = authed(
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

    const req = authed(
      `http://localhost:3000/api/sync/catalog?cursor=${encodeURIComponent(futureCursor)}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(204);
  });

  it("QA-53: refuses an anonymous download", async () => {
    const res = await GET(
      new Request("http://localhost:3000/api/sync/catalog?limit=5"),
    );
    expect(res.status).toBe(401);
  });

  it("QA-53: the last page carries its position; the next sync gets only what changed", async () => {
    // Walk every page as the app does.
    let cursor = "";
    for (let i = 0; i < 1000; i++) {
      const res = await GET(
        authed(
          `http://localhost:3000/api/sync/catalog?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
      );
      if (res.status === 204) break;
      expect(res.status).toBe(200);
      const page = await res.json();
      expect(page.next_cursor).toBeTruthy();
      cursor = page.next_cursor;
      if (!page.has_more) break;
    }
    // Nothing changed since: 204.
    const same = await GET(
      authed(
        `http://localhost:3000/api/sync/catalog?cursor=${encodeURIComponent(cursor)}`,
      ),
    );
    expect(same.status).toBe(204);
    // A product changes: only it comes back.
    await prisma.globalProduct.update({
      where: { id: testProductId2 },
      data: { nameEn: `Changed ${Date.now()}` },
    });
    const changed = await GET(
      authed(
        `http://localhost:3000/api/sync/catalog?cursor=${encodeURIComponent(cursor)}`,
      ),
    );
    expect(changed.status).toBe(200);
    const body = await changed.json();
    expect(body.products.map((p: { id: string }) => p.id)).toEqual([
      testProductId2,
    ]);
  });
});
