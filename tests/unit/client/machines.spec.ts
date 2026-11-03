import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getMachineStorageKey,
  getStoredMachines,
  addMachineTopup,
} from "@/client/shared/machines";

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
    expect(getMachineStorageKey()).toBe("hesba_pos_machines_v2");
    expect(getMachineStorageKey(undefined)).toBe("hesba_pos_machines_v2");
    expect(getMachineStorageKey("default")).toBe("hesba_pos_machines_v2");
    expect(getMachineStorageKey("store-123")).toBe(
      "hesba_pos_machines_v2_store-123",
    );
  });

  it("initializes with default machines if nothing in storage", () => {
    const machines = getStoredMachines();
    expect(machines.length).toBeGreaterThan(0);
    const first = machines[0];
    expect(first).toBeDefined();
    expect(first!.currentBalancePiasters).toBeGreaterThan(0);
  });

  it("migrates legacy v2_default and v1_default keys smoothly", () => {
    mockStorage.set(
      "hesba_pos_machines_v2_default",
      JSON.stringify([
        {
          id: "mach-legacy",
          name: "ماكينة قديمة",
          provider: "فوري",
          currentBalancePiasters: 99000,
          balanceTransactions: [],
        },
      ]),
    );

    const machines = getStoredMachines();
    expect(machines).toHaveLength(1);
    const first = machines[0];
    expect(first).toBeDefined();
    expect(first!.id).toBe("mach-legacy");
    expect(first!.currentBalancePiasters).toBe(99000);
  });

  it("adds topup amount correctly in piasters and appends transaction record", () => {
    const initial = getStoredMachines();
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
      "default",
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

    // Reading with getStoredMachines() with undefined storeId also sees the new balance
    const refreshed = getStoredMachines();
    const refreshedTarget = refreshed.find((m) => m.id === target.id);
    expect(refreshedTarget).toBeDefined();
    expect(refreshedTarget!.currentBalancePiasters).toBe(
      initialBalance + topupAmount,
    );
  });
});
