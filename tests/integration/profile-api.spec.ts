/**
 * QA-11 (docs/QA/FULL-SYSTEM-AUDIT.md) — PUT /api/auth/profile: the owner saves their details
 * and the store's profile in ONE tenant transaction (FORCE RLS stays on), the phone is stored
 * in the canonical +20… form so login keeps working with it, invalid input is a 400 (never a
 * 500), and nobody can change another store's profile.
 *
 * Real Postgres, real route handlers, real sessions, app role with RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import {
  createSession,
  hashPassword,
  loginWithPassword,
} from "@/server/modules/auth";
import { PUT as putProfile } from "@/app/api/auth/profile/route";

const directUrl =
  // Fixtures only (seed, inspect, clean up): a test-database admin connection. The migrator
  // no longer sees shops' rows (ADR-0024); isolation itself is tested through the app role.
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";

describe("QA-11 — Profile API", () => {
  let migratorPrisma: PrismaClient;
  let migratorClient: postgres.Sql;
  const digits = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  const ownerId = crypto.randomUUID();
  const workerId = crypto.randomUUID();
  const otherOwnerId = crypto.randomUUID();
  const storeId = crypto.randomUUID();
  const otherStoreId = crypto.randomUUID();
  const password = "Profile-test-2026-ok";

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

  async function put(
    userId: string | null,
    body: unknown,
    store = storeId,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (userId) {
      const session = await createSession(userId, store);
      headers["cookie"] = `hesba_session=${session.rawToken}`;
    }
    const res = await putProfile(
      new Request("http://localhost:3000/api/auth/profile", {
        method: "PUT",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: await res.json() };
  }

  const storeRow = (id: string) =>
    withTenant(
      id,
      null,
      (tx) => tx.store.findUniqueOrThrow({ where: { id } }),
      migratorPrisma,
    );

  beforeAll(async () => {
    migratorClient = postgres(directUrl, { max: 1 });
    migratorPrisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    await migratorPrisma.$connect();
    const hash = await hashPassword(password);
    await migratorPrisma.user.createMany({
      data: [
        {
          id: ownerId,
          name: "مالك",
          phone: `+20109${digits}`,
          email: `own-${digits}@hesba.test`,
          emailVerifiedAt: new Date(),
          passwordHash: hash,
        },
        {
          id: workerId,
          name: "عامل",
          phone: `+20108${digits}`,
          email: `wrk-${digits}@hesba.test`,
          passwordHash: "x",
        },
        {
          id: otherOwnerId,
          name: "مالك تاني",
          phone: `+20106${digits}`,
          email: `oth-${digits}@hesba.test`,
          passwordHash: "x",
        },
      ],
    });
    for (const [id, owner, name] of [
      [storeId, ownerId, "محل"],
      [otherStoreId, otherOwnerId, "محل تاني"],
    ] as const) {
      await withTenant(
        id,
        owner,
        async (tx) => {
          await tx.store.create({
            data: {
              id,
              name,
              shopType: "بقالة",
              governorate: "الجيزة",
              createdBy: owner,
            },
          });
          await tx.storeMember.create({
            data: { storeId: id, userId: owner, role: "owner" },
          });
          if (id === storeId) {
            await tx.storeMember.create({
              data: { storeId: id, userId: workerId, role: "cashier" },
            });
          }
        },
        migratorPrisma,
      );
    }
  });

  afterAll(async () => {
    const users = [ownerId, workerId, otherOwnerId];
    const stores = [storeId, otherStoreId];
    try {
      await migratorClient`DELETE FROM "sessions" WHERE user_id IN ${migratorClient(users)}`;
      await migratorClient`DELETE FROM "devices" WHERE user_id IN ${migratorClient(users)}`;
      await migratorClient`DELETE FROM "store_members" WHERE store_id IN ${migratorClient(stores)}`;
      await migratorClient`DELETE FROM "stores" WHERE id IN ${migratorClient(stores)}`;
      await migratorClient`DELETE FROM "users" WHERE id IN ${migratorClient(users)}`;
    } finally {
      await migratorClient.end();
      await migratorPrisma.$disconnect();
    }
  });

  it("the owner saves the owner and store profile: 200 with the saved values", async () => {
    const r = await put(ownerId, validBody);
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.data).toMatchObject({
      ownerName: "أحمد",
      phone: `+20101${digits}`,
      email: `profile-${digits}@hesba.test`,
      storeName: "سوبر ماركت النور",
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
      area: "مدينة نصر",
      workersCount: 3,
    });

    const store = await storeRow(storeId);
    expect(store.name).toBe("سوبر ماركت النور");
    expect(store.area).toBe("مدينة نصر");
    expect(store.workersCount).toBe(3);
    expect(store.openedOn?.toISOString().slice(0, 10)).toBe("2020-01-15");
    const user = await migratorPrisma.user.findUniqueOrThrow({
      where: { id: ownerId },
    });
    expect(user.name).toBe("أحمد");
  });

  it("stores the phone in the canonical +20 form, and the owner logs in with the new number", async () => {
    // The local form the owner types and the +20 form both end up as +20… (what signup
    // writes and login looks up).
    for (const phone of [`0101${digits}`, `+20101${digits}`]) {
      const r = await put(ownerId, { ...validBody, phone });
      expect(r.status).toBe(200);
      const user = await migratorPrisma.user.findUniqueOrThrow({
        where: { id: ownerId },
      });
      expect(user.phone).toBe(`+20101${digits}`);
    }

    // Login looks users up by the normalized phone: both local and +20 forms work.
    const local = await loginWithPassword({
      phone: `0101${digits}`,
      password,
    });
    expect(local.user.id).toBe(ownerId);
    const intl = await loginWithPassword({
      phone: `+20101${digits}`,
      password,
    });
    expect(intl.user.id).toBe(ownerId);
  });

  it("changing the email clears its verified flag; keeping it keeps the flag", async () => {
    await migratorPrisma.user.update({
      where: { id: ownerId },
      data: { emailVerifiedAt: new Date() },
    });
    const same = await put(ownerId, validBody);
    expect(same.status).toBe(200);
    expect((same.json.data as { emailVerified: boolean }).emailVerified).toBe(
      true,
    );
    const changed = await put(ownerId, {
      ...validBody,
      email: `NEW-${digits}@Hesba.test`,
    });
    expect(changed.status).toBe(200);
    expect(changed.json.data).toMatchObject({
      email: `new-${digits}@hesba.test`,
      emailVerified: false,
    });
  });

  it("a phone or email of another account is a 409, and nothing is changed", async () => {
    const before = await storeRow(storeId);
    const phoneTaken = await put(ownerId, {
      ...validBody,
      storeName: "اسم مش هيتحفظ",
      phone: `0106${digits}`,
    });
    expect(phoneTaken.status).toBe(409);
    const emailTaken = await put(ownerId, {
      ...validBody,
      storeName: "اسم مش هيتحفظ",
      email: `oth-${digits}@hesba.test`,
    });
    expect(emailTaken.status).toBe(409);
    expect((await storeRow(storeId)).name).toBe(before.name);
  });

  it("invalid input is a 400, never a 500", async () => {
    for (const body of [
      { ...validBody, phone: "12345" },
      { ...validBody, storeName: "" },
      { ...validBody, workersCount: 0 },
      { ...validBody, email: "not-an-email" },
      { ...validBody, openedOn: "not-a-date" },
      "{ not json",
    ]) {
      const r = await put(ownerId, body);
      expect(r.status).toBe(400);
    }
  });

  it("without a session it is a 401", async () => {
    const r = await put(null, validBody);
    expect(r.status).toBe(401);
  });

  it("a non-owner member is forbidden", async () => {
    const r = await put(workerId, { ...validBody, storeName: "مش مسموح" });
    expect(r.status).toBe(403);
    expect((await storeRow(storeId)).name).not.toBe("مش مسموح");
  });

  it("only the session's own store changes (tenant isolation)", async () => {
    const otherBefore = await storeRow(otherStoreId);
    // An owner of another store saves their own profile…
    const r = await put(
      otherOwnerId,
      {
        ...validBody,
        phone: `0106${digits}`,
        email: `oth-${digits}@hesba.test`,
        storeName: "المحل التاني اتعدل",
      },
      otherStoreId,
    );
    expect(r.status).toBe(200);
    expect((await storeRow(otherStoreId)).name).toBe("المحل التاني اتعدل");
    expect(otherBefore.name).toBe("محل تاني");
    // …and the first store is untouched.
    expect((await storeRow(storeId)).name).toBe("سوبر ماركت النور");
    // The worker of the first store cannot reach the other store's profile with their session.
    const cross = await put(workerId, validBody, otherStoreId);
    expect([401, 403]).toContain(cross.status);
    expect((await storeRow(otherStoreId)).name).toBe("المحل التاني اتعدل");
  });
});
