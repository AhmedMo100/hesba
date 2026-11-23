/**
 * Simple-mode operations & financials (real Postgres, app role, the real services):
 * - stocktaking: differences applied by the owner's reason only — never a sale by itself;
 *   damaged counted once as a loss; confirm idempotent; abandoned changes nothing; closed frozen;
 * - «فلوس حِسبة»: owner withdrawals / deposits and transfers move the drawer and the wallets,
 *   never income or expenses; no overdraft; idempotent;
 * - services: only the commission is income; float and customer side balance exactly;
 *   cancel reverses; duplicate requests count once; a too-low float records nothing;
 * - the daily total: a credit part is revenue + a customer debt (collection is not a new sale);
 *   quantities take stock but add no revenue; cancel reverses both;
 * - profit: collections, supplier payments, transfers, owner withdrawals excluded; commissions
 *   and losses included; estimated vs actual labelled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { MachinesService } from "@/server/modules/machines";
import { getDrawer, recordDrawerCount } from "@/server/modules/drawer";
import {
  abandonInventoryCount,
  confirmInventoryCount,
  getInventoryCount,
  startInventoryCount,
  updateInventoryCount,
} from "@/server/modules/inventory";
import { recordMoneyMovement, getMoneyOverview } from "@/server/modules/money";
import {
  cancelServiceTransaction,
  recordServiceTransaction,
  saveServiceRules,
} from "@/server/modules/services";
import {
  cancelDailySales,
  recordDailySales,
} from "@/server/modules/daily-sales";
import { getHomeReport } from "@/server/modules/reports";
import { recordDebtTransaction } from "@/server/modules/people";
import { SaleFixtures } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const machines = new MachinesService(appPrisma);
const op = () => crypto.randomUUID();

const level = async (variantId: string) =>
  (await f.stockState(A, variantId)).level;
const machineBalance = async (id: string) =>
  Number(
    (await f.as(A, (tx) => tx.posMachine.findUniqueOrThrow({ where: { id } })))
      .currentBalancePiasters,
  );
const expectedDrawer = async () =>
  (await getDrawer(A.storeId, A.userId)).expectedPiasters!;

let wallet = "";
let fawry = "";
let customerId = "";

beforeAll(async () => {
  await f.setup();
  wallet = (
    await machines.upsertMachine(A.storeId, A.userId, {
      name: `فودافون كاش ${f.runId}`,
      provider: "vodafone_cash",
    })
  ).id;
  fawry = (
    await machines.upsertMachine(A.storeId, A.userId, {
      name: `فوري ${f.runId}`,
      provider: "fawry",
    })
  ).id;
  // The drawer's base: a count of 1,000.00.
  await recordDrawerCount(A.storeId, A.userId, {
    opId: op(),
    countedPiasters: 100000,
  });
  customerId = (
    await f.as(A, (tx) =>
      tx.customer.create({
        data: { storeId: A.storeId, nameAr: `زبون آجل ${f.runId}` },
      }),
    )
  ).id;
}, 120_000);

afterAll(async () => {
  const ids = [A.storeId, B.storeId];
  const sql = f.sql;
  await sql`DELETE FROM service_transactions WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM money_movements WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM inventory_counts WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM daily_sales_entries WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM debt_entries WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM customers WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM pos_machine_topups WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM cash_drawer_counts WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM pos_machines WHERE store_id IN ${sql(ids)}`;
  await f.teardown();
});

describe("stocktaking (الجرد)", () => {
  it("applies each difference by the owner's reason; never a sale by itself", async () => {
    const p = {
      sold: (await f.product(A, { name: "جرد بيع", sell: 1000, buy: 600 }))
        .variantId,
      damaged: (await f.product(A, { name: "جرد تالف", sell: 1000 })).variantId,
      unknown: (await f.product(A, { name: "جرد مجهول", sell: 1000 }))
        .variantId,
      extra: (await f.product(A, { name: "جرد زيادة", sell: 1000 })).variantId,
      same: (await f.product(A, { name: "جرد مظبوط", sell: 1000 })).variantId,
    };
    for (const v of Object.values(p))
      await f.addStock(A, v, 10, { cost: 6000 });
    const count = await startInventoryCount(A.storeId, A.userId, {
      opId: op(),
      scope: "selected",
      variantIds: Object.values(p),
    });
    expect(count.lines).toHaveLength(5);
    expect(count.lines.every((l) => l.expectedBase === 10)).toBe(true);
    // A second count while one is open is refused.
    await expect(
      startInventoryCount(A.storeId, A.userId, { opId: op(), scope: "full" }),
    ).rejects.toThrow(/جرد مفتوح/);

    const updated = await updateInventoryCount(A.storeId, A.userId, count.id, {
      lines: [
        { variantId: p.sold, countedBase: 7, reason: "unrecorded_sale" },
        { variantId: p.damaged, countedBase: 8, reason: "damaged" },
        { variantId: p.unknown, countedBase: 9 }, // no reason → unknown, never a sale
        { variantId: p.extra, countedBase: 12 },
        { variantId: p.same, countedBase: 10 },
      ],
    });
    const byId = new Map(updated.lines.map((l) => [l.variantId, l]));
    expect(byId.get(p.unknown)!.reason).toBe("unknown");
    expect(byId.get(p.extra)!.reason).toBe("surplus");
    expect(byId.get(p.same)!.reason).toBeNull();
    expect(updated.totals).toMatchObject({
      counted: 5,
      matched: 1,
      discrepancies: 4,
      unrecordedSaleBase: 3,
      damagedBase: 2,
      unknownBase: 1,
      surplusBase: 2,
    });
    // Nothing applied before confirmation.
    expect(await level(p.sold)).toBe(10);

    const confirmOp = op();
    const done = await confirmInventoryCount(
      A.storeId,
      A.userId,
      count.id,
      confirmOp,
    );
    expect(done.status).toBe("confirmed");
    expect(await level(p.sold)).toBe(7);
    expect(await level(p.damaged)).toBe(8);
    expect(await level(p.unknown)).toBe(9);
    expect(await level(p.extra)).toBe(12);
    expect(await level(p.same)).toBe(10);
    // Idempotent: the same confirmation again changes nothing; another opId is a 409.
    await confirmInventoryCount(A.storeId, A.userId, count.id, confirmOp);
    expect(await level(p.sold)).toBe(7);
    await expect(
      confirmInventoryCount(A.storeId, A.userId, count.id, op()),
    ).rejects.toThrow(/اتأكد/);
    // Damaged is ONE waste record (the loss ledger), the unknown shortage is not a waste.
    const wastes = await f.as(A, (tx) =>
      tx.wasteRecord.findMany({
        where: {
          storeId: A.storeId,
          storeVariantId: { in: [p.damaged, p.unknown] },
        },
      }),
    );
    expect(
      wastes.map((w) => [w.storeVariantId, Number(w.quantityBase)]),
    ).toEqual([[p.damaged, 2]]);
    // No sale was invented: no invoice, no money.
    expect(
      await f.as(A, (tx) => tx.sale.count({ where: { storeId: A.storeId } })),
    ).toBe(0);
    // A closed count is frozen by the database.
    await expect(
      updateInventoryCount(A.storeId, A.userId, count.id, {
        lines: [{ variantId: p.same, countedBase: 1 }],
      }),
    ).rejects.toThrow(/اتقفل/);

    // The report: the confirmed «اتباع ومتسجلش» is a sale at the selling price (3 × 10.00)
    // with its cost; the unknown shortage and the damaged goods are losses, not sales.
    const report = await getHomeReport(A.storeId, A.userId, "today");
    expect(report.profit!.discoveredSalesPiasters).toBe(3000);
    expect(report.profit!.inventoryLossesPiasters).toBe(2 * 600 + 1 * 600);
    expect(report.profit!.lastStocktakeAt).not.toBeNull();
  });

  it("an abandoned count changes nothing", async () => {
    const v = (await f.product(A, { name: "جرد ملغي", sell: 500 })).variantId;
    await f.addStock(A, v, 5);
    const c = await startInventoryCount(A.storeId, A.userId, {
      opId: op(),
      scope: "selected",
      variantIds: [v],
    });
    await updateInventoryCount(A.storeId, A.userId, c.id, {
      lines: [{ variantId: v, countedBase: 1, reason: "lost" }],
    });
    const gone = await abandonInventoryCount(A.storeId, A.userId, c.id);
    expect(gone.status).toBe("abandoned");
    expect(await level(v)).toBe(5);
    await expect(
      confirmInventoryCount(A.storeId, A.userId, c.id, op()),
    ).rejects.toThrow(/اتلغى/);
  });

  it("another shop cannot read or confirm this shop's count", async () => {
    const v = (await f.product(A, { name: "جرد معزول", sell: 500 })).variantId;
    const c = await startInventoryCount(A.storeId, A.userId, {
      opId: op(),
      scope: "selected",
      variantIds: [v],
    });
    await expect(getInventoryCount(B.storeId, B.userId, c.id)).rejects.toThrow(
      /مش موجود/,
    );
    await expect(
      confirmInventoryCount(B.storeId, B.userId, c.id, op()),
    ).rejects.toThrow(/مش موجود/);
    await abandonInventoryCount(A.storeId, A.userId, c.id);
  });
});

describe("«فلوس حِسبة»: withdrawals, deposits and transfers", () => {
  it("moves the drawer and the wallets; never income or an expense; idempotent; no overdraft", async () => {
    const d0 = await expectedDrawer();
    const w0 = await machineBalance(wallet);
    const before = await getHomeReport(A.storeId, A.userId, "today");

    await recordMoneyMovement(A.storeId, A.userId, {
      opId: op(),
      kind: "owner_deposit",
      amountPiasters: 50000,
      to: { machineId: wallet },
    });
    expect(await machineBalance(wallet)).toBe(w0 + 50000);

    const t = op();
    await recordMoneyMovement(A.storeId, A.userId, {
      opId: t,
      kind: "transfer",
      amountPiasters: 20000,
      from: { machineId: wallet },
      to: "cash",
    });
    const again = await recordMoneyMovement(A.storeId, A.userId, {
      opId: t,
      kind: "transfer",
      amountPiasters: 20000,
      from: { machineId: wallet },
      to: "cash",
    });
    expect(again.duplicate).toBe(true);
    expect(await machineBalance(wallet)).toBe(w0 + 30000);
    expect(await expectedDrawer()).toBe(d0 + 20000);

    await recordMoneyMovement(A.storeId, A.userId, {
      opId: op(),
      kind: "owner_withdrawal",
      amountPiasters: 5000,
      from: "cash",
    });
    expect(await expectedDrawer()).toBe(d0 + 15000);

    await expect(
      recordMoneyMovement(A.storeId, A.userId, {
        opId: op(),
        kind: "owner_withdrawal",
        amountPiasters: 999_999_999,
        from: { machineId: wallet },
      }),
    ).rejects.toThrow(/غير كافٍ/);
    expect(await machineBalance(wallet)).toBe(w0 + 30000);

    const after = await getHomeReport(A.storeId, A.userId, "today");
    expect(after.sales.revenuePiasters).toBe(before.sales.revenuePiasters);
    expect(after.expenses.totalPiasters).toBe(before.expenses.totalPiasters);
    expect(
      after.profit!.ownerWithdrawalsPiasters -
        before.profit!.ownerWithdrawalsPiasters,
    ).toBe(5000);
    expect(
      after.profit!.ownerDepositsPiasters -
        before.profit!.ownerDepositsPiasters,
    ).toBe(50000);
    expect(after.profit!.estimatedNetProfitPiasters).toBe(
      before.profit!.estimatedNetProfitPiasters,
    );

    const overview = await getMoneyOverview(A.storeId, A.userId);
    expect(
      overview.accounts.find((a) => a.id === "cash")!.balancePiasters,
    ).toBe(d0 + 15000);
    expect(overview.cashKnown).toBe(true);
  });
});

describe("services and commissions", () => {
  it("send with a customer fee: drawer + (a + c), float − a, income = c only", async () => {
    await saveServiceRules(A.storeId, A.userId, {
      rules: {
        fawry_payment: {
          mode: "customer_fee",
          rule: { type: "fixed", value: 500, tiers: [] },
        },
      },
    });
    await machines.topupMachine(A.storeId, A.userId, fawry, 100000);
    const d0 = await expectedDrawer();
    const f0 = await machineBalance(fawry);
    const before = await getHomeReport(A.storeId, A.userId, "today");
    const t = await recordServiceTransaction(A.storeId, A.userId, {
      opId: op(),
      serviceKey: "fawry_payment",
      provider: "فوري",
      amountPiasters: 20000,
      floatMachineId: fawry,
      payment: "cash",
    });
    expect(t.commissionPiasters).toBe(500);
    expect(t.customerPiasters).toBe(20500);
    expect(await expectedDrawer()).toBe(d0 + 20500);
    expect(await machineBalance(fawry)).toBe(f0 - 20000);
    const after = await getHomeReport(A.storeId, A.userId, "today");
    expect(
      after.profit!.serviceCommissionsPiasters -
        before.profit!.serviceCommissionsPiasters,
    ).toBe(500);
    // The bill's value is never sales revenue.
    expect(after.sales.revenuePiasters).toBe(before.sales.revenuePiasters);
  });

  it("the provider's discount (500 paid, float − 490, commission 10) and a wallet withdrawal", async () => {
    await saveServiceRules(A.storeId, A.userId, {
      rules: {
        mobile_recharge: {
          mode: "provider_discount",
          rule: { type: "percent", value: 2, tiers: [] },
        },
      },
    });
    const f0 = await machineBalance(fawry);
    const d0 = await expectedDrawer();
    const r = await recordServiceTransaction(A.storeId, A.userId, {
      opId: op(),
      serviceKey: "mobile_recharge",
      provider: "فودافون",
      amountPiasters: 50000,
      floatMachineId: fawry,
      payment: "cash",
    });
    expect([
      r.customerPiasters,
      r.floatDeltaPiasters,
      r.commissionPiasters,
    ]).toEqual([50000, -49000, 1000]);
    expect(await machineBalance(fawry)).toBe(f0 - 49000);
    expect(await expectedDrawer()).toBe(d0 + 50000);

    // Withdrawal: 1,000 arrives in the shop's wallet, the customer gets 990 cash (fee 10).
    await saveServiceRules(A.storeId, A.userId, {
      rules: {
        wallet_withdrawal: {
          mode: "customer_fee",
          rule: { type: "fixed", value: 1000, tiers: [] },
        },
      },
    });
    const w0 = await machineBalance(wallet);
    const d1 = await expectedDrawer();
    const w = await recordServiceTransaction(A.storeId, A.userId, {
      opId: op(),
      serviceKey: "wallet_withdrawal",
      provider: "فودافون كاش",
      amountPiasters: 100000,
      floatMachineId: wallet,
      payment: "cash",
    });
    expect([
      w.customerPiasters,
      w.floatDeltaPiasters,
      w.commissionPiasters,
    ]).toEqual([99000, 100000, 1000]);
    expect(await machineBalance(wallet)).toBe(w0 + 100000);
    expect(await expectedDrawer()).toBe(d1 - 99000);

    // Cancel reverses Hesba's books exactly (float and drawer), once.
    await cancelServiceTransaction(A.storeId, A.userId, w.id);
    await cancelServiceTransaction(A.storeId, A.userId, w.id);
    expect(await machineBalance(wallet)).toBe(w0);
    expect(await expectedDrawer()).toBe(d1);
  });

  it("a duplicate request counts once; a float too low records nothing", async () => {
    const f0 = await machineBalance(fawry);
    const body = {
      opId: op(),
      serviceKey: "electricity_bill",
      provider: "الكهربا",
      amountPiasters: 1000,
      floatMachineId: fawry,
      payment: "cash" as const,
      commissionPiasters: 200,
    };
    const [x, y] = await Promise.allSettled([
      recordServiceTransaction(A.storeId, A.userId, body),
      recordServiceTransaction(A.storeId, A.userId, body),
    ]);
    expect(
      [x, y].filter((r) => r.status === "fulfilled").length,
    ).toBeGreaterThanOrEqual(1);
    expect(await machineBalance(fawry)).toBe(f0 - 1000);
    expect(
      await f.as(A, (tx) =>
        tx.serviceTransaction.count({
          where: { storeId: A.storeId, opId: body.opId },
        }),
      ),
    ).toBe(1);
    const n0 = await f.as(A, (tx) =>
      tx.serviceTransaction.count({ where: { storeId: A.storeId } }),
    );
    await expect(
      recordServiceTransaction(A.storeId, A.userId, {
        ...body,
        opId: op(),
        amountPiasters: 900_000_000,
      }),
    ).rejects.toThrow(/غير كافٍ/);
    expect(
      await f.as(A, (tx) =>
        tx.serviceTransaction.count({ where: { storeId: A.storeId } }),
      ),
    ).toBe(n0);
  });

  it("the database refuses books that do not balance", async () => {
    await expect(
      f.sql`INSERT INTO service_transactions (store_id, op_id, service_key, category, provider, service_type,
              direction, amount_piasters, commission_piasters, commission_mode, customer_piasters,
              float_delta_piasters, float_machine_id)
            VALUES (${A.storeId}, ${op()}, 'x', 'other', 'x', 'other', 'send', 1000, 100,
                    'customer_fee', 1000, -1000, ${fawry})`,
    ).rejects.toThrow(/service_transactions_balance_check/);
  });
});

describe("the daily total: credit and quantities", () => {
  it("credit is revenue and a customer debt; a collection is not a new sale; cancel reverses", async () => {
    const v = (await f.product(A, { name: "يومي كمية", sell: 1500, buy: 1000 }))
      .variantId;
    await f.addStock(A, v, 20, { cost: 20000 });
    const before = await getHomeReport(A.storeId, A.userId, "today");
    const d0 = await expectedDrawer();
    const { entry } = await recordDailySales(A.storeId, A.userId, {
      opId: op(),
      cashPiasters: 30000,
      parts: [],
      credits: [{ customerId, amountPiasters: 12000 }],
      items: [{ variantId: v, quantityBase: 4 }],
    });
    expect([entry.totalPiasters, entry.creditPiasters]).toEqual([42000, 12000]);
    expect(entry.items[0]).toMatchObject({
      quantityBase: 4,
      costPiasters: 4000,
    });
    expect(await level(v)).toBe(16);
    expect(await expectedDrawer()).toBe(d0 + 30000); // credit is not cash
    const r1 = await getHomeReport(A.storeId, A.userId, "today");
    expect(r1.sales.revenuePiasters - before.sales.revenuePiasters).toBe(42000); // items add nothing
    expect(r1.byPaymentMethod!.debt - before.byPaymentMethod!.debt).toBe(12000);
    expect(r1.profit!.status).not.toBe("actual"); // a daily total has no cost per item

    const balance = async () =>
      (
        await f.as(A, (tx) =>
          tx.debtEntry.findMany({ where: { storeId: A.storeId, customerId } }),
        )
      ).reduce(
        (s, e) =>
          s +
          (e.direction === "owed_to_me" ? 1 : -1) * Number(e.amountPiasters),
        0,
      );
    expect(await balance()).toBe(12000);
    // The collection settles the debt — cash in, no revenue.
    await recordDebtTransaction(
      A.storeId,
      customerId,
      {
        type: "payment",
        amountPiasters: 5000,
        paidFrom: "cash",
        paidFromMachineId: null,
        note: null,
        date: undefined,
        opId: op(),
      },
      A.userId,
    );
    expect(await balance()).toBe(7000);
    const r2 = await getHomeReport(A.storeId, A.userId, "today");
    expect(r2.sales.revenuePiasters).toBe(r1.sales.revenuePiasters);
    expect(await expectedDrawer()).toBe(d0 + 35000);

    // Cancelling the total: its debt is reversed (the collection stays), stock comes back.
    await cancelDailySales(A.storeId, A.userId, entry.id);
    expect(await balance()).toBe(-5000);
    expect(await level(v)).toBe(20);
    const r3 = await getHomeReport(A.storeId, A.userId, "today");
    expect(r3.sales.revenuePiasters).toBe(before.sales.revenuePiasters);
  });
});
