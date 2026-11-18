/**
 * @file service-commission.ts
 * @description The shop's commission on a service (a transfer, a bill, a top-up): a fixed
 * amount or a percentage of the operation, optionally by tiers of the operation's amount
 * («من 100 لحد 1000 → 5 جنيه»). Pure and unit-tested.
 *
 * Tiers are half-open — `from ≤ amount < to` — so 100–1000 and 1000–5000 do not overlap and
 * 1000 belongs to the second; the top of the highest tier is included. An amount outside every
 * tier takes the base commission. Money is integer piasters; a percentage is a plain number
 * (1.5 = 1.5%).
 */

export type CommissionType = "fixed" | "percent";

export interface CommissionTier {
  fromPiasters: number;
  toPiasters: number;
  type: CommissionType;
  /** Piasters for "fixed", a percentage for "percent". */
  value: number;
}

export interface ServiceCommissionRule {
  type: CommissionType;
  value: number;
  tiers: CommissionTier[];
}

export const MAX_PERCENT = 100;

/** Arabic problems with a rule; empty when it is valid. */
export function commissionRuleErrors(rule: ServiceCommissionRule): string[] {
  const errors: string[] = [];
  const checkValue = (type: CommissionType, value: number, where: string) => {
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${where}: العمولة مينفعش تبقى سالبة`);
    } else if (type === "fixed" && !Number.isInteger(value)) {
      errors.push(`${where}: العمولة لازم تكون بالقروش`);
    } else if (type === "percent" && value > MAX_PERCENT) {
      errors.push(`${where}: النسبة لازم تكون ${MAX_PERCENT}% أو أقل`);
    }
  };
  checkValue(rule.type, rule.value, "العمولة");
  rule.tiers.forEach((t, i) => {
    const where = `الشريحة ${i + 1}`;
    if (
      !Number.isInteger(t.fromPiasters) ||
      !Number.isInteger(t.toPiasters) ||
      t.fromPiasters < 0
    ) {
      errors.push(`${where}: الحدود لازم تكون مبالغ صحيحة`);
    } else if (t.toPiasters <= t.fromPiasters) {
      errors.push(`${where}: الحد الأعلى لازم يكون أكبر من الحد الأدنى`);
    }
    checkValue(t.type, t.value, where);
  });
  const sorted = [...rule.tiers]
    .map((t, i) => ({ ...t, i }))
    .sort((a, b) => a.fromPiasters - b.fromPiasters);
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1]!;
    const cur = sorted[k]!;
    if (cur.fromPiasters < prev.toPiasters) {
      errors.push(`الشريحة ${prev.i + 1} والشريحة ${cur.i + 1} داخلين في بعض`);
    }
  }
  return errors;
}

/** The tier this amount falls in, if any. */
export function tierFor(
  rule: ServiceCommissionRule,
  amountPiasters: number,
): CommissionTier | undefined {
  const top = Math.max(...rule.tiers.map((t) => t.toPiasters), 0);
  return rule.tiers.find(
    (t) =>
      amountPiasters >= t.fromPiasters &&
      (amountPiasters < t.toPiasters ||
        (amountPiasters === t.toPiasters && t.toPiasters === top)),
  );
}

/** The commission, in piasters, on an operation of `amountPiasters`. */
export function serviceCommission(
  rule: ServiceCommissionRule,
  amountPiasters: number,
): number {
  const r = tierFor(rule, amountPiasters) ?? rule;
  if (r.type === "fixed") return Math.max(0, Math.round(r.value));
  return Math.max(0, Math.round((amountPiasters * r.value) / 100));
}

/** A service saved before rules existed: its price was the fixed commission. */
export function legacyCommissionRule(
  sellPricePiasters: number,
): ServiceCommissionRule {
  return { type: "fixed", value: Math.max(0, sellPricePiasters), tiers: [] };
}

/** «5 ج» / «1.5%» / «بالشرائح» — the rule in a few words (EGP from piasters). */
export function describeCommission(rule: ServiceCommissionRule): string {
  const one = (type: CommissionType, value: number) =>
    type === "fixed"
      ? `${Number((value / 100).toFixed(2))} ج`
      : `${Number(value.toFixed(2))}%`;
  return rule.tiers.length > 0
    ? `${rule.tiers.length} شرائح · غير كده ${one(rule.type, rule.value)}`
    : one(rule.type, rule.value);
}
