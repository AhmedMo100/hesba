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
