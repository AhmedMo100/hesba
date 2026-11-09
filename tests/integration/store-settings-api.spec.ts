/**
 * Characterization tests for the routes that keep per-store options inside
 * `stores.settings`: /api/sales/config and /api/store/custom-taxonomy.
 * Pins behavior before the shared settings read/merge/write moved into the tenancy module.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth";
import {
  GET as getSalesConfig,
  POST as postSalesConfig,
} from "@/app/api/sales/config/route";
import {
  GET as getTaxonomy,
  POST as postTaxonomy,
} from "@/app/api/store/custom-taxonomy/route";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

type Handler = (req: Request) => Promise<Response>;

describe("Store settings routes (characterization) & Tenancy", () => {
  let migratorPrisma: PrismaClient;
  let migratorClient: postgres.Sql;
  const runId = Math.random().toString(36).slice(2, 8);
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const storeAId = crypto.randomUUID();
  const storeBId = crypto.randomUUID();

  async function call(
    handler: Handler,
    path: string,
    userId: string,
    storeId: string,
    body?: unknown,
  ) {
    const session = await createSession(userId, storeId);
    const res = await handler(
      new Request(`http://localhost:3000${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${session.rawToken}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: await res.json() };
  }

  function settingsOf(storeId: string, userId: string) {
    return withTenant(
      storeId,
      userId,
      async (tx) =>
        (await tx.store.findUniqueOrThrow({ where: { id: storeId } }))
          .settings as Record<string, unknown>,
      migratorPrisma,
    );
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
          name: `إعدادات أ ${runId}`,
          phone: `+20131${runId}`,
          email: `settings-a-${runId}@hesba.test`,
          passwordHash: "x",
        },
        {
          id: userBId,
          name: `إعدادات ب ${runId}`,
          phone: `+20132${runId}`,
          email: `settings-b-${runId}@hesba.test`,
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
              name: `محل إعدادات ${runId}`,
              shopType: "supermarket",
              governorate: "Cairo",
              createdBy: userId,
              settings: { keepMe: 1 },
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

  describe("/api/sales/config", () => {
    it("GET defaults to empty lists", async () => {
      const r = await call(
        getSalesConfig,
        "/api/sales/config",
        userAId,
        storeAId,
      );
      expect(r.status).toBe(200);
      expect(r.json.config).toEqual({
        enabledServiceIds: [],
        enabledProductIds: [],
      });
    });

    it("POST de-duplicates ids, coerces to strings, treats non-arrays as empty, and keeps other settings", async () => {
      const r = await call(
        postSalesConfig,
        "/api/sales/config",
        userAId,
        storeAId,
        {
          enabledServiceIds: ["s1", "s1", 7],
          enabledProductIds: "not-an-array",
        },
      );
      expect(r.status).toBe(200);
      expect(r.json.success).toBe(true);
      expect(r.json.config.enabledServiceIds).toEqual(["s1", "7"]);
      expect(r.json.config.enabledProductIds).toEqual([]);
      expect(typeof r.json.config.updatedAt).toBe("string");

      const g = await call(
        getSalesConfig,
        "/api/sales/config",
        userAId,
        storeAId,
      );
      expect(g.json.config.enabledServiceIds).toEqual(["s1", "7"]);
      expect((await settingsOf(storeAId, userAId))["keepMe"]).toBe(1);
    });

    it("is isolated per store", async () => {
      const r = await call(
        getSalesConfig,
        "/api/sales/config",
        userBId,
        storeBId,
      );
      expect(r.json.config.enabledServiceIds).toEqual([]);
    });
  });

  describe("/api/store/custom-taxonomy", () => {
    const path = "/api/store/custom-taxonomy";

    it("GET defaults to empty lists", async () => {
      const r = await call(getTaxonomy, path, userAId, storeAId);
      expect(r.json).toEqual({
        customCategories: [],
        customSellingMethods: [],
      });
    });

    it("POST appends trimmed new values once, ignores 'أخرى', and keeps other settings", async () => {
      await call(postTaxonomy, path, userAId, storeAId, {
        newCategory: "  منظفات ",
        newSellingMethod: "بالدستة",
      });
      await call(postTaxonomy, path, userAId, storeAId, {
        newCategory: "منظفات",
      });
      const r = await call(postTaxonomy, path, userAId, storeAId, {
        newCategory: "أخرى",
        newSellingMethod: "أخرى",
      });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({
        success: true,
        customCategories: ["منظفات"],
        customSellingMethods: ["بالدستة"],
      });

      const settings = await settingsOf(storeAId, userAId);
      expect(settings["keepMe"]).toBe(1);
      expect(settings["salesConfig"]).toBeDefined(); // written by the sales-config test above
    });

    it("POST rejects an empty string value", async () => {
      const r = await call(postTaxonomy, path, userAId, storeAId, {
        newCategory: "   ",
      });
      expect(r.status).toBe(400);
    });

    it("is isolated per store", async () => {
      const r = await call(getTaxonomy, path, userBId, storeBId);
      expect(r.json.customCategories).toEqual([]);
    });
  });
});
