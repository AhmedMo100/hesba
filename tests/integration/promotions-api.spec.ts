/**
 * Characterization tests for /api/promotions (published offers stored in
 * `stores.settings.activePromotions`). Pins behavior before the logic moved into
 * `src/server/modules/promotions`.
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

  const promo = (id: string, title = "عرض الشاي") => ({
    id,
    title,
    items: [
      {
        productId: "p1",
        variantId: "v1",
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
  });

  afterAll(async () => {
    try {
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
});
