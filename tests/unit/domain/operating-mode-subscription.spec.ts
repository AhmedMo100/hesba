/**
 * ADR-0033 rules, pure: what each operating mode may do, and whether a shop may use Hesba now —
 * read on the server's clock (a device clock is never an input), with no "forever" for a
 * missing end date.
 */
import { describe, expect, it } from "vitest";
import {
  isOperatingMode,
  modeAllows,
  modeRefusal,
} from "@/domain/operating-mode";
import {
  TRIAL_HOURS,
  effectiveSubscription,
  storeAccessView,
} from "@/domain/subscription";
import { deriveSyncState } from "@/client/app-shell/SyncBar";

const NOW = new Date("2026-11-21T10:00:00Z");
const h = (n: number) => new Date(NOW.getTime() + n * 3600_000);

describe("operating modes", () => {
  it("the cashier only in الكاشير الذكي, the daily total only in إدارة المحل", () => {
    expect(modeAllows("pos", "posSales")).toBe(true);
    expect(modeAllows("simple", "posSales")).toBe(false);
    expect(modeAllows("simple", "dailySalesTotals")).toBe(true);
    expect(modeAllows("pos", "dailySalesTotals")).toBe(false);
    expect(modeAllows("both", "posSales")).toBe(false);
    expect(modeAllows(null, "dailySalesTotals")).toBe(false);
    expect(isOperatingMode("simple")).toBe(true);
    expect(isOperatingMode("SIMPLE")).toBe(false);
    expect(modeRefusal("posSales")).toContain("الكاشير الذكي");
  });
});

describe("the subscription, effective now", () => {
  it("a trial of 72 hours: allowed until its end, expired after (no cron needed)", () => {
    expect(TRIAL_HOURS).toBe(72);
    const trial = {
      subscriptionStatus: "trialing",
      trialEndsAt: h(72),
      subscriptionEndsAt: null,
    };
    expect(effectiveSubscription(trial, NOW)).toMatchObject({
      status: "trialing",
      allowed: true,
    });
    expect(effectiveSubscription(trial, h(71.99))).toMatchObject({
      allowed: true,
    });
    expect(effectiveSubscription(trial, h(72))).toMatchObject({
      status: "expired",
      allowed: false,
    });
  });

  it("a paid period stops on its end date", () => {
    const paid = {
      subscriptionStatus: "active",
      trialEndsAt: null,
      subscriptionEndsAt: h(24 * 30),
    };
    expect(effectiveSubscription(paid, NOW)).toMatchObject({
      status: "active",
      allowed: true,
    });
    expect(effectiveSubscription(paid, h(24 * 30 + 1))).toMatchObject({
      status: "expired",
      allowed: false,
    });
  });

  it("no end date is never 'forever'; suspended and expired stop; an unknown status stops", () => {
    expect(
      effectiveSubscription(
        {
          subscriptionStatus: "active",
          trialEndsAt: null,
          subscriptionEndsAt: null,
        },
        NOW,
      ).allowed,
    ).toBe(false);
    expect(
      effectiveSubscription(
        {
          subscriptionStatus: "trialing",
          trialEndsAt: null,
          subscriptionEndsAt: null,
        },
        NOW,
      ).allowed,
    ).toBe(false);
    expect(
      effectiveSubscription(
        {
          subscriptionStatus: "suspended",
          trialEndsAt: h(10),
          subscriptionEndsAt: h(10),
        },
        NOW,
      ),
    ).toMatchObject({ status: "suspended", allowed: false });
    expect(
      effectiveSubscription(
        {
          subscriptionStatus: "expired",
          trialEndsAt: h(10),
          subscriptionEndsAt: h(10),
        },
        NOW,
      ).allowed,
    ).toBe(false);
    expect(
      effectiveSubscription(
        {
          subscriptionStatus: "lifetime",
          trialEndsAt: null,
          subscriptionEndsAt: h(10),
        },
        NOW,
      ).allowed,
    ).toBe(false);
  });

  it("the client view carries the server's own time (checkedAt), never the device's", () => {
    const v = storeAccessView(
      {
        operatingMode: "simple",
        subscriptionStatus: "trialing",
        subscriptionPlan: null,
        trialStartedAt: NOW,
        trialEndsAt: h(72),
        subscriptionStartedAt: null,
        subscriptionEndsAt: null,
      },
      NOW,
    );
    expect(v).toMatchObject({
      operatingMode: "simple",
      subscription: {
        status: "trialing",
        allowed: true,
        endsAt: h(72).toISOString(),
        checkedAt: NOW.toISOString(),
      },
    });
  });

  it("the sync bar says the account needs activation when a queued sale got 402", () => {
    expect(
      deriveSyncState({
        online: true,
        sessionExpired: false,
        queue: [{ status: "pending", last_status: 402 }],
      }),
    ).toEqual({ state: "subscription", pendingCount: 1 });
  });
});
