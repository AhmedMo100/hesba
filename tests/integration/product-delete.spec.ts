/**
 * Integration tests for deleting a product the shop created
 * (`DELETE /api/products?id=…&action=delete` → `CatalogService.deleteShopProduct`) on a real
 * Postgres, through the route handler, as the app role with RLS enforced.
 *
 * Rules under test:
 * - no history → the product (and its variants) are removed;
 * - any history (sale, stock movement/batch) → archived (hidden), history intact;
 * - catalog products are refused and the global record is never touched;
 * - another shop's product is invisible (404) and untouched;
 * - a product used in a sandwich recipe is refused;
 * - deleted/archived products leave the ingredient options.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient, type Prisma } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { createSession } from "@/server/modules/auth";
import { InventoryService } from "@/server/modules/inventory";
import {
  DELETE as productsDelete,
  GET as productsGet,
} from "@/app/api/products/route";
import { GET as ingredientsGet } from "@/app/api/sandwiches/ingredients/route";
import { POST as sandwichesPost } from "@/app/api/sandwiches/route";
import { GET as salesGet } from "@/app/api/sales/route";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

type Json = Record<string, unknown>;

describe("Delete a shop-created product — safety and isolation", () => {
  let migratorPrisma: PrismaClient;
  let migratorClient: postgres.Sql;
  const runId = Math.random().toString(36).slice(2, 8);
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const storeA = crypto.randomUUID();
  const storeB = crypto.randomUUID();
  let globalProductId: string;

  function asStore<T>(
    store: string,
    user: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return withTenant(store, user, fn, migratorPrisma);
  }

  async function createStore(id: string, owner: string) {
    await asStore(id, owner, async (tx) => {
      await tx.store.create({
        data: {
          id,
          name: `محل حذف ${runId}`,
          shopType: "supermarket",
          governorate: "Cairo",
          createdBy: owner,
        },
      });
      await tx.storeMember.create({
        data: { storeId: id, userId: owner, role: "owner" },
      });
    });
  }

  async function shopProduct(
    store: string,
    user: string,
    name: string,
    extra: { globalProductId?: string } = {},
  ): Promise<{ productId: string; variantId: string }> {
    return asStore(store, user, async (tx) => {
      const p = await tx.storeProduct.create({
        data: {
          storeId: store,
          nameAr: name,
          nameNorm: name,
          category: "تجربة",
          unit: "piece",
          sellPricePiasters: BigInt(500),
          buyPricePiasters: BigInt(300),
          isCustom: !extra.globalProductId,
          globalProductId: extra.globalProductId ?? null,
          storeVariants: {
            create: {
              storeId: store,
              sellPricePiasters: BigInt(500),
              buyPricePiasters: BigInt(300),
            },
          },
        },
        include: { storeVariants: true },
      });
      return { productId: p.id, variantId: p.storeVariants[0]!.id };
    });
  }

  async function call(
    handler: (req: Request) => Promise<Response>,
    method: string,
    path: string,
    as: "A" | "B",
    body?: unknown,
  ): Promise<{ status: number; json: Json }> {
    const session =
      as === "A"
        ? await createSession(userA, storeA)
        : await createSession(userB, storeB);
    const res = await handler(
      new Request(`http://localhost:3000${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${session.rawToken}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as Json };
  }

  const del = (id: string, as: "A" | "B" = "A") =>
    call(
      productsDelete,
      "DELETE",
      `/api/products?id=${encodeURIComponent(id)}&action=delete`,
      as,
    );

  const findProduct = (store: string, user: string, id: string) =>
    asStore(store, user, (tx) =>
      tx.storeProduct.findUnique({
        where: { id },
        include: { storeVariants: true },
      }),
    );

  async function ingredientIds(): Promise<string[]> {
    const res = await call(
      ingredientsGet,
      "GET",
      "/api/sandwiches/ingredients",
      "A",
    );
    return (res.json.ingredients as Json[]).map((i) => i.variantId as string);
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
          id: userA,
          name: `حذف أ ${runId}`,
          phone: `+20131${runId}`,
          email: `delete-a-${runId}@hesba.test`,
          passwordHash: "x",
        },
        {
          id: userB,
          name: `حذف ب ${runId}`,
          phone: `+20132${runId}`,
          email: `delete-b-${runId}@hesba.test`,
          passwordHash: "x",
        },
      ],
    });
    await createStore(storeA, userA);
    await createStore(storeB, userB);
    const gp = await migratorPrisma.globalProduct.create({
      data: {
        nameAr: `منتج كتالوج حذف ${runId}`,
        nameNorm: `منتج كتالوج حذف ${runId}`,
        category: "تجربة",
      },
    });
    globalProductId = gp.id;
  });

  afterAll(async () => {
    try {
      const ids = [storeA, storeB];
      await migratorClient`DELETE FROM "stock_movements" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "stock_levels" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "store_stock_batches" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "sale_lines" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "sales" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "sandwich_ingredients" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "store_variants" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "store_products" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "global_products" WHERE id = ${globalProductId}`;
      await migratorClient`DELETE FROM "sessions" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "store_members" WHERE store_id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "stores" WHERE id IN ${migratorClient(ids)}`;
      await migratorClient`DELETE FROM "users" WHERE id IN ${migratorClient([userA, userB])}`;
    } finally {
      await migratorClient.end();
      await migratorPrisma.$disconnect();
    }
  });

  it("removes a shop-created product that has no history", async () => {
    const p = await shopProduct(storeA, userA, `منتج جديد ${runId}`);
    expect(await ingredientIds()).toContain(p.variantId);

    const res = await del(p.productId);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ result: "deleted" });
    expect(await findProduct(storeA, userA, p.productId)).toBeNull();
    const variant = await asStore(storeA, userA, (tx) =>
      tx.storeVariant.findUnique({ where: { id: p.variantId } }),
    );
    expect(variant).toBeNull();
    expect(await ingredientIds()).not.toContain(p.variantId);

    const list = await call(
      productsGet,
      "GET",
      "/api/products?filter=all",
      "A",
    );
    expect(
      (list.json.products as Json[]).some((x) => x.id === p.productId),
    ).toBe(false);
  });

  it("archives (hides) a product with stock history and keeps the history", async () => {
    const p = await shopProduct(storeA, userA, `منتج بمخزون ${runId}`);
    await new InventoryService(appPrisma).addStockBatch(storeA, userA, {
      storeVariantId: p.variantId,
      receivedQuantityBase: 7,
      costPriceMinor: 300,
    });

    const res = await del(p.productId);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ result: "archived" });

    const row = await findProduct(storeA, userA, p.productId);
    expect(row?.isActive).toBe(false);
    expect(row?.storeVariants.every((v) => !v.isActive)).toBe(true);
    const [batches, movements] = await asStore(storeA, userA, (tx) =>
      Promise.all([
        tx.storeStockBatch.count({ where: { storeVariantId: p.variantId } }),
        tx.stockMovement.count({ where: { storeVariantId: p.variantId } }),
      ]),
    );
    expect(batches).toBe(1);
    expect(movements).toBe(1);
    expect(await ingredientIds()).not.toContain(p.variantId);
  });

  it("archives a product with past sales; the invoice keeps the product and its name", async () => {
    const p = await shopProduct(storeA, userA, `منتج مبيوع ${runId}`);
    const saleId = crypto.randomUUID();
    await asStore(storeA, userA, (tx) =>
      tx.sale.create({
        data: {
          id: saleId,
          storeId: storeA,
          paymentMethod: "cash",
          totalPiasters: BigInt(500),
          opId: crypto.randomUUID(),
          saleLines: {
            create: {
              storeId: storeA,
              storeProductId: p.productId,
              quantityBaseUnits: 1,
              unitPricePiasters: BigInt(500),
              totalPiasters: BigInt(500),
            },
          },
        },
      }),
    );

    const res = await del(p.productId);
    expect(res.json).toMatchObject({ result: "archived" });
    const line = await asStore(storeA, userA, (tx) =>
      tx.saleLine.findFirst({ where: { saleId } }),
    );
    expect(line?.storeProductId).toBe(p.productId);
    const sales = await call(salesGet, "GET", "/api/sales", "A");
    expect(
      (sales.json.sales as Json[]).find((s) => s.id === saleId),
    ).toMatchObject({ name: `منتج مبيوع ${runId}`, amountPiasters: 500 });
  });

  it("refuses to delete a catalog product and never touches the global record", async () => {
    const override = await shopProduct(storeA, userA, `نسخة كتالوج ${runId}`, {
      globalProductId,
    });
    const viaOverride = await del(override.productId);
    expect(viaOverride.status).toBe(400);
    const viaGlobalId = await del(`gp_${globalProductId}`);
    expect(viaGlobalId.status).toBe(400);

    const global = await migratorPrisma.globalProduct.findUnique({
      where: { id: globalProductId },
    });
    expect(global).not.toBeNull();
    const row = await findProduct(storeA, userA, override.productId);
    expect(row?.isActive).toBe(true);
  });

  it("cannot delete another shop's product, which stays untouched", async () => {
    const theirs = await shopProduct(storeB, userB, `منتج محل تاني ${runId}`);
    const res = await del(theirs.productId, "A");
    expect(res.status).toBe(404);
    const row = await findProduct(storeB, userB, theirs.productId);
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(true);

    // And store A deleting its own same-named product leaves store B's alone.
    const mine = await shopProduct(storeA, userA, `منتج محل تاني ${runId}`);
    expect((await del(mine.productId)).json).toMatchObject({
      result: "deleted",
    });
    expect(await findProduct(storeB, userB, theirs.productId)).not.toBeNull();
  });

  it("refuses to delete an ingredient used in a sandwich, then allows it once the sandwich is gone", async () => {
    const bread = await shopProduct(storeA, userA, `عيش للساندوتش ${runId}`);
    const created = await call(sandwichesPost, "POST", "/api/sandwiches", "A", {
      name: `ساندوتش حذف ${runId}`,
      sellPricePiasters: 1000,
      ingredients: [{ variantId: bread.variantId, quantity: 1, unit: "piece" }],
    });
    expect(created.status).toBe(201);
    const sandwichId = (created.json.sandwich as Json).id as string;

    const blocked = await del(bread.productId);
    expect(blocked.status).toBe(409);
    expect((blocked.json.error as Json).message).toContain(
      `ساندوتش حذف ${runId}`,
    );
    expect(await findProduct(storeA, userA, bread.productId)).not.toBeNull();

    // A sandwich is shop-created too: with no sales it is removed with its recipe.
    const sw = await del(sandwichId);
    expect(sw.json).toMatchObject({ result: "deleted" });
    const recipe = await asStore(storeA, userA, (tx) =>
      tx.sandwichIngredient.count({ where: { sandwichProductId: sandwichId } }),
    );
    expect(recipe).toBe(0);
    expect((await del(bread.productId)).json).toMatchObject({
      result: "deleted",
    });
  });

  it("rejects unknown ids with 404 and requires a session", async () => {
    expect((await del(crypto.randomUUID())).status).toBe(404);
    expect((await del("not-a-uuid")).status).toBe(404);
    const anon = await productsDelete(
      new Request(
        `http://localhost:3000/api/products?id=${crypto.randomUUID()}&action=delete`,
        { method: "DELETE" },
      ),
    );
    expect(anon.status).toBe(401);
  });
});
