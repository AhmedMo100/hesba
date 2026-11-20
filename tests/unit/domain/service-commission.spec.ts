import { describe, expect, it } from "vitest";
import {
  commissionRuleErrors,
  serviceCommission,
  type ServiceCommissionRule,
} from "@/domain/service-commission";
import { serviceCommissionRuleSchema } from "@/schemas/sales-config";

const tiers: ServiceCommissionRule = {
  type: "fixed",
  value: 300, // 3 ج outside the tiers
  tiers: [
    { fromPiasters: 10000, toPiasters: 100000, type: "fixed", value: 500 },
    { fromPiasters: 100000, toPiasters: 500000, type: "fixed", value: 1000 },
    { fromPiasters: 500000, toPiasters: 1000000, type: "percent", value: 0.2 },
  ],
};

describe("service commission", () => {
  it("fixed and percent", () => {
    expect(
      serviceCommission({ type: "fixed", value: 500, tiers: [] }, 70000),
    ).toBe(500);
    expect(
      serviceCommission({ type: "percent", value: 1.5, tiers: [] }, 20000),
    ).toBe(300);
  });

  it("tiers: from ≤ amount < to, the top of the last tier included, outside → base", () => {
    expect(serviceCommission(tiers, 10000)).toBe(500);
    expect(serviceCommission(tiers, 99999)).toBe(500);
    expect(serviceCommission(tiers, 100000)).toBe(1000); // 1000 ج → the second tier
    expect(serviceCommission(tiers, 700000)).toBe(1400); // 0.2% of 7000 ج
    expect(serviceCommission(tiers, 1000000)).toBe(2000); // the top is included
    expect(serviceCommission(tiers, 5000)).toBe(300); // under every tier → base
    expect(serviceCommission(tiers, 2000000)).toBe(300);
  });

  it("refuses overlaps, a top under the bottom and negative commissions", () => {
    expect(commissionRuleErrors(tiers)).toEqual([]);
    const bad: ServiceCommissionRule = {
      type: "fixed",
      value: -1,
      tiers: [
        { fromPiasters: 10000, toPiasters: 100000, type: "fixed", value: 500 },
        { fromPiasters: 50000, toPiasters: 200000, type: "fixed", value: 500 },
        { fromPiasters: 300000, toPiasters: 200000, type: "percent", value: 1 },
        {
          fromPiasters: 400000,
          toPiasters: 450000,
          type: "percent",
          value: 150,
        },
      ],
    };
    const errors = commissionRuleErrors(bad).join(" | ");
    expect(errors).toContain("العمولة مينفعش تبقى سالبة");
    expect(errors).toContain("داخلين في بعض");
    expect(errors).toContain("الحد الأعلى لازم يكون أكبر من الحد الأدنى");
    expect(errors).toContain("100% أو أقل");
  });

  it("the settings schema rejects an invalid rule (400, nothing saved)", () => {
    expect(serviceCommissionRuleSchema.safeParse(tiers).success).toBe(true);
    expect(
      serviceCommissionRuleSchema.safeParse({
        ...tiers,
        tiers: [tiers.tiers[0], { ...tiers.tiers[0], fromPiasters: 50000 }],
      }).success,
    ).toBe(false);
  });
});

describe("slabs only (the service form)", () => {
  const rule = {
    type: "fixed" as const,
    value: 0,
    tiers: [
      {
        fromPiasters: 10000,
        toPiasters: 100000,
        type: "fixed" as const,
        value: 500,
      },
      {
        fromPiasters: 100000,
        toPiasters: 1000000,
        type: "percent" as const,
        value: 2,
      },
    ],
  };

  it("picks the slab of the amount and its commission", async () => {
    const { slabFor } = await import("@/domain/service-commission");
    expect(slabFor(rule, 75000)).toEqual({
      tier: rule.tiers[0],
      piasters: 500,
    });
    expect(slabFor(rule, 100000)?.piasters).toBe(2000);
    expect(slabFor(rule, 1000000)?.piasters).toBe(20000);
  });

  it("an amount outside every slab has no commission (the sale is refused)", async () => {
    const { slabFor } = await import("@/domain/service-commission");
    expect(slabFor(rule, 5000)).toBeUndefined();
    expect(slabFor(rule, 1000001)).toBeUndefined();
  });

  it("an older rule without slabs still applies to every amount", async () => {
    const { slabFor, legacyCommissionRule } =
      await import("@/domain/service-commission");
    expect(slabFor(legacyCommissionRule(500), 123456)).toEqual({
      tier: null,
      piasters: 500,
    });
  });

  it("refuses no slab, a repeated range, a bad percentage", async () => {
    const { commissionRuleErrors } =
      await import("@/domain/service-commission");
    expect(
      commissionRuleErrors({ ...rule, tiers: [] }, { slabsRequired: true }),
    ).toContain("ضيف شريحة واحدة على الأقل");
    expect(
      commissionRuleErrors({
        ...rule,
        tiers: [rule.tiers[0]!, rule.tiers[0]!],
      }).join(),
    ).toContain("نفس المدى");
    expect(
      commissionRuleErrors({
        ...rule,
        tiers: [{ ...rule.tiers[1]!, value: 150 }],
      }).join(),
    ).toContain("100%");
  });

  it("describes a slab: «100 → 1000: 5 ج» / «1000 → 10000: 2%»", async () => {
    const { describeSlab } = await import("@/domain/service-commission");
    expect(describeSlab(rule.tiers[0]!)).toBe("100 → 1000: 5 ج");
    expect(describeSlab(rule.tiers[1]!)).toBe("1000 → 10000: 2%");
  });
});
