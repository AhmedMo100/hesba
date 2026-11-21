/**
 * Stock paid from one of the shop's machines / wallets: the machine's balance goes down in the
 * same transaction as the batch, a short balance rolls the whole stock-in back, and another
 * shop's machine cannot be used (RLS + store check). Real Postgres, app role.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { InventoryService } from "@/server/modules/inventory";
import { MachinesService } from "@/server/modules/machines";
import { SaleFixtures } from "./helpers/sale-fixtures";

const fx = new SaleFixtures();
const inventory = new InventoryService(appPrisma);
const machines = new MachinesService(appPrisma);

describe("stock-in paid from a machine (V19 «الدفع إزاي؟»)", () => {
  let variantId: string;
  let machineId: string;

  beforeAll(async () => {
    await fx.setup();
    ({ variantId } = await fx.product(fx.shopA, { name: "تونة", sell: 3000 }));
    const m = await machines.upsertMachine(fx.shopA.storeId, fx.shopA.userId, {
      name: "فوري",
      provider: "فوري",
    });
    machineId = m.id;
    await machines.topupMachine(
      fx.shopA.storeId,
      fx.shopA.userId,
      machineId,
      50000,
    );
  });

  afterAll(async () => {
    await fx.teardown();
  });

  const balance = async () =>
    (await machines.getStoreMachines(fx.shopA.storeId, fx.shopA.userId)).find(
      (m) => m.id === machineId,
    )!.currentBalancePiasters;

  it("takes the cost off the machine with the batch, recorded as wallet money", async () => {
    const r = await inventory.addStockBatch(fx.shopA.storeId, fx.shopA.userId, {
      storeVariantId: variantId,
      receivedQuantityBase: 10,
      costTotalMinor: 20000,
      paidFromMachineId: machineId,
      opId: crypto.randomUUID(),
    });
    expect(await balance()).toBe(30000);
    const batch = await fx.as(fx.shopA, (tx) =>
      tx.storeStockBatch.findFirstOrThrow({ where: { id: r.batchId! } }),
    );
    expect(batch.paidFrom).toBe("wallet");
    const ledger = await fx.as(fx.shopA, (tx) =>
      tx.posMachineTopup.findFirstOrThrow({
        where: { machineId, reference: r.batchId! },
      }),
    );
    expect(Number(ledger.amountPiasters)).toBe(-20000);
  });

  it("a short balance rolls the whole stock-in back (no batch, no stock)", async () => {
    const before = await fx.as(fx.shopA, (tx) =>
      tx.storeStockBatch.count({ where: { storeVariantId: variantId } }),
    );
    await expect(
      inventory.addStockBatch(fx.shopA.storeId, fx.shopA.userId, {
        storeVariantId: variantId,
        receivedQuantityBase: 10,
        costTotalMinor: 90000,
        paidFromMachineId: machineId,
      }),
    ).rejects.toThrow(/غير كافٍ/);
    const after = await fx.as(fx.shopA, (tx) =>
      tx.storeStockBatch.count({ where: { storeVariantId: variantId } }),
    );
    expect(after).toBe(before);
    expect(await balance()).toBe(30000);
  });

  it("another shop cannot pay with this shop's machine", async () => {
    const { variantId: other } = await fx.product(fx.shopB, {
      name: "سكر",
      sell: 3800,
    });
    await expect(
      inventory.addStockBatch(fx.shopB.storeId, fx.shopB.userId, {
        storeVariantId: other,
        receivedQuantityBase: 1,
        costTotalMinor: 1000,
        paidFromMachineId: machineId,
      }),
    ).rejects.toThrow(/غير موجودة/);
    expect(await balance()).toBe(30000);
  });
});
