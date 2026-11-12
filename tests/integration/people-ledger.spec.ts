/**
 * QA-12 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0023) — the people ledgers show financial reality:
 * - an overpayment is a VISIBLE credit (a negative balance), never floored to 0, and a later
 *   debt is set against it in the open;
 * - editing a person's balance writes one labelled owner `adjustment`, never a fake debt or
 *   payment, and renaming a person writes nothing;
 * - history is never changed, writes are idempotent by `opId`, and stores are isolated.
 *
 * Real Postgres, real route handlers, real sessions, app role with RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth";
import { GET as listRoute, POST as createRoute } from "@/app/api/people/route";
import {
  GET as detailsRoute,
  PATCH as patchRoute,
} from "@/app/api/people/[id]/route";
import { POST as txRoute } from "@/app/api/people/[id]/transactions/route";

const directUrl =
  // Fixtures only (seed, inspect, clean up): a test-database admin connection. The migrator
  // no longer sees shops' rows (ADR-0024); isolation itself is tested through the app role.
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";

type Json = Record<string, unknown>;
interface Shop {
  storeId: string;
  userId: string;
}
interface Person {
  id: string;
  amount_piasters: number;
  credit_piasters: number;
  total_original_piasters: number;
  total_paid_piasters: number;
  total_adjustments_piasters: number;
  is_settled: boolean;
  name: string;
}
interface Entry {
  id: string;
  type: "debt" | "payment" | "adjustment";
  kind: "opening" | "transaction" | "adjustment";
  amount_piasters: number;
  balance_after_piasters: number;
  action_label: string;
}

const runId = Math.random().toString(36).slice(2, 8);
const A: Shop = { storeId: crypto.randomUUID(), userId: crypto.randomUUID() };
const B: Shop = { storeId: crypto.randomUUID(), userId: crypto.randomUUID() };
const migrator = new PrismaClient({ datasources: { db: { url: directUrl } } });
const sql = postgres(directUrl, { max: 1 });
const tokens = new Map<string, string>();

async function call(
  shop: Shop,
  handler: (req: Request, ctx: never) => Promise<Response>,
  method: string,
  path: string,
  body?: unknown,
  id?: string,
): Promise<{ status: number; json: Json }> {
  let token = tokens.get(shop.storeId);
  if (!token) {
    token = (await createSession(shop.userId, shop.storeId)).rawToken;
    tokens.set(shop.storeId, token);
  }
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: id ?? "" }) } as never,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const create = (
  shop: Shop,
  section: "owedToMe" | "iOwe" | "suppliers",
  amountPiasters: number,
) =>
  call(shop, createRoute as never, "POST", "/api/people", {
    name: `شخص ${section} ${runId}`,
    section,
    amountPiasters,
  });

const pay = (
  shop: Shop,
  id: string,
  type: "debt" | "payment",
  amountPiasters: number,
  opId?: string,
) =>
  call(
    shop,
    txRoute as never,
    "POST",
    `/api/people/${id}/transactions`,
    { type, amountPiasters, ...(opId ? { opId } : {}) },
    id,
  );

async function details(shop: Shop, id: string) {
  const r = await call(
    shop,
    detailsRoute as never,
    "GET",
    `/api/people/${id}`,
    undefined,
    id,
  );
  expect(r.status).toBe(200);
  return r.json as unknown as {
    person: Person;
    transactions: Entry[];
    summary: { remaining_piasters: number; credit_piasters: number };
  };
}

const entriesOf = (shop: Shop, where: Record<string, string>) =>
  withTenant(
    shop.storeId,
    shop.userId,
    (tx) =>
      tx.debtEntry.findMany({
        where: { storeId: shop.storeId, ...where },
        orderBy: { createdAt: "asc" },
      }),
    migrator,
  );

beforeAll(async () => {
  await migrator.$connect();
  let n = 0;
  for (const shop of [A, B]) {
    n += 1;
    await migrator.user.create({
      data: {
        id: shop.userId,
        name: `مالك دفتر ${n} ${runId}`,
        phone: `+2011${n}${runId}`,
        email: `ledger-${n}-${runId}@hesba.test`,
        passwordHash: "x",
      },
    });
    await withTenant(
      shop.storeId,
      shop.userId,
      async (tx) => {
        await tx.store.create({
          data: {
            id: shop.storeId,
            name: `محل دفتر ${n} ${runId}`,
            shopType: "supermarket",
            governorate: "Cairo",
            createdBy: shop.userId,
          },
        });
        await tx.storeMember.create({
          data: { storeId: shop.storeId, userId: shop.userId, role: "owner" },
        });
      },
      migrator,
    );
  }
});

afterAll(async () => {
  const ids = [A.storeId, B.storeId];
  try {
    await sql`DELETE FROM "debt_entries" WHERE store_id IN ${sql(ids)}`;
    await sql`DELETE FROM "customers" WHERE store_id IN ${sql(ids)}`;
    await sql`DELETE FROM "payables" WHERE store_id IN ${sql(ids)}`;
    await sql`DELETE FROM "suppliers" WHERE store_id IN ${sql(ids)}`;
    await sql`DELETE FROM "sessions" WHERE store_id IN ${sql(ids)}`;
    await sql`DELETE FROM "store_members" WHERE store_id IN ${sql(ids)}`;
    await sql`DELETE FROM "stores" WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM "users" WHERE id IN ${sql([A.userId, B.userId])}`;
  } finally {
    await sql.end();
    await migrator.$disconnect();
  }
});

describe("QA-12 — customer overpayment is a visible credit", () => {
  it("100 owed → pay 30, 10, 10, 9,999.99 → credit 9,949.99; a later debt is set against it openly", async () => {
    const created = await create(A, "owedToMe", 10_000);
    expect(created.status).toBe(201);
    const id = (created.json.person as Person).id;

    for (const amount of [3_000, 1_000, 1_000]) {
      expect((await pay(A, id, "payment", amount)).status).toBe(201);
    }
    expect((await details(A, id)).person.amount_piasters).toBe(5_000);

    const over = await pay(A, id, "payment", 999_999);
    expect(over.status).toBe(201);
    expect((over.json.transaction as Entry).balance_after_piasters).toBe(
      -994_999,
    );

    let d = await details(A, id);
    expect(d.person).toMatchObject({
      amount_piasters: -994_999,
      credit_piasters: 994_999,
      total_original_piasters: 10_000,
      total_paid_piasters: 1_004_999,
      is_settled: false,
    });
    expect(d.summary).toMatchObject({
      remaining_piasters: -994_999,
      credit_piasters: 994_999,
    });
    // The running balance is signed too: nothing in the history is floored to 0.
    expect(d.transactions.map((t) => t.balance_after_piasters)).toEqual([
      -994_999, 5_000, 6_000, 7_000, 10_000,
    ]);

    // Five later debts of 1.00 are NOT absorbed invisibly: each one shows on the balance.
    for (let i = 0; i < 5; i++) {
      expect((await pay(A, id, "debt", 100)).status).toBe(201);
    }
    d = await details(A, id);
    expect(d.person.amount_piasters).toBe(-994_499);
    expect(d.person.credit_piasters).toBe(994_499);
    expect(d.transactions).toHaveLength(10);

    // The list shows the credit too, and keeps it out of the "owed to you" total.
    const list = await call(
      A,
      listRoute as never,
      "GET",
      "/api/people?section=owedToMe",
    );
    const row = (list.json.people as Person[]).find((p) => p.id === id)!;
    expect(row.amount_piasters).toBe(-994_499);
    const summary = list.json.summary as {
      total_remaining_piasters: number;
      total_credit_piasters: number;
    };
    expect(summary.total_credit_piasters).toBeGreaterThanOrEqual(994_499);
    expect(list.json.total_piasters).toBe(summary.total_remaining_piasters);
  });
});

describe("QA-12 — payable and supplier overpayment", () => {
  it("payable: owe 30, pay 50 → the shop has a 20 credit (they owe the shop)", async () => {
    const id = ((await create(A, "iOwe", 3_000)).json.person as Person).id;
    const res = await pay(A, id, "payment", 5_000);
    expect(res.status).toBe(201);
    expect((res.json.transaction as Entry).balance_after_piasters).toBe(-2_000);
    const d = await details(A, id);
    expect(d.person).toMatchObject({
      amount_piasters: -2_000,
      credit_piasters: 2_000,
      total_original_piasters: 3_000,
      total_paid_piasters: 5_000,
    });
    // Nothing hidden: the ledger holds exactly the two real entries.
    const rows = await entriesOf(A, { payableId: id });
    expect(
      rows.map((r) => [r.entryKind, r.direction, Number(r.amountPiasters)]),
    ).toEqual([
      ["opening", "i_owe", 3_000],
      ["transaction", "owed_to_me", 5_000],
    ]);
  });

  it("supplier: owe 100, pay 150 → a 50 advance, shown as a credit", async () => {
    const id = ((await create(A, "suppliers", 10_000)).json.person as Person)
      .id;
    expect((await pay(A, id, "payment", 15_000)).status).toBe(201);
    const d = await details(A, id);
    expect(d.person).toMatchObject({
      amount_piasters: -5_000,
      credit_piasters: 5_000,
    });
    // A new purchase on credit is set against the advance.
    expect((await pay(A, id, "debt", 2_000)).status).toBe(201);
    expect((await details(A, id)).person.amount_piasters).toBe(-3_000);
  });
});

describe("QA-12 — editing a balance never fabricates a debt or a payment", () => {
  it("renaming (no amount) writes nothing; setting a new balance writes one adjustment; the same balance again writes nothing", async () => {
    const id = ((await create(A, "owedToMe", 10_000)).json.person as Person).id;
    await pay(A, id, "payment", 12_000); // a 20.00 credit
    const before = await entriesOf(A, { customerId: id });

    const renamed = await call(
      A,
      patchRoute as never,
      "PATCH",
      `/api/people/${id}`,
      { name: `اسم جديد ${runId}` },
      id,
    );
    expect(renamed.status).toBe(200);
    expect((renamed.json.person as Person).amount_piasters).toBe(-2_000);

    // Setting it to 0 IS a change from -20.00: it must be ONE labelled owner adjustment.
    const toZero = await call(
      A,
      patchRoute as never,
      "PATCH",
      `/api/people/${id}`,
      { amountPiasters: 0 },
      id,
    );
    expect(toZero.status).toBe(200);
    const after = await entriesOf(A, { customerId: id });
    expect(after).toHaveLength(before.length + 1);
    const added = after[after.length - 1]!;
    expect(added.entryKind).toBe("adjustment");
    expect(Number(added.amountPiasters)).toBe(2_000);
    expect(added.noteAr).toBeNull();
    // History is intact: the earlier entries are exactly as they were.
    expect(
      after
        .slice(0, before.length)
        .map((e) => [e.id, Number(e.amountPiasters)]),
    ).toEqual(before.map((e) => [e.id, Number(e.amountPiasters)]));

    const again = await call(
      A,
      patchRoute as never,
      "PATCH",
      `/api/people/${id}`,
      { amountPiasters: 0 },
      id,
    );
    expect(again.status).toBe(200);
    expect(await entriesOf(A, { customerId: id })).toHaveLength(after.length);
  });

  it("an opening balance edited 100 → 150 → 40: owner adjustments, correct balance, totals unchanged", async () => {
    const id = ((await create(A, "owedToMe", 10_000)).json.person as Person).id;
    await pay(A, id, "payment", 2_000); // real history: 100 owed, 20 collected

    for (const target of [15_000, 4_000]) {
      const r = await call(
        A,
        patchRoute as never,
        "PATCH",
        `/api/people/${id}`,
        { amountPiasters: target },
        id,
      );
      expect(r.status).toBe(200);
      expect((r.json.person as Person).amount_piasters).toBe(target);
    }

    const d = await details(A, id);
    expect(d.person).toMatchObject({
      amount_piasters: 4_000,
      // Debts and collections are only the real ones…
      total_original_piasters: 10_000,
      total_paid_piasters: 2_000,
      // …and the owner's changes are reported apart: +70.00 then −110.00.
      total_adjustments_piasters: -4_000,
    });
    const kinds = d.transactions.map((t) => [t.kind, t.type]);
    expect(kinds).toEqual([
      ["adjustment", "adjustment"],
      ["adjustment", "adjustment"],
      ["transaction", "payment"],
      ["opening", "debt"],
    ]);
    expect(d.transactions[0]!.action_label).toContain("تعديل رصيد");
    // No ordinary debt or payment was invented.
    const rows = await entriesOf(A, { customerId: id });
    expect(rows.filter((r) => r.entryKind === "transaction")).toHaveLength(1);
  });

  it("payables and suppliers follow the same rule", async () => {
    for (const section of ["iOwe", "suppliers"] as const) {
      const id = ((await create(A, section, 3_000)).json.person as Person).id;
      const r = await call(
        A,
        patchRoute as never,
        "PATCH",
        `/api/people/${id}`,
        { name: `معدل ${section} ${runId}`, amountPiasters: 5_000 },
        id,
      );
      expect(r.status).toBe(200);
      expect((r.json.person as Person).amount_piasters).toBe(5_000);
      const col = section === "iOwe" ? "payableId" : "supplierId";
      const rows = await entriesOf(A, { [col]: id });
      expect(rows.map((e) => [e.entryKind, e.direction])).toEqual([
        ["opening", "i_owe"],
        ["adjustment", "i_owe"],
      ]);
    }
  });
});

describe("QA-12 — idempotency, atomicity and tenant isolation", () => {
  it("the same payment sent twice (same opId) is recorded once", async () => {
    const id = ((await create(A, "owedToMe", 10_000)).json.person as Person).id;
    const opId = crypto.randomUUID();
    const first = await pay(A, id, "payment", 4_000, opId);
    const second = await pay(A, id, "payment", 4_000, opId);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.json.transaction as Entry).id).toBe(
      (first.json.transaction as Entry).id,
    );
    expect((await details(A, id)).person.amount_piasters).toBe(6_000);
    // The same opId on another person is a conflict, not a silent duplicate.
    const other = ((await create(A, "owedToMe", 1_000)).json.person as Person)
      .id;
    expect((await pay(A, other, "payment", 500, opId)).status).toBe(409);
  });

  it("concurrent payments are all recorded and every balance is exact", async () => {
    const id = ((await create(A, "owedToMe", 10_000)).json.person as Person).id;
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => pay(A, id, "payment", 3_000)),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const afters = results
      .map((r) => (r.json.transaction as Entry).balance_after_piasters)
      .sort((a, b) => b - a);
    expect(afters).toEqual([7_000, 4_000, 1_000, -2_000]);
    expect((await details(A, id)).person.amount_piasters).toBe(-2_000);
  });

  it("another store cannot read, pay into, or edit the person (404) and nothing changes", async () => {
    const id = ((await create(A, "owedToMe", 10_000)).json.person as Person).id;
    const before = await entriesOf(A, { customerId: id });
    const read = await call(
      B,
      detailsRoute as never,
      "GET",
      `/api/people/${id}`,
      undefined,
      id,
    );
    expect(read.status).toBe(404);
    expect((await pay(B, id, "payment", 1_000)).status).toBe(404);
    const edit = await call(
      B,
      patchRoute as never,
      "PATCH",
      `/api/people/${id}`,
      { name: "مخترق", amountPiasters: 0 },
      id,
    );
    expect(edit.status).toBe(404);
    expect(await entriesOf(A, { customerId: id })).toHaveLength(before.length);
    expect((await details(A, id)).person.amount_piasters).toBe(10_000);
  });

  it("the app role cannot change or delete a ledger entry (append-only)", async () => {
    const id = ((await create(A, "owedToMe", 1_000)).json.person as Person).id;
    await expect(
      withTenant(A.storeId, A.userId, (tx) =>
        tx.debtEntry.updateMany({
          where: { storeId: A.storeId, customerId: id },
          data: { amountPiasters: BigInt(1) },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
