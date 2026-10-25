import { assertIntegerPiasters } from "./money";

export interface CommissionRule {
  id: string;
  provider: string;
  kind: string; // e.g. 'transfer', 'bill'
  fromAmountPiasters: number;
  toAmountPiasters: number;
  feeType: "fixed" | "percent";
  feeValue: number; // integer piasters if fixed, or percentage number if percent
}

export interface CalculateCommissionParams {
  kind: string;
  provider: string;
  amountPiasters: number;
  rules: CommissionRule[];
}

export interface CommissionResult {
  feePiasters: number;
  ruleId: string;
}

/**
 * Calculates financial service commission based on active configured rules.
 *
 * Rules:
 * - Ranges are INCLUSIVE: `fromAmountPiasters <= amount <= toAmountPiasters`.
 * - If multiple matching rules cover the amount -> Overlap error.
 * - If no rule covers the amount -> Gap error. Do not guess.
 */
export function calculateCommission({
  kind,
  provider,
  amountPiasters,
  rules,
}: CalculateCommissionParams): CommissionResult {
  assertIntegerPiasters(amountPiasters, "Amount");
  if (amountPiasters <= 0) {
    throw new RangeError(
      `Amount must be a positive integer in piasters, received: ${amountPiasters}`,
    );
  }

  // Filter rules for this provider and kind
  const applicableRules = rules.filter(
    (r) =>
      r.provider.toLowerCase() === provider.toLowerCase() &&
      r.kind.toLowerCase() === kind.toLowerCase(),
  );

  // Find rules where amount falls in [fromAmountPiasters, toAmountPiasters]
  const matchingRules = applicableRules.filter(
    (r) =>
      amountPiasters >= r.fromAmountPiasters &&
      amountPiasters <= r.toAmountPiasters,
  );

  // Overlap check
  if (matchingRules.length > 1) {
    const overlappingIds = matchingRules.map((r) => r.id).join(", ");
    throw new Error(
      `Commission rule overlap detected for provider "${provider}" and kind "${kind}" at amount ${amountPiasters} piasters (rules: ${overlappingIds}).`,
    );
  }

  // Gap check
  if (matchingRules.length === 0) {
    throw new Error(
      `No applicable commission rule found (gap) for provider "${provider}" and kind "${kind}" at amount ${amountPiasters} piasters.`,
    );
  }

  const rule = matchingRules[0]!;

  let feePiasters: number;
  if (rule.feeType === "fixed") {
    assertIntegerPiasters(rule.feeValue, "Fixed fee value");
    feePiasters = rule.feeValue;
  } else if (rule.feeType === "percent") {
    if (rule.feeValue < 0) {
      throw new RangeError(
        `Fee percentage cannot be negative: ${rule.feeValue}`,
      );
    }
    feePiasters = Math.round((amountPiasters * rule.feeValue) / 100);
  } else {
    throw new Error(
      `Unsupported fee type: ${(rule as CommissionRule).feeType}`,
    );
  }

  return {
    feePiasters,
    ruleId: rule.id,
  };
}
