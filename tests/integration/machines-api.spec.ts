import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth/session.service";
import {
  GET as getMachinesRoute,
  POST as postMachinesRoute,
  DELETE as deleteMachinesRoute,
} from "@/app/api/machines/route";
import { POST as topupMachineRoute } from "@/app/api/machines/topup/route";

const directUrl =
  // Fixtures only (seed, inspect, clean up): a test-database admin connection. The migrator
  // no longer sees shops' rows (ADR-0024); isolation itself is tested through the app role.
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";
const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

describe("POS Machines & Topups API Integration", () => {
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

    const userA = await migratorPrisma.user.create({
      data: {
        name: `User A ${runId}`,
        phone: `+2010${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `usera_${runId}@hesba.test`,
      },
    });
    userAId = userA.id;

    const userB = await migratorPrisma.user.create({
      data: {
        name: `User B ${runId}`,
        phone: `+2010${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `userb_${runId}@hesba.test`,
      },
    });
    userBId = userB.id;

    storeAId = crypto.randomUUID();
    storeBId = crypto.randomUUID();

    await createStoreWithRLS(storeAId, userAId, {
      name: `Supermarket A ${runId}`,
      shopType: "supermarket",
      governorate: "Cairo",
    });

    await createStoreWithRLS(storeBId, userBId, {
      name: `Kiosk B ${runId}`,
      shopType: "kiosk",
      governorate: "Giza",
    });
  });

  afterAll(async () => {
    try {
      await migratorClient`DELETE FROM pos_machine_topups WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM pos_machines WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM store_members WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM stores WHERE id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await appPrisma.$disconnect();
      await migratorPrisma.$disconnect();
      await migratorClient.end();
    }
  });

  it("GET /api/machines returns empty list for a new store with no machines yet", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const req = new Request("http://localhost:3000/api/machines", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });

    const res = await getMachinesRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data.machines)).toBe(true);
    expect(data.machines.length).toBe(0);
  });

  it("POST /api/machines creates a new custom POS machine for the store", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const payload = {
      name: "ماكينة فوري خاصة بالمتجر",
      provider: "فوري (Fawry)",
      terminalId: "FAWRY-POS-99",
      status: "active",
      notes: "ماكينة الكاشير الأساسية لخدمات الدفع والشحن",
    };

    const req = new Request("http://localhost:3000/api/machines", {
      method: "POST",
      headers: {
        cookie: `hesba_session=${sessionA.rawToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const res = await postMachinesRoute(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.machine.name).toBe("ماكينة فوري خاصة بالمتجر");
    expect(data.machine.currentBalancePiasters).toBe(0);
    expect(data.machine.id).toBeDefined();
  });

  it("POST /api/machines/topup deposits balance and updates running balance atomically", async () => {
    const sessionA = await createSession(userAId, storeAId);

    // Get current machine created by Store A
    const listReq = new Request("http://localhost:3000/api/machines", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });
    const listRes = await getMachinesRoute(listReq);
    const listData = await listRes.json();
    const targetMachine = listData.machines.find(
      (m: { provider: string }) => m.provider === "فوري (Fawry)",
    );
    expect(targetMachine).toBeDefined();

    const initialBalance = targetMachine.currentBalancePiasters;
    const topupAmount = 50000; // 500 EGP

    const topupReq = new Request("http://localhost:3000/api/machines/topup", {
      method: "POST",
      headers: {
        cookie: `hesba_session=${sessionA.rawToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        machineId: targetMachine.id,
        amountPiasters: topupAmount,
        source: "فودافون كاش",
        reference: "VOD-TOPUP-123",
        notes: "شحن رصيد إضافي مسائي",
      }),
    });

    const topupRes = await topupMachineRoute(topupReq);
    expect(topupRes.status).toBe(200);

    const topupData = await topupRes.json();
    expect(topupData.machine.currentBalancePiasters).toBe(
      initialBalance + topupAmount,
    );
    expect(topupData.machine.balanceTransactions[0].source).toBe("فودافون كاش");
  });

  it("strictly enforces cross-tenant isolation: Store B cannot see or topup Store A machines", async () => {
    const sessionA = await createSession(userAId, storeAId);
    const sessionB = await createSession(userBId, storeBId);

    // Get Store A machines
    const listAReq = new Request("http://localhost:3000/api/machines", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });
    const listARes = await getMachinesRoute(listAReq);
    const listAData = await listARes.json();
    const machineA = listAData.machines[0];

    // Store B tries to topup Store A machine
    const rogueReq = new Request("http://localhost:3000/api/machines/topup", {
      method: "POST",
      headers: {
        cookie: `hesba_session=${sessionB.rawToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        machineId: machineA.id,
        amountPiasters: 10000,
      }),
    });

    const rogueRes = await topupMachineRoute(rogueReq);
    expect(rogueRes.status).toBe(404); // Machine not found in tenant B context

    // Store B listing only shows Store B's own machines
    const listBReq = new Request("http://localhost:3000/api/machines", {
      headers: { cookie: `hesba_session=${sessionB.rawToken}` },
    });
    const listBRes = await getMachinesRoute(listBReq);
    const listBData = await listBRes.json();
    expect(
      listBData.machines.some((m: { id: string }) => m.id === machineA.id),
    ).toBe(false);
  });

  it("DELETE /api/machines soft deletes machine", async () => {
    const sessionA = await createSession(userAId, storeAId);

    // Create a temporary machine to delete
    const createReq = new Request("http://localhost:3000/api/machines", {
      method: "POST",
      headers: {
        cookie: `hesba_session=${sessionA.rawToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "ماكينة مؤقتة للحذف",
        provider: "أخرى (مزود مخصص)",
      }),
    });
    const createRes = await postMachinesRoute(createReq);
    const createData = await createRes.json();
    const tempId = createData.machine.id;

    const delReq = new Request(
      `http://localhost:3000/api/machines?id=${tempId}`,
      {
        method: "DELETE",
        headers: { cookie: `hesba_session=${sessionA.rawToken}` },
      },
    );
    const delRes = await deleteMachinesRoute(delReq);
    expect(delRes.status).toBe(200);

    // Check it no longer appears in listing
    const listReq = new Request("http://localhost:3000/api/machines", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });
    const listRes = await getMachinesRoute(listReq);
    const listData = await listRes.json();
    expect(listData.machines.some((m: { id: string }) => m.id === tempId)).toBe(
      false,
    );
  });
});
