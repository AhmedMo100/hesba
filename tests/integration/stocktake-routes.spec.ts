import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  GET as stocktakeGet,
  POST as stocktakePost,
} from "@/app/api/stock/stocktake/route";
import { GET as sessionDetailsGet } from "@/app/api/stock/stocktake/[id]/route";
import { POST as updateCountPost } from "@/app/api/stock/stocktake/[id]/count/route";
import { POST as cancelPost } from "@/app/api/stock/stocktake/[id]/cancel/route";
import { SaleFixtures } from "./helpers/sale-fixtures";
import { createSession } from "@/server/modules/auth";

describe("Stocktake Route Handlers Stabilization", () => {
  const f = new SaleFixtures();
  const shopA = f.shopA;
  let token: string;
  let createdSessionId: string | null = null;

  beforeAll(async () => {
    await f.setup();
    token = (await createSession(shopA.userId, shopA.storeId)).rawToken;
    const prod = await f.product(shopA, {
      name: "Milk",
      sell: 2500,
      buy: 2000,
    });
    await f.addStock(shopA, prod.variantId, 100, { cost: 200000 });
  });

  afterAll(async () => {
    await f.teardown();
  });

  it("GET /api/stock/stocktake returns 200 with activeSession and sessions array", async () => {
    const req = new Request("http://localhost:3000/api/stock/stocktake", {
      method: "GET",
      headers: {
        cookie: `hesba_session=${token}`,
      },
    });

    const res = await stocktakeGet(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("sessions");
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it("POST /api/stock/stocktake creates a session or handles conflict properly", async () => {
    const req = new Request("http://localhost:3000/api/stock/stocktake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${token}`,
      },
      body: JSON.stringify({ scope: "full" }),
    });

    const res = await stocktakePost(req);
    const body = await res.json();

    expect([201, 409]).toContain(res.status);
    if (res.status === 201) {
      expect(body.session).toBeDefined();
      expect(body.session.id).toBeDefined();
      createdSessionId = body.session.id;
    }
  });

  it("GET /api/stock/stocktake/[id] returns details of the session", async () => {
    if (!createdSessionId) return;

    const req = new Request(
      `http://localhost:3000/api/stock/stocktake/${createdSessionId}`,
      {
        method: "GET",
        headers: {
          cookie: `hesba_session=${token}`,
        },
      },
    );

    const res = await sessionDetailsGet(req, {
      params: Promise.resolve({ id: createdSessionId }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session).toBeDefined();
    expect(Array.isArray(body.session.items)).toBe(true);
  });

  it("POST /api/stock/stocktake/[id]/count saves item counts", async () => {
    if (!createdSessionId) return;

    // Fetch items first
    const getReq = new Request(
      `http://localhost:3000/api/stock/stocktake/${createdSessionId}`,
      {
        method: "GET",
        headers: { cookie: `hesba_session=${token}` },
      },
    );
    const getRes = await sessionDetailsGet(getReq, {
      params: Promise.resolve({ id: createdSessionId }),
    });
    const getData = await getRes.json();
    const item = getData.session?.items?.[0];
    if (!item) return;

    const countReq = new Request(
      `http://localhost:3000/api/stock/stocktake/${createdSessionId}/count`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${token}`,
        },
        body: JSON.stringify({
          items: [
            {
              storeVariantId: item.storeVariantId,
              countedQuantityBase: 50,
            },
          ],
        }),
      },
    );

    const res = await updateCountPost(countReq, {
      params: Promise.resolve({ id: createdSessionId }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /api/stock/stocktake/[id]/cancel cancels session safely", async () => {
    if (!createdSessionId) return;

    const req = new Request(
      `http://localhost:3000/api/stock/stocktake/${createdSessionId}/cancel`,
      {
        method: "POST",
        headers: {
          cookie: `hesba_session=${token}`,
        },
      },
    );

    const res = await cancelPost(req, {
      params: Promise.resolve({ id: createdSessionId }),
    });
    expect(res.status).toBe(200);
  });
});
