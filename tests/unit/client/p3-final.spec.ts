/**
 * QA-51 (session sliding), QA-52 (alert rules) and QA-53 (offline catalog download).
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { HesbaDatabase } from "@/client/offline/db";
import { syncCatalogFully } from "@/client/offline/catalog";
import {
  buildStoreAlerts,
  getDaysUntilExpiry,
  stockLevel,
  type AlertInventoryRow,
} from "@/domain/alerts";
import { isNearExpiry } from "@/domain/stock/stock-engine";
import { slideSessionIfDue } from "@/client/shared/api/auth.real";

const DAY = 24 * 60 * 60 * 1000;

describe("QA-53 — the offline catalog downloads fully, resumes, and stays up to date", () => {
  const DB_NAME = "hesba_test_catalog_full";
  let db: HesbaDatabase;
  beforeEach(async () => {
    await Dexie.delete(DB_NAME);
    db = new HesbaDatabase(DB_NAME);
    await db.open();
  });

  const product = (id: string) => ({
    id,
    brand_id: null,
    name_ar: `منتج ${id}`,
    name_en: `Product ${id}`,
    name_norm: `منتج ${id}`,
    category: "مشروبات",
    type: "stock",
    updated_at: "2026-11-01T00:00:00.000Z",
  });
  const page = (ids: string[], cursor: string, more: boolean) =>
    new Response(
      JSON.stringify({
        brands: [],
        products: ids.map(product),
        variants: [],
        next_cursor: cursor,
        has_more: more,
      }),
      { status: 200, headers: { ETag: `W/"${cursor}"` } },
    );

  it("pulls every page, resumes from the saved cursor, never duplicates, and skips when unchanged", async () => {
    const seen: string[] = [];
    let fail = true;
    const fetchFn = vi.fn(async (url: string) => {
      const cursor = new URL(url).searchParams.get("cursor") ?? "";
      seen.push(cursor);
      if (cursor === "") return page(["a", "b"], "c1", true);
      if (cursor === "c1") {
        if (fail) throw new Error("network lost"); // interrupted download
        return page(["c"], "c2", false);
      }
      return new Response(null, { status: 204 });
    });

    const first = await syncCatalogFully(db, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(first.status).toBe("error");
    expect(await db.global_products.count()).toBe(2); // the first page is kept

    fail = false;
    const second = await syncCatalogFully(db, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(second.status).toBe("synced");
    expect(seen.slice(-1)).toEqual(["c1"]); // resumed, not restarted
    expect(await db.global_products.count()).toBe(3);

    // Up to date: one request with the last cursor, nothing rewritten.
    const third = await syncCatalogFully(db, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(third.status).toBe("up_to_date");
    expect(seen.slice(-1)).toEqual(["c2"]);
    expect(await db.global_products.count()).toBe(3);
  });

  it("runs once at a time", async () => {
    const fetchFn = vi.fn(async () => page(["x"], "k", false));
    const [a, b] = await Promise.all([
      syncCatalogFully(db, { fetchFn: fetchFn as unknown as typeof fetch }),
      syncCatalogFully(db, { fetchFn: fetchFn as unknown as typeof fetch }),
    ]);
    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("QA-52 — alert rules", () => {
  it("stock level follows the reference rule: 3 kg, two packs, 10 pieces", () => {
    expect(stockLevel("weight", 1, 0)).toBe("out");
    expect(stockLevel("weight", 1, 2999)).toBe("low");
    expect(stockLevel("weight", 1, 3000)).toBe("ok");
    // Before: weighed goods were "low" only at ≤ 5 grams.
    expect(stockLevel("weight", 1, 6)).toBe("low");
    expect(stockLevel("piece", 12, 23)).toBe("low");
    expect(stockLevel("piece", 12, 24)).toBe("ok");
    expect(stockLevel("piece", 1, 9)).toBe("low");
    expect(stockLevel("piece", 1, 10)).toBe("ok");
  });

  it("counts expiry days on the Cairo calendar, whatever the server timezone", () => {
    // 23:30 UTC on Nov 10 is already Nov 11 in Cairo (UTC+2).
    const now = new Date("2026-11-10T23:30:00Z");
    expect(getDaysUntilExpiry("2026-11-11T00:00:00.000Z", now)).toBe(0);
    expect(getDaysUntilExpiry("2026-11-10", now)).toBe(-1);
    expect(getDaysUntilExpiry("2026-11-18", now)).toBe(7);
    // The stock badge uses the same rule as the Alerts screen.
    expect(isNearExpiry(new Date("2026-11-18T00:00:00Z"), now)).toBe(true);
    expect(isNearExpiry(new Date("2026-11-19T00:00:00Z"), now)).toBe(false);
  });

  it("never suggests an offer that is not cheaper, and lists each alert once", () => {
    const row = (id: string, price: number): AlertInventoryRow => ({
      variantId: id,
      productId: `p-${id}`,
      productName: id,
      category: "x",
      unitMode: "piece",
      packQty: 1,
      sellPricePiasters: price,
      currentStockBase: 3,
      status: "low",
      batches: [
        {
          id: `b-${id}`,
          remainingQty: 3,
          costPricePiasters: 10,
          expiryDate: "2026-11-12",
        },
      ],
    });
    const a = buildStoreAlerts(
      [row("cheap", 50), row("cheap2", 50), row("tea", 2000)],
      new Date("2026-11-10T10:00:00Z"),
    );
    for (const p of a.suggestedPromotions) {
      expect(p.promoPricePiasters).toBeLessThan(p.originalPricePiasters);
    }
    const ids = [...a.lowStock, ...a.nearExpiry].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("QA-51 — the session slides by rotation", () => {
  const session = (ageMs: number, now: number) => ({
    session: {
      expiresAt: new Date(now + 30 * DAY - ageMs).toISOString(),
    },
  });

  it("rotates a session older than a day, and leaves a fresh one alone", async () => {
    const now = Date.parse("2026-11-11T10:00:00Z");
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(
      await slideSessionIfDue(
        session(2 * 60 * 60 * 1000, now),
        now,
        fetchFn as unknown as typeof fetch,
      ),
    ).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(
      await slideSessionIfDue(
        session(2 * DAY, now),
        now,
        fetchFn as unknown as typeof fetch,
      ),
    ).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("/api/auth/rotate", {
      method: "POST",
    });
  });

  it("a failed rotation changes nothing", async () => {
    const now = Date.now();
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(
      await slideSessionIfDue(
        session(5 * DAY, now),
        now,
        fetchFn as unknown as typeof fetch,
      ),
    ).toBe(false);
  });
});
