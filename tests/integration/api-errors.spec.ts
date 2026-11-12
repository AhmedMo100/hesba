/**
 * QA-18 / QA-19 (docs/QA/FULL-SYSTEM-AUDIT.md): a request mistake is a 4xx with a clear
 * message, never a 500 that says "your work is saved" and hides real incidents in the logs.
 * Real route handlers, real sessions, real Postgres with RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import * as products from "@/app/api/products/route";
import * as stock from "@/app/api/stock/route";
import * as salesConfig from "@/app/api/sales/config/route";
import * as people from "@/app/api/people/route";
import * as person from "@/app/api/people/[id]/route";
import * as personTx from "@/app/api/people/[id]/transactions/route";
import * as expenses from "@/app/api/expenses/route";
import * as expense from "@/app/api/expenses/[id]/route";
import * as machines from "@/app/api/machines/route";
import * as topup from "@/app/api/machines/topup/route";
import * as deduct from "@/app/api/machines/deduct/route";
import * as adjust from "@/app/api/machines/adjust/route";
import * as promotions from "@/app/api/promotions/route";
import * as taxonomy from "@/app/api/store/custom-taxonomy/route";
import * as aiChat from "@/app/api/ai/chat/route";
import * as aiConversation from "@/app/api/ai/conversations/[id]/route";
import * as profile from "@/app/api/auth/profile/route";
import * as signup from "@/app/api/auth/signup/route";
import * as login from "@/app/api/auth/login/route";
import * as reset from "@/app/api/auth/forgot-password/reset/route";
import { SaleFixtures } from "./helpers/sale-fixtures";

type Handler = (req: Request, ctx: never) => Promise<Response>;

const f = new SaleFixtures();
let token = "";

async function send(
  handler: Handler,
  method: string,
  path: string,
  body?: string,
  id?: string,
  auth = true,
): Promise<{ status: number; message: string }> {
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { cookie: `hesba_session=${token}` } : {}),
      },
      body,
    }),
    { params: Promise.resolve({ id: id ?? "" }) } as never,
  );
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return { status: res.status, message: json?.error?.message ?? "" };
}

beforeAll(async () => {
  await f.setup();
  token = (await createSession(f.shopA.userId, f.shopA.storeId)).rawToken;
});
afterAll(() => f.teardown());

describe("QA-18 — a malformed JSON body is a 400 on every endpoint", () => {
  const bad = "{not json";
  const cases: Array<[string, Handler, string, string, boolean?]> = [
    ["POST /api/products", products.POST as Handler, "POST", "/api/products"],
    [
      "PATCH /api/products",
      products.PATCH as Handler,
      "PATCH",
      "/api/products",
    ],
    ["POST /api/stock", stock.POST as Handler, "POST", "/api/stock"],
    [
      "POST /api/sales/config",
      salesConfig.POST as Handler,
      "POST",
      "/api/sales/config",
    ],
    ["POST /api/people", people.POST as Handler, "POST", "/api/people"],
    ["PATCH /api/people/x", person.PATCH as Handler, "PATCH", "/api/people/x"],
    [
      "POST /api/people/x/transactions",
      personTx.POST as Handler,
      "POST",
      "/api/people/x/transactions",
    ],
    ["POST /api/expenses", expenses.POST as Handler, "POST", "/api/expenses"],
    [
      "PATCH /api/expenses",
      expenses.PATCH as Handler,
      "PATCH",
      "/api/expenses",
    ],
    [
      "PATCH /api/expenses/x",
      expense.PATCH as Handler,
      "PATCH",
      "/api/expenses/x",
    ],
    ["POST /api/machines", machines.POST as Handler, "POST", "/api/machines"],
    [
      "POST /api/machines/topup",
      topup.POST as Handler,
      "POST",
      "/api/machines/topup",
    ],
    [
      "POST /api/machines/deduct",
      deduct.POST as Handler,
      "POST",
      "/api/machines/deduct",
    ],
    [
      "POST /api/machines/adjust",
      adjust.POST as Handler,
      "POST",
      "/api/machines/adjust",
    ],
    [
      "POST /api/promotions",
      promotions.POST as Handler,
      "POST",
      "/api/promotions",
    ],
    [
      "POST /api/store/custom-taxonomy",
      taxonomy.POST as Handler,
      "POST",
      "/api/store/custom-taxonomy",
    ],
    ["POST /api/ai/chat", aiChat.POST as Handler, "POST", "/api/ai/chat"],
    [
      "PUT /api/auth/profile",
      profile.PUT as Handler,
      "PUT",
      "/api/auth/profile",
    ],
    [
      "POST /api/auth/signup",
      signup.POST as Handler,
      "POST",
      "/api/auth/signup",
      false,
    ],
    [
      "POST /api/auth/login",
      login.POST as Handler,
      "POST",
      "/api/auth/login",
      false,
    ],
    [
      "POST /api/auth/forgot-password/reset",
      reset.POST as Handler,
      "POST",
      "/api/auth/forgot-password/reset",
      false,
    ],
  ];
  for (const [name, handler, method, path, auth] of cases) {
    it(name, async () => {
      const r = await send(handler, method, path, bad, "x", auth ?? true);
      expect(r.status).toBe(400);
      expect(r.message).not.toContain("محفوظ");
    });
  }
});

describe("QA-19 — unknown or malformed ids are 400/404, never 500", () => {
  const unknown = "6f9bfdfa-4869-4fac-8b94-0de852beaafd";
  const json = (v: unknown) => JSON.stringify(v);

  it("people: unknown id 404, malformed id 400 (read, edit, delete, transaction)", async () => {
    for (const [id, status] of [
      [unknown, 404],
      ["nope", 400],
    ] as const) {
      expect(
        (
          await send(
            person.GET as Handler,
            "GET",
            `/api/people/${id}`,
            undefined,
            id,
          )
        ).status,
      ).toBe(status);
      expect(
        (
          await send(
            person.PATCH as Handler,
            "PATCH",
            `/api/people/${id}`,
            json({ name: "x" }),
            id,
          )
        ).status,
      ).toBe(status);
      expect(
        (
          await send(
            person.DELETE as Handler,
            "DELETE",
            `/api/people/${id}`,
            undefined,
            id,
          )
        ).status,
      ).toBe(status);
      expect(
        (
          await send(
            personTx.POST as Handler,
            "POST",
            `/api/people/${id}/transactions`,
            json({ type: "debt", amountPiasters: 100 }),
            id,
          )
        ).status,
      ).toBe(status);
    }
  });

  it("expenses: unknown id 404, malformed id 400; bad custom dates 400", async () => {
    for (const [id, status] of [
      [unknown, 404],
      ["nope", 400],
    ] as const) {
      expect(
        (
          await send(
            expense.PATCH as Handler,
            "PATCH",
            `/api/expenses/${id}`,
            json({ note: "x" }),
            id,
          )
        ).status,
      ).toBe(status);
      expect(
        (
          await send(
            expense.DELETE as Handler,
            "DELETE",
            `/api/expenses/${id}`,
            undefined,
            id,
          )
        ).status,
      ).toBe(status);
    }
    for (const q of [
      "from=garbage",
      "from=2026-01-01&to=garbage",
      "from=2026-02-30&to=2026-03-01",
    ]) {
      expect(
        (
          await send(
            expenses.GET as Handler,
            "GET",
            `/api/expenses?period=custom&${q}`,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await send(
          expenses.GET as Handler,
          "GET",
          "/api/expenses?period=custom&from=2026-01-01&to=2026-01-31",
        )
      ).status,
    ).toBe(200);
  });

  it("products, machines, stock, AI conversations: unknown 404, malformed 400", async () => {
    expect(
      (
        await send(
          products.DELETE as Handler,
          "DELETE",
          `/api/products?id=${unknown}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await send(
          products.DELETE as Handler,
          "DELETE",
          "/api/products?id=nope",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          machines.DELETE as Handler,
          "DELETE",
          `/api/machines?id=${unknown}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await send(
          machines.DELETE as Handler,
          "DELETE",
          "/api/machines?id=nope",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          topup.POST as Handler,
          "POST",
          "/api/machines/topup",
          json({ machineId: "not-a-uuid", amountPiasters: 100 }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          stock.DELETE as Handler,
          "DELETE",
          `/api/stock?batchId=${unknown}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await send(stock.DELETE as Handler, "DELETE", "/api/stock?batchId=nope"))
        .status,
    ).toBe(400);
    expect(
      (
        await send(
          aiConversation.GET as Handler,
          "GET",
          `/api/ai/conversations/${unknown}`,
          undefined,
          unknown,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await send(
          aiConversation.GET as Handler,
          "GET",
          "/api/ai/conversations/nope",
          undefined,
          "nope",
        )
      ).status,
    ).toBe(400);
  });

  it("a machine with a wrong type or no name is a 400, not a 500", async () => {
    for (const body of [
      { name: 5, provider: "fawry" },
      { provider: "fawry" },
      { name: "x", provider: "fawry", status: "broken" },
    ]) {
      expect(
        (
          await send(
            machines.POST as Handler,
            "POST",
            "/api/machines",
            json(body),
          )
        ).status,
      ).toBe(400);
    }
  });
});
