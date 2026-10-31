import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth/session.service";
import {
  GET as getExpensesRoute,
  POST as postExpensesRoute,
} from "@/app/api/expenses/route";
import {
  PATCH as patchExpenseRoute,
  DELETE as deleteExpenseRoute,
} from "@/app/api/expenses/[id]/route";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";
const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

describe("Expenses API & Tenancy Integration", () => {
  let migratorPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  let storeAId: string;
  let storeBId: string;
  let userAId: string;
  let userBId: string;
  const runId = Math.random().toString(36).slice(2, 8);

  async function createStoreWithRLS(
    id: string,
    creatorId: string,
    data: {
      name: string;
      shopType: string;
      governorate: string;
    },
  ) {
    return await withTenant(
      id,
      creatorId,
      async (tx) => {
        const store = await tx.store.create({
          data: {
            id,
            name: data.name,
            shopType: data.shopType,
            governorate: data.governorate,
            createdBy: creatorId,
          },
        });

        await tx.storeMember.create({
          data: {
            storeId: id,
            userId: creatorId,
            role: "owner",
          },
        });

        return store;
      },
      migratorPrisma,
    );
  }

  beforeAll(async () => {
    migratorClient = postgres(directUrl, { max: 1 });
    migratorPrisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    appPrisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    await migratorPrisma.$connect();
    await appPrisma.$connect();

    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    storeAId = crypto.randomUUID();
    storeBId = crypto.randomUUID();

    await migratorPrisma.user.createMany({
      data: [
        {
          id: userAId,
          name: `مالك أ ${runId}`,
          phone: `+20101${runId}`,
          email: `owner-a-${runId}@hesba.test`,
          passwordHash: "mockhashA",
        },
        {
          id: userBId,
          name: `مالك ب ${runId}`,
          phone: `+20102${runId}`,
          email: `owner-b-${runId}@hesba.test`,
          passwordHash: "mockhashB",
        },
      ],
    });

    await createStoreWithRLS(storeAId, userAId, {
      name: `محل أ للمصروفات ${runId}`,
      shopType: "supermarket",
      governorate: "Cairo",
    });

    await createStoreWithRLS(storeBId, userBId, {
      name: `محل ب للمصروفات ${runId}`,
      shopType: "supermarket",
      governorate: "Giza",
    });
  });

  afterAll(async () => {
    try {
      await migratorClient`DELETE FROM "expenses" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "store_members" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "stores" WHERE id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "users" WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await migratorClient.end();
      await migratorPrisma.$disconnect();
      await appPrisma.$disconnect();
    }
  });

  let createdExpenseId: string;

  it("POST /api/expenses records an expense with tenant isolation", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const postReq = new Request("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify({
        category: "نقل",
        amountPiasters: 12000,
        note: "توصيل أوردر",
      }),
    });

    const res = await postExpensesRoute(postReq);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.expense).toBeDefined();
    expect(json.expense.category).toBe("نقل");
    expect(json.expense.amount_piasters).toBe(12000);
    expect(json.expense.note).toBe("توصيل أوردر");
    expect(json.expense.store_id).toBe(storeAId);

    createdExpenseId = json.expense.id;
  });

  it("GET /api/expenses returns expenses and correct sum for Store A", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const getReq = new Request(
      "http://localhost:3000/api/expenses?period=today",
      {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );

    const res = await getExpensesRoute(getReq);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.expenses).toBeInstanceOf(Array);
    expect(json.expenses.length).toBeGreaterThanOrEqual(1);

    interface ExpItem {
      id: string;
      category: string;
      amount_piasters: number;
    }
    const found = (json.expenses as ExpItem[]).find(
      (e) => e.id === createdExpenseId,
    );
    expect(found).toBeDefined();
    expect(found?.amount_piasters).toBe(12000);
    expect(json.total_piasters).toBe(12000);
    expect(json.by_category["نقل"]).toBe(12000);
  });

  it("GET /api/expenses without period parameter defaults to today and returns 200", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const getReq = new Request("http://localhost:3000/api/expenses", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });

    const res = await getExpensesRoute(getReq);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.expenses).toBeInstanceOf(Array);
    expect(json.total_piasters).toBe(12000);
  });

  it("GET /api/expenses without authentication returns 401 Unauthorized", async () => {
    const getReq = new Request("http://localhost:3000/api/expenses");
    const res = await getExpensesRoute(getReq);
    expect(res.status).toBe(401);
  });

  it("GET /api/expenses supports period filters and custom range", async () => {
    const sessionA = await createSession(userAId, storeAId);

    // 7days period
    const getWeek = new Request(
      "http://localhost:3000/api/expenses?period=7days",
      {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );
    const resWeek = await getExpensesRoute(getWeek);
    expect(resWeek.status).toBe(200);
    const jsonWeek = await resWeek.json();
    expect(jsonWeek.expenses.length).toBeGreaterThanOrEqual(1);

    // Custom date range encompassing today
    const nowIso = new Date().toISOString().slice(0, 10);
    const getCustom = new Request(
      `http://localhost:3000/api/expenses?period=custom&from=${nowIso}&to=${nowIso}`,
      {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );
    const resCustom = await getExpensesRoute(getCustom);
    expect(resCustom.status).toBe(200);
    const jsonCustom = await resCustom.json();
    expect(jsonCustom.expenses.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/expenses filters by category correctly", async () => {
    const sessionA = await createSession(userAId, storeAId);

    // Filter matching category
    const getMatching = new Request(
      "http://localhost:3000/api/expenses?period=today&category=نقل",
      {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );
    const resMatching = await getExpensesRoute(getMatching);
    expect(resMatching.status).toBe(200);
    const jsonMatching = await resMatching.json();
    expect(jsonMatching.expenses.length).toBe(1);

    // Filter non-matching category
    const getNonMatching = new Request(
      "http://localhost:3000/api/expenses?period=today&category=كهرباء",
      {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );
    const resNonMatching = await getExpensesRoute(getNonMatching);
    expect(resNonMatching.status).toBe(200);
    const jsonNonMatching = await resNonMatching.json();
    expect(jsonNonMatching.expenses.length).toBe(0);
  });

  it("Enforces Cross-Tenant Isolation: Store B CANNOT read Store A expenses", async () => {
    const sessionB = await createSession(userBId, storeBId);

    const getReq = new Request(
      "http://localhost:3000/api/expenses?period=today",
      {
        headers: { cookie: `hesba_session=${sessionB.rawToken}` },
      },
    );

    const res = await getExpensesRoute(getReq);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.expenses.length).toBe(0);
    expect(json.total_piasters).toBe(0);

    interface ExpItem {
      id: string;
    }
    const leaked = (json.expenses as ExpItem[]).find(
      (e) => e.id === createdExpenseId,
    );
    expect(leaked).toBeUndefined();
  });

  it("Enforces Cross-Tenant Isolation: Store B CANNOT update or delete Store A expense", async () => {
    const sessionB = await createSession(userBId, storeBId);

    // Attempt PATCH from Store B
    const patchReq = new Request(
      `http://localhost:3000/api/expenses/${createdExpenseId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${sessionB.rawToken}`,
        },
        body: JSON.stringify({ amountPiasters: 99999 }),
      },
    );

    const patchRes = await patchExpenseRoute(patchReq, {
      params: Promise.resolve({ id: createdExpenseId }),
    });
    // Should fail with 400 or 500 safe error
    expect(patchRes.status).toBeGreaterThanOrEqual(400);

    // Attempt DELETE from Store B
    const delReq = new Request(
      `http://localhost:3000/api/expenses/${createdExpenseId}`,
      {
        method: "DELETE",
        headers: { cookie: `hesba_session=${sessionB.rawToken}` },
      },
    );

    const delRes = await deleteExpenseRoute(delReq, {
      params: Promise.resolve({ id: createdExpenseId }),
    });
    expect(delRes.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/expenses rejects invalid amount (<= 0)", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const postReq = new Request("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify({
        category: "كهرباء",
        amountPiasters: 0,
      }),
    });

    const res = await postExpensesRoute(postReq);
    expect(res.status).toBe(400);
  });

  it("PATCH /api/expenses/[id] updates expense values for Store A", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const patchReq = new Request(
      `http://localhost:3000/api/expenses/${createdExpenseId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${sessionA.rawToken}`,
        },
        body: JSON.stringify({
          amountPiasters: 25000,
          category: "صيانة",
          note: "صيانة الثلاجة",
        }),
      },
    );

    const res = await patchExpenseRoute(patchReq, {
      params: Promise.resolve({ id: createdExpenseId }),
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.expense.amount_piasters).toBe(25000);
    expect(json.expense.category).toBe("صيانة");
    expect(json.expense.note).toBe("صيانة الثلاجة");
  });

  it("DELETE /api/expenses/[id] deletes expense and updates total", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const delReq = new Request(
      `http://localhost:3000/api/expenses/${createdExpenseId}`,
      {
        method: "DELETE",
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );

    const res = await deleteExpenseRoute(delReq, {
      params: Promise.resolve({ id: createdExpenseId }),
    });
    expect(res.status).toBe(200);

    // Verify it is no longer returned in GET /api/expenses
    const getReq = new Request(
      "http://localhost:3000/api/expenses?period=today",
      {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );

    const getRes = await getExpensesRoute(getReq);
    const json = await getRes.json();
    expect(json.expenses.length).toBe(0);
    expect(json.total_piasters).toBe(0);
  });
});
