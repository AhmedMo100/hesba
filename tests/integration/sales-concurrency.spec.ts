/**
 * QA-02 (docs/QA/FULL-SYSTEM-AUDIT.md) — concurrent stock writes must not lose updates or
 * oversell (ADR-0019). Every scenario runs its operations at the same time against a real
 * Postgres through the real route handlers / inventory service (app role, RLS), then checks
 * the authoritative state:
 *
 *   stock_levels = Σ batch remaining = Σ movements = start + committed increases − decreases
 *
 * and that no committed operation is missing or duplicated in the ledger.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SaleFixtures, type ProductRef } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;

type Move = { quantity: number; balanceAfter: number };

/**
 * True when the movements form one unbroken chain from 0: each movement starts from the
 * balance the previous one ended at. Timestamps are not used, because an operation stamps its
 * time before it waits for the lock. A lost update shows up as two movements starting from
 * the same balance, which breaks the chain. (Movements of one sale that spans several batches
 * chain one after the other, too.)
 */
function chains(moves: Move[]): boolean {
  const used = new Array<boolean>(moves.length).fill(false);
  const walk = (balance: number, left: number): boolean => {
    if (left === 0) return true;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]!;
      if (!used[i] && m.balanceAfter - m.quantity === balance) {
        used[i] = true;
        if (walk(m.balanceAfter, left - 1)) return true;
        used[i] = false;
      }
    }
    return false;
  };
  return walk(0, moves.length);
}

/** Asserts level = Σ batches = Σ movements = expected, ≥ 0, and an unbroken ledger chain. */
async function expectConsistent(variantId: string, expected: number) {
  const s = await f.stockState(A, variantId);
  expect(s.level).toBe(expected);
  expect(s.batchesRemaining).toBe(expected);
  expect(s.movementsSum).toBe(expected);
  expect(s.level).toBeGreaterThanOrEqual(0);
  expect(chains(s.movements)).toBe(true);
  return s;
}

describe("QA-02 — concurrent stock safety", () => {
  beforeAll(() => f.setup());
  afterAll(() => f.teardown());

  it("two concurrent sales (5 and 7 of 20) both commit and the stock ends at 8", async () => {
    const p = await f.product(A, { name: "متزامن ١", sell: 100 });
    await f.addStock(A, p.variantId, 20);

    const [a, b] = await Promise.all([
      f.sell(A, p.variantId, 5),
      f.sell(A, p.variantId, 7),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);

    const s = await expectConsistent(p.variantId, 8);
    const saleMoves = s.movements.filter((m) => m.type === "sale");
    expect(saleMoves.map((m) => m.quantity).sort()).toEqual([-5, -7]);

    const sales = (await f.salesOf(A)).filter((x) =>
      x.saleLines.some((l) => l.storeVariantId === p.variantId),
    );
    expect(sales).toHaveLength(2);
    expect(sales.map((x) => Number(x.totalPiasters)).sort()).toEqual([
      500, 700,
    ]);
    // Each sale's line is the one its movement points at (no movement missing or doubled).
    const lineIds = sales.map((x) => x.saleLines[0]!.id).sort();
    expect(saleMoves.map((m) => m.saleLineId).sort()).toEqual(lineIds);
  });

  it("two concurrent sales of 6 against 10: exactly one commits, nothing goes negative", async () => {
    const p = await f.product(A, { name: "متزامن ٢", sell: 100 });
    await f.addStock(A, p.variantId, 10);

    const results = await Promise.all([
      f.sell(A, p.variantId, 6),
      f.sell(A, p.variantId, 6),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const s = await expectConsistent(p.variantId, 4);
    expect(s.movements.filter((m) => m.type === "sale")).toHaveLength(1);
    expect(s.movements.some((m) => m.negative)).toBe(false);
    const sales = (await f.salesOf(A)).filter((x) =>
      x.saleLines.some((l) => l.storeVariantId === p.variantId),
    );
    expect(sales).toHaveLength(1); // the rejected sale left no row and no line
  });

  it("20 concurrent sales of 1 against 15: exactly 15 commit and the stock ends at 0", async () => {
    const p = await f.product(A, { name: "متزامن ٣", sell: 250 });
    await f.addStock(A, p.variantId, 15);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => f.sell(A, p.variantId, 1)),
    );
    const ok = results.filter((r) => r.status === 200).length;
    const rejected = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(15);
    expect(rejected).toBe(5);

    const s = await expectConsistent(p.variantId, 0);
    expect(s.movements.filter((m) => m.type === "sale")).toHaveLength(15);
    const sales = (await f.salesOf(A)).filter((x) =>
      x.saleLines.some((l) => l.storeVariantId === p.variantId),
    );
    expect(sales).toHaveLength(15);
    expect(sales.reduce((t, x) => t + Number(x.totalPiasters), 0)).toBe(
      15 * 250,
    );
  });

  it("keeps FEFO batches exact under concurrent sales across two batches", async () => {
    const p = await f.product(A, { name: "متزامن ٤", sell: 100 });
    await f.addStock(A, p.variantId, 5, { expiry: "2027-01-01" });
    await f.addStock(A, p.variantId, 10, { expiry: "2027-12-01" });

    const results = await Promise.all(
      Array.from({ length: 3 }, () => f.sell(A, p.variantId, 4)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);

    const s = await expectConsistent(p.variantId, 3);
    expect(s.batches).toEqual([0, 3]); // the early batch is used up first
  });

  it("concurrent sales, stock additions and adjustments on one variant all count", async () => {
    const p = await f.product(A, { name: "متزامن ٥", sell: 100 });
    await f.addStock(A, p.variantId, 50);

    const ops = [
      ...Array.from({ length: 6 }, () => f.sell(A, p.variantId, 2)), // −12
      ...Array.from({ length: 4 }, () => f.addStock(A, p.variantId, 5)), // +20
      ...Array.from({ length: 5 }, () => f.adjust(A, p.variantId, -1)), // −5
    ];
    const settled = await Promise.allSettled(ops);
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);
    const saleStatuses = settled
      .slice(0, 6)
      .map((r) =>
        r.status === "fulfilled" ? (r.value as { status: number }).status : 0,
      );
    expect(saleStatuses).toEqual([200, 200, 200, 200, 200, 200]);

    await expectConsistent(p.variantId, 50 - 12 + 20 - 5);
  });

  it("10 concurrent adjustments of −1 from 100 end at exactly 90 (audit reproduction)", async () => {
    const p = await f.product(A, { name: "متزامن ٦", sell: 100 });
    await f.addStock(A, p.variantId, 100);
    await Promise.all(
      Array.from({ length: 10 }, () => f.adjust(A, p.variantId, -1)),
    );
    await expectConsistent(p.variantId, 90);
  });

  it("8 concurrent stock additions of 100 g are all counted (audit reproduction)", async () => {
    const p = await f.product(A, { name: "متزامن ٧", unit: "kg", sell: 100 });
    await f.addStock(A, p.variantId, 2000);
    await Promise.all(
      Array.from({ length: 8 }, () => f.addStock(A, p.variantId, 100)),
    );
    await expectConsistent(p.variantId, 2800);
  });

  it("sales of different products run concurrently without affecting each other", async () => {
    const products: ProductRef[] = [];
    for (let i = 0; i < 4; i++) {
      const p = await f.product(A, { name: `مستقل ${i}`, sell: 100 });
      await f.addStock(A, p.variantId, 10);
      products.push(p);
    }
    const results = await Promise.all(
      products.flatMap((p) => [
        f.sell(A, p.variantId, 3),
        f.sell(A, p.variantId, 4),
      ]),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    for (const p of products) await expectConsistent(p.variantId, 3);
  });

  it("concurrent sales in two shops stay isolated", async () => {
    const pa = await f.product(A, { name: "محل أ", sell: 100 });
    const pb = await f.product(B, { name: "محل ب", sell: 100 });
    await f.addStock(A, pa.variantId, 5);
    await f.addStock(B, pb.variantId, 5);

    const results = await Promise.all([
      f.sell(A, pa.variantId, 2),
      f.sell(B, pb.variantId, 3),
      f.sell(A, pb.variantId, 1), // A cannot reach B's variant
      f.sell(B, pa.variantId, 1), // B cannot reach A's variant
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 404, 404]);
    expect((await f.stockState(A, pa.variantId)).level).toBe(3);
    expect((await f.stockState(B, pb.variantId)).level).toBe(2);
    const salesB = await f.salesOf(B);
    expect(
      salesB.every((s) =>
        s.saleLines.every((l) => l.storeVariantId === pb.variantId),
      ),
    ).toBe(true);
  });
});
