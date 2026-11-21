/**
 * The database built by the migrations and schema.prisma must describe the same schema
 * (production readiness): otherwise the next `prisma migrate dev` silently generates a migration
 * that drops what the migrations created (indexes, tenant-safety foreign keys).
 *
 * The ONE allowed difference is a constraint Prisma cannot express: the composite
 * `waste_records_sale_return_fkey` with `ON DELETE SET NULL (sale_return_id)` (see schema.prisma).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

const url =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

describe("schema.prisma ⇄ migrations", () => {
  it("has no drift except the documented composite foreign key", () => {
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
        ],
        { encoding: "utf8", env: { ...process.env, HESBA_DIRECT_URL: url } },
      );
    } catch (err) {
      out = String((err as { stdout?: string }).stdout ?? err);
    }
    const changes = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\[[*+-]\]/.test(l));
    expect(changes).toEqual([
      "[*] Changed the `waste_records` table",
      "[-] Removed foreign key on columns (store_id, sale_return_id)",
    ]);
  }, 60_000);
});
