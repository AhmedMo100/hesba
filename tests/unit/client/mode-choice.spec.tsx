/**
 * ADR-0033 screens: the sign-up choice starts with nothing chosen, explains both modes, and
 * marks الكاشير الذكي as the detailed one; the subscription helpers read the server's clock.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModeChoice } from "@/client/features/subscription/ModeChoice";
import {
  isAccessBlocked,
  modeOf,
  timeLeft,
} from "@/client/features/subscription/access";
import type { SessionState } from "@/client/shared/api/auth";

describe("ModeChoice", () => {
  it("nothing is chosen until the owner taps one; both modes are explained", () => {
    const html = renderToStaticMarkup(
      <ModeChoice value={null} onChange={() => {}} />,
    );
    expect(html).toContain("إدارة المحل");
    expect(html).toContain("الكاشير الذكي");
    expect(html).toContain("متابعة تفصيلية للمبيعات");
    expect(html).toContain("من غير كاشير ولا فواتير بيع");
    expect(html.match(/aria-checked="true"/g)).toBeNull();
    const chosen = renderToStaticMarkup(
      <ModeChoice value="pos" onChange={() => {}} />,
    );
    expect(chosen.match(/aria-checked="true"/g)).toHaveLength(1);
  });
});

describe("access helpers", () => {
  const session = (store: Partial<SessionState["store"]>): SessionState =>
    ({
      user: { id: "u", name: "x", phone: "", email: "" },
      store: {
        id: "s1",
        name: "x",
        shopType: "",
        governorate: "",
        openedOn: "",
        workersCount: 1,
        ...store,
      },
      expiresAt: "",
    }) as SessionState;

  it("blocked only when the server said so", () => {
    expect(isAccessBlocked(session({}))).toBe(false);
    expect(
      isAccessBlocked(
        session({
          subscription: {
            status: "expired",
            allowed: false,
            plan: null,
            trialStartedAt: null,
            trialEndsAt: null,
            subscriptionStartedAt: null,
            subscriptionEndsAt: null,
            endsAt: null,
            checkedAt: "2026-11-21T10:00:00Z",
          },
        }),
      ),
    ).toBe(true);
  });

  it("the mode comes from the session", () => {
    expect(modeOf(session({ operatingMode: "simple" }), "s1")).toBe("simple");
  });

  it("time left is measured from the server's checkedAt, not the device clock", () => {
    expect(timeLeft("2026-11-24T10:00:00Z", "2026-11-21T10:00:00Z")).toBe(
      "3 يوم",
    );
    expect(timeLeft("2026-11-21T15:30:00Z", "2026-11-21T10:00:00Z")).toBe(
      "5 ساعة",
    );
    expect(timeLeft("2026-11-21T09:00:00Z", "2026-11-21T10:00:00Z")).toBeNull();
  });
});
