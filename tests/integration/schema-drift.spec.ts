/**
 * The database built by the migrations and schema.prisma must describe the same schema
 * (production readiness): otherwise the next `prisma migrate dev` silently generates a migration
 * that drops what the migrations created (indexes, tenant-safety foreign keys).
 *
 * Allowed differences, by name:
 * - a constraint Prisma cannot express: the composite `waste_records_sale_return_fkey` with
 *   `ON DELETE SET NULL (sale_return_id)` (see schema.prisma);
 * - in databases where the abandoned `feat/physical-stocktaking` branch once ran its migration
 *   (`20261122000000_physical_stocktaking`, never merged): its `stocktake_items` /
 *   `stocktake_sessions` tables and `stocktake_*` enums. Stocktaking lives in `inventory_counts`;
 *   those leftovers are unused and are not dropped by any migration (no data is deleted).
 *   A fresh database (CI) has none of them.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

const url =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

const ALLOWED = [
  /^ALTER TABLE "waste_records" DROP CONSTRAINT "waste_records_sale_return_fkey";$/,
  /^ALTER TABLE "stocktake_(items|sessions)" DROP CONSTRAINT "stocktake_[a-z_]+";$/,
  /^DROP TABLE "stocktake_(items|sessions)";$/,
  /^DROP TYPE "stocktake_[a-z_]+";$/,
];

describe("schema.prisma ⇄ migrations", () => {
  it("has no drift except the documented, named differences", () => {
    let out = "";
    try {
      out = execFileSync(
        "npx",
        [
          "prisma",
          "migrate",
          "diff",
          "--from-url",
          url,
          "--to-schema-datamodel",
          "prisma/schema.prisma",
          "--script",
        ],
        { encoding: "utf8", env: { ...process.env, HESBA_DIRECT_URL: url } },
      );
    } catch (err) {
      out = String((err as { stdout?: string }).stdout ?? err);
    }
    const statements = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^(ALTER|CREATE|DROP|COMMENT)\b/.test(l));
    const unexpected = statements.filter(
      (s) => !ALLOWED.some((re) => re.test(s)),
    );
    expect(unexpected).toEqual([]);
    // The waste FK is always reported: proves the diff really ran.
    expect(statements).toContain(
      'ALTER TABLE "waste_records" DROP CONSTRAINT "waste_records_sale_return_fkey";',
    );
  }, 60_000);
});
