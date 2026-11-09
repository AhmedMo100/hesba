/**
 * Characterization tests for /api/sales.
 *
 * These pin the CURRENT behavior of the sales route so it can be moved into
 * `src/server/modules/sales` without changing it. Known gaps in that behavior
 * (no stock movement, server-side op_id, hard delete on undo) are documented in
 * the restructuring report and intentionally asserted as-is here.
 *
 * KNOWN DEFECT (pending owner decision): whenever a sale resolves to a product
 * VARIANT, the route writes both `store_variant_id` and `store_product_id` on the
 * sale line, which violates the DB check `chk_sale_lines_exactly_one_target`
 * (exactly one target per line) and returns 500. Those cases are marked
 * `it.fails` below: they document the bug and will turn red once it is fixed,
 * at which point they should become normal `it` tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient, type Prisma } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth";
import {
  GET as getSalesRoute,
  POST as postSalesRoute,
  DELETE as deleteSalesRoute,
} from "@/app/api/sales/route";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

describe("Sales API (characterization) & Tenancy", () => {
  let migratorPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  const runId = Math.random().toString(36).slice(2, 8);
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const storeAId = crypto.randomUUID();
  const storeBId = crypto.randomUUID();
  let productAId: string;
  let variantAId: string;
  let plainProductAId: string; // a product with no variants — the only path that persists today

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

  async function request(
    method: "GET" | "POST" | "DELETE",
    userId: string,
    storeId: string,
    opts: { body?: unknown; query?: string } = {},
  ) {
    const session = await createSession(userId, storeId);
    const req = new Request(
      `http://localhost:3000/api/sales${opts.query ?? ""}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${session.rawToken}`,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      },
    );
    const handler =
      method === "GET"
        ? getSalesRoute
        : method === "POST"
          ? postSalesRoute
          : deleteSalesRoute;
    return handler(req);
  }

  /** Reads Store A's rows through RLS, exactly as production code would. */
  function asStoreA<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return withTenant(storeAId, userAId, fn, migratorPrisma);
  }

  function linesOf(saleId: string) {
    return asStoreA((tx) => tx.saleLine.findMany({ where: { saleId } }));
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
          name: `بائع أ ${runId}`,
          phone: `+20111${runId}`,
          email: `sales-a-${runId}@hesba.test`,
          passwordHash: "mockhashA",
        },
        {
          id: userBId,
          name: `بائع ب ${runId}`,
          phone: `+20112${runId}`,
          email: `sales-b-${runId}@hesba.test`,
          passwordHash: "mockhashB",
        },
      ],
    });
    await createStore(storeAId, userAId, `محل مبيعات أ ${runId}`);
    await createStore(storeBId, userBId, `محل مبيعات ب ${runId}`);

    const product = await withTenant(
      storeAId,
      userAId,
      (tx) =>
        tx.storeProduct.create({
          data: {
            storeId: storeAId,
            nameAr: `شاي ${runId}`,
            nameNorm: `شاي ${runId}`,
            category: "مشروبات",
            unit: "piece",
            sellPricePiasters: BigInt(2500),
            isCustom: true,
            storeVariants: {
              create: {
                storeId: storeAId,
                sellPricePiasters: BigInt(2500),
                packQty: 1,
              },
            },
          },
          include: { storeVariants: true },
        }),
      migratorPrisma,
    );
    productAId = product.id;
    variantAId = product.storeVariants[0]!.id;

    const plain = await withTenant(
      storeAId,
      userAId,
      (tx) =>
        tx.storeProduct.create({
          data: {
            storeId: storeAId,
            nameAr: `خدمة ${runId}`,
            nameNorm: `خدمة ${runId}`,
            category: "خدمات وفواتير",
            unit: "piece",
            sellPricePiasters: BigInt(1500),
            isCustom: true,
          },
        }),
      migratorPrisma,
    );
    plainProductAId = plain.id;
  });

  afterAll(async () => {
    try {
      await migratorClient`DELETE FROM "sale_lines" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "sales" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "store_variants" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "store_products" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "sessions" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "store_members" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "stores" WHERE id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "users" WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await migratorClient.end();
      await migratorPrisma.$disconnect();
    }
  });

  it.fails(
    "POST with an existing variantId links the line to that variant and product",
    async () => {
      const saleId = crypto.randomUUID();
      const res = await request("POST", userAId, storeAId, {
        body: {
          id: saleId,
          variantId: variantAId,
          quantityBase: 2,
          amountPiasters: 5000,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { id: saleId } });

      const sale = await asStoreA((tx) =>
        tx.sale.findUniqueOrThrow({ where: { id: saleId } }),
      );
      expect(sale.storeId).toBe(storeAId);
      expect(sale.paymentMethod).toBe("cash");
      expect(sale.totalPiasters).toBe(BigInt(5000));

      const lines = await linesOf(saleId);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.storeVariantId).toBe(variantAId);
      expect(lines[0]!.storeProductId).toBe(productAId);
      expect(lines[0]!.quantityBaseUnits).toBe(2);
      expect(lines[0]!.unitPricePiasters).toBe(BigInt(5000));
      expect(lines[0]!.totalPiasters).toBe(BigInt(5000));
    },
  );

  it.fails(
    "POST with a productId resolves the product's first variant",
    async () => {
      const saleId = crypto.randomUUID();
      await request("POST", userAId, storeAId, {
        body: { id: saleId, productId: productAId, amountPiasters: 2500 },
      });
      const [line] = await linesOf(saleId);
      expect(line!.storeProductId).toBe(productAId);
      expect(line!.storeVariantId).toBe(variantAId);
      expect(line!.quantityBaseUnits).toBe(1); // schema default
    },
  );

  it.fails(
    "POST with only a name matches an existing product by Arabic name",
    async () => {
      const saleId = crypto.randomUUID();
      await request("POST", userAId, storeAId, {
        body: { id: saleId, name: `شاي ${runId}`, amountPiasters: 2500 },
      });
      const [line] = await linesOf(saleId);
      expect(line!.storeProductId).toBe(productAId);
    },
  );

  it.fails(
    "POST with an unknown name creates a custom product (service category when a machine is used)",
    async () => {
      const saleId = crypto.randomUUID();
      await request("POST", userAId, storeAId, {
        body: {
          id: saleId,
          name: `شحن ${runId}`,
          amountPiasters: 1000,
          machineId: "m-1",
        },
      });
      const [line] = await linesOf(saleId);
      const created = await asStoreA((tx) =>
        tx.storeProduct.findUniqueOrThrow({
          where: { id: line!.storeProductId! },
        }),
      );
      expect(created.isCustom).toBe(true);
      expect(created.category).toBe("خدمات وفواتير");
      expect(created.sellPricePiasters).toBe(BigInt(1000));
      expect(line!.storeVariantId).not.toBeNull();
    },
  );

  it("POST with a non-UUID id gets a server-generated sale id", async () => {
    const res = await request("POST", userAId, storeAId, {
      body: {
        id: "local-123",
        productId: plainProductAId,
        amountPiasters: 100,
      },
    });
    const json = await res.json();
    expect(json.data.id).not.toBe("local-123");
    expect(json.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("POST rejects a non-integer amount", async () => {
    const res = await request("POST", userAId, storeAId, {
      body: { name: "x", amountPiasters: 10.5 },
    });
    expect(res.status).toBe(400);
  });

  it("POST for a product without variants persists one product line", async () => {
    const saleId = crypto.randomUUID();
    const res = await request("POST", userAId, storeAId, {
      body: { id: saleId, productId: plainProductAId, amountPiasters: 1500 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { id: saleId } });

    const sale = await asStoreA((tx) =>
      tx.sale.findUniqueOrThrow({ where: { id: saleId } }),
    );
    expect(sale.storeId).toBe(storeAId);
    expect(sale.paymentMethod).toBe("cash");
    expect(sale.totalPiasters).toBe(BigInt(1500));
    const lines = await linesOf(saleId);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.storeProductId).toBe(plainProductAId);
    expect(lines[0]!.storeVariantId).toBeNull();
    expect(lines[0]!.quantityBaseUnits).toBe(1); // schema default
    expect(lines[0]!.unitPricePiasters).toBe(BigInt(1500));
  });

  it("GET returns only the caller's store sales, with today's totals", async () => {
    const resA = await request("GET", userAId, storeAId);
    expect(resA.status).toBe(200);
    const a = await resA.json();
    expect(a.sales.length).toBeGreaterThanOrEqual(2);
    expect(a.todayCount).toBe(a.todaySales.length);
    expect(a.todayTotalPiasters).toBe(
      (a.todaySales as Array<{ amountPiasters: number }>).reduce(
        (s, x) => s + x.amountPiasters,
        0,
      ),
    );
    const plainSale = (
      a.sales as Array<{ name: string; productId: string }>
    ).find((s) => s.productId === plainProductAId);
    expect(plainSale?.name).toBe(`خدمة ${runId}`);

    const resB = await request("GET", userBId, storeBId);
    const b = await resB.json();
    expect(b.sales).toEqual([]);
    expect(b.todayTotalPiasters).toBe(0);
  });

  // KNOWN DEFECT (pending owner decision): the route hard-deletes on undo, but the
  // app DB role has no DELETE grant on `sales` (append-only, AGENTS.md rule 6), so
  // every undo fails with 500 and the sale is kept. The correct fix is a reversing
  // `sale.void`, not granting DELETE.
  it("DELETE (undo) is refused by the append-only grants for every store, and the sale survives", async () => {
    const saleId = crypto.randomUUID();
    await request("POST", userAId, storeAId, {
      body: { id: saleId, productId: plainProductAId, amountPiasters: 1500 },
    });
    const countSale = () =>
      asStoreA((tx) => tx.sale.count({ where: { id: saleId } }));

    const cross = await request("DELETE", userBId, storeBId, {
      query: `?id=${saleId}`,
    });
    expect(cross.status).toBe(500);
    expect(await countSale()).toBe(1);

    const own = await request("DELETE", userAId, storeAId, {
      query: `?id=${saleId}`,
    });
    expect(own.status).toBe(500);
    expect(await countSale()).toBe(1);
    expect(await linesOf(saleId)).toHaveLength(1);
  });

  it("DELETE without an id is a 400", async () => {
    const res = await request("DELETE", userAId, storeAId);
    expect(res.status).toBe(400);
  });
});
