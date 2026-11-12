/**
 * QA-03 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0020) — POS-machine money must not lose updates,
 * must be idempotent by `opId`, must never overdraw, and a service sale must charge the machine
 * in the same transaction. Real Postgres, real route handlers, real sessions (app role, RLS).
 *
 * Invariant checked after every scenario:
 *   balance = Σ ledger amounts, and the ledger rows chain (each starts where one ended).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { POST as topupRoute } from "@/app/api/machines/topup/route";
import { POST as deductRoute } from "@/app/api/machines/deduct/route";
import { POST as adjustRoute } from "@/app/api/machines/adjust/route";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const EGP = 100; // piasters

const tokens = new Map<string, string>();
async function call(
  handler: (req: Request) => Promise<Response>,
  shop: Shop,
  path: string,
  body: unknown,
): Promise<{ status: number; json: Json }> {
  let token = tokens.get(shop.storeId);
  if (!token) {
    token = (await createSession(shop.userId, shop.storeId)).rawToken;
    tokens.set(shop.storeId, token);
  }
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${token}`,
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const deduct = (
  shop: Shop,
  machineId: string,
  amountPiasters: unknown,
  opId?: string,
) =>
  call(deductRoute, shop, "/api/machines/deduct", {
    machineId,
    amountPiasters,
    ...(opId ? { opId } : {}),
  });
const topup = (
  shop: Shop,
  machineId: string,
  amountPiasters: unknown,
  opId?: string,
) =>
  call(topupRoute, shop, "/api/machines/topup", {
    machineId,
    amountPiasters,
    ...(opId ? { opId } : {}),
  });
const adjust = (
  shop: Shop,
  machineId: string,
  target: unknown,
  opId?: string,
) =>
  call(adjustRoute, shop, "/api/machines/adjust", {
    machineId,
    targetBalancePiasters: target,
    ...(opId ? { opId } : {}),
  });

/** A new machine with `balance` piasters, funded by one top-up (so the ledger starts at 0). */
async function machine(shop: Shop, balance: number): Promise<string> {
  const m = await f.as(shop, (tx) =>
    tx.posMachine.create({
      data: {
        storeId: shop.storeId,
        name: `ماكينة ${f.runId}`,
        provider: "fawry",
      },
      select: { id: true },
    }),
  );
  if (balance > 0) expect((await topup(shop, m.id, balance)).status).toBe(200);
  return m.id;
}

async function machineState(shop: Shop, machineId: string) {
  return f.as(shop, async (tx) => {
    const m = await tx.posMachine.findUniqueOrThrow({
      where: { id: machineId },
    });
    const ledger = await tx.posMachineTopup.findMany({
      where: { machineId },
      orderBy: { createdAt: "asc" },
    });
    return {
      balance: Number(m.currentBalancePiasters),
      ledger: ledger.map((l) => ({
        amount: Number(l.amountPiasters),
        after: Number(l.balanceAfterPiasters),
        opId: l.opId,
      })),
    };
  });
}

/** True when the ledger rows chain from 0: each row starts where another ended (no lost update). */
function chains(rows: Array<{ amount: number; after: number }>): boolean {
  const used = new Array<boolean>(rows.length).fill(false);
  const walk = (balance: number, left: number): boolean => {
    if (left === 0) return true;
    for (let i = 0; i < rows.length; i++) {
      if (!used[i] && rows[i]!.after - rows[i]!.amount === balance) {
        used[i] = true;
        if (walk(rows[i]!.after, left - 1)) return true;
        used[i] = false;
      }
    }
    return false;
  };
  return walk(0, rows.length);
}

async function expectConsistent(
  shop: Shop,
  machineId: string,
  expected: number,
) {
  const s = await machineState(shop, machineId);
  expect(s.balance).toBe(expected);
  expect(s.ledger.reduce((t, l) => t + l.amount, 0)).toBe(expected);
  expect(chains(s.ledger)).toBe(true);
  expect(s.balance).toBeGreaterThanOrEqual(0);
  return s;
}

describe("QA-03 — POS-machine money", () => {
  beforeAll(() => f.setup());
  afterAll(async () => {
    const ids = [A.storeId, B.storeId];
    await f.sql`DELETE FROM "pos_machine_topups" WHERE store_id IN ${f.sql(ids)}`;
    await f.sql`DELETE FROM "pos_machines" WHERE store_id IN ${f.sql(ids)}`;
    await f.teardown();
  });

  describe("concurrency (no lost updates)", () => {
    it("A: 10 concurrent deductions of 100 EGP from 10,000 EGP end at 9,000 EGP", async () => {
      const m = await machine(A, 10_000 * EGP);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => deduct(A, m, 100 * EGP)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      const s = await expectConsistent(A, m, 9_000 * EGP);
      expect(s.ledger.filter((l) => l.amount === -100 * EGP)).toHaveLength(10);
    });

    it("B: −1,000 and −500 EGP at once from 10,000 EGP end at 8,500 EGP", async () => {
      const m = await machine(A, 10_000 * EGP);
      const [a, b] = await Promise.all([
        deduct(A, m, 1_000 * EGP),
        deduct(A, m, 500 * EGP),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const s = await expectConsistent(A, m, 8_500 * EGP);
      expect(s.ledger).toHaveLength(3); // the funding top-up + the two deductions
    });

    it("C: two concurrent 700 EGP deductions from 1,000 EGP — one is refused (no overdraft)", async () => {
      const m = await machine(A, 1_000 * EGP);
      const results = await Promise.all([
        deduct(A, m, 700 * EGP),
        deduct(A, m, 700 * EGP),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      const refused = results.find((r) => r.status === 400)!;
      expect((refused.json.error as { message: string }).message).toContain(
        "غير كافٍ",
      );
      await expectConsistent(A, m, 300 * EGP);
    });

    it("concurrent top-ups are all counted", async () => {
      const m = await machine(A, 0);
      await Promise.all(Array.from({ length: 8 }, () => topup(A, m, 50 * EGP)));
      await expectConsistent(A, m, 400 * EGP);
    });

    it("mixed concurrent top-ups and deductions add up exactly", async () => {
      const m = await machine(A, 1_000 * EGP);
      const ops = [
        ...Array.from({ length: 5 }, () => topup(A, m, 30 * EGP)),
        ...Array.from({ length: 5 }, () => deduct(A, m, 70 * EGP)),
      ];
      const results = await Promise.all(ops);
      expect(results.every((r) => r.status === 200)).toBe(true);
      await expectConsistent(A, m, (1_000 + 150 - 350) * EGP);
    });
  });

  describe("idempotency (opId)", () => {
    it("D: the same opId sent 5 times at once is applied once", async () => {
      const m = await machine(A, 1_000 * EGP);
      const opId = crypto.randomUUID();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => deduct(A, m, 100 * EGP, opId)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(5).fill(200));
      expect(results.filter((r) => r.json.duplicate === false)).toHaveLength(1);
      const s = await expectConsistent(A, m, 900 * EGP);
      expect(s.ledger.filter((l) => l.opId === opId)).toHaveLength(1);
    });

    it("a sequential retry with the same opId changes nothing and reports duplicate", async () => {
      const m = await machine(A, 0);
      const opId = crypto.randomUUID();
      const first = await topup(A, m, 250 * EGP, opId);
      const again = await topup(A, m, 250 * EGP, opId);
      expect([first.status, again.status]).toEqual([200, 200]);
      expect([first.json.duplicate, again.json.duplicate]).toEqual([
        false,
        true,
      ]);
      await expectConsistent(A, m, 250 * EGP);
    });

    it("an adjust retried with the same opId is applied once", async () => {
      const m = await machine(A, 500 * EGP);
      const opId = crypto.randomUUID();
      await adjust(A, m, 800 * EGP, opId);
      await deduct(A, m, 100 * EGP);
      const again = await adjust(A, m, 800 * EGP, opId);
      expect(again.json.duplicate).toBe(true);
      await expectConsistent(A, m, 700 * EGP); // not reset to 800 by the retry
    });
  });

  describe("validation (integer piasters, no overdraft)", () => {
    it("rejects malformed amounts with 400 and changes nothing", async () => {
      const m = await machine(A, 100 * EGP);
      for (const bad of [0.5, 1.5, "100", "abc", null, -5, 0, 1e20]) {
        expect((await deduct(A, m, bad)).status).toBe(400);
        expect((await topup(A, m, bad)).status).toBe(400);
      }
      for (const bad of [-1, 2.5, "abc", 1e20]) {
        expect((await adjust(A, m, bad)).status).toBe(400);
      }
      expect((await deduct(A, "not-a-uuid", 100)).status).toBe(400);
      await expectConsistent(A, m, 100 * EGP);
    });

    it("rejects a deduction above the balance; the database also refuses a negative balance", async () => {
      const m = await machine(A, 100 * EGP);
      expect((await deduct(A, m, 100 * EGP + 1)).status).toBe(400);
      await expectConsistent(A, m, 100 * EGP);
      await expect(
        f.as(A, (tx) =>
          tx.posMachine.update({
            where: { id: m },
            data: { currentBalancePiasters: BigInt(-1) },
          }),
        ),
      ).rejects.toThrow(/chk_pos_machines_balance_non_negative/);
    });
  });

  describe("service sale charges the machine in the same transaction", () => {
    async function service(shop: Shop) {
      return f.product(shop, {
        name: "شحن رصيد",
        sell: 500,
        category: "شحن رصيد",
      });
    }
    const sellService = (
      shop: Shop,
      productId: string,
      machineId: string,
      amount: number,
      deductAmount: number,
      opId = crypto.randomUUID(),
    ) =>
      f.request(shop, "POST", {
        productId,
        amountPiasters: amount,
        machineId,
        machineDeductPiasters: deductAmount,
        opId,
      });

    it("records the sale and charges the machine once, with the sale's opId on the ledger", async () => {
      const m = await machine(A, 1_000 * EGP);
      const svc = await service(A);
      const opId = crypto.randomUUID();
      const res = await sellService(
        A,
        svc.productId,
        m,
        105 * EGP,
        100 * EGP,
        opId,
      );
      expect(res.status).toBe(200);
      expect((res.json.data as { machine: unknown }).machine).toEqual({
        machineId: m,
        balanceAfterPiasters: 900 * EGP,
      });
      const s = await expectConsistent(A, m, 900 * EGP);
      expect(s.ledger.filter((l) => l.opId === opId)).toHaveLength(1);

      // Retry after a lost response: same sale, no second charge.
      const again = await sellService(
        A,
        svc.productId,
        m,
        105 * EGP,
        100 * EGP,
        opId,
      );
      expect((again.json.data as { duplicate: boolean }).duplicate).toBe(true);
      await expectConsistent(A, m, 900 * EGP);
    });

    it("the same service sale sent 4 times at once makes one sale and one charge", async () => {
      const m = await machine(A, 1_000 * EGP);
      const svc = await service(A);
      const opId = crypto.randomUUID();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          sellService(A, svc.productId, m, 52 * EGP, 50 * EGP, opId),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      const ids = new Set(
        results.map((r) => (r.json.data as { id: string }).id),
      );
      expect(ids.size).toBe(1);
      await expectConsistent(A, m, 950 * EGP);
      const sales = await f.as(A, (tx) =>
        tx.sale.count({ where: { storeId: A.storeId, opId } }),
      );
      expect(sales).toBe(1);
    });

    it("refuses the sale when the machine balance is short — no sale, no charge", async () => {
      const m = await machine(A, 40 * EGP);
      const svc = await service(A);
      const before = (await f.salesOf(A)).length;
      const res = await sellService(A, svc.productId, m, 55 * EGP, 50 * EGP);
      expect(res.status).toBe(400);
      expect((await f.salesOf(A)).length).toBe(before);
      await expectConsistent(A, m, 40 * EGP);
    });

    it("rolls back the machine charge when the sale fails after it", async () => {
      const m = await machine(A, 1_000 * EGP);
      const svc = await service(A);
      const fn = `qa03_fail_${f.runId}`;
      await f.sql.unsafe(`
        CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.store_variant_id = '${svc.variantId}'::uuid THEN
            RAISE EXCEPTION 'qa03 injected failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER ${fn} BEFORE INSERT ON sale_lines
          FOR EACH ROW EXECUTE FUNCTION ${fn}();`);
      try {
        const res = await sellService(
          A,
          svc.productId,
          m,
          105 * EGP,
          100 * EGP,
        );
        expect(res.status).toBe(500);
      } finally {
        await f.sql.unsafe(
          `DROP TRIGGER ${fn} ON sale_lines; DROP FUNCTION ${fn}();`,
        );
      }
      const s = await expectConsistent(A, m, 1_000 * EGP);
      expect(s.ledger).toHaveLength(1); // only the funding top-up
    });

    it("refuses a machine charge larger than what the customer paid", async () => {
      const m = await machine(A, 1_000 * EGP);
      const svc = await service(A);
      const res = await sellService(A, svc.productId, m, 50 * EGP, 60 * EGP);
      expect(res.status).toBe(400);
      await expectConsistent(A, m, 1_000 * EGP);
    });
  });

  describe("tenant isolation", () => {
    it("another shop cannot top up, deduct, adjust or sell against this shop's machine", async () => {
      const m = await machine(A, 500 * EGP);
      expect((await deduct(B, m, 100)).status).toBe(404);
      expect((await topup(B, m, 100)).status).toBe(404);
      expect((await adjust(B, m, 0)).status).toBe(404);
      const svcB = await f.product(B, {
        name: "خدمة ب",
        sell: 100,
        category: "شحن رصيد",
      });
      const sale = await f.request(B, "POST", {
        productId: svcB.productId,
        amountPiasters: 1000,
        machineId: m,
        machineDeductPiasters: 1000,
        opId: crypto.randomUUID(),
      });
      expect(sale.status).toBe(404);
      expect(await f.salesOf(B)).toHaveLength(0);
      await expectConsistent(A, m, 500 * EGP);
    });

    it("an opId already used in one shop does not block or leak into another", async () => {
      const mA = await machine(A, 100 * EGP);
      const mB = await machine(B, 100 * EGP);
      const opId = crypto.randomUUID();
      expect((await deduct(A, mA, 10 * EGP, opId)).json.duplicate).toBe(false);
      expect((await deduct(B, mB, 10 * EGP, opId)).json.duplicate).toBe(false);
      await expectConsistent(A, mA, 90 * EGP);
      await expectConsistent(B, mB, 90 * EGP);
    });
  });
});
