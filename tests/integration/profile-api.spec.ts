/**
 * Characterization tests for PUT /api/auth/profile (owner edits their own and the store's
 * profile). Written during the restructuring because the route had no coverage; the route
 * itself was left unchanged because its main path is broken (see the `it.fails` below).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth";
import { PUT as putProfile } from "@/app/api/auth/profile/route";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

describe("Profile API (characterization)", () => {
  let migratorPrisma: PrismaClient;
  let migratorClient: postgres.Sql;
  const digits = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  const ownerId = crypto.randomUUID();
  const workerId = crypto.randomUUID();
  const storeId = crypto.randomUUID();

  const validBody = {
    ownerName: "أحمد",
    phone: `0101${digits}`,
    email: `profile-${digits}@hesba.test`,
    storeName: "سوبر ماركت النور",
    shopType: "سوبر ماركت",
    governorate: "القاهرة",
    area: "مدينة نصر",
    openedOn: "2020-01-15",
    workersCount: 3,
  };

  async function put(userId: string, body: unknown) {
    const session = await createSession(userId, storeId);
    const res = await putProfile(
      new Request("http://localhost:3000/api/auth/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${session.rawToken}`,
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: await res.json() };
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
          id: ownerId,
          name: "مالك",
          phone: `+20109${digits}`,
          email: `own-${digits}@hesba.test`,
          passwordHash: "x",
        },
        {
          id: workerId,
          name: "عامل",
          phone: `+20108${digits}`,
          email: `wrk-${digits}@hesba.test`,
          passwordHash: "x",
        },
      ],
    });
    await withTenant(
      storeId,
      ownerId,
      async (tx) => {
        await tx.store.create({
          data: {
            id: storeId,
            name: "محل",
            shopType: "بقالة",
            governorate: "الجيزة",
            createdBy: ownerId,
          },
        });
        await tx.storeMember.createMany({
          data: [
            { storeId, userId: ownerId, role: "owner" },
            { storeId, userId: workerId, role: "cashier" },
          ],
        });
      },
      migratorPrisma,
    );
  });

  afterAll(async () => {
    try {
      await migratorClient`DELETE FROM "sessions" WHERE store_id = ${storeId}`;
      await migratorClient`DELETE FROM "store_members" WHERE store_id = ${storeId}`;
      await migratorClient`DELETE FROM "stores" WHERE id = ${storeId}`;
      await migratorClient`DELETE FROM "users" WHERE id IN (${ownerId}, ${workerId})`;
    } finally {
      await migratorClient.end();
      await migratorPrisma.$disconnect();
    }
  });

  // KNOWN DEFECT (pending owner decision): the route updates `stores` with the plain Prisma
  // client outside `withTenant`, so FORCE RLS hides the row (P2025) and the whole transaction —
  // including the user update — fails with 500. Fix: run the store update inside withTenant.
  // When fixed, this becomes a normal `it`.
  it.fails("owner can update user + store profile", async () => {
    const r = await put(ownerId, validBody);
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.data).toMatchObject({
      ownerName: "أحمد",
      storeName: "سوبر ماركت النور",
      area: "مدينة نصر",
      workersCount: 3,
    });
  });

  it("a non-owner member is forbidden", async () => {
    const r = await put(workerId, validBody);
    expect(r.status).toBe(403);
  });

  it("rejects an invalid Egyptian phone", async () => {
    const r = await put(ownerId, { ...validBody, phone: "12345" });
    expect(r.status).toBe(400);
  });
});
