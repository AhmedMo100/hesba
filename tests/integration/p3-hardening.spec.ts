/**
 * QA-35 … QA-42 (docs/QA/FULL-SYSTEM-AUDIT.md, P3): real route handlers, real sessions, real
 * Postgres with RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import * as products from "@/app/api/products/route";
import * as promotions from "@/app/api/promotions/route";
import * as stock from "@/app/api/stock/route";
import * as machines from "@/app/api/machines/route";
import { POST as topup } from "@/app/api/machines/topup/route";
import { POST as adjust } from "@/app/api/machines/adjust/route";
import * as expenses from "@/app/api/expenses/route";
import * as expense from "@/app/api/expenses/[id]/route";
import * as people from "@/app/api/people/route";
import * as person from "@/app/api/people/[id]/route";
import { POST as personTx } from "@/app/api/people/[id]/transactions/route";
import { POST as sandwichRoute } from "@/app/api/sandwiches/route";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as rotateRoute } from "@/app/api/auth/rotate/route";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

type Handler = (req: Request, ctx: never) => Promise<Response>;
const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const tokens = new Map<string, string>();
const signedUp: string[] = [];

async function call(
  handler: Handler,
  shop: Shop | null,
  method: string,
  path: string,
  body?: unknown,
  opts: { id?: string; headers?: Record<string, string>; raw?: string } = {},
): Promise<{ status: number; json: Json; res: Response }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  };
  if (shop) {
    let token = tokens.get(shop.storeId);
    if (!token) {
      token = (await createSession(shop.userId, shop.storeId)).rawToken;
      tokens.set(shop.storeId, token);
    }
    headers["cookie"] = `hesba_session=${token}`;
  }
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers,
      body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    { params: Promise.resolve({ id: opts.id ?? "" }) } as never,
  );
  return {
    status: res.status,
    json: (await res
      .clone()
      .json()
      .catch(() => ({}))) as Json,
    res,
  };
}

beforeAll(() => f.setup());
afterAll(async () => {
  for (const email of signedUp) {
    const users = await f.sql<
      Array<{ id: string }>
    >`SELECT id FROM users WHERE email = ${email}`;
    for (const { id } of users) {
      const stores = await f.sql<
        Array<{ store_id: string }>
      >`SELECT store_id FROM store_members WHERE user_id = ${id}`;
      await f.sql`DELETE FROM sessions WHERE user_id = ${id}`;
      await f.sql`DELETE FROM devices WHERE user_id = ${id}`;
      for (const s of stores) {
        await f.sql`DELETE FROM store_members WHERE store_id = ${s.store_id}`;
        await f.sql`DELETE FROM stores WHERE id = ${s.store_id}`;
      }
      await f.sql`DELETE FROM users WHERE id = ${id}`;
    }
  }
  await f.teardown();
});

describe("QA-35 — an operation that changes nothing is not a success", () => {
  it("unhiding an unknown or another shop's product is a 404", async () => {
    const pB = await f.product(B, {
      name: "منتج غيري مخفي",
      sell: 500,
      isActive: false,
    });
    for (const id of [crypto.randomUUID(), pB.productId]) {
      const r = await call(
        products.PATCH as Handler,
        A,
        "PATCH",
        `/api/products?id=${id}&action=unhide`,
        {},
      );
      expect(r.status).toBe(404);
    }
    const stillHidden = await f.as(B, (tx) =>
      tx.storeProduct.findUniqueOrThrow({ where: { id: pB.productId } }),
    );
    expect(stillHidden.isActive).toBe(false);
  });

  it("deleting an unknown or another shop's promotion is a 404", async () => {
    const r = await call(
      promotions.DELETE as Handler,
      A,
      "DELETE",
      "/api/promotions?id=promo_unknown",
    );
    expect(r.status).toBe(404);
  });

  it("a stock adjustment without a delta (or a target) is a 400 and records nothing", async () => {
    const p = await f.product(A, { name: "تسوية فاضية", sell: 500 });
    await f.addStock(A, p.variantId, 5);
    for (const body of [
      { action: "adjust", storeVariantId: p.variantId, mode: "delta" },
      {
        action: "adjust",
        storeVariantId: p.variantId,
        mode: "delta",
        deltaQuantityBase: 0,
      },
      { action: "adjust", storeVariantId: p.variantId, mode: "set" },
    ]) {
      expect(
        (await call(stock.POST as Handler, A, "POST", "/api/stock", body))
          .status,
      ).toBe(400);
    }
    const s = await f.stockState(A, p.variantId);
    expect(s.level).toBe(5);
    expect(s.movements).toHaveLength(1);
  });
});

describe("QA-36 — machine top-up and adjust validate numbers", () => {
  it("non-integer, string, huge or zero amounts are a 400; a valid one is applied", async () => {
    const m = await call(machines.POST as Handler, A, "POST", "/api/machines", {
      name: `ماكينة ${f.runId}`,
      provider: "fawry",
    });
    expect(m.status).toBe(201);
    const machineId = (m.json.machine as { id: string }).id;
    for (const amountPiasters of ["abc", 0.5, 1.5, 1e20, "100", 0, -5]) {
      expect(
        (
          await call(topup as Handler, A, "POST", "/api/machines/topup", {
            machineId,
            amountPiasters,
          })
        ).status,
      ).toBe(400);
    }
    for (const targetBalancePiasters of ["abc", 1.5, 1e20, -1]) {
      expect(
        (
          await call(adjust as Handler, A, "POST", "/api/machines/adjust", {
            machineId,
            targetBalancePiasters,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await call(topup as Handler, A, "POST", "/api/machines/topup", {
          machineId,
          amountPiasters: 10000,
        })
      ).status,
    ).toBeLessThan(300);
  });
});

describe("QA-37 — dates are validated", () => {
  it("expenses: an impossible or future date is a 400; a real one is saved as given", async () => {
    for (const spentAt of [
      "2026-13-45",
      "2026-02-30",
      "2099-01-01",
      "1990-01-01",
      "not-a-date",
      "2026-11-1",
    ]) {
      expect(
        (
          await call(expenses.POST as Handler, A, "POST", "/api/expenses", {
            category: "كهرباء",
            amountPiasters: 100,
            spentAt,
          })
        ).status,
      ).toBe(400);
    }
    const ok = await call(
      expenses.POST as Handler,
      A,
      "POST",
      "/api/expenses",
      { category: "كهرباء", amountPiasters: 100, spentAt: "2026-01-15" },
    );
    expect(ok.status).toBe(201);
    const saved = (ok.json.expense as { spent_at: string }).spent_at;
    expect(saved.slice(0, 10)).toBe("2026-01-15");
  });

  it("a debt dated 2099 or an impossible date is a 400; an unknown expenses period is a 400", async () => {
    const pr = await call(people.POST as Handler, A, "POST", "/api/people", {
      name: `تاريخ ${f.runId}`,
      section: "owedToMe",
      amountEgp: "0",
    });
    const id = (pr.json.person as { id: string }).id;
    for (const date of ["2099-01-01", "2026-13-45", "garbage"]) {
      expect(
        (
          await call(
            personTx as Handler,
            A,
            "POST",
            `/api/people/${id}/transactions`,
            { type: "debt", amountPiasters: 100, date },
            { id },
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await call(
          expenses.GET as Handler,
          A,
          "GET",
          "/api/expenses?period=nope",
        )
      ).status,
    ).toBe(400);
  });

  it("stock: an invalid or far expiry date is a 400 (it was a 500)", async () => {
    const p = await f.product(A, { name: "صلاحية غلط", sell: 500 });
    for (const expiryDate of ["not-a-date", "2026-13-45", "2199-01-01"]) {
      const r = await call(stock.POST as Handler, A, "POST", "/api/stock", {
        action: "add",
        storeVariantId: p.variantId,
        quantityBase: 1,
        costTotalPiasters: 100,
        expiryDate,
      });
      expect(r.status).toBe(400);
    }
    expect((await f.stockState(A, p.variantId)).level).toBe(0);
  });
});

describe("QA-39 — writes from another site are refused on the server", () => {
  const evil = { Origin: "https://evil.example" };
  it("a cookie-authenticated write with a foreign Origin or cross-site fetch is a 403", async () => {
    const body = { category: "كهرباء", amountPiasters: 100 };
    expect(
      (
        await call(expenses.POST as Handler, A, "POST", "/api/expenses", body, {
          headers: evil,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(expenses.POST as Handler, A, "POST", "/api/expenses", body, {
          headers: { "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          loginRoute as Handler,
          null,
          "POST",
          "/api/auth/login",
          { phone: "01000000000", password: "x" },
          { headers: evil },
        )
      ).status,
    ).toBe(403);
  });

  it("a non-JSON body (a CORS-free 'simple request') is a 415", async () => {
    const r = await call(
      expenses.POST as Handler,
      A,
      "POST",
      "/api/expenses",
      undefined,
      {
        headers: { "Content-Type": "text/plain" },
        raw: JSON.stringify({ category: "كهرباء", amountPiasters: 100 }),
      },
    );
    expect(r.status).toBe(415);
  });

  it("the same origin, and reads from anywhere, still work", async () => {
    const same = await call(
      expenses.POST as Handler,
      A,
      "POST",
      "/api/expenses",
      { category: "كهرباء", amountPiasters: 100 },
      { headers: { Origin: "http://localhost:3000" } },
    );
    expect(same.status).toBe(201);
    expect(
      (
        await call(
          expenses.GET as Handler,
          A,
          "GET",
          "/api/expenses?period=today",
          undefined,
          { headers: evil },
        )
      ).status,
    ).toBe(200);
  });
});

describe("QA-40 — the session token is only in the HttpOnly cookie", () => {
  it("signup, login and rotate return no token in the body, and set the cookie", async () => {
    const email = `p3-${f.runId}@hesba.test`;
    signedUp.push(email);
    const phone = `011${Math.floor(1e7 + Math.random() * 9e7)}`;
    const password = "P3-hardening-2026-ok";
    const sign = await call(
      signupRoute as Handler,
      null,
      "POST",
      "/api/auth/signup",
      {
        ownerName: "فحص",
        phone,
        email,
        password,
        storeName: `محل ${f.runId}`,
        shopType: "سوبر ماركت",
        governorate: "القاهرة",
      },
    );
    expect(sign.status).toBe(200);
    const login = await call(
      loginRoute as Handler,
      null,
      "POST",
      "/api/auth/login",
      { phone, password },
    );
    expect(login.status).toBe(200);
    for (const r of [sign, login]) {
      expect(JSON.stringify(r.json)).not.toMatch(/sessionToken|"token"/);
      expect(r.res.headers.get("set-cookie")).toMatch(
        /hesba_session=[^;]+;.*HttpOnly/i,
      );
    }
    const cookie = /hesba_session=([^;]+)/.exec(
      login.res.headers.get("set-cookie")!,
    )![1]!;
    const rot = await call(
      rotateRoute as Handler,
      null,
      "POST",
      "/api/auth/rotate",
      undefined,
      { headers: { cookie: `hesba_session=${cookie}` } },
    );
    expect(rot.status).toBe(200);
    expect(JSON.stringify(rot.json)).not.toMatch(/"token"/);
    expect(rot.res.headers.get("set-cookie")).toMatch(/hesba_session=/);
  });
});

describe("QA-41 — a sandwich ingredient cannot be hidden, and a hidden one is never sold", () => {
  it("hiding an ingredient is a 409; a sandwich with an already-hidden ingredient does not sell", async () => {
    const bread = await f.product(A, { name: "عيش ساندوتش", sell: 400 });
    await f.addStock(A, bread.variantId, 10);
    const sw = await call(
      sandwichRoute as Handler,
      A,
      "POST",
      "/api/sandwiches",
      {
        name: `ساندوتش إخفاء ${f.runId}`,
        sellPricePiasters: 1500,
        ingredients: [
          { variantId: bread.variantId, quantity: 1, unit: "piece" },
        ],
      },
    );
    expect(sw.status).toBe(201);
    const swId = (sw.json.sandwich as { id: string }).id;
    const hide = await call(
      products.DELETE as Handler,
      A,
      "DELETE",
      `/api/products?id=${bread.productId}`,
    );
    expect(hide.status).toBe(409);
    expect(
      (
        await f.as(A, (tx) =>
          tx.storeProduct.findUniqueOrThrow({ where: { id: bread.productId } }),
        )
      ).isActive,
    ).toBe(true);

    // Data from before the rule: the ingredient is hidden directly in the database.
    await f.as(A, (tx) =>
      tx.storeProduct.update({
        where: { id: bread.productId },
        data: { isActive: false },
      }),
    );
    const sale = await f.request(A, "POST", {
      productId: swId,
      quantityBase: 1,
      opId: crypto.randomUUID(),
    });
    expect(sale.status).toBe(400);
    expect((await f.stockState(A, bread.variantId)).level).toBe(10);
  });
});

describe("QA-42 — another shop's records are 404, never 500", () => {
  it("product upsert/hide, customer read/edit/pay/delete, expense edit/delete, sandwich sale", async () => {
    const pA = await f.product(A, { name: "منتج شاب أ", sell: 500 });
    const cust = await call(people.POST as Handler, A, "POST", "/api/people", {
      name: `زبون أ ${f.runId}`,
      section: "owedToMe",
      amountEgp: "10",
    });
    const custId = (cust.json.person as { id: string }).id;
    const exp = await call(
      expenses.POST as Handler,
      A,
      "POST",
      "/api/expenses",
      { category: "كهرباء", amountPiasters: 300 },
    );
    const expId = (exp.json.expense as { id: string }).id;
    const bread = await f.product(A, { name: "عيش شاب", sell: 400 });
    await f.addStock(A, bread.variantId, 3);
    const sw = await call(
      sandwichRoute as Handler,
      A,
      "POST",
      "/api/sandwiches",
      {
        name: `ساندوتش شاب ${f.runId}`,
        sellPricePiasters: 1500,
        ingredients: [
          { variantId: bread.variantId, quantity: 1, unit: "piece" },
        ],
      },
    );
    const swId = (sw.json.sandwich as { id: string }).id;

    const attempts = [
      call(products.POST as Handler, B, "POST", "/api/products", {
        id: pA.productId,
        nameAr: "مسروق",
        category: "مشروبات",
        unit: "piece",
        sellPricePiasters: 1,
        isCustom: true,
        variants: [{ packQty: 1, sellPricePiasters: 1 }],
      }),
      call(
        products.DELETE as Handler,
        B,
        "DELETE",
        `/api/products?id=${pA.productId}`,
      ),
      call(
        person.GET as Handler,
        B,
        "GET",
        `/api/people/${custId}`,
        undefined,
        { id: custId },
      ),
      call(
        person.PATCH as Handler,
        B,
        "PATCH",
        `/api/people/${custId}`,
        { name: "x" },
        { id: custId },
      ),
      call(
        personTx as Handler,
        B,
        "POST",
        `/api/people/${custId}/transactions`,
        { type: "payment", amountPiasters: 100 },
        { id: custId },
      ),
      call(
        person.DELETE as Handler,
        B,
        "DELETE",
        `/api/people/${custId}`,
        undefined,
        { id: custId },
      ),
      call(
        expense.PATCH as Handler,
        B,
        "PATCH",
        `/api/expenses/${expId}`,
        { note: "x" },
        { id: expId },
      ),
      call(
        expense.DELETE as Handler,
        B,
        "DELETE",
        `/api/expenses/${expId}`,
        undefined,
        { id: expId },
      ),
      f.request(B, "POST", {
        productId: swId,
        quantityBase: 1,
        opId: crypto.randomUUID(),
      }),
    ];
    for (const r of await Promise.all(attempts)) expect(r.status).toBe(404);

    // Nothing of shop A changed.
    const row = await f.as(A, (tx) =>
      tx.storeProduct.findUniqueOrThrow({ where: { id: pA.productId } }),
    );
    expect(row.nameAr).not.toBe("مسروق");
    expect(row.isActive).toBe(true);
    const custRow = await call(
      person.GET as Handler,
      A,
      "GET",
      `/api/people/${custId}`,
      undefined,
      { id: custId },
    );
    expect(
      (custRow.json.person as { amount_piasters: number }).amount_piasters,
    ).toBe(1000);
    expect((await f.stockState(A, bread.variantId)).level).toBe(3);
  });
});
