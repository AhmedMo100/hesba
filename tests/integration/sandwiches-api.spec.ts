/**
 * Integration tests for sandwiches (composite products, ADR-0018) on a real Postgres:
 * recipe CRUD, live cost, hiding, tenant isolation, and selling a sandwich through the
 * existing `POST /api/sales` transaction (ingredient stock check + FEFO depletion).
 *
 * Every request goes through the real route handlers with a real session, as the app role
 * (`hesba_app`, RLS enforced). Setup and assertions read through `withTenant`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient, type Prisma } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { createSession } from "@/server/modules/auth";
import { InventoryService } from "@/server/modules/inventory";
import {
  GET as listSandwichesRoute,
  POST as createSandwichRoute,
} from "@/app/api/sandwiches/route";
import {
  GET as getSandwichRoute,
  PATCH as patchSandwichRoute,
} from "@/app/api/sandwiches/[id]/route";
import { GET as ingredientsRoute } from "@/app/api/sandwiches/ingredients/route";
import {
  GET as listSalesRoute,
  POST as postSaleRoute,
} from "@/app/api/sales/route";
import {
  GET as listProductsRoute,
  POST as upsertProductRoute,
  DELETE as hideProductRoute,
} from "@/app/api/products/route";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

type Json = Record<string, unknown>;

describe("Sandwiches (composite products) — API, sale, stock & tenancy", () => {
  let migratorPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  const runId = Math.random().toString(36).slice(2, 8);
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const storeAId = crypto.randomUUID();
  const storeBId = crypto.randomUUID();
  // A store with no products at all (empty-state checks).
  const userCId = crypto.randomUUID();
  const storeCId = crypto.randomUUID();

  // Store A ingredients (variant ids).
  let bread: string; // piece, bought 30 ج per bag of 10 → 3 ج (300) per piece
  let luncheon: string; // kg, 200 ج/kg
  let cheese: string; // kg, 160 ج/kg
  let roumy: string; // kg, 180 ج/kg
  let luncheonProduct: string;
  // Store B ingredient, used to prove A cannot reference it.
  let breadB: string;

  async function createStore(id: string, ownerId: string, name: string) {
    await withTenant(
      id,
      ownerId,
      async (tx) => {
        await tx.store.create({
          data: {
            id,
            name,
            shopType: "supermarket",
            governorate: "Cairo",
            createdBy: ownerId,
          },
        });
        await tx.storeMember.create({
          data: { storeId: id, userId: ownerId, role: "owner" },
        });
      },
      migratorPrisma,
    );
  }

  async function createIngredient(
    storeId: string,
    userId: string,
    data: {
      name: string;
      unit: string;
      buyPricePiasters: number;
      packQty?: number;
    },
  ): Promise<{ productId: string; variantId: string }> {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const p = await tx.storeProduct.create({
          data: {
            storeId,
            nameAr: data.name,
            nameNorm: data.name,
            category: "ألبان وأجبان",
            unit: data.unit,
            sellPricePiasters: BigInt(data.buyPricePiasters * 2),
            buyPricePiasters: BigInt(data.buyPricePiasters),
            isCustom: true,
            storeVariants: {
              create: {
                storeId,
                packQty: data.packQty ?? 1,
                sellPricePiasters: BigInt(data.buyPricePiasters * 2),
                buyPricePiasters: BigInt(data.buyPricePiasters),
              },
            },
          },
          include: { storeVariants: true },
        });
        return { productId: p.id, variantId: p.storeVariants[0]!.id };
      },
      migratorPrisma,
    );
  }

  async function addStock(variantId: string, qty: number, costPerUnit = 1) {
    await new InventoryService(appPrisma).addStockBatch(storeAId, userAId, {
      storeVariantId: variantId,
      receivedQuantityBase: qty,
      costTotalMinor: costPerUnit * qty, // the batch stores the total (ADR-0021)
    });
  }

  async function call(
    handler: (req: Request, ctx: never) => Promise<Response>,
    method: string,
    path: string,
    as: "A" | "B",
    body?: unknown,
    params?: Json,
  ): Promise<{ status: number; json: Json }> {
    const session =
      as === "A"
        ? await createSession(userAId, storeAId)
        : await createSession(userBId, storeBId);
    const req = new Request(`http://localhost:3000${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${session.rawToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await handler(req, {
      params: Promise.resolve(params ?? {}),
    } as never);
    return { status: res.status, json: (await res.json()) as Json };
  }

  function asStoreA<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return withTenant(storeAId, userAId, fn, migratorPrisma);
  }

  async function levelOf(variantId: string): Promise<number> {
    const lvl = await asStoreA((tx) =>
      tx.stockLevel.findUnique({
        where: {
          storeId_storeVariantId: {
            storeId: storeAId,
            storeVariantId: variantId,
          },
        },
      }),
    );
    return Number(lvl?.quantityBase ?? 0);
  }

  function recipe(
    lines: Array<[string, number, "g" | "kg" | "piece"]>,
  ): Array<{ variantId: string; quantity: number; unit: string }> {
    return lines.map(([variantId, quantity, unit]) => ({
      variantId,
      quantity,
      unit,
    }));
  }

  async function createSandwich(body: Json) {
    return call(
      createSandwichRoute as never,
      "POST",
      "/api/sandwiches",
      "A",
      body,
    );
  }

  async function sell(
    sandwichId: string,
    count: number,
    opId: string = crypto.randomUUID(),
    as: "A" | "B" = "A",
  ) {
    return call(postSaleRoute as never, "POST", "/api/sales", as, {
      id: crypto.randomUUID(),
      productId: sandwichId,
      quantityBase: count,
      amountPiasters: 1, // ignored for sandwiches: the server prices them
      opId,
    });
  }

  beforeAll(async () => {
    migratorClient = postgres(directUrl, { max: 1 });
    migratorPrisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    await migratorPrisma.$connect();

    await migratorPrisma.user.createMany({
      data: [
        {
          id: userAId,
          name: `ساندوتشات أ ${runId}`,
          phone: `+20121${runId}`,
          email: `sandwich-a-${runId}@hesba.test`,
          passwordHash: "mockhashA",
        },
        {
          id: userBId,
          name: `ساندوتشات ب ${runId}`,
          phone: `+20122${runId}`,
          email: `sandwich-b-${runId}@hesba.test`,
          passwordHash: "mockhashB",
        },
      ],
    });
    await createStore(storeAId, userAId, `محل ساندوتش أ ${runId}`);
    await createStore(storeBId, userBId, `محل ساندوتش ب ${runId}`);

    bread = (
      await createIngredient(storeAId, userAId, {
        name: `عيش ${runId}`,
        unit: "piece",
        buyPricePiasters: 300,
        packQty: 10,
      })
    ).variantId;
    const l = await createIngredient(storeAId, userAId, {
      name: `لانشون ${runId}`,
      unit: "kg",
      buyPricePiasters: 20000,
    });
    luncheon = l.variantId;
    luncheonProduct = l.productId;
    cheese = (
      await createIngredient(storeAId, userAId, {
        name: `جبنة ${runId}`,
        unit: "kg",
        buyPricePiasters: 16000,
      })
    ).variantId;
    roumy = (
      await createIngredient(storeAId, userAId, {
        name: `رومي ${runId}`,
        unit: "kg",
        buyPricePiasters: 18000,
      })
    ).variantId;
    breadB = (
      await createIngredient(storeBId, userBId, {
        name: `عيش ب ${runId}`,
        unit: "piece",
        buyPricePiasters: 250,
      })
    ).variantId;

    await addStock(bread, 10, 300);
    await addStock(luncheon, 1000, 20);
    await addStock(cheese, 1000, 16);
    await addStock(roumy, 1000, 18);
  });

  afterAll(async () => {
    try {
      const ids = [storeAId, storeBId, storeCId];
      await migratorClient`DELETE FROM "stock_movements" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "stock_levels" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "store_stock_batches" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "sale_lines" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "sales" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "sandwich_ingredients" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "store_variants" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "store_products" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "sessions" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "store_members" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "stores" WHERE id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "users" WHERE id IN ${migratorClient([userAId, userBId, userCId])}`;
    } finally {
      await migratorClient.end();
      await migratorPrisma.$disconnect();
    }
  });

  // ---------------------------------------------------------------------------------------
  describe("create, read and cost", () => {
    it("creates a sandwich and calculates its cost from the recipe (bread per piece + grams)", async () => {
      const res = await createSandwich({
        name: `ساندوتش لانشون ${runId}`,
        sellPricePiasters: 1000,
        ingredients: recipe([
          [bread, 1, "piece"],
          [luncheon, 5, "g"],
          [cheese, 5, "g"],
          [roumy, 5, "g"],
        ]),
      });
      expect(res.status).toBe(201);
      const s = res.json.sandwich as Json;
      // 3.00 + 1.00 + 0.80 + 0.90 = 5.70
      expect(s.costPiasters).toBe(570);
      expect(s.sellPricePiasters).toBe(1000);
      expect(s.profitPiasters).toBe(430);
      expect(s.marginPercent).toBe(43);
      expect(s.category).toBe("ساندوتشات");
      const ings = s.ingredients as Json[];
      expect(ings.map((i) => i.costPiasters)).toEqual([300, 100, 80, 90]);
      // 10 bread pieces limit the count
      expect(s.availableCount).toBe(10);

      // Stored as a store product of kind 'sandwich' with NO variant (no stock of its own)
      const row = await asStoreA((tx) =>
        tx.storeProduct.findUnique({
          where: { id: s.id as string },
          include: { storeVariants: true, sandwichIngredients: true },
        }),
      );
      expect(row?.kind).toBe("sandwich");
      expect(row?.storeVariants).toHaveLength(0);
      expect(row?.sandwichIngredients).toHaveLength(4);
    });

    it("accepts kilograms and converts them to whole grams", async () => {
      const res = await createSandwich({
        name: `ساندوتش رومي ${runId}`,
        sellPricePiasters: 1800,
        ingredients: recipe([
          [bread, 1, "piece"],
          [roumy, 0.01, "kg"],
        ]),
      });
      expect(res.status).toBe(201);
      const s = res.json.sandwich as Json;
      expect((s.ingredients as Json[])[1]?.quantityBase).toBe(10);
      expect(s.costPiasters).toBe(300 + 180);
    });

    it("keeps several independent sandwiches", async () => {
      const res = await call(
        listSandwichesRoute as never,
        "GET",
        "/api/sandwiches",
        "A",
      );
      expect(res.status).toBe(200);
      const names = (res.json.sandwiches as Json[]).map((s) => s.name);
      expect(names).toEqual(
        expect.arrayContaining([
          `ساندوتش لانشون ${runId}`,
          `ساندوتش رومي ${runId}`,
        ]),
      );
    });

    it("lists ingredient options with their purchase price and stock, excluding sandwiches", async () => {
      const res = await call(
        ingredientsRoute as never,
        "GET",
        "/api/sandwiches/ingredients",
        "A",
      );
      const opts = res.json.ingredients as Json[];
      const b = opts.find((o) => o.variantId === bread);
      expect(b).toMatchObject({ buyPricePiasters: 300, isWeight: false });
      expect(opts.find((o) => o.variantId === luncheon)).toMatchObject({
        buyPricePiasters: 20000,
        isWeight: true,
        unit: "kg",
      });
      expect(opts.every((o) => o.variantId !== breadB)).toBe(true);
    });

    it("exposes sandwiches in GET /api/products with kind 'sandwich' and the Sandwiches category", async () => {
      const res = await call(
        listProductsRoute as never,
        "GET",
        "/api/products?filter=all",
        "A",
      );
      const products = res.json.products as Json[];
      const sw = products.find((p) => p.name_ar === `ساندوتش لانشون ${runId}`);
      expect(sw).toMatchObject({ kind: "sandwich", category: "ساندوتشات" });
      const normal = products.find((p) => p.name_ar === `عيش ${runId}`);
      expect(normal?.kind).toBe("standard");
    });

    it("refuses to edit a sandwich through the normal product form path", async () => {
      const list = await call(
        listSandwichesRoute as never,
        "GET",
        "/api/sandwiches",
        "A",
      );
      const sw = (list.json.sandwiches as Json[])[0]!;
      const res = await call(
        upsertProductRoute as never,
        "POST",
        "/api/products",
        "A",
        {
          id: sw.id,
          nameAr: "تعديل غلط",
          category: "عام",
          unit: "piece",
          sellPricePiasters: 500,
          variants: [{ sellPricePiasters: 500, packQty: 1 }],
        },
      );
      expect(res.status).toBe(400);
      const row = await asStoreA((tx) =>
        tx.storeProduct.findUnique({
          where: { id: sw.id as string },
          include: { storeVariants: true },
        }),
      );
      expect(row?.kind).toBe("sandwich");
      expect(row?.storeVariants).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("validation", () => {
    const base = () => ({
      name: `ساندوتش تجربة ${runId} ${Math.random()}`,
      sellPricePiasters: 1000,
    });

    it.each([
      ["no ingredients", { ingredients: [] }],
      [
        "duplicate ingredient",
        {
          ingredients: [
            { variantId: "", quantity: 1, unit: "piece" },
            { variantId: "", quantity: 2, unit: "piece" },
          ],
        },
      ],
      [
        "zero quantity",
        { ingredients: [{ variantId: "", quantity: 0, unit: "piece" }] },
      ],
      [
        "invalid unit",
        { ingredients: [{ variantId: "", quantity: 1, unit: "box" }] },
      ],
    ])("rejects %s with 400", async (_label, extra) => {
      const ingredients = (extra.ingredients as Json[]).map((i) => ({
        ...i,
        variantId: bread,
      }));
      const res = await createSandwich({ ...base(), ingredients });
      expect(res.status).toBe(400);
    });

    it("rejects a missing name and a zero selling price", async () => {
      const ing = recipe([[bread, 1, "piece"]]);
      expect(
        (
          await createSandwich({
            name: " ",
            sellPricePiasters: 1000,
            ingredients: ing,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await createSandwich({
            ...base(),
            sellPricePiasters: 0,
            ingredients: ing,
          })
        ).status,
      ).toBe(400);
    });

    it("rejects half grams and fractional pieces instead of rounding", async () => {
      const half = await createSandwich({
        ...base(),
        ingredients: recipe([[luncheon, 0.5, "g"]]),
      });
      expect(half.status).toBe(400);
      expect((half.json.error as Json).message).toContain("جرامات صحيحة");

      const kgFraction = await createSandwich({
        ...base(),
        ingredients: recipe([[luncheon, 0.0055, "kg"]]),
      });
      expect(kgFraction.status).toBe(400);

      const halfPiece = await createSandwich({
        ...base(),
        ingredients: recipe([[bread, 1.5, "piece"]]),
      });
      expect(halfPiece.status).toBe(400);
    });

    it("rejects a unit that does not match the ingredient (grams of bread, pieces of luncheon)", async () => {
      expect(
        (
          await createSandwich({
            ...base(),
            ingredients: recipe([[bread, 5, "g"]]),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await createSandwich({
            ...base(),
            ingredients: recipe([[luncheon, 1, "piece"]]),
          })
        ).status,
      ).toBe(400);
    });

    it("rejects a malformed JSON body with 400 (not 500), for sandwiches and sales", async () => {
      const session = await createSession(userAId, storeAId);
      const raw = (url: string) =>
        new Request(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `hesba_session=${session.rawToken}`,
          },
          body: "{bad",
        });
      const sw = await createSandwichRoute(
        raw("http://localhost:3000/api/sandwiches"),
      );
      expect(sw.status).toBe(400);
      expect(((await sw.json()) as Json).error).toMatchObject({
        code: "VALIDATION_ERROR",
      });
      const sale = await postSaleRoute(raw("http://localhost:3000/api/sales"));
      expect(sale.status).toBe(400);
    });

    it("rejects a duplicate sandwich name with 409", async () => {
      const res = await createSandwich({
        name: `ساندوتش لانشون ${runId}`,
        sellPricePiasters: 900,
        ingredients: recipe([[bread, 1, "piece"]]),
      });
      expect(res.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("empty store", () => {
    it("returns 200 with empty lists when the store has no products and no sandwiches", async () => {
      await migratorPrisma.user.create({
        data: {
          id: userCId,
          name: `ساندوتشات ج ${runId}`,
          phone: `+20123${runId}`,
          email: `sandwich-c-${runId}@hesba.test`,
          passwordHash: "mockhashC",
        },
      });
      await createStore(storeCId, userCId, `محل فاضي ${runId}`);
      const sessionC = await createSession(userCId, storeCId);
      const req = (path: string) =>
        new Request(`http://localhost:3000${path}`, {
          headers: { cookie: `hesba_session=${sessionC.rawToken}` },
        });

      const ing = await ingredientsRoute(req("/api/sandwiches/ingredients"));
      expect(ing.status).toBe(200);
      expect(await ing.json()).toEqual({ ingredients: [] });

      const list = await listSandwichesRoute(
        req("/api/sandwiches?includeHidden=true"),
      );
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({ sandwiches: [] });
    });

    it("rejects unauthenticated requests with 401", async () => {
      const res = await listSandwichesRoute(
        new Request("http://localhost:3000/api/sandwiches"),
      );
      expect(res.status).toBe(401);
      const ing = await ingredientsRoute(
        new Request("http://localhost:3000/api/sandwiches/ingredients"),
      );
      expect(ing.status).toBe(401);
    });
  });

  describe("tenant isolation", () => {
    let sandwichA: string;

    beforeAll(async () => {
      const res = await createSandwich({
        name: `ساندوتش معزول ${runId}`,
        sellPricePiasters: 1200,
        ingredients: recipe([[bread, 1, "piece"]]),
      });
      sandwichA = (res.json.sandwich as Json).id as string;
    });

    it("store B does not see store A's sandwiches, recipe or price", async () => {
      const list = await call(
        listSandwichesRoute as never,
        "GET",
        "/api/sandwiches?includeHidden=true",
        "B",
      );
      expect(list.status).toBe(200);
      expect(list.json.sandwiches).toEqual([]);

      const one = await call(
        getSandwichRoute as never,
        "GET",
        `/api/sandwiches/${sandwichA}`,
        "B",
        undefined,
        { id: sandwichA },
      );
      expect(one.status).toBe(404);

      const products = await call(
        listProductsRoute as never,
        "GET",
        "/api/products?filter=all",
        "B",
      );
      expect(
        (products.json.products as Json[]).some((p) => p.id === sandwichA),
      ).toBe(false);
    });

    it("store B cannot edit or sell store A's sandwich", async () => {
      const patch = await call(
        patchSandwichRoute as never,
        "PATCH",
        `/api/sandwiches/${sandwichA}`,
        "B",
        {
          name: "سرقة",
          sellPricePiasters: 1,
          ingredients: recipe([[breadB, 1, "piece"]]),
        },
        { id: sandwichA },
      );
      expect(patch.status).toBe(404);

      const breadBefore = await levelOf(bread);
      const sale = await sell(sandwichA, 1, crypto.randomUUID(), "B");
      // For store B the id is unknown: it is not treated as a sandwich and no stock of
      // store A moves (the generic path's own behavior applies).
      expect(await levelOf(bread)).toBe(breadBefore);
      const salesB = await withTenant(
        storeBId,
        userBId,
        (tx) => tx.saleLine.findMany({ where: { storeProductId: sandwichA } }),
        migratorPrisma,
      );
      expect(salesB).toHaveLength(0);
      expect([200, 400, 404, 500]).toContain(sale.status);
    });

    it("store A cannot use store B's product as an ingredient (service check)", async () => {
      const res = await createSandwich({
        name: `ساندوتش مخلوط ${runId}`,
        sellPricePiasters: 1000,
        ingredients: recipe([[breadB, 1, "piece"]]),
      });
      expect(res.status).toBe(400);
    });

    it("the database trigger rejects a recipe line pointing at another store's variant", async () => {
      await expect(
        asStoreA((tx) =>
          tx.sandwichIngredient.create({
            data: {
              storeId: storeAId,
              sandwichProductId: sandwichA,
              ingredientVariantId: breadB,
              quantityBase: 1,
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("selling", () => {
    let sandwich: string;

    beforeAll(async () => {
      const res = await createSandwich({
        name: `ساندوتش للبيع ${runId}`,
        sellPricePiasters: 1500,
        ingredients: recipe([
          [bread, 1, "piece"],
          [luncheon, 5, "g"],
          [cheese, 5, "g"],
        ]),
      });
      expect(res.status).toBe(201);
      sandwich = (res.json.sandwich as Json).id as string;
    });

    it("selling 3 sandwiches records one sale line and consumes 3 bread + 15 g + 15 g", async () => {
      const before = {
        bread: await levelOf(bread),
        luncheon: await levelOf(luncheon),
        cheese: await levelOf(cheese),
      };
      const res = await sell(sandwich, 3);
      expect(res.status).toBe(200);
      const saleId = (res.json.data as Json).id as string;

      const sale = await asStoreA((tx) =>
        tx.sale.findUnique({
          where: { id: saleId },
          include: { saleLines: true },
        }),
      );
      expect(sale).not.toBeNull();
      expect(Number(sale!.totalPiasters)).toBe(4500); // server price × 3, not the client's 1
      expect(sale!.saleLines).toHaveLength(1);
      const line = sale!.saleLines[0]!;
      expect(line.storeProductId).toBe(sandwich);
      expect(line.storeVariantId).toBeNull();
      expect(line.quantityBaseUnits).toBe(3);
      expect(Number(line.unitPricePiasters)).toBe(1500);
      expect(Number(line.costPiasters)).toBe(480 * 3); // 3.00 + 1.00 + 0.80 per sandwich

      expect(await levelOf(bread)).toBe(before.bread - 3);
      expect(await levelOf(luncheon)).toBe(before.luncheon - 15);
      expect(await levelOf(cheese)).toBe(before.cheese - 15);

      const movements = await asStoreA((tx) =>
        tx.stockMovement.findMany({ where: { saleLineId: line.id } }),
      );
      const sumBy = (v: string) =>
        movements
          .filter((m) => m.storeVariantId === v)
          .reduce((s, m) => s + Number(m.quantityBase), 0);
      expect(movements.every((m) => m.type === "sale")).toBe(true);
      expect(sumBy(bread)).toBe(-3);
      expect(sumBy(luncheon)).toBe(-15);
      expect(sumBy(cheese)).toBe(-15);
    });

    it("the sale appears in GET /api/sales with the sandwich name and its cost", async () => {
      const res = await call(listSalesRoute as never, "GET", "/api/sales", "A");
      const sales = res.json.sales as Json[];
      const s = sales.find((x) => x.productId === sandwich);
      expect(s).toMatchObject({
        name: `ساندوتش للبيع ${runId}`,
        category: "ساندوتشات",
        amountPiasters: 4500,
        costPiasters: 1440,
      });
    });

    it("a retried request with the same opId creates one sale and deducts once", async () => {
      const opId = crypto.randomUUID();
      const breadBefore = await levelOf(bread);
      const first = await sell(sandwich, 1, opId);
      const second = await sell(sandwich, 1, opId);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((second.json.data as Json).id).toBe((first.json.data as Json).id);
      const count = await asStoreA((tx) =>
        tx.sale.count({ where: { storeId: storeAId, opId } }),
      );
      expect(count).toBe(1);
      expect(await levelOf(bread)).toBe(breadBefore - 1);
    });

    it("rejects the sale when an ingredient is short, deducting nothing", async () => {
      const breadLeft = await levelOf(bread);
      const before = {
        luncheon: await levelOf(luncheon),
        cheese: await levelOf(cheese),
      };
      const salesBefore = await asStoreA((tx) =>
        tx.sale.count({ where: { storeId: storeAId } }),
      );

      const res = await sell(sandwich, breadLeft + 1);
      expect(res.status).toBe(409);
      const err = res.json.error as Json;
      expect(err.message).toContain(`عيش ${runId}`);
      const shortages = (err.details as Json).shortages as Json[];
      expect(shortages).toHaveLength(1);
      expect(shortages[0]).toMatchObject({
        variantId: bread,
        neededBase: breadLeft + 1,
        availableBase: breadLeft,
      });

      expect(await levelOf(bread)).toBe(breadLeft);
      expect(await levelOf(luncheon)).toBe(before.luncheon);
      expect(await levelOf(cheese)).toBe(before.cheese);
      expect(
        await asStoreA((tx) => tx.sale.count({ where: { storeId: storeAId } })),
      ).toBe(salesBefore);
    });

    it("a failing insert rolls back the whole sale (atomic)", async () => {
      // Reuse an existing sale id: the sale insert fails after the stock check.
      const existing = await asStoreA((tx) =>
        tx.sale.findFirst({ where: { storeId: storeAId } }),
      );
      const breadBefore = await levelOf(bread);
      const movementsBefore = await asStoreA((tx) =>
        tx.stockMovement.count({ where: { storeId: storeAId } }),
      );
      const res = await call(
        postSaleRoute as never,
        "POST",
        "/api/sales",
        "A",
        {
          id: existing!.id,
          productId: sandwich,
          quantityBase: 1,
          amountPiasters: 1500,
          opId: crypto.randomUUID(),
        },
      );
      expect(res.status).toBe(500);
      expect(await levelOf(bread)).toBe(breadBefore);
      expect(
        await asStoreA((tx) =>
          tx.stockMovement.count({ where: { storeId: storeAId } }),
        ),
      ).toBe(movementsBefore);
    });

    it("two concurrent sales cannot both take the last bread (no negative stock)", async () => {
      // Leave exactly 2 bread pieces, then race two sales of 2 sandwiches each.
      const left = await levelOf(bread);
      if (left > 2) {
        const filler = await sell(sandwich, left - 2);
        expect(filler.status).toBe(200);
      }
      expect(await levelOf(bread)).toBe(2);

      const [a, b] = await Promise.all([sell(sandwich, 2), sell(sandwich, 2)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await levelOf(bread)).toBe(0);
    });

    it("refuses to sell a hidden sandwich and keeps its past sales intact", async () => {
      const hide = await call(
        hideProductRoute as never,
        "DELETE",
        `/api/products?id=${sandwich}`,
        "A",
      );
      expect(hide.status).toBe(200);

      const visible = await call(
        listSandwichesRoute as never,
        "GET",
        "/api/sandwiches",
        "A",
      );
      expect(
        (visible.json.sandwiches as Json[]).some((s) => s.id === sandwich),
      ).toBe(false);
      const all = await call(
        listSandwichesRoute as never,
        "GET",
        "/api/sandwiches?includeHidden=true",
        "A",
      );
      expect(
        (all.json.sandwiches as Json[]).find((s) => s.id === sandwich),
      ).toMatchObject({ isHidden: true });

      await addStock(bread, 5, 300);
      const res = await sell(sandwich, 1);
      expect(res.status).toBe(400);

      const sales = await call(
        listSalesRoute as never,
        "GET",
        "/api/sales",
        "A",
      );
      expect(
        (sales.json.sales as Json[]).some((s) => s.productId === sandwich),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe("editing and history", () => {
    it("cost follows ingredient price changes, and edits never rewrite past sales", async () => {
      const created = await createSandwich({
        name: `ساندوتش تاريخ ${runId}`,
        sellPricePiasters: 1500,
        ingredients: recipe([
          [bread, 1, "piece"],
          [luncheon, 5, "g"],
        ]),
      });
      const id = (created.json.sandwich as Json).id as string;
      await addStock(bread, 5, 300);

      const sale = await sell(id, 2);
      expect(sale.status).toBe(200);
      const saleId = (sale.json.data as Json).id as string;
      const lineBefore = await asStoreA((tx) =>
        tx.saleLine.findFirstOrThrow({ where: { saleId } }),
      );
      const movementsBefore = await asStoreA((tx) =>
        tx.stockMovement.findMany({
          where: { saleLineId: lineBefore.id },
          orderBy: { id: "asc" },
        }),
      );
      expect(Number(lineBefore.costPiasters)).toBe(400 * 2);

      // Luncheon goes from 200 to 240 ج/kg → live cost follows.
      await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          await tx.storeProduct.update({
            where: { id: luncheonProduct },
            data: { buyPricePiasters: BigInt(24000) },
          });
          await tx.storeVariant.update({
            where: { id: luncheon },
            data: { buyPricePiasters: BigInt(24000) },
          });
        },
        migratorPrisma,
      );
      const afterPrice = await call(
        getSandwichRoute as never,
        "GET",
        `/api/sandwiches/${id}`,
        "A",
        undefined,
        { id },
      );
      expect((afterPrice.json.sandwich as Json).costPiasters).toBe(300 + 120);

      // Edit name, price and recipe.
      const patch = await call(
        patchSandwichRoute as never,
        "PATCH",
        `/api/sandwiches/${id}`,
        "A",
        {
          name: `ساندوتش تاريخ دبل ${runId}`,
          sellPricePiasters: 2500,
          ingredients: recipe([
            [bread, 2, "piece"],
            [luncheon, 10, "g"],
            [cheese, 10, "g"],
          ]),
        },
        { id },
      );
      expect(patch.status).toBe(200);
      const edited = patch.json.sandwich as Json;
      expect(edited.costPiasters).toBe(600 + 240 + 160);
      expect(edited.sellPricePiasters).toBe(2500);
      expect(edited.ingredients as Json[]).toHaveLength(3);

      // The past sale line and its movements are unchanged.
      const lineAfter = await asStoreA((tx) =>
        tx.saleLine.findFirstOrThrow({ where: { saleId } }),
      );
      expect(Number(lineAfter.unitPricePiasters)).toBe(1500);
      expect(Number(lineAfter.totalPiasters)).toBe(3000);
      expect(Number(lineAfter.costPiasters)).toBe(800);
      expect(lineAfter.quantityBaseUnits).toBe(2);
      const movementsAfter = await asStoreA((tx) =>
        tx.stockMovement.findMany({
          where: { saleLineId: lineBefore.id },
          orderBy: { id: "asc" },
        }),
      );
      expect(
        movementsAfter.map((m) => [m.storeVariantId, Number(m.quantityBase)]),
      ).toEqual(
        movementsBefore.map((m) => [m.storeVariantId, Number(m.quantityBase)]),
      );
    });
  });
});
