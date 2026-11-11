/**
 * Characterization tests for /api/promotions (published offers stored in
 * `stores.settings.activePromotions`). Pins behavior before the logic moved into
 * `src/server/modules/promotions`.
 *
 * QA-20: offers are checked against the shop's own products and priced by the server.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth";
import {
  GET as getPromotions,
  POST as postPromotion,
  DELETE as deletePromotion,
} from "@/app/api/promotions/route";

const directUrl =
  // Fixtures only (seed, inspect, clean up): a test-database admin connection. The migrator
  // no longer sees shops' rows (ADR-0024); isolation itself is tested through the app role.
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";

describe("Promotions API (characterization) & Tenancy", () => {
  let migratorPrisma: PrismaClient;
  let migratorClient: postgres.Sql;
  const runId = Math.random().toString(36).slice(2, 8);
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const storeAId = crypto.randomUUID();
  const storeBId = crypto.randomUUID();
  // Real products of each shop (QA-20: an offer's items must be the shop's own).
  const ref = {
    tea: { productId: "", variantId: "" }, // store A, 25.00 per piece
    cheese: { productId: "", variantId: "" }, // store A, 200.00 per kg
    hidden: { productId: "", variantId: "" }, // store A, hidden
    unpriced: { productId: "", variantId: "" }, // store A, no price
    otherShop: { productId: "", variantId: "" }, // store B
  };

  const promo = (id: string, title = "عرض الشاي") => ({
    id,
    title,
    items: [
      {
        productId: ref.tea.productId,
        variantId: ref.tea.variantId,
        productName: "شاي",
        quantityBase: 2,
        regularPricePiasters: 2500,
      },
    ],
    originalPricePiasters: 5000,
    promoPricePiasters: 4000,
    savingsPiasters: 1000,
  });

  async function call(
    method: "GET" | "POST" | "DELETE",
    userId: string,
    storeId: string,
    opts: { body?: unknown; query?: string } = {},
  ) {
    const session = await createSession(userId, storeId);
    const req = new Request(
      `http://localhost:3000/api/promotions${opts.query ?? ""}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${session.rawToken}`,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      },
    );
    const handler =
      method === "GET"
        ? getPromotions
        : method === "POST"
          ? postPromotion
          : deletePromotion;
    return handler(req);
  }

  async function listIds(userId: string, storeId: string) {
    const res = await call("GET", userId, storeId);
    const json = (await res.json()) as { promotions: Array<{ id: string }> };
    return json.promotions.map((p) => p.id);
  }

  beforeAll(async () => {
    migratorClient = postgres(directUrl, { max: 1 });
    migratorPrisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    await migratorPrisma.$connect();
    await migratorPrisma.user.createMany({
      data: [
        {
          id: userAId,
          name: `عروض أ ${runId}`,
          phone: `+20121${runId}`,
          email: `promo-a-${runId}@hesba.test`,
          passwordHash: "x",
        },
        {
          id: userBId,
          name: `عروض ب ${runId}`,
          phone: `+20122${runId}`,
          email: `promo-b-${runId}@hesba.test`,
          passwordHash: "x",
        },
      ],
    });
    for (const [storeId, userId] of [
      [storeAId, userAId],
      [storeBId, userBId],
    ] as const) {
      await withTenant(
        storeId,
        userId,
        async (tx) => {
          await tx.store.create({
            data: {
              id: storeId,
              name: `محل عروض ${runId}`,
              shopType: "supermarket",
              governorate: "Cairo",
              createdBy: userId,
              settings: { keepMe: true },
            },
          });
          await tx.storeMember.create({
            data: { storeId, userId, role: "owner" },
          });
        },
        migratorPrisma,
      );
    }
    const product = async (
      storeId: string,
      userId: string,
      name: string,
      unit: string,
      price: number,
      isActive = true,
    ) =>
      withTenant(
        storeId,
        userId,
        async (tx) => {
          const p = await tx.storeProduct.create({
            data: {
              storeId,
              nameAr: `${name} ${runId}`,
              nameNorm: `${name} ${runId}`,
              category: "مشروبات",
              unit,
              sellPricePiasters: BigInt(price),
              isCustom: true,
              isActive,
              storeVariants: {
                create: {
                  storeId,
                  packQty: 1,
                  sellPricePiasters: BigInt(price),
                },
              },
            },
            include: { storeVariants: true },
          });
          return { productId: p.id, variantId: p.storeVariants[0]!.id };
        },
        migratorPrisma,
      );
    ref.tea = await product(storeAId, userAId, "شاي", "piece", 2500);
    ref.cheese = await product(storeAId, userAId, "جبنة", "kg", 20000);
    ref.hidden = await product(storeAId, userAId, "مخفي", "piece", 1000, false);
    ref.unpriced = await product(storeAId, userAId, "بدون سعر", "piece", 0);
    ref.otherShop = await product(storeBId, userBId, "محل تاني", "piece", 2500);
  });

  afterAll(async () => {
    try {
      await migratorClient`DELETE FROM "store_variants" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "store_products" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "sessions" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "store_members" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "stores" WHERE id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "users" WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await migratorClient.end();
      await migratorPrisma.$disconnect();
    }
  });

  it("GET starts empty", async () => {
    expect(await listIds(userAId, storeAId)).toEqual([]);
  });

  it("POST publishes newest-first, replaces an existing id, and keeps other settings", async () => {
    const r1 = await call("POST", userAId, storeAId, { body: promo("a") });
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1.success).toBe(true);
    expect(j1.promotion.type).toBe("bundle"); // schema default
    expect(j1.promotion.items[0].unit).toBe("piece"); // schema default
    expect(typeof j1.promotion.createdAt).toBe("number");

    await call("POST", userAId, storeAId, { body: promo("b") });
    await call("POST", userAId, storeAId, { body: promo("a", "عرض معدل") });
    expect(await listIds(userAId, storeAId)).toEqual(["a", "b"]);

    const res = await call("GET", userAId, storeAId);
    const { promotions } = await res.json();
    expect(promotions[0].title).toBe("عرض معدل");

    const store = await withTenant(
      storeAId,
      userAId,
      (tx) => tx.store.findUniqueOrThrow({ where: { id: storeAId } }),
      migratorPrisma,
    );
    expect((store.settings as Record<string, unknown>)["keepMe"]).toBe(true);
  });

  it("POST rejects a non-positive promo price", async () => {
    const res = await call("POST", userAId, storeAId, {
      body: { ...promo("bad"), promoPricePiasters: 0 },
    });
    expect(res.status).toBe(400);
  });

  it("another store sees none of these and cannot delete them", async () => {
    expect(await listIds(userBId, storeBId)).toEqual([]);
    const res = await call("DELETE", userBId, storeBId, { query: "?id=a" });
    expect(res.status).toBe(200);
    expect(await listIds(userAId, storeAId)).toEqual(["a", "b"]);
  });

  it("DELETE removes one promotion; missing id is a 400", async () => {
    await call("DELETE", userAId, storeAId, { query: "?id=a" });
    expect(await listIds(userAId, storeAId)).toEqual(["b"]);
    const res = await call("DELETE", userAId, storeAId);
    expect(res.status).toBe(400);
  });

  describe("QA-20 — invalid offers are refused; prices come from the shop", () => {
    const post = (body: unknown) =>
      call("POST", userAId, storeAId, { body }).then(async (r) => ({
        status: r.status,
        json: (await r.json()) as {
          promotion?: Record<string, unknown> & {
            items: Array<Record<string, unknown>>;
          };
          error?: { message: string };
        },
      }));

    it("a promo price at or above the original is a 400", async () => {
      for (const promoPricePiasters of [5000, 5001, 999999]) {
        const r = await post({ ...promo("expensive"), promoPricePiasters });
        expect(r.status).toBe(400);
      }
      // The client claims a high original, but the shop's price makes 2 teas 50.00.
      const lied = await post({
        ...promo("lied"),
        originalPricePiasters: 999999,
        promoPricePiasters: 6000,
      });
      expect(lied.status).toBe(400);
      expect(await listIds(userAId, storeAId)).not.toContain("lied");
    });

    it("no items, an unknown, hidden, unpriced or another shop's product is a 400", async () => {
      const withItem = (variantId: string, productId = "x") => ({
        ...promo("bad-item"),
        items: [{ ...promo("x").items[0]!, variantId, productId }],
      });
      const bodies = [
        { ...promo("empty"), items: [] },
        withItem("not-a-uuid"),
        withItem(crypto.randomUUID()),
        withItem(ref.hidden.variantId, ref.hidden.productId),
        withItem(ref.unpriced.variantId, ref.unpriced.productId),
        withItem(ref.otherShop.variantId, ref.otherShop.productId),
      ];
      for (const body of bodies) {
        expect((await post(body)).status).toBe(400);
      }
      const ids = await listIds(userAId, storeAId);
      expect(ids).not.toContain("bad-item");
      expect(ids).not.toContain("empty");
    });

    it("a single discount has exactly one item", async () => {
      const r = await post({
        ...promo("two-singles"),
        type: "single_discount",
        items: [promo("x").items[0]!, promo("x").items[0]!],
        originalPricePiasters: 10000,
        promoPricePiasters: 8000,
      });
      expect(r.status).toBe(400);
    });

    it("the server sets the item prices, names, original and savings from the shop's data", async () => {
      const r = await post({
        id: "server-priced",
        title: "شاي وجبنة",
        type: "bundle",
        items: [
          {
            productId: "anything",
            variantId: ref.tea.variantId,
            productName: "اسم من العميل",
            quantityBase: 2,
            regularPricePiasters: 1,
          },
          {
            productId: ref.cheese.productId,
            variantId: ref.cheese.variantId,
            productName: "جبنة",
            quantityBase: 500, // grams of a per-kg product
            unit: "kg",
            regularPricePiasters: 1,
          },
        ],
        originalPricePiasters: 20000,
        promoPricePiasters: 12000,
        savingsPiasters: 8000,
      });
      expect(r.status).toBe(200);
      const p = r.json.promotion!;
      // 2 × 25.00 + 500 g × 200.00/kg = 50.00 + 100.00
      expect(p.items.map((i) => i["regularPricePiasters"])).toEqual([
        5000, 10000,
      ]);
      expect(p["originalPricePiasters"]).toBe(15000);
      expect(p["promoPricePiasters"]).toBe(12000);
      expect(p["savingsPiasters"]).toBe(3000);
      expect(p.items[0]!["productId"]).toBe(ref.tea.productId);
      expect(p.items[0]!["productName"]).toBe(`شاي ${runId}`);
      expect(p.items[1]!["unit"]).toBe("kg");
    });
  });
});
