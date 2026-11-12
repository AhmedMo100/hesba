/**
 * QA-01 (docs/QA/FULL-SYSTEM-AUDIT.md) — an ordinary sale is ONE atomic server operation
 * (ADR-0019): sale + lines + FEFO stock deduction + movements commit or roll back together,
 * priced by the server, idempotent by `opId`, and tenant-isolated.
 *
 * Real Postgres, real route handlers, real sessions, app role with RLS. Concurrency is in
 * `sales-concurrency.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SaleFixtures, type ProductRef } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;

describe("QA-01 — atomic ordinary sale", () => {
  beforeAll(() => f.setup());
  afterAll(() => f.teardown());

  describe("a normal sale", () => {
    let cola: ProductRef;

    beforeAll(async () => {
      cola = await f.product(A, { name: "كولا", sell: 1250, buy: 900 });
      // Two batches: the earlier expiry must be consumed first (FEFO).
      await f.addStock(A, cola.variantId, 4, { expiry: "2027-01-01" });
      await f.addStock(A, cola.variantId, 6, { expiry: "2027-06-01" });
    });

    it("persists the sale and one line that targets only the variant, priced by the server", async () => {
      const saleId = crypto.randomUUID();
      const res = await f.sell(A, cola.variantId, 3, {
        id: saleId,
        amountPiasters: 1, // a fabricated amount: must be ignored
        timestamp: Date.UTC(2100, 0, 1), // a fabricated time: must be ignored
      });
      expect(res.status).toBe(200);
      const data = res.json.data as Record<string, unknown>;
      expect(data).toMatchObject({
        totalPiasters: 3750,
        duplicate: false,
      });
      // The server chooses the sale id; a client id is ignored (QA-56).
      expect(data.id).not.toBe(saleId);
      expect(data.lines).toEqual([
        {
          productId: cola.productId,
          variantId: cola.variantId,
          quantityBase: 3,
          totalPiasters: 3750,
          stockAfterBase: 7,
        },
      ]);

      const [sale] = (await f.salesOf(A)).filter((s) => s.id === data.id);
      expect(Number(sale!.totalPiasters)).toBe(3750);
      expect(Math.abs(sale!.createdAt.getTime() - Date.now())).toBeLessThan(
        60_000,
      );
      expect(sale!.saleLines).toHaveLength(1);
      const line = sale!.saleLines[0]!;
      expect(line.storeVariantId).toBe(cola.variantId);
      expect(line.storeProductId).toBeNull(); // exactly one target
      expect(line.quantityBaseUnits).toBe(3);
      expect(Number(line.unitPricePiasters)).toBe(1250);
      expect(Number(line.totalPiasters)).toBe(3750);
    });

    it("deducts the stock exactly once, FEFO, with sale movements linked to the line", async () => {
      const state = await f.stockState(A, cola.variantId);
      expect(state.level).toBe(7);
      expect(state.batchesRemaining).toBe(7);
      expect(state.movementsSum).toBe(7);
      expect(state.batches).toEqual([1, 6]); // earliest expiry drawn first
      const saleMoves = state.movements.filter((m) => m.type === "sale");
      expect(saleMoves.map((m) => m.quantity)).toEqual([-3]);
      expect(saleMoves[0]!.balanceAfter).toBe(7);
      expect(saleMoves[0]!.negative).toBe(false);
      const [sale] = (await f.salesOf(A)).slice(-1);
      expect(saleMoves[0]!.saleLineId).toBe(sale!.saleLines[0]!.id);
    });

    it("crosses batches FEFO when one batch is not enough", async () => {
      const res = await f.sell(A, cola.variantId, 3);
      expect(res.status).toBe(200);
      const state = await f.stockState(A, cola.variantId);
      expect(state.batches).toEqual([0, 4]);
      expect(state.level).toBe(4);
      const moves = state.movements.filter((m) => m.type === "sale");
      // The second sale drew 1 from the early batch and 2 from the late one (state.batches
      // above proves the FEFO order; the two movements share a timestamp, so compare as a set).
      const last = moves.slice(-2);
      expect(last.map((m) => m.quantity).sort()).toEqual([-1, -2].sort());
      expect(Math.min(...last.map((m) => m.balanceAfter))).toBe(4);
    });

    it("lists the sale in GET /api/sales with the server total", async () => {
      const res = await f.request(A, "GET");
      expect(res.status).toBe(200);
      const sales = res.json.sales as Array<{
        productId: string;
        amountPiasters: number;
        quantity: number;
      }>;
      const mine = sales.filter((s) => s.productId === cola.productId);
      expect(mine.map((s) => s.amountPiasters).sort()).toEqual([3750, 3750]);
    });
  });

  describe("weighed products and pricing", () => {
    it("prices grams from the per-kg price and deducts grams", async () => {
      const cheese = await f.product(A, {
        name: "جبنة رومي",
        unit: "kg",
        sell: 20000,
      });
      await f.addStock(A, cheese.variantId, 1000);
      const res = await f.sell(A, cheese.variantId, 250, {
        amountPiasters: 999999,
      });
      expect(res.status).toBe(200);
      expect((res.json.data as { totalPiasters: number }).totalPiasters).toBe(
        5000,
      );
      expect((await f.stockState(A, cheese.variantId)).level).toBe(750);
    });

    it("rounds a fractional piaster total half up, once", async () => {
      const halva = await f.product(A, {
        name: "حلاوة",
        unit: "kg",
        sell: 9999,
      });
      await f.addStock(A, halva.variantId, 100);
      const res = await f.sell(A, halva.variantId, 3); // 3 g × 99.99/kg = 29.997 → 30
      expect((res.json.data as { totalPiasters: number }).totalPiasters).toBe(
        30,
      );
    });

    it("sells by productId (older clients) using the product's first variant", async () => {
      const tea = await f.product(A, { name: "شاي", sell: 500 });
      await f.addStock(A, tea.variantId, 5);
      const res = await f.request(A, "POST", {
        productId: tea.productId,
        quantityBase: 2,
        opId: crypto.randomUUID(),
      });
      expect(res.status).toBe(200);
      expect((await f.stockState(A, tea.variantId)).level).toBe(3);
    });
  });

  describe("rejections leave nothing behind", () => {
    it("rejects more than the stock with 409 and changes nothing", async () => {
      const juice = await f.product(A, { name: "عصير", sell: 800 });
      await f.addStock(A, juice.variantId, 2);
      const before = await f.stockState(A, juice.variantId);
      const salesBefore = (await f.salesOf(A)).length;

      const res = await f.sell(A, juice.variantId, 3);
      expect(res.status).toBe(409);
      const err = res.json.error as {
        message: string;
        details: { shortages: Array<Record<string, unknown>> };
      };
      expect(err.message).toContain("مش كفاية");
      expect(err.details.shortages[0]).toMatchObject({
        variantId: juice.variantId,
        neededBase: 3,
        availableBase: 2,
      });

      expect(await f.stockState(A, juice.variantId)).toEqual(before);
      expect((await f.salesOf(A)).length).toBe(salesBefore);
    });

    it("rejects a product with no stock at all", async () => {
      const empty = await f.product(A, { name: "بلا مخزون", sell: 100 });
      const res = await f.sell(A, empty.variantId, 1);
      expect(res.status).toBe(409);
      expect((await f.stockState(A, empty.variantId)).level).toBe(0);
    });

    it("rejects a hidden product with 400", async () => {
      const hidden = await f.product(A, {
        name: "مخفي",
        sell: 100,
        isActive: false,
      });
      await f.addStock(A, hidden.variantId, 5);
      const res = await f.sell(A, hidden.variantId, 1);
      expect(res.status).toBe(400);
      expect((await f.stockState(A, hidden.variantId)).level).toBe(5);
    });

    it("rejects an unknown product with 404 and does not create one from the name", async () => {
      const name = `صنف وهمي ${f.runId}`;
      const res = await f.request(A, "POST", {
        name,
        quantityBase: 1,
        amountPiasters: 500,
      });
      expect(res.status).toBe(404);
      const created = await f.as(A, (tx) =>
        tx.storeProduct.count({ where: { storeId: A.storeId, nameAr: name } }),
      );
      expect(created).toBe(0);
    });

    it("rejects a non-integer or oversized quantity with 400", async () => {
      const p = await f.product(A, { name: "كمية", sell: 100 });
      expect((await f.sell(A, p.variantId, 1.5)).status).toBe(400);
      expect((await f.sell(A, p.variantId, 2_000_000_000)).status).toBe(400);
    });

    it("rolls back the sale, its line and the batch update when a later step fails", async () => {
      const soap = await f.product(A, { name: "صابون", sell: 700 });
      await f.addStock(A, soap.variantId, 5);
      const before = await f.stockState(A, soap.variantId);
      const salesBefore = (await f.salesOf(A)).length;

      // Make the stock-movement insert (the LAST write of the sale) fail for this variant
      // only, after the sale, the line and the batch update were already written.
      const fn = `qa01_fail_${f.runId}`;
      await f.sql.unsafe(`
        CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.store_variant_id = '${soap.variantId}'::uuid AND NEW.type = 'sale' THEN
            RAISE EXCEPTION 'qa01 injected failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER ${fn} BEFORE INSERT ON stock_movements
          FOR EACH ROW EXECUTE FUNCTION ${fn}();`);
      try {
        const res = await f.sell(A, soap.variantId, 2);
        expect(res.status).toBe(500);
      } finally {
        await f.sql.unsafe(
          `DROP TRIGGER ${fn} ON stock_movements; DROP FUNCTION ${fn}();`,
        );
      }

      expect(await f.stockState(A, soap.variantId)).toEqual(before);
      expect((await f.salesOf(A)).length).toBe(salesBefore);
      const orphanLines = await f.as(A, (tx) =>
        tx.saleLine.count({
          where: { storeId: A.storeId, storeVariantId: soap.variantId },
        }),
      );
      expect(orphanLines).toBe(0);

      // The same sale works once the failure is gone.
      expect((await f.sell(A, soap.variantId, 2)).status).toBe(200);
      expect((await f.stockState(A, soap.variantId)).level).toBe(3);
    });
  });

  describe("idempotency (opId)", () => {
    it("returns the first sale for a repeated opId and deducts once", async () => {
      const water = await f.product(A, { name: "مياه", sell: 600 });
      await f.addStock(A, water.variantId, 10);
      const opId = crypto.randomUUID();
      const first = await f.sell(A, water.variantId, 2, { opId });
      const again = await f.sell(A, water.variantId, 2, {
        opId,
        id: crypto.randomUUID(),
      });
      expect(first.status).toBe(200);
      expect(again.status).toBe(200);
      const a = first.json.data as { id: string; duplicate: boolean };
      const b = again.json.data as { id: string; duplicate: boolean };
      expect(b.id).toBe(a.id);
      expect(a.duplicate).toBe(false);
      expect(b.duplicate).toBe(true);

      const state = await f.stockState(A, water.variantId);
      expect(state.level).toBe(8);
      expect(state.movements.filter((m) => m.type === "sale")).toHaveLength(1);
      const sales = (await f.salesOf(A)).filter((s) =>
        s.saleLines.some((l) => l.storeVariantId === water.variantId),
      );
      expect(sales).toHaveLength(1);
    });

    it("records one sale when the same opId arrives 5 times at once", async () => {
      const bread = await f.product(A, { name: "عيش", sell: 100 });
      await f.addStock(A, bread.variantId, 10);
      const opId = crypto.randomUUID();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          f.sell(A, bread.variantId, 3, { opId, id: crypto.randomUUID() }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const ids = new Set(
        results.map((r) => (r.json.data as { id: string }).id),
      );
      expect(ids.size).toBe(1);
      const state = await f.stockState(A, bread.variantId);
      expect(state.level).toBe(7);
      expect(state.movements.filter((m) => m.type === "sale")).toHaveLength(1);
    });
  });

  describe("services (no stock)", () => {
    it("records a service sale with the entered amount and touches no stock", async () => {
      const topup = await f.product(A, {
        name: "شحن رصيد",
        sell: 500,
        category: "شحن رصيد",
      });
      const res = await f.request(A, "POST", {
        productId: topup.productId,
        amountPiasters: 10500,
        machineId: "m-1",
        opId: crypto.randomUUID(),
      });
      expect(res.status).toBe(200);
      const data = res.json.data as {
        totalPiasters: number;
        lines: Array<{ stockAfterBase: number | null }>;
      };
      expect(data.totalPiasters).toBe(10500);
      expect(data.lines[0]!.stockAfterBase).toBeNull();
      expect((await f.stockState(A, topup.variantId)).movements).toHaveLength(
        0,
      );
    });

    it("records a service without variants on a product-only line", async () => {
      const bill = await f.product(A, {
        name: "فاتورة نت",
        sell: 0,
        category: "فواتير إنترنت",
        withVariant: false,
      });
      const res = await f.request(A, "POST", {
        productId: bill.productId,
        amountPiasters: 25000,
        opId: crypto.randomUUID(),
      });
      expect(res.status).toBe(200);
      const [sale] = (await f.salesOf(A)).filter(
        (s) => s.id === (res.json.data as { id: string }).id,
      );
      expect(sale!.saleLines[0]!.storeProductId).toBe(bill.productId);
      expect(sale!.saleLines[0]!.storeVariantId).toBeNull();
    });

    it("rejects a service sale without an amount", async () => {
      const card = await f.product(A, {
        name: "كارت",
        sell: 1000,
        category: "كروت شحن",
      });
      const res = await f.request(A, "POST", { productId: card.productId });
      expect(res.status).toBe(400);
    });

    it("creates a service sold by name with a machine, as before", async () => {
      const name = `شحن جديد ${f.runId}`;
      const res = await f.request(A, "POST", {
        name,
        amountPiasters: 1000,
        machineId: "m-1",
        opId: crypto.randomUUID(),
      });
      expect(res.status).toBe(200);
      const created = await f.as(A, (tx) =>
        tx.storeProduct.findFirstOrThrow({
          where: { storeId: A.storeId, nameAr: name },
        }),
      );
      expect(created.category).toBe("خدمات وفواتير");
    });
  });

  describe("promotions", () => {
    let chips: ProductRef;
    let pepsi: ProductRef;
    const promoId = `promo-${crypto.randomUUID()}`;

    beforeAll(async () => {
      chips = await f.product(A, { name: "شيبسي", sell: 500 });
      pepsi = await f.product(A, { name: "بيبسي", sell: 1000 });
      await f.addStock(A, chips.variantId, 5);
      await f.addStock(A, pepsi.variantId, 1);
      await f.as(A, (tx) =>
        tx.store.update({
          where: { id: A.storeId },
          data: {
            settings: {
              activePromotions: [
                {
                  id: promoId,
                  title: "كومبو",
                  type: "bundle",
                  items: [
                    {
                      productId: chips.productId,
                      variantId: chips.variantId,
                      productName: "شيبسي",
                      quantityBase: 2,
                      unit: "piece",
                      regularPricePiasters: 1,
                    },
                    {
                      productId: pepsi.productId,
                      variantId: pepsi.variantId,
                      productName: "بيبسي",
                      quantityBase: 1,
                      unit: "piece",
                      regularPricePiasters: 1,
                    },
                  ],
                  originalPricePiasters: 2000,
                  promoPricePiasters: 1500,
                  savingsPiasters: 500,
                  createdAt: Date.now(),
                },
              ],
            },
          },
        }),
      );
    });

    it("sells the saved offer: lines add up to the offer price and every item is deducted", async () => {
      const res = await f.request(A, "POST", {
        promotionId: promoId,
        amountPiasters: 1, // ignored
        opId: crypto.randomUUID(),
      });
      expect(res.status).toBe(200);
      const data = res.json.data as {
        id: string;
        totalPiasters: number;
        lines: Array<{ variantId: string; totalPiasters: number }>;
      };
      expect(data.totalPiasters).toBe(1500);
      // Split by the server's regular value (the offer's own regular prices are ignored):
      // chips 2 × 5.00 = 10.00, pepsi 1 × 10.00 = 10.00 → 7.50 / 7.50.
      expect(data.lines.map((l) => l.totalPiasters)).toEqual([750, 750]);

      const [sale] = (await f.salesOf(A)).filter((s) => s.id === data.id);
      expect(sale!.saleLines).toHaveLength(2);
      expect(
        sale!.saleLines.reduce((s, l) => s + Number(l.totalPiasters), 0),
      ).toBe(1500);
      expect(sale!.saleLines.every((l) => l.storeProductId === null)).toBe(
        true,
      );
      expect((await f.stockState(A, chips.variantId)).level).toBe(3);
      expect((await f.stockState(A, pepsi.variantId)).level).toBe(0);
    });

    it("rejects the whole offer when one item is short, deducting nothing", async () => {
      const chipsBefore = await f.stockState(A, chips.variantId);
      const res = await f.request(A, "POST", {
        promotionId: promoId,
        opId: crypto.randomUUID(),
      });
      expect(res.status).toBe(409);
      expect(await f.stockState(A, chips.variantId)).toEqual(chipsBefore);
    });

    it("returns 404 for an unknown offer", async () => {
      const res = await f.request(A, "POST", {
        promotionId: "nope",
        opId: crypto.randomUUID(),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("queued (offline) sales — QA-04, ADR-0020", () => {
    it("a sale queued in another shop is refused (403 STORE_MISMATCH) and changes nothing", async () => {
      const p = await f.product(A, { name: "مستنية", sell: 300 });
      await f.addStock(A, p.variantId, 3);
      const opId = crypto.randomUUID();
      const wrong = await f.request(
        A,
        "POST",
        { variantId: p.variantId, quantityBase: 1, opId },
        "",
        { "X-Hesba-Store-Id": B.storeId },
      );
      expect(wrong.status).toBe(403);
      expect((wrong.json.error as { code: string }).code).toBe(
        "STORE_MISMATCH",
      );
      expect((await f.stockState(A, p.variantId)).level).toBe(3);
      expect(
        await f.as(A, (tx) =>
          tx.sale.count({ where: { storeId: A.storeId, opId } }),
        ),
      ).toBe(0);

      // The same queued sale, sent while its own shop is signed in, is recorded once.
      const right = await f.request(
        A,
        "POST",
        { variantId: p.variantId, quantityBase: 1, opId },
        "",
        { "X-Hesba-Store-Id": A.storeId },
      );
      expect(right.status).toBe(200);
      expect((await f.stockState(A, p.variantId)).level).toBe(2);
    });

    it("a queued sale arriving after the stock was sold elsewhere is rejected whole (409), never partially", async () => {
      const p = await f.product(A, { name: "متأخرة", sell: 300 });
      await f.addStock(A, p.variantId, 10);
      const offlineOp = crypto.randomUUID(); // queued while offline: 8 pieces
      expect((await f.sell(A, p.variantId, 6)).status).toBe(200); // another device, online
      const before = await f.stockState(A, p.variantId);
      const synced = await f.sell(A, p.variantId, 8, { opId: offlineOp });
      expect(synced.status).toBe(409);
      expect(await f.stockState(A, p.variantId)).toEqual(before);
      expect(
        await f.as(A, (tx) =>
          tx.sale.count({ where: { storeId: A.storeId, opId: offlineOp } }),
        ),
      ).toBe(0);
    });
  });

  describe("tenant isolation", () => {
    it("cannot sell another shop's variant, and the other shop's stock is untouched", async () => {
      const own = await f.product(B, { name: "منتج ب", sell: 300 });
      await f.addStock(B, own.variantId, 4);
      const res = await f.sell(A, own.variantId, 1);
      expect(res.status).toBe(404);
      expect((await f.stockState(B, own.variantId)).level).toBe(4);
      expect(await f.salesOf(B)).toHaveLength(0);
    });

    it("lists only the caller's sales", async () => {
      const resB = await f.request(B, "GET");
      expect(resB.json.sales).toEqual([]);
      expect(resB.json.todayTotalPiasters).toBe(0);
    });
  });

  // Undo is a reversing void (ADR-0022, QA-10), covered by `sales-void.spec.ts`. Sales are
  // append-only: there is no hard delete to call.
  describe("no hard delete", () => {
    it("the sales route exports no DELETE handler", async () => {
      const route = await import("@/app/api/sales/route");
      expect("DELETE" in route).toBe(false);
    });
  });
});
