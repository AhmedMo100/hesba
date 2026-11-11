/**
 * Shared real-Postgres fixtures for the sale tests (ADR-0019): two stores, products with
 * stock, requests through the real `/api/sales` route with a real session (app role, RLS
 * enforced), and readers for the authoritative stock state (level, batches, movements).
 */
import postgres from "postgres";
import { PrismaClient, type Prisma } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { createSession } from "@/server/modules/auth";
import { InventoryService } from "@/server/modules/inventory";
import {
  GET as listSalesRoute,
  POST as postSaleRoute,
} from "@/app/api/sales/route";
import { POST as voidSaleRoute } from "@/app/api/sales/void/route";

export const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

export type Json = Record<string, unknown>;

export interface Shop {
  storeId: string;
  userId: string;
}

export interface ProductRef {
  productId: string;
  variantId: string;
}

export class SaleFixtures {
  readonly migratorPrisma = new PrismaClient({
    datasources: { db: { url: directUrl } },
  });
  readonly sql = postgres(directUrl, { max: 1 });
  readonly runId = Math.random().toString(36).slice(2, 8);
  readonly shopA: Shop = {
    storeId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  };
  readonly shopB: Shop = {
    storeId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  };
  private readonly inventory = new InventoryService(appPrisma);
  private readonly tokens = new Map<string, string>();

  async setup(): Promise<void> {
    await this.migratorPrisma.$connect();
    let n = 0;
    for (const shop of [this.shopA, this.shopB]) {
      n += 1;
      await this.migratorPrisma.user.create({
        data: {
          id: shop.userId,
          name: `بائع ${n} ${this.runId}`,
          phone: `+2015${n}${this.runId}`,
          email: `sale-${n}-${this.runId}@hesba.test`,
          passwordHash: "mockhash",
        },
      });
      await withTenant(
        shop.storeId,
        shop.userId,
        async (tx) => {
          await tx.store.create({
            data: {
              id: shop.storeId,
              name: `محل بيع ${n} ${this.runId}`,
              shopType: "supermarket",
              governorate: "Cairo",
              createdBy: shop.userId,
            },
          });
          await tx.storeMember.create({
            data: { storeId: shop.storeId, userId: shop.userId, role: "owner" },
          });
        },
        this.migratorPrisma,
      );
    }
  }

  async teardown(): Promise<void> {
    const ids = [this.shopA.storeId, this.shopB.storeId];
    const sql = this.sql;
    try {
      await sql`DELETE FROM "stock_movements" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "stock_levels" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "waste_records" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "store_stock_batches" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "sale_voids" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "sale_lines" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "sales" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "store_variants" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "store_products" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "sessions" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "store_members" WHERE store_id IN ${sql(ids)}`;
      await sql`DELETE FROM "stores" WHERE id IN ${sql(ids)}`;
      await sql`DELETE FROM "users" WHERE id IN ${sql([this.shopA.userId, this.shopB.userId])}`;
    } finally {
      await sql.end();
      await this.migratorPrisma.$disconnect();
    }
  }

  as<T>(shop: Shop, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return withTenant(shop.storeId, shop.userId, fn, this.migratorPrisma);
  }

  /** A product with one variant; `sell`/`buy` are piasters per selling unit. */
  async product(
    shop: Shop,
    data: {
      name: string;
      unit?: string;
      sell: number;
      buy?: number;
      category?: string;
      isActive?: boolean;
      withVariant?: boolean;
    },
  ): Promise<ProductRef> {
    return this.as(shop, async (tx) => {
      const p = await tx.storeProduct.create({
        data: {
          storeId: shop.storeId,
          nameAr: `${data.name} ${this.runId}`,
          nameNorm: `${data.name} ${this.runId}`,
          category: data.category ?? "مشروبات",
          unit: data.unit ?? "piece",
          sellPricePiasters: BigInt(data.sell),
          buyPricePiasters: BigInt(data.buy ?? 0),
          isCustom: true,
          isActive: data.isActive ?? true,
          ...(data.withVariant === false
            ? {}
            : {
                storeVariants: {
                  create: {
                    storeId: shop.storeId,
                    packQty: 1,
                    sellPricePiasters: BigInt(data.sell),
                    buyPricePiasters: BigInt(data.buy ?? 0),
                  },
                },
              }),
        },
        include: { storeVariants: true },
      });
      return { productId: p.id, variantId: p.storeVariants[0]?.id ?? "" };
    });
  }

  /** Adds a stock batch through the real inventory service. */
  async addStock(
    shop: Shop,
    variantId: string,
    qty: number,
    opts: {
      expiry?: string;
      /** Total paid for the batch (default 1.00 per unit). */ cost?: number;
    } = {},
  ) {
    return this.inventory.addStockBatch(shop.storeId, shop.userId, {
      storeVariantId: variantId,
      receivedQuantityBase: qty,
      costTotalMinor: opts.cost ?? 100 * qty, // total paid (ADR-0021)
      expiryDate: opts.expiry ?? null,
    });
  }

  adjust(shop: Shop, variantId: string, delta: number) {
    return this.inventory.adjustStockQuantity(shop.storeId, shop.userId, {
      storeVariantId: variantId,
      mode: "delta",
      deltaQuantityBase: delta,
    });
  }

  private async token(shop: Shop): Promise<string> {
    const cached = this.tokens.get(shop.storeId);
    if (cached) return cached;
    const session = await createSession(shop.userId, shop.storeId);
    this.tokens.set(shop.storeId, session.rawToken);
    return session.rawToken;
  }

  async request(
    shop: Shop,
    method: "GET" | "POST",
    body?: unknown,
    query = "",
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: Json }> {
    const req = new Request(`http://localhost:3000/api/sales${query}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${await this.token(shop)}`,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const handler = method === "GET" ? listSalesRoute : postSaleRoute;
    const res = await handler(req);
    return { status: res.status, json: (await res.json()) as Json };
  }

  /** POST /api/sales/void (ADR-0022). */
  async void(shop: Shop, body: Json): Promise<{ status: number; json: Json }> {
    const res = await voidSaleRoute(
      new Request("http://localhost:3000/api/sales/void", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${await this.token(shop)}`,
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as Json };
  }

  /** POST /api/sales for an ordinary product. */
  sell(shop: Shop, variantId: string, quantityBase: number, extra: Json = {}) {
    return this.request(shop, "POST", {
      variantId,
      quantityBase,
      opId: crypto.randomUUID(),
      ...extra,
    });
  }

  /** The authoritative stock state of one variant. */
  async stockState(shop: Shop, variantId: string) {
    return this.as(shop, async (tx) => {
      const level = await tx.stockLevel.findUnique({
        where: {
          storeId_storeVariantId: {
            storeId: shop.storeId,
            storeVariantId: variantId,
          },
        },
      });
      const batches = await tx.storeStockBatch.findMany({
        where: { storeId: shop.storeId, storeVariantId: variantId },
        orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
      });
      const movements = await tx.stockMovement.findMany({
        where: { storeId: shop.storeId, storeVariantId: variantId },
        orderBy: { createdAt: "asc" },
      });
      return {
        level: Number(level?.quantityBase ?? 0),
        batchesRemaining: batches.reduce(
          (s, b) => s + Number(b.remainingQuantityBase),
          0,
        ),
        batches: batches.map((b) => Number(b.remainingQuantityBase)),
        movementsSum: movements.reduce((s, m) => s + Number(m.quantityBase), 0),
        movements: movements.map((m) => ({
          type: m.type,
          quantity: Number(m.quantityBase),
          balanceAfter: Number(m.balanceAfterBase ?? 0),
          saleLineId: m.saleLineId,
          negative: m.negative,
        })),
      };
    });
  }

  async salesOf(shop: Shop) {
    return this.as(shop, (tx) =>
      tx.sale.findMany({
        where: { storeId: shop.storeId },
        include: { saleLines: true, saleVoid: true },
        orderBy: { createdAt: "asc" },
      }),
    );
  }
}
