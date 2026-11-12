import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * QA-09 / QA-10 guards (ADR-0022): the Sales screen's recorded sales come only from the
 * server, and undo is the server's void — never a local list, never a delete, never a local
 * stock change before the server confirmed it.
 */
const source = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../../src/client/features/sales/SalesView.tsx",
  ),
  "utf8",
);

describe("Sales screen — the server is the only source of recorded sales", () => {
  it("never reads or writes a local copy of the sales list", () => {
    expect(source).not.toMatch(/localStorage\.getItem\([^)]*[Ss]ales/);
    expect(source).not.toMatch(/localStorage\.setItem\([^)]*[Ss]ales/);
    expect(source).not.toMatch(/setItem\(\s*getSalesStorageKey/);
  });

  it("today's total and count are the server's, not summed on the device", () => {
    expect(source).toMatch(/salesOverview\?\.todayTotalPiasters/);
    expect(source).toMatch(/salesOverview\?\.todayCount/);
    expect(source).not.toMatch(
      /sales\.filter\(\(s\) => new Date\(s\.timestamp\)/,
    );
  });

  it("undo is the server's void, not a delete or a local stock change", () => {
    expect(source).not.toMatch(/method:\s*"DELETE"[\s\S]{0,80}\/api\/sales/);
    expect(source).not.toMatch(/\/api\/sales\?id=/);
    expect(source).toMatch(/await voidSale\(/);
  });
});
