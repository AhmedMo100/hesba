/**
 * QA-37 (strict dates), QA-38 (login timing) and QA-39 (cross-site write guard) — unit level.
 */
import { describe, expect, it } from "vitest";
import {
  dummyVerifyTimingProtection,
  hashPassword,
  verifyPassword,
} from "@/server/modules/auth/password.service";
import { assertSameOriginWrite } from "@/server/modules/auth/request-guard";
import { AppError } from "@/server/platform/error";
import {
  businessDateSchema,
  expiryDateSchema,
  parseStrictDate,
} from "@/schemas/dates";

async function median(fn: () => Promise<unknown>, n = 7): Promise<number> {
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    await fn();
    t.push(performance.now() - s);
  }
  return t.sort((a, b) => a - b)[Math.floor(n / 2)]!;
}

describe("QA-38 — unknown phone costs the same as a wrong password", () => {
  it("the dummy verify does real Argon2 work (was ~0.1 ms with a malformed hash)", async () => {
    const realHash = await hashPassword("Some-real-password-2026");
    const wrong = await median(() =>
      verifyPassword(realHash, "wrong-password"),
    );
    const dummy = await median(() => dummyVerifyTimingProtection());
    expect(dummy).toBeGreaterThan(wrong * 0.5);
    expect(dummy).toBeLessThan(wrong * 2);
  });
});

describe("QA-37 — strict dates", () => {
  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseStrictDate("2026-13-45")).toBeNull();
    expect(parseStrictDate("2026-02-30")).toBeNull();
    expect(parseStrictDate("2026-02-30T10:00:00Z")).toBeNull();
    expect(parseStrictDate("not-a-date")).toBeNull();
    expect(parseStrictDate("2026-02-28")?.toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(parseStrictDate("2026-11-12T10:30:00.000Z")).not.toBeNull();
  });

  it("business dates are not in the future or before 2000; expiry may be ahead", () => {
    expect(businessDateSchema.safeParse("2099-01-01").success).toBe(false);
    expect(businessDateSchema.safeParse("1999-12-31").success).toBe(false);
    expect(businessDateSchema.safeParse("2026-01-15").success).toBe(true);
    expect(expiryDateSchema.safeParse("2030-06-30").success).toBe(true);
    expect(expiryDateSchema.safeParse("2199-01-01").success).toBe(false);
  });
});

describe("QA-39 — cross-site write guard", () => {
  const req = (
    method: string,
    headers: Record<string, string>,
    body?: string,
  ) =>
    new Request("https://hesba.example/api/expenses", {
      method,
      headers,
      body,
    });
  const status = (r: Request) => {
    try {
      assertSameOriginWrite(r);
      return 200;
    } catch (e) {
      return (e as AppError).statusCode;
    }
  };
  const json = { "Content-Type": "application/json" };

  it("refuses foreign origins and cross-site fetches on writes", () => {
    expect(
      status(req("POST", { ...json, Origin: "https://evil.example" }, "{}")),
    ).toBe(403);
    expect(status(req("POST", { ...json, Origin: "null" }, "{}"))).toBe(403);
    expect(status(req("DELETE", { "Sec-Fetch-Site": "cross-site" }))).toBe(403);
  });

  it("refuses a non-JSON body", () => {
    expect(status(req("POST", { "Content-Type": "text/plain" }, "{}"))).toBe(
      415,
    );
    expect(
      status(
        req(
          "POST",
          { "Content-Type": "application/x-www-form-urlencoded" },
          "a=1",
        ),
      ),
    ).toBe(415);
  });

  it("accepts the same origin, a proxy's forwarded host, no-Origin clients, and reads", () => {
    expect(
      status(req("POST", { ...json, Origin: "https://hesba.example" }, "{}")),
    ).toBe(200);
    expect(
      status(
        new Request("http://internal:3000/api/expenses", {
          method: "POST",
          headers: {
            ...json,
            Origin: "https://hesba.example",
            "x-forwarded-host": "hesba.example",
          },
          body: "{}",
        }),
      ),
    ).toBe(200);
    expect(status(req("POST", json, "{}"))).toBe(200);
    expect(status(req("DELETE", {}))).toBe(200);
    expect(status(req("GET", { Origin: "https://evil.example" }))).toBe(200);
  });
});
