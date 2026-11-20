/**
 * Expenses paid from the drawer or from one of the shop's machines / wallets (V19 «الدفع
 * إزاي؟»), and cancelling today's expense: the machine's balance moves in the same transaction,
 * a short balance records nothing, a cancel keeps the record and gives the money back once, and
 * an earlier day's expense is not cancelled. Real Postgres, app role.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { ExpenseService } from "@/server/modules/expenses";
import { MachinesService } from "@/server/modules/machines";
import { getDrawer, recordDrawerCount } from "@/server/modules/drawer";
import { SaleFixtures } from "./helpers/sale-fixtures";

const fx = new SaleFixtures();
const expenses = new ExpenseService(appPrisma);
const machines = new MachinesService(appPrisma);

describe("expense payment sources and cancel", () => {
  let vodafone: string;
  let instapay: string;

  beforeAll(async () => {
    await fx.setup();
    const a = await machines.upsertMachine(fx.shopA.storeId, fx.shopA.userId, {
      name: "فودافون كاش 010",
      provider: "فودافون كاش",
    });
    const b = await machines.upsertMachine(fx.shopA.storeId, fx.shopA.userId, {
      name: "إنستاباي",
      provider: "إنستاباي",
    });
    vodafone = a.id;
    instapay = b.id;
    await machines.topupMachine(
      fx.shopA.storeId,
      fx.shopA.userId,
      vodafone,
      50000,
    );
    await machines.topupMachine(
      fx.shopA.storeId,
      fx.shopA.userId,
      instapay,
      10000,
    );
  });

  afterAll(async () => {
    await fx.teardown();
  });

  const balance = async (id: string) =>
    (await machines.getStoreMachines(fx.shopA.storeId, fx.shopA.userId)).find(
      (m) => m.id === id,
    )!.currentBalancePiasters;

  const countExpenses = () =>
    fx.as(fx.shopA, (tx) =>
      tx.expense.count({ where: { storeId: fx.shopA.storeId } }),
    );

  it("cash: recorded from the drawer, no machine touched", async () => {
    const e = await expenses.createExpense(fx.shopA.storeId, fx.shopA.userId, {
      category: "كهرباء",
      amountPiasters: 12000,
      paidFrom: "cash",
      opId: crypto.randomUUID(),
    });
    expect(e.paid_from).toBe("cash");
    expect(e.machine).toBeNull();
    expect(await balance(vodafone)).toBe(50000);
  });

  it("Vodafone Cash: the expense and the deduction happen together", async () => {
    const e = await expenses.createExpense(fx.shopA.storeId, fx.shopA.userId, {
      category: "ميه وغاز",
      amountPiasters: 20000,
      paidFrom: "wallet",
      paidFromMachineId: vodafone,
      opId: crypto.randomUUID(),
    });
    expect(e.paid_from).toBe("wallet");
    expect(e.machine).toEqual({ id: vodafone, name: "فودافون كاش 010" });
    expect(await balance(vodafone)).toBe(30000);
  });

  it("InstaPay with a short balance: 400, nothing recorded, balance unchanged", async () => {
    const before = await countExpenses();
    await expect(
      expenses.createExpense(fx.shopA.storeId, fx.shopA.userId, {
        category: "نقل",
        amountPiasters: 10001,
        paidFrom: "wallet",
        paidFromMachineId: instapay,
        opId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/غير كافٍ/);
    expect(await countExpenses()).toBe(before);
    expect(await balance(instapay)).toBe(10000);
  });

  it("a wallet expense without the wallet named is refused", async () => {
    await expect(
      expenses.createExpense(fx.shopA.storeId, fx.shopA.userId, {
        category: "نقل",
        amountPiasters: 100,
        paidFrom: "wallet",
      }),
    ).rejects.toThrow();
  });

  it("an invalid amount is refused", async () => {
    for (const amountPiasters of [0, -5, 1.5]) {
      await expect(
        expenses.createExpense(fx.shopA.storeId, fx.shopA.userId, {
          category: "نقل",
          amountPiasters,
          paidFrom: "cash",
        }),
      ).rejects.toThrow();
    }
  });

  it("another shop's machine cannot pay this shop's expense", async () => {
    await expect(
      expenses.createExpense(fx.shopB.storeId, fx.shopB.userId, {
        category: "نقل",
        amountPiasters: 100,
        paidFrom: "wallet",
        paidFromMachineId: vodafone,
      }),
    ).rejects.toThrow(/غير موجودة/);
    expect(await balance(vodafone)).toBe(30000);
  });

  it("the same opId retried records once and deducts once", async () => {
    const opId = crypto.randomUUID();
    const input = {
      category: "صيانة",
      amountPiasters: 1000,
      paidFrom: "wallet" as const,
      paidFromMachineId: vodafone,
      opId,
    };
    const a = await expenses.createExpense(
      fx.shopA.storeId,
      fx.shopA.userId,
      input,
    );
    const b = await expenses.createExpense(
      fx.shopA.storeId,
      fx.shopA.userId,
      input,
    );
    expect(b.id).toBe(a.id);
    expect(await balance(vodafone)).toBe(29000);
  });

  it("cancelling today's wallet expense keeps the record and gives the money back once", async () => {
    const e = await expenses.createExpense(fx.shopA.storeId, fx.shopA.userId, {
      category: "مرتبات",
      amountPiasters: 5000,
      paidFrom: "wallet",
      paidFromMachineId: vodafone,
      opId: crypto.randomUUID(),
    });
    expect(await balance(vodafone)).toBe(24000);

    const r = await expenses.deleteExpense(
      fx.shopA.storeId,
      fx.shopA.userId,
      e.id,
    );
    expect(r.expense.cancelled_at).not.toBeNull();
    expect(await balance(vodafone)).toBe(29000);
    // A retried cancel does not refund twice.
    await expenses.deleteExpense(fx.shopA.storeId, fx.shopA.userId, e.id);
    expect(await balance(vodafone)).toBe(29000);

    // Still on record (audit), listed as cancelled, out of the totals.
    const row = await fx.as(fx.shopA, (tx) =>
      tx.expense.findUniqueOrThrow({ where: { id: e.id } }),
    );
    expect(row.deletedAt).not.toBeNull();
    const listed = await expenses.getStoreExpenses(
      fx.shopA.storeId,
      fx.shopA.userId,
      {
        period: "today",
        includeCancelled: true,
      },
    );
    expect(
      listed.expenses.find((x) => x.id === e.id)?.cancelled_at,
    ).not.toBeNull();
    const plain = await expenses.getStoreExpenses(
      fx.shopA.storeId,
      fx.shopA.userId,
      {
        period: "today",
      },
    );
    expect(plain.expenses.some((x) => x.id === e.id)).toBe(false);
    expect(plain.totalPiasters).toBe(12000 + 20000 + 1000);

    // Both ledger rows stay: the deduction and the refund.
    const ledger = await fx.as(fx.shopA, (tx) =>
      tx.posMachineTopup.findMany({ where: { reference: e.id } }),
    );
    expect(
      ledger.map((l) => Number(l.amountPiasters)).sort((x, y) => x - y),
    ).toEqual([-5000, 5000]);
  });

  it("an earlier day's expense is not cancelled here", async () => {
    const yesterday = new Date(Date.now() - 36 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const e = await expenses.createExpense(fx.shopA.storeId, fx.shopA.userId, {
      category: "إيجار",
      amountPiasters: 3000,
      paidFrom: "cash",
      spentAt: yesterday,
    });
    await expect(
      expenses.deleteExpense(fx.shopA.storeId, fx.shopA.userId, e.id),
    ).rejects.toThrow(/النهارده بس/);
  });

  it("a machine-paid expense cannot change its amount by edit", async () => {
    const e = await expenses.createExpense(fx.shopA.storeId, fx.shopA.userId, {
      category: "نقل",
      amountPiasters: 500,
      paidFrom: "wallet",
      paidFromMachineId: vodafone,
    });
    await expect(
      expenses.updateExpense(fx.shopA.storeId, fx.shopA.userId, e.id, {
        amountPiasters: 100,
      }),
    ).rejects.toThrow(/ألغيه/);
  });

  it("the drawer: a cash expense cancelled after the count comes back in", async () => {
    const e = await expenses.createExpense(fx.shopA.storeId, fx.shopA.userId, {
      category: "حاجة تانية",
      amountPiasters: 700,
      paidFrom: "cash",
    });
    await recordDrawerCount(fx.shopA.storeId, fx.shopA.userId, {
      opId: crypto.randomUUID(),
      countedPiasters: 100000,
    });
    await expenses.deleteExpense(fx.shopA.storeId, fx.shopA.userId, e.id);
    const d = await getDrawer(fx.shopA.storeId, fx.shopA.userId);
    expect(
      d.flows.find((f) => f.key === "expenseCancels")?.amountPiasters,
    ).toBe(700);
    expect(d.expectedPiasters).toBe(100700);
  });
});
