#!/usr/bin/env tsx
/**
 * Reconciliation script: Recompute Stock Levels from Append-Only Movements History.
 *
 * Usage:
 *   pnpm exec tsx scripts/recompute-stock.ts
 *   pnpm exec tsx scripts/recompute-stock.ts --store <storeId>
 *   pnpm exec tsx scripts/recompute-stock.ts --repair (or --apply)
 *
 * Invariant verified:
 *   stock_levels.quantity_base === SUM(stock_movements.quantity_base)
 */

import postgres from "postgres";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  process.env["DIRECT_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

interface DiscrepancyReport {
  storeId: string;
  storeVariantId: string;
  cachedBalance: bigint;
  computedBalance: bigint;
  difference: bigint;
  movementCount: number;
}

async function main() {
  const args = process.argv.slice(2);
  const isRepair = args.includes("--repair") || args.includes("--apply");
  const storeIndex = args.indexOf("--store");
  const targetStoreId = storeIndex !== -1 ? args[storeIndex + 1] : null;

  console.log("=================================================");
  console.log("   حسبة — Stock Reconciliation & Audit Tool     ");
  console.log("=================================================");
  console.log(
    `Mode: ${isRepair ? "REPAIR (--apply)" : "PREVIEW / AUDIT (dry-run)"}`,
  );
  if (targetStoreId) {
    console.log(`Target Store: ${targetStoreId}`);
  }
  console.log("Connecting to PostgreSQL...");

  const sql = postgres(directUrl, { max: 2 });

  try {
    // 1. Fetch stores to inspect
    const stores = targetStoreId
      ? await sql<Array<{ id: string; name: string }>>`
          SELECT id, name FROM stores WHERE id = ${targetStoreId}::uuid
        `
      : await sql<Array<{ id: string; name: string }>>`
          SELECT id, name FROM stores ORDER BY created_at ASC
        `;

    if (stores.length === 0) {
      console.log("No matching stores found.");
      await sql.end();
      process.exit(0);
    }

    console.log(`Auditing ${stores.length} store(s)...\n`);

    const discrepancies: DiscrepancyReport[] = [];
    let totalVariantsAudited = 0;

    for (const store of stores) {
      // Find all variants in this store
      const variants = await sql<Array<{ id: string }>>`
        SELECT id FROM store_variants WHERE store_id = ${store.id}::uuid
      `;

      for (const variant of variants) {
        totalVariantsAudited++;

        // 1. Get cached level
        const [cached] = await sql<Array<{ quantity_base: string }>>`
          SELECT quantity_base FROM stock_levels
          WHERE store_id = ${store.id}::uuid AND store_variant_id = ${variant.id}::uuid
        `;

        const cachedBalance = cached ? BigInt(cached.quantity_base) : BigInt(0);

        // 2. Compute balance from append-only movement history
        const [computedRow] = await sql<
          Array<{ sum: string | null; count: string }>
        >`
          SELECT
            COALESCE(SUM(quantity_base), 0) AS sum,
            COUNT(*) AS count
          FROM stock_movements
          WHERE store_id = ${store.id}::uuid AND store_variant_id = ${variant.id}::uuid
        `;

        const computedBalance = BigInt(computedRow?.sum ?? 0);
        const movementCount = parseInt(computedRow?.count ?? "0", 10);

        if (cachedBalance !== computedBalance) {
          discrepancies.push({
            storeId: store.id,
            storeVariantId: variant.id,
            cachedBalance,
            computedBalance,
            difference: computedBalance - cachedBalance,
            movementCount,
          });

          if (isRepair) {
            await sql`
              INSERT INTO stock_levels (store_id, store_variant_id, quantity_base, updated_at)
              VALUES (${store.id}::uuid, ${variant.id}::uuid, ${computedBalance.toString()}::bigint, NOW())
              ON CONFLICT (store_id, store_variant_id)
              DO UPDATE SET quantity_base = ${computedBalance.toString()}::bigint, updated_at = NOW();
            `;
          }
        }
      }
    }

    console.log(`Total Variants Audited: ${totalVariantsAudited}`);
    console.log(`Total Discrepancies Found: ${discrepancies.length}`);

    if (discrepancies.length > 0) {
      console.log("\n⚠️ DISCREPANCY DETAILS:");
      for (const d of discrepancies) {
        console.log(
          `  - Store: ${d.storeId} | Variant: ${d.storeVariantId} | Cached: ${d.cachedBalance} | Computed: ${d.computedBalance} (Diff: ${d.difference > BigInt(0) ? "+" : ""}${d.difference}) [Movements: ${d.movementCount}]`,
        );
      }

      if (isRepair) {
        console.log(
          "\n✅ All discrepancies successfully repaired to match movement history!",
        );
        await sql.end();
        process.exit(0);
      } else {
        console.log("\n❌ Audit failed: Mismatches detected in dry-run mode.");
        console.log(
          "Run with --repair to synchronize stock_levels with movement history.",
        );
        await sql.end();
        process.exit(1);
      }
    } else {
      console.log(
        "\n✅ All stock levels match append-only movement history perfectly (100% Invariant Hold).",
      );
      await sql.end();
      process.exit(0);
    }
  } catch (err) {
    console.error("Reconciliation failed with error:", err);
    await sql.end();
    process.exit(1);
  }
}

void main();
