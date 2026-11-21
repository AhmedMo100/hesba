/**
 * @file subscription.ts
 * @description Whether a shop may use Hesba now (ADR-0033). The stored status is what Hesba set;
 * the EFFECTIVE status also reads the dates against the server's clock, so a trial or a paid
 * period ends on time even if nothing ever updates the row (no cron is needed), and a missing
 * end date never means "forever". Pure; the server passes its own `now` — never the device's.
 *
 * - suspended → stopped, whatever the dates.
 * - active    → allowed while `subscriptionEndsAt` is in the future, else expired.
 * - trialing  → allowed while `trialEndsAt` is in the future, else expired.
 * - expired   → stopped.
 */

export const TRIAL_HOURS = 72;

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "expired",
  "suspended",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface SubscriptionFields {
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  subscriptionEndsAt: Date | null;
}

export interface EffectiveSubscription {
  /** What applies now. */
  status: SubscriptionStatus;
  /** True for trialing / active within their dates. */
  allowed: boolean;
  /** When the current access ends (trial end or paid end), null when stopped. */
  endsAt: Date | null;
}

export function effectiveSubscription(
  s: SubscriptionFields,
  now: Date,
): EffectiveSubscription {
  const t = now.getTime();
  if (s.subscriptionStatus === "active") {
    const end = s.subscriptionEndsAt;
    return end && end.getTime() > t
      ? { status: "active", allowed: true, endsAt: end }
      : { status: "expired", allowed: false, endsAt: null };
  }
  if (s.subscriptionStatus === "trialing") {
    const end = s.trialEndsAt;
    return end && end.getTime() > t
      ? { status: "trialing", allowed: true, endsAt: end }
      : { status: "expired", allowed: false, endsAt: null };
  }
  if (s.subscriptionStatus === "suspended") {
    return { status: "suspended", allowed: false, endsAt: null };
  }
  return { status: "expired", allowed: false, endsAt: null };
}

export const SUBSCRIPTION_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "فترة تجريبية",
  active: "الاشتراك مفعّل",
  expired: "انتهت الفترة",
  suspended: "الحساب موقوف",
};

/** What the client is told about the shop's access (it shows it; the server enforces it). */
export interface StoreAccessView {
  operatingMode: string;
  subscription: {
    /** The effective status, read on the server's clock. */
    status: SubscriptionStatus;
    allowed: boolean;
    plan: string | null;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    subscriptionStartedAt: string | null;
    subscriptionEndsAt: string | null;
    /** When the current access ends (trial or paid end), null when stopped. */
    endsAt: string | null;
    /** The server's time when this was read (the screen never trusts the device clock). */
    checkedAt: string;
  };
}

export function storeAccessView(
  store: SubscriptionFields & {
    operatingMode: string;
    subscriptionPlan: string | null;
    trialStartedAt: Date | null;
    subscriptionStartedAt: Date | null;
  },
  now: Date,
): StoreAccessView {
  const eff = effectiveSubscription(store, now);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    operatingMode: store.operatingMode,
    subscription: {
      status: eff.status,
      allowed: eff.allowed,
      plan: store.subscriptionPlan,
      trialStartedAt: iso(store.trialStartedAt),
      trialEndsAt: iso(store.trialEndsAt),
      subscriptionStartedAt: iso(store.subscriptionStartedAt),
      subscriptionEndsAt: iso(store.subscriptionEndsAt),
      endsAt: iso(eff.endsAt),
      checkedAt: now.toISOString(),
    },
  };
}
