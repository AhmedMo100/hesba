import { describe, expect, it } from "vitest";
import { calculateCommission } from "@/domain/commission";
import {
  MOCK_COMMISSION_RULES,
  OVERLAPPING_COMMISSION_RULES,
} from "../../fixtures/commission-rules.fixture";

describe("domain/commission - rule-based financial service fee calculation", () => {
  describe("Exact Boundary Testing", () => {
    it("matches exact lower boundary of tier 1 (fromAmountPiasters = 100)", () => {
      const result = calculateCommission({
        provider: "vodafone",
        kind: "transfer",
        amountPiasters: 100,
        rules: MOCK_COMMISSION_RULES,
      });

      expect(result.ruleId).toBe("rule-vf-transfer-t1");
      expect(result.feePiasters).toBe(100); // Fixed 100 piasters
    });

    it("matches exact upper boundary of tier 1 (toAmountPiasters = 50,000)", () => {
      const result = calculateCommission({
        provider: "vodafone",
        kind: "transfer",
        amountPiasters: 50000,
        rules: MOCK_COMMISSION_RULES,
      });

      expect(result.ruleId).toBe("rule-vf-transfer-t1");
      expect(result.feePiasters).toBe(100);
    });

    it("matches exact lower boundary of tier 2 (fromAmountPiasters = 50,001)", () => {
      const result = calculateCommission({
        provider: "vodafone",
        kind: "transfer",
        amountPiasters: 50001,
        rules: MOCK_COMMISSION_RULES,
      });

      expect(result.ruleId).toBe("rule-vf-transfer-t2");
      // 50,001 * 1.0% = 500.01 -> rounds to 500 piasters
      expect(result.feePiasters).toBe(500);
    });

    it("matches exact upper boundary of tier 2 (toAmountPiasters = 200,000)", () => {
      const result = calculateCommission({
        provider: "vodafone",
        kind: "transfer",
        amountPiasters: 200000,
        rules: MOCK_COMMISSION_RULES,
      });

      expect(result.ruleId).toBe("rule-vf-transfer-t2");
      // 200,000 * 1.0% = 2,000 piasters
      expect(result.feePiasters).toBe(2000);
    });

    it("matches exact lower boundary of tier 3 (fromAmountPiasters = 200,001)", () => {
      const result = calculateCommission({
        provider: "vodafone",
        kind: "transfer",
        amountPiasters: 200001,
        rules: MOCK_COMMISSION_RULES,
      });

      expect(result.ruleId).toBe("rule-vf-transfer-t3");
      expect(result.feePiasters).toBe(3000); // Fixed 3,000 piasters
    });

    it("matches exact upper boundary of tier 3 (toAmountPiasters = 1,000,000)", () => {
      const result = calculateCommission({
        provider: "vodafone",
        kind: "transfer",
        amountPiasters: 1000000,
        rules: MOCK_COMMISSION_RULES,
      });

      expect(result.ruleId).toBe("rule-vf-transfer-t3");
      expect(result.feePiasters).toBe(3000);
    });
  });

  describe("Gap Detection", () => {
    it("throws a clear error when amount is below lowest configured range (amount = 50 < 100)", () => {
      expect(() =>
        calculateCommission({
          provider: "vodafone",
          kind: "transfer",
          amountPiasters: 50,
          rules: MOCK_COMMISSION_RULES,
        }),
      ).toThrowError(/gap/i);
    });

    it("throws a clear error when amount is above highest configured range (amount = 1,000,001 > 1,000,000)", () => {
      expect(() =>
        calculateCommission({
          provider: "vodafone",
          kind: "transfer",
          amountPiasters: 1000001,
          rules: MOCK_COMMISSION_RULES,
        }),
      ).toThrowError(/gap/i);
    });

    it("throws a gap error if an unknown provider or kind is requested", () => {
      expect(() =>
        calculateCommission({
          provider: "non-existent-provider",
          kind: "transfer",
          amountPiasters: 5000,
          rules: MOCK_COMMISSION_RULES,
        }),
      ).toThrowError(/gap/i);
    });
  });

  describe("Overlap Detection", () => {
    it("throws an error when an amount falls into multiple overlapping rules and does not guess", () => {
      // Amount 4,000 falls in both [100, 5000] and [3000, 10000]
      expect(() =>
        calculateCommission({
          provider: "test-provider",
          kind: "transfer",
          amountPiasters: 4000,
          rules: OVERLAPPING_COMMISSION_RULES,
        }),
      ).toThrowError(/overlap/i);
    });
  });

  describe("Percentage Rounding & Fixed Fee Zero", () => {
    it("handles zero fee correctly (e.g. promotional 0 fee tier)", () => {
      const result = calculateCommission({
        provider: "instapay",
        kind: "transfer",
        amountPiasters: 50000,
        rules: MOCK_COMMISSION_RULES,
      });

      expect(result.ruleId).toBe("rule-instapay-transfer-t1");
      expect(result.feePiasters).toBe(0);
    });

    it("calculates percentage fee with proper integer piaster rounding", () => {
      // Amount: 150,000 piasters (1,500 EGP) at 0.5% = 750 piasters (7.50 EGP)
      const result = calculateCommission({
        provider: "instapay",
        kind: "transfer",
        amountPiasters: 150000,
        rules: MOCK_COMMISSION_RULES,
      });

      expect(result.ruleId).toBe("rule-instapay-transfer-t2");
      expect(result.feePiasters).toBe(750);
    });
  });
});
