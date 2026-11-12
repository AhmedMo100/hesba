/**
 * Security fixes on the real auth routes and services, real Postgres:
 * - QA-14: sessions are independent per device; a revoked token is just refused.
 * - QA-24: login lockout counts failures only, answers 429 + Retry-After, and treats unknown
 *   phones like known ones.
 * - QA-25: forgot-password answers the same for registered and unregistered emails, even when
 *   the email provider fails; codes are single-use, expire, and are rate-limited.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import {
  authRateLimiter,
  createSession,
  hashPassword,
  hashToken,
  requestPasswordResetCode,
  resetPasswordWithCode,
  revokeOtherUserSessions,
  revokeSession,
  rotateSession,
  validateSession,
  ROTATION_GRACE_MS,
} from "@/server/modules/auth";
import { mockEmailProvider } from "@/server/infra/email";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as forgotRoute } from "@/app/api/auth/forgot-password/request/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { GET as expensesRoute } from "@/app/api/expenses/route";

const adminUrl =
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";
const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
const sql = postgres(adminUrl, { max: 1 });

const runId = Math.random().toString(36).slice(2, 8);
const digits = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
const password = "Security-test-2026-ok";
const A = {
  user: crypto.randomUUID(),
  store: crypto.randomUUID(),
  phone: `0105${digits}`,
  email: `sec-a-${runId}@hesba.test`,
};
const B = {
  user: crypto.randomUUID(),
  store: crypto.randomUUID(),
  phone: `0104${digits}`,
  email: `sec-b-${runId}@hesba.test`,
};

const withCookie = (
  token: string,
  url = "http://localhost:3000/api/auth/session",
) => new Request(url, { headers: { cookie: `hesba_session=${token}` } });

async function login(phone: string, pw: string, ip = "198.51.100.7") {
  const res = await loginRoute(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ phone, password: pw }),
    }),
  );
  return { status: res.status, headers: res.headers, json: await res.json() };
}

async function forgot(email: string, ip = "203.0.113.9") {
  const res = await forgotRoute(
    new Request("http://localhost:3000/api/auth/forgot-password/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email }),
    }),
  );
  return { status: res.status, body: await res.text() };
}

beforeAll(async () => {
  await admin.$connect();
  const hash = await hashPassword(password);
  for (const s of [A, B]) {
    await admin.user.create({
      data: {
        id: s.user,
        name: "مالك أمان",
        phone: `+2${s.phone}`,
        email: s.email,
        passwordHash: hash,
      },
    });
    await withTenant(
      s.store,
      s.user,
      async (tx) => {
        await tx.store.create({
          data: {
            id: s.store,
            name: `محل أمان ${runId}`,
            shopType: "supermarket",
            governorate: "Cairo",
            createdBy: s.user,
          },
        });
        await tx.storeMember.create({
          data: { storeId: s.store, userId: s.user, role: "owner" },
        });
      },
      admin,
    );
  }
});

beforeEach(() => authRateLimiter.clear());

afterAll(async () => {
  const users = [A.user, B.user];
  try {
    await sql`DELETE FROM password_reset_codes WHERE user_id IN ${sql(users)}`;
    await sql`DELETE FROM sessions WHERE user_id IN ${sql(users)}`;
    await sql`DELETE FROM devices WHERE user_id IN ${sql(users)}`;
    await sql`DELETE FROM stores WHERE id IN ${sql([A.store, B.store])}`;
    await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
  } finally {
    await sql.end();
    await admin.$disconnect();
  }
});

describe("QA-14 — revoking one session never logs out the other devices", () => {
  it("logout on device 1 is refused for device 1 only; devices 2 and 3 stay signed in", async () => {
    const d1 = await createSession(A.user, A.store);
    const d2 = await createSession(A.user, A.store);
    const d3 = await createSession(A.user, A.store);
    await revokeSession(d1.rawToken);

    expect((await sessionRoute(withCookie(d1.rawToken))).status).toBe(401);
    // Using the revoked token again (twice) must not touch anything else.
    expect((await sessionRoute(withCookie(d1.rawToken))).status).toBe(401);
    expect(await validateSession(d2.rawToken)).not.toBeNull();
    expect(await validateSession(d3.rawToken)).not.toBeNull();
    expect((await sessionRoute(withCookie(d2.rawToken))).status).toBe(200);
  });

  it("“sign out other devices”, then the old device makes a request: the current device stays signed in", async () => {
    const phoneA = await createSession(A.user, A.store);
    const phoneB = await createSession(A.user, A.store);
    await revokeOtherUserSessions(A.user, phoneA.rawToken);
    expect((await sessionRoute(withCookie(phoneB.rawToken))).status).toBe(401);
    expect((await sessionRoute(withCookie(phoneA.rawToken))).status).toBe(200);
  });

  it("a revoked token cannot be refreshed (rotated) back into a session", async () => {
    const s = await createSession(A.user, A.store);
    await revokeSession(s.rawToken);
    await expect(rotateSession(s.rawToken)).rejects.toThrow();
    const successors = await admin.session.count({
      where: { rotatedFrom: hashToken(s.rawToken) },
    });
    expect(successors).toBe(0);
  });

  it("a rotated token used during the grace period is refused quietly; the new token keeps working", async () => {
    const s = await createSession(A.user, A.store);
    const other = await createSession(A.user, A.store);
    const rotated = await rotateSession(s.rawToken);
    await expect(validateSession(s.rawToken)).rejects.toThrow(/انتهت/);
    expect(await validateSession(rotated.rawToken)).not.toBeNull();
    expect(await validateSession(other.rawToken)).not.toBeNull();
    expect(ROTATION_GRACE_MS).toBeGreaterThan(0);
  });

  it("concurrent rotations of one token produce one successor", async () => {
    const s = await createSession(A.user, A.store);
    const results = await Promise.allSettled([
      rotateSession(s.rawToken),
      rotateSession(s.rawToken),
      rotateSession(s.rawToken),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(
      await admin.session.count({
        where: { rotatedFrom: hashToken(s.rawToken) },
      }),
    ).toBe(1);
  });

  it("revoking one session while another device is making requests leaves that device signed in", async () => {
    const d1 = await createSession(A.user, A.store);
    const d2 = await createSession(A.user, A.store);
    const [, ...checks] = await Promise.all([
      revokeSession(d1.rawToken),
      validateSession(d2.rawToken),
      validateSession(d2.rawToken),
    ]);
    for (const c of checks) expect(c).not.toBeNull();
    expect(await validateSession(d2.rawToken)).not.toBeNull();
  });

  it("a session only ever reaches its own store's data", async () => {
    const a = await createSession(A.user, A.store);
    const res = await expensesRoute(
      withCookie(a.rawToken, "http://localhost:3000/api/expenses"),
    );
    expect(res.status).toBe(200);
    const ctx = await validateSession(a.rawToken);
    expect(ctx?.store.id).toBe(A.store);
    expect(ctx?.store.id).not.toBe(B.store);
  });
});

describe("QA-24 — login lockout counts failures only and answers 429", () => {
  it("successful logins never lock the phone", async () => {
    for (let i = 0; i < 8; i++) {
      expect((await login(A.phone, password)).status).toBe(200);
    }
  });

  it("5 failures lock the phone: 429 + Retry-After, even with the right password", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(A.phone, "Wrong-password-1")).status).toBe(401);
    }
    const locked = await login(A.phone, password);
    expect(locked.status).toBe(429);
    const retry = Number(locked.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(14 * 60);
    expect(retry).toBeLessThanOrEqual(15 * 60);
    expect((await login(A.phone, password)).status).toBe(429); // still blocked
    // Another account is not affected.
    expect((await login(B.phone, password)).status).toBe(200);
  });

  it("a success clears the earlier failures of that phone", async () => {
    for (let i = 0; i < 4; i++) {
      expect((await login(A.phone, "Wrong-password-1")).status).toBe(401);
    }
    expect((await login(A.phone, password)).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await login(A.phone, "Wrong-password-1")).status).toBe(401);
    }
    expect((await login(A.phone, password)).status).toBe(200);
  });

  it("login is possible again once the lockout window has passed", async () => {
    for (let i = 0; i < 5; i++) await login(A.phone, "Wrong-password-1");
    expect((await login(A.phone, password)).status).toBe(429);
    const realNow = Date.now();
    const spy = vi
      .spyOn(Date, "now")
      .mockReturnValue(realNow + 15 * 60_000 + 1_000);
    try {
      expect((await login(A.phone, password)).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("parallel wrong guesses cannot get past the limit", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => login(A.phone, "Wrong-password-1")),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it("an unknown phone behaves exactly like a known one (no account enumeration)", async () => {
    const unknown = `0103${digits}`;
    const known: number[] = [];
    const missing: number[] = [];
    for (let i = 0; i < 6; i++) {
      known.push((await login(A.phone, "Wrong-password-1")).status);
      missing.push((await login(unknown, "Wrong-password-1")).status);
    }
    expect(missing).toEqual(known);
    expect(known).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("15 failures from one IP lock that IP for other phones too", async () => {
    const ip = "192.0.2.55";
    for (let i = 0; i < 15; i++) {
      await login(`0102${String(i).padStart(7, "0")}`, "x-wrong-pass", ip);
    }
    expect((await login(A.phone, password, ip)).status).toBe(429);
    expect((await login(A.phone, password, "192.0.2.56")).status).toBe(200);
  });
});

describe("QA-25 — forgot-password reveals nothing about which emails have accounts", () => {
  it("a registered and an unregistered email get the same status and the same body", async () => {
    mockEmailProvider.clear();
    const known = await forgot(A.email, "203.0.113.10");
    const unknown = await forgot(`nobody-${runId}@hesba.test`, "203.0.113.11");
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toBe(known.body);
  });

  it("only the registered email gets a code; nothing is created for an unknown one", async () => {
    mockEmailProvider.clear();
    const before = await admin.passwordResetCode.count();
    await requestPasswordResetCode({ email: `ghost-${runId}@hesba.test` });
    expect(await admin.passwordResetCode.count()).toBe(before);
    expect(mockEmailProvider.getSentEmails()).toHaveLength(0);

    await requestPasswordResetCode({ email: A.email });
    const sent = mockEmailProvider.getLastEmailFor(A.email);
    expect(sent?.code).toMatch(/^\d{6}$/);
  });

  it("when the email provider fails, the answer is still the same 200 (it used to be a 503)", async () => {
    const spy = vi
      .spyOn(mockEmailProvider, "sendPasswordResetCode")
      .mockRejectedValue(new Error("provider down"));
    try {
      const known = await forgot(A.email, "203.0.113.12");
      const unknown = await forgot(`none2-${runId}@hesba.test`, "203.0.113.13");
      expect(known.status).toBe(200);
      expect(known.body).toBe(unknown.body);
      // The undeliverable code is invalidated (it never reached the owner).
      await vi.waitFor(async () => {
        const latest = await admin.passwordResetCode.findFirst({
          where: { userId: A.user },
          orderBy: { createdAt: "desc" },
        });
        expect(latest?.usedAt).not.toBeNull();
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("a code works once, and a wrong or expired code is refused", async () => {
    mockEmailProvider.clear();
    await requestPasswordResetCode({ email: A.email });
    const code = mockEmailProvider.getLastEmailFor(A.email)!.code!;
    await expect(
      resetPasswordWithCode({
        email: A.email,
        code: "000000",
        newPassword: "Another-pass-2026",
      }),
    ).rejects.toThrow();
    const ok = await resetPasswordWithCode({
      email: A.email,
      code,
      newPassword: password,
    });
    expect(ok.success).toBe(true);
    await expect(
      resetPasswordWithCode({ email: A.email, code, newPassword: password }),
    ).rejects.toThrow();
    // The code is bound to its account: it cannot reset another email.
    await requestPasswordResetCode({ email: A.email });
    const codeA = mockEmailProvider.getLastEmailFor(A.email)!.code!;
    await expect(
      resetPasswordWithCode({
        email: B.email,
        code: codeA,
        newPassword: password,
      }),
    ).rejects.toThrow();
    // Expired: move the code's expiry into the past.
    await admin.passwordResetCode.updateMany({
      where: { userId: A.user, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      resetPasswordWithCode({
        email: A.email,
        code: codeA,
        newPassword: password,
      }),
    ).rejects.toThrow();
  });

  it("requests are rate-limited the same way for registered and unregistered emails", async () => {
    const statusesFor = async (email: string) => {
      const out: number[] = [];
      for (let i = 0; i < 4; i++)
        out.push((await forgot(email, `198.18.0.${i + 1}`)).status);
      return out;
    };
    const known = await statusesFor(B.email);
    const unknown = await statusesFor(`nobody3-${runId}@hesba.test`);
    expect(known).toEqual([200, 200, 200, 429]);
    expect(unknown).toEqual(known);
  });
});
