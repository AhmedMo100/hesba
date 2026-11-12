import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getMachineStorageKey,
  getStoredMachines,
  addMachineTopup,
  setMachineExactBalance,
  deductMachineBalance,
} from "@/client/shared/api/machines";

describe("POS Machines Storage and Topup", () => {
  let mockStorage: Map<string, string>;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    mockStorage = new Map<string, string>();
    originalWindow = globalThis.window;

    const fakeLocalStorage = {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => mockStorage.set(key, value),
      removeItem: (key: string) => mockStorage.delete(key),
      clear: () => mockStorage.clear(),
      key: () => null,
      length: 0,
    };

    globalThis.window = {
      localStorage: fakeLocalStorage,
      dispatchEvent: () => true,
    } as unknown as typeof globalThis.window;

    (
      globalThis as unknown as { localStorage: typeof fakeLocalStorage }
    ).localStorage = fakeLocalStorage;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("normalizes storage key for default and undefined storeId", () => {
    expect(getMachineStorageKey()).toBe("hesba_pos_machines_v2_unscoped");
    expect(getMachineStorageKey(undefined)).toBe(
      "hesba_pos_machines_v2_unscoped",
    );
    expect(getMachineStorageKey("default")).toBe(
      "hesba_pos_machines_v2_unscoped",
    );
    expect(getMachineStorageKey("store-123")).toBe(
      "hesba_pos_machines_v2_store-123",
    );
  });

  it("returns empty array for a store with no machines yet", () => {
    const machines = getStoredMachines("store-empty");
    expect(machines).toEqual([]);
  });

  it("returns stored machines for a store with saved machines", () => {
    mockStorage.set(
      "hesba_pos_machines_v2_store-custom",
      JSON.stringify([
        {
          id: "mach-custom",
          name: "ماكينة فوري خاصة",
          provider: "فوري",
          currentBalancePiasters: 99000,
          balanceTransactions: [],
        },
      ]),
    );

    const machines = getStoredMachines("store-custom");
    expect(machines).toHaveLength(1);
    const first = machines[0];
    expect(first).toBeDefined();
    expect(first!.id).toBe("mach-custom");
    expect(first!.currentBalancePiasters).toBe(99000);
  });

  it("adds topup amount correctly in piasters and appends transaction record", () => {
    mockStorage.set(
      "hesba_pos_machines_v2_store-topup",
      JSON.stringify([
        {
          id: "mach-100",
          name: "ماكينة المتجر",
          provider: "أمان",
          currentBalancePiasters: 10000,
          balanceTransactions: [],
        },
      ]),
    );

    const initial = getStoredMachines("store-topup");
    const target = initial[0];
    expect(target).toBeDefined();
    if (!target) return;

    const initialBalance = target.currentBalancePiasters;
    const topupAmount = 50000; // 500.00 EGP

    const updatedList = addMachineTopup(
      target.id,
      topupAmount,
      {
        source: "خزينة المحل",
        notes: "شحن رصيد تجريبي",
      },
      "store-topup",
    );

    const updatedTarget = updatedList.find((m) => m.id === target.id);
    expect(updatedTarget).toBeDefined();
    expect(updatedTarget!.currentBalancePiasters).toBe(
      initialBalance + topupAmount,
    );
    const tx = updatedTarget!.balanceTransactions[0];
    expect(tx).toBeDefined();
    expect(tx!.amountPiasters).toBe(topupAmount);
    expect(tx!.balanceAfterPiasters).toBe(initialBalance + topupAmount);
    expect(tx!.source).toBe("خزينة المحل");

    // Reading with getStoredMachines("store-topup") sees updated balance
    const refreshed = getStoredMachines("store-topup");
    const refreshedTarget = refreshed.find((m) => m.id === target.id);
    expect(refreshedTarget).toBeDefined();
    expect(refreshedTarget!.currentBalancePiasters).toBe(
      initialBalance + topupAmount,
    );
  });

  it("adjusts exact balance correctly (increase or decrease) with audit reason", () => {
    mockStorage.set(
      "hesba_pos_machines_v2_store-adj",
      JSON.stringify([
        {
          id: "mach-adj-1",
          name: "ماكينة فوري تعديل",
          provider: "فوري",
          currentBalancePiasters: 150000, // 1,500.00 EGP
          balanceTransactions: [],
        },
      ]),
    );

    // 1. Decrease balance to 1,200.00 EGP (e.g. cash reconciliation deficit or correction)
    const updated = setMachineExactBalance(
      "mach-adj-1",
      120000,
      {
        reason: "جرد ومطابقة رصيد الماكينة",
        notes: "تم تصحيح خطأ إدخال سابق",
      },
      "store-adj",
    );

    const target = updated.find((m) => m.id === "mach-adj-1");
    expect(target).toBeDefined();
    expect(target!.currentBalancePiasters).toBe(120000);
    expect(target!.balanceTransactions).toHaveLength(1);
    const tx = target!.balanceTransactions[0];
    expect(tx).toBeDefined();
    expect(tx!.type).toBe("adjustment");
    expect(tx!.amountPiasters).toBe(-30000); // delta is -300.00 EGP
    expect(tx!.balanceAfterPiasters).toBe(120000);
    expect(tx!.notes).toContain("تصحيح خطأ");

    // 2. Increase balance to 2,000.00 EGP
    const updated2 = setMachineExactBalance(
      "mach-adj-1",
      200000,
      {
        reason: "تصحيح خطأ إدخال رصيد سابق",
      },
      "store-adj",
    );
    const target2 = updated2.find((m) => m.id === "mach-adj-1");
    expect(target2!.currentBalancePiasters).toBe(200000);
    expect(target2!.balanceTransactions).toHaveLength(2);
    const tx2 = target2!.balanceTransactions[0];
    expect(tx2!.amountPiasters).toBe(80000); // delta is +800.00 EGP
  });

  it("deducts only the principal amount during sale, keeping commission separate", () => {
    mockStorage.set(
      "hesba_pos_machines_v2_store-comm",
      JSON.stringify([
        {
          id: "mach-comm-1",
          name: "ماكينة فودافون كاش",
          provider: "فودافون",
          currentBalancePiasters: 10000, // exactly 100.00 EGP
          balanceTransactions: [],
        },
      ]),
    );

    // Customer wants to transfer 100.00 EGP with 5.00 EGP commission
    // Principal = 100.00 EGP (10000 piasters)
    // Machine balance is 100.00 EGP. Balance check only tests principal (10000 <= 10000)
    const principalPiasters = 10000;

    const updated = deductMachineBalance(
      "mach-comm-1",
      principalPiasters,
      {
        source: "تحويل أموال",
        reference: "ref-sale-1",
      },
      "store-comm",
    );

    const target = updated.find((m) => m.id === "mach-comm-1");
    expect(target).toBeDefined();
    // Machine balance after deducting ONLY 100 EGP principal:
    expect(target!.currentBalancePiasters).toBe(0);
    const tx = target!.balanceTransactions[0];
    expect(tx).toBeDefined();
    expect(tx!.type).toBe("withdrawal");
    expect(tx!.amountPiasters).toBe(-10000);
  });

  it("refunds balance back to machine immediately on undo", () => {
    mockStorage.set(
      "hesba_pos_machines_v2_store-refund",
      JSON.stringify([
        {
          id: "mach-ref-1",
          name: "ماكينة أمان",
          provider: "أمان",
          currentBalancePiasters: 50000, // 500.00 EGP
          balanceTransactions: [],
        },
      ]),
    );

    // 1. Deduct 200.00 EGP for a transaction
    deductMachineBalance(
      "mach-ref-1",
      20000,
      { source: "شحن رصيد" },
      "store-refund",
    );
    expect(getStoredMachines("store-refund")[0]?.currentBalancePiasters).toBe(
      30000,
    );

    // 2. Undo: Cashier clicked "تراجع" -> immediately refund the 200.00 EGP
    const restored = addMachineTopup(
      "mach-ref-1",
      20000,
      {
        source: "تراجع عن عملية بيع",
        notes: "استرداد فوري لرصيد 200.00 ج.م",
      },
      "store-refund",
    );

    expect(restored[0]?.currentBalancePiasters).toBe(50000);
    expect(restored[0]?.balanceTransactions).toHaveLength(2);
  });
});
