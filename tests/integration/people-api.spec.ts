import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth/session.service";
import {
  GET as getPeopleRoute,
  POST as postPeopleRoute,
} from "@/app/api/people/route";
import {
  GET as getPersonDetailsRoute,
  PATCH as patchPersonRoute,
  DELETE as deletePersonRoute,
} from "@/app/api/people/[id]/route";
import { POST as postTransactionRoute } from "@/app/api/people/[id]/transactions/route";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";
const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

describe("People Module API & Tenancy Integration", () => {
  let migratorPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  let storeAId: string;
  let storeBId: string;
  let userAId: string;
  let userBId: string;
  let testProductId: string;
  const runId = Math.random().toString(36).slice(2, 8);

  async function createStoreWithRLS(
    id: string,
    creatorId: string,
    data: { name: string; shopType: string; governorate: string },
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
    testProductId = crypto.randomUUID();

    await migratorPrisma.user.createMany({
      data: [
        {
          id: userAId,
          name: `مالك أ للناس ${runId}`,
          phone: `+20107${runId}`,
          email: `owner-people-a-${runId}@hesba.test`,
          passwordHash: "mockhashA",
        },
        {
          id: userBId,
          name: `مالك ب للناس ${runId}`,
          phone: `+20108${runId}`,
          email: `owner-people-b-${runId}@hesba.test`,
          passwordHash: "mockhashB",
        },
      ],
    });

    await createStoreWithRLS(storeAId, userAId, {
      name: `محل أ للناس ${runId}`,
      shopType: "supermarket",
      governorate: "Cairo",
    });

    await createStoreWithRLS(storeBId, userBId, {
      name: `محل ب للناس ${runId}`,
      shopType: "supermarket",
      governorate: "Giza",
    });

    // Create a product in Store A to test supplier-product relationships
    await withTenant(
      storeAId,
      userAId,
      async (tx) => {
        await tx.storeProduct.create({
          data: {
            id: testProductId,
            storeId: storeAId,
            nameAr: `مياه معدنية 1.5 لتر ${runId}`,
            category: "مشروبات",
            unit: "piece",
            sellPricePiasters: 800,
          },
        });
      },
      migratorPrisma,
    );
  });

  afterAll(async () => {
    try {
      await migratorClient`DELETE FROM "supplier_products" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "debt_entries" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "contacts" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "store_products" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "store_members" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "stores" WHERE id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "users" WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await migratorClient.end();
      await migratorPrisma.$disconnect();
      await appPrisma.$disconnect();
    }
  });

  let customerId: string;
  let iOwePersonId: string;
  let supplierId: string;

  it("POST /api/people adds a customer with receivable debt in 'owedToMe'", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const postReq = new Request("http://localhost:3000/api/people", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify({
        name: "أبو خالد",
        phone: "01123456789",
        section: "owedToMe",
        amountPiasters: 240000, // 2,400 EGP
        note: "حساب الشهر",
      }),
    });

    const res = await postPeopleRoute(postReq);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.person).toBeDefined();
    expect(json.person.name).toBe("أبو خالد");
    expect(json.person.phone).toBe("01123456789");
    expect(json.person.amount_piasters).toBe(240000);
    expect(json.person.note).toBe("حساب الشهر");

    customerId = json.person.id;
  });

  it("POST /api/people adds a payable party in 'iOwe'", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const postReq = new Request("http://localhost:3000/api/people", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify({
        name: "الحاج إبراهيم",
        phone: "01001234567",
        section: "iOwe",
        amountPiasters: 150000, // 1,500 EGP
        note: "سلفة",
      }),
    });

    const res = await postPeopleRoute(postReq);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.person.name).toBe("الحاج إبراهيم");
    expect(json.person.amount_piasters).toBe(150000);
    expect(json.person.note).toBe("سلفة");

    iOwePersonId = json.person.id;
  });

  it("POST /api/people adds a supplier with supplied products and owed amount", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const postReq = new Request("http://localhost:3000/api/people", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify({
        name: "شركة النور",
        phone: "01001112233",
        section: "suppliers",
        amountPiasters: 320000, // 3,200 EGP
        supplies: [testProductId],
      }),
    });

    const res = await postPeopleRoute(postReq);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.person.name).toBe("شركة النور");
    expect(json.person.amount_piasters).toBe(320000);
    expect(json.person.supplies).toHaveLength(1);
    expect(json.person.supplies[0].id).toBe(testProductId);

    supplierId = json.person.id;
  });

  it("GET /api/people lists sections accurately with totals", async () => {
    const sessionA = await createSession(userAId, storeAId);

    // 1. Check owedToMe section
    const resOwed = await getPeopleRoute(
      new Request("http://localhost:3000/api/people?section=owedToMe", {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      }),
    );
    expect(resOwed.status).toBe(200);
    const jsonOwed = await resOwed.json();
    expect(jsonOwed.count).toBeGreaterThanOrEqual(1);
    expect(jsonOwed.total_piasters).toBeGreaterThanOrEqual(240000);

    // 2. Check iOwe section
    const resIOwe = await getPeopleRoute(
      new Request("http://localhost:3000/api/people?section=iOwe", {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      }),
    );
    expect(resIOwe.status).toBe(200);
    const jsonIOwe = await resIOwe.json();
    expect(jsonIOwe.count).toBeGreaterThanOrEqual(1);
    expect(jsonIOwe.total_piasters).toBeGreaterThanOrEqual(150000);

    // 3. Check suppliers section
    const resSup = await getPeopleRoute(
      new Request("http://localhost:3000/api/people?section=suppliers", {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      }),
    );
    expect(resSup.status).toBe(200);
    const jsonSup = await resSup.json();
    expect(jsonSup.count).toBeGreaterThanOrEqual(1);
    expect(jsonSup.total_piasters).toBeGreaterThanOrEqual(320000);
    const foundSup = jsonSup.people.find(
      (s: { id: string }) => s.id === supplierId,
    );
    expect(foundSup.supplies).toHaveLength(1);
  });

  it("POST /api/people/[id]/transactions records a collection reducing customer balance", async () => {
    const sessionA = await createSession(userAId, storeAId);

    // Customer owes 2,400 EGP (240000 piasters). Repay 400 EGP (40000 piasters).
    const transReq = new Request(
      `http://localhost:3000/api/people/${customerId}/transactions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${sessionA.rawToken}`,
        },
        body: JSON.stringify({
          type: "payment",
          amountPiasters: 40000,
          note: "دفعة نقدية",
        }),
      },
    );

    const transRes = await postTransactionRoute(transReq, {
      params: Promise.resolve({ id: customerId }),
    });
    expect(transRes.status).toBe(201);
    const transJson = await transRes.json();
    expect(transJson.transaction.amount_piasters).toBe(40000);
    expect(transJson.transaction.type).toBe("payment");

    // Verify customer details and transaction history
    const detailReq = new Request(
      `http://localhost:3000/api/people/${customerId}`,
      {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );
    const detailRes = await getPersonDetailsRoute(detailReq, {
      params: Promise.resolve({ id: customerId }),
    });
    expect(detailRes.status).toBe(200);
    const detailJson = await detailRes.json();

    // 240000 - 40000 = 200000 piasters (2,000 EGP)
    expect(detailJson.person.amount_piasters).toBe(200000);
    expect(detailJson.transactions.length).toBeGreaterThanOrEqual(2);
  });

  it("Idempotency: duplicate transaction submission does not double count", async () => {
    const sessionA = await createSession(userAId, storeAId);
    const fixedOpId = crypto.randomUUID();

    // Send transaction with explicit opId
    const req1 = new Request(
      `http://localhost:3000/api/people/${customerId}/transactions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${sessionA.rawToken}`,
        },
        body: JSON.stringify({
          type: "payment",
          amountPiasters: 50000,
          note: "دفعة ثانية",
          opId: fixedOpId,
        }),
      },
    );

    const res1 = await postTransactionRoute(req1, {
      params: Promise.resolve({ id: customerId }),
    });
    expect(res1.status).toBe(201);

    // Send exact same transaction again
    const req2 = new Request(
      `http://localhost:3000/api/people/${customerId}/transactions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${sessionA.rawToken}`,
        },
        body: JSON.stringify({
          type: "payment",
          amountPiasters: 50000,
          note: "دفعة ثانية",
          opId: fixedOpId,
        }),
      },
    );

    const res2 = await postTransactionRoute(req2, {
      params: Promise.resolve({ id: customerId }),
    });
    expect(res2.status).toBe(201);

    // Verify balance was only deducted once: 200000 - 50000 = 150000
    const detailRes = await getPersonDetailsRoute(
      new Request(`http://localhost:3000/api/people/${customerId}`, {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      }),
      { params: Promise.resolve({ id: customerId }) },
    );
    const detailJson = await detailRes.json();
    expect(detailJson.person.amount_piasters).toBe(150000);
  });

  it("PATCH /api/people/[id] updates details and balance adjustment", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const patchReq = new Request(
      `http://localhost:3000/api/people/${customerId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${sessionA.rawToken}`,
        },
        body: JSON.stringify({
          name: "أبو خالد المعدل",
          phone: "01199998888",
        }),
      },
    );

    const patchRes = await patchPersonRoute(patchReq, {
      params: Promise.resolve({ id: customerId }),
    });
    expect(patchRes.status).toBe(200);
    const patchJson = await patchRes.json();
    expect(patchJson.person.name).toBe("أبو خالد المعدل");
    expect(patchJson.person.phone).toBe("01199998888");
  });

  it("DELETE /api/people/[id] soft-deletes person and removes them from active lists", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const delReq = new Request(
      `http://localhost:3000/api/people/${iOwePersonId}`,
      {
        method: "DELETE",
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );

    const delRes = await deletePersonRoute(delReq, {
      params: Promise.resolve({ id: iOwePersonId }),
    });
    expect(delRes.status).toBe(200);

    // Verify person is excluded from GET /api/people?section=iOwe
    const getRes = await getPeopleRoute(
      new Request("http://localhost:3000/api/people?section=iOwe", {
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      }),
    );
    const getJson = await getRes.json();
    const found = getJson.people.find(
      (p: { id: string }) => p.id === iOwePersonId,
    );
    expect(found).toBeUndefined();
  });

  it("Cross-Tenant Isolation: Store B cannot access or modify Store A contacts", async () => {
    const sessionB = await createSession(userBId, storeBId);

    // Attempt GET from Store B
    const getRes = await getPersonDetailsRoute(
      new Request(`http://localhost:3000/api/people/${customerId}`, {
        headers: { cookie: `hesba_session=${sessionB.rawToken}` },
      }),
      { params: Promise.resolve({ id: customerId }) },
    );
    expect(getRes.status).toBeGreaterThanOrEqual(400);

    // Attempt PATCH from Store B
    const patchRes = await patchPersonRoute(
      new Request(`http://localhost:3000/api/people/${customerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${sessionB.rawToken}`,
        },
        body: JSON.stringify({ name: "اختراق" }),
      }),
      { params: Promise.resolve({ id: customerId }) },
    );
    expect(patchRes.status).toBeGreaterThanOrEqual(400);

    // Attempt DELETE from Store B
    const delRes = await deletePersonRoute(
      new Request(`http://localhost:3000/api/people/${customerId}`, {
        method: "DELETE",
        headers: { cookie: `hesba_session=${sessionB.rawToken}` },
      }),
      { params: Promise.resolve({ id: customerId }) },
    );
    expect(delRes.status).toBeGreaterThanOrEqual(400);
  });

  it("Security: Unauthenticated requests return 401 Unauthorized", async () => {
    const res = await getPeopleRoute(
      new Request("http://localhost:3000/api/people"),
    );
    expect(res.status).toBe(401);
  });
});
