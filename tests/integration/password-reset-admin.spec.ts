/**
 * Sign-up without an e-mail, and the manual password reset (real Postgres, the app's route
 * handlers and roles, the real admin tool helpers):
 * - several accounts can sign up with NO e-mail (stored as NULL, never ''), and log in by phone;
 * - the admin reset stores only an Argon2id hash, signs the account out everywhere, and the
 *   temporary password then signs in to a session that can do NOTHING but change the password
 *   (403 PASSWORD_CHANGE_REQUIRED on every other API, whatever the subscription);
 * - the change needs the temporary password, clears the flag, closes every other session, and
 *   the temporary password stops working; an expired temporary password never signs in;
 * - the runtime role can never put an account into the reset state (database trigger), and the
 *   change route cannot target another account (strict body).
 */
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { authRateLimiter } from "@/server/modules/auth";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as changeRoute } from "@/app/api/auth/change-password/route";
import { GET as subscriptionRoute } from "@/app/api/subscription/route";
import * as products from "@/app/api/products/route";
import { GET as reportRoute } from "@/app/api/reports/home/route";
import {
  generateTemporaryPassword,
  resetPasswordForUser,
} from "../../scripts/admin-reset-password";
import { validatePasswordPolicy } from "@/domain/password-policy";

const admin = postgres(
  process.env["HESBA_TEST_ADMIN_URL"] ??
    "postgres://postgres:change-me-local-root@localhost:5434/hesba",
  { max: 1, onnotice: () => {} },
);
const migrator = postgres(
  process.env["HESBA_DIRECT_URL"] ??
    "postgres://hesba_migrator:change-me-local@localhost:5434/hesba",
  { max: 1, onnotice: () => {} },
);
const app = postgres(
  process.env["HESBA_DATABASE_URL"] ??
    "postgres://hesba_app:change-me-local@localhost:5434/hesba",
  { max: 1, onnotice: () => {} },
);

type Handler = (req: Request, ctx: never) => Promise<Response>;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const runId = Math.random().toString(36).slice(2, 8);
const signedUpStores: string[] = [];
const signedUpUsers: string[] = [];

async function call(
  handler: Handler,
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; ip?: string } = {},
): Promise<{ status: number; json: Json; cookie: string }> {
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        "x-forwarded-for":
          opts.ip ?? `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    { params: Promise.resolve({}) } as never,
  );
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = /hesba_session=([^;]+)/.exec(setCookie);
  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    /* empty body */
  }
  return { status: res.status, json, cookie: m ? `hesba_session=${m[1]}` : "" };
}

const phone = () => `012${String(Math.floor(1e7 + Math.random() * 9e7))}`;
const PASSWORD = "Shop-owner-2026-ok";

async function signup(p: string, email?: string) {
  const r = await call(signupRoute, "POST", "/api/auth/signup", {
    body: {
      ownerName: `محل ${runId}`,
      phone: p,
      ...(email !== undefined ? { email } : {}),
      password: PASSWORD,
      storeName: `محل ${runId} ${p.slice(-4)}`,
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
      operatingMode: "simple",
    },
  });
  if (r.status === 200) {
    signedUpStores.push(r.json.data.store.id);
    signedUpUsers.push(r.json.data.user.id);
  }
  return r;
}

const login = (identifier: string, password: string) =>
  call(loginRoute, "POST", "/api/auth/login", {
    body: { identifier, password },
  });

afterAll(async () => {
  for (const id of signedUpStores) {
    await admin`DELETE FROM sessions WHERE store_id = ${id}`;
    await admin`DELETE FROM devices WHERE store_id = ${id}`;
    await admin`DELETE FROM store_members WHERE store_id = ${id}`;
    await admin`DELETE FROM stores WHERE id = ${id}`;
  }
  if (signedUpUsers.length) {
    await admin`DELETE FROM sessions WHERE user_id IN ${admin(signedUpUsers)}`;
    await admin`DELETE FROM users WHERE id IN ${admin(signedUpUsers)}`;
  }
  await Promise.all([admin.end(), migrator.end(), app.end()]);
});

describe("sign-up with the e-mail left empty", () => {
  it("two accounts without an e-mail both sign up (NULL, never ''), and log in by phone", async () => {
    authRateLimiter.clear();
    const p1 = phone();
    const p2 = phone();
    const a = await signup(p1); // field omitted
    const b = await signup(p2, ""); // field sent empty
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(b.status, JSON.stringify(b.json)).toBe(200);
    expect(a.json.data.user.email).toBeNull();
    const rows = await admin<{ email: string | null }[]>`
      SELECT email FROM users WHERE id IN ${admin([a.json.data.user.id, b.json.data.user.id])}`;
    expect(rows.map((r) => r.email)).toEqual([null, null]);

    const l = await login(p1, PASSWORD);
    expect(l.status).toBe(200);
    expect(l.cookie).not.toBe("");
    const s = await call(sessionRoute, "GET", "/api/auth/session", {
      cookie: l.cookie,
    });
    expect(s.json.data.user.id).toBe(a.json.data.user.id);
    expect(s.json.data.store.operatingMode).toBe("simple");
    // The account always has its store, and the trial was started by the database.
    expect(s.json.data.store.subscription.status).toBe("trialing");
  });

  it("an invalid e-mail is a clear 400; the same phone twice is a 409, never a 500", async () => {
    const p = phone();
    const bad = await signup(p, "not-an-email");
    expect(bad.status).toBe(400);
    const first = await signup(p, `ok-${runId}@hesba.test`);
    expect(first.status).toBe(200);
    const again = await signup(p);
    expect(again.status).toBe(409);
    expect(again.json.error.message).toContain("مسجل");
  });

  it("a double submit (two identical requests at once) creates ONE account", async () => {
    const p = phone();
    const [x, y] = await Promise.all([signup(p), signup(p)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const n = await admin<{ n: number }[]>`
      SELECT count(*)::int n FROM users WHERE phone = ${"+2" + p}`;
    expect(n[0]!.n).toBe(1);
  });

  it("wrong password: 401 and no session; unknown phone: the same 401", async () => {
    const p = phone();
    await signup(p);
    const wrong = await login(p, "Wrong-password-2026");
    expect(wrong.status).toBe(401);
    expect(wrong.cookie).toBe("");
    const unknown = await login(phone(), PASSWORD);
    expect(unknown.status).toBe(401);
    expect(unknown.json.error.message).toBe(wrong.json.error.message);
  });

  it("logout ends the session: the same cookie is refused afterwards", async () => {
    const p = phone();
    await signup(p);
    const l = await login(p, PASSWORD);
    expect(
      (
        await call(products.GET as Handler, "GET", "/api/products", {
          cookie: l.cookie,
        })
      ).status,
    ).toBe(200);
    await call(logoutRoute, "POST", "/api/auth/logout", { cookie: l.cookie });
    expect(
      (
        await call(products.GET as Handler, "GET", "/api/products", {
          cookie: l.cookie,
        })
      ).status,
    ).toBe(401);
  });
});

describe("manual password reset by Hesba's team", () => {
  it("generates strong, policy-compliant temporary passwords that never repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generateTemporaryPassword();
      expect(validatePasswordPolicy(t).valid).toBe(true);
      expect(t).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it("full cycle: reset → only the change works → change → normal again, others signed out", async () => {
    authRateLimiter.clear();
    const p = phone();
    const su = await signup(p);
    const userId = su.json.data.user.id as string;
    const before = await login(p, PASSWORD); // a session on «another device»
    expect(before.status).toBe(200);

    const temp = generateTemporaryPassword();
    const res = await resetPasswordForUser(migrator, userId, temp, 24);
    expect(res.revokedSessions).toBeGreaterThanOrEqual(2); // sign-up + login sessions

    // Only the hash is stored — never the temporary password.
    const [row] = await admin<
      { password_hash: string; must: boolean; exp: Date }[]
    >`
      SELECT password_hash, must_change_password AS must, temp_password_expires_at AS exp
        FROM users WHERE id = ${userId}`;
    expect(
      row!.password_hash.startsWith("$argon2id$v=19$m=19456,t=2,p=1$"),
    ).toBe(true);
    expect(row!.password_hash).not.toContain(temp);
    expect(row!.must).toBe(true);

    // Every earlier session is signed out; the old password no longer works.
    expect(
      (
        await call(products.GET as Handler, "GET", "/api/products", {
          cookie: before.cookie,
        })
      ).status,
    ).toBe(401);
    expect((await login(p, PASSWORD)).status).toBe(401);

    // The temporary password signs in, but nothing works except the change.
    const t1 = await login(p, temp);
    expect(t1.status).toBe(200);
    expect(t1.json.data.user.mustChangePassword).toBe(true);
    const sess = await call(sessionRoute, "GET", "/api/auth/session", {
      cookie: t1.cookie,
    });
    expect(sess.json.data.user.mustChangePassword).toBe(true);
    for (const [h, path] of [
      [products.GET, "/api/products"],
      [reportRoute, "/api/reports/home"],
      [subscriptionRoute, "/api/subscription"],
    ] as const) {
      const r = await call(h as Handler, "GET", path, { cookie: t1.cookie });
      expect(r.status, path).toBe(403);
      expect(r.json.error.code, path).toBe("PASSWORD_CHANGE_REQUIRED");
    }
    const otherDevice = await login(p, temp); // a second temporary sign-in, elsewhere

    // The change needs the temporary password, a strong new one, and only the own account.
    const wrongCurrent = await call(
      changeRoute,
      "POST",
      "/api/auth/change-password",
      {
        cookie: t1.cookie,
        body: {
          currentPassword: "Not-the-temp-2026",
          newPassword: "Brand-new-2026-pass",
        },
      },
    );
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.json.error.details.field).toBe("currentPassword");
    const weak = await call(changeRoute, "POST", "/api/auth/change-password", {
      cookie: t1.cookie,
      body: { currentPassword: temp, newPassword: "short1" },
    });
    expect(weak.status).toBe(400);
    const otherUser = await call(
      changeRoute,
      "POST",
      "/api/auth/change-password",
      {
        cookie: t1.cookie,
        body: {
          currentPassword: temp,
          newPassword: "Brand-new-2026-pass",
          userId: signedUpUsers[0],
        },
      },
    );
    expect(otherUser.status).toBe(400); // strict body: no way to name another account
    const noSession = await call(
      changeRoute,
      "POST",
      "/api/auth/change-password",
      {
        body: { currentPassword: temp, newPassword: "Brand-new-2026-pass" },
      },
    );
    expect(noSession.status).toBe(401);

    const ok = await call(changeRoute, "POST", "/api/auth/change-password", {
      cookie: t1.cookie,
      body: { currentPassword: temp, newPassword: "Brand-new-2026-pass" },
    });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.data.revokedSessions).toBeGreaterThanOrEqual(1);

    // The device that changed it keeps working; the other temporary session is closed.
    expect(
      (
        await call(products.GET as Handler, "GET", "/api/products", {
          cookie: t1.cookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(products.GET as Handler, "GET", "/api/products", {
          cookie: otherDevice.cookie,
        })
      ).status,
    ).toBe(401);
    const [after] = await admin<{ must: boolean; exp: Date | null }[]>`
      SELECT must_change_password AS must, temp_password_expires_at AS exp FROM users WHERE id = ${userId}`;
    expect(after).toEqual({ must: false, exp: null });

    // The temporary password is dead; the new one works.
    expect((await login(p, temp)).status).toBe(401);
    expect((await login(p, "Brand-new-2026-pass")).status).toBe(200);
  });

  it("an expired temporary password does not sign in", async () => {
    authRateLimiter.clear();
    const p = phone();
    const su = await signup(p);
    const userId = su.json.data.user.id as string;
    const temp = generateTemporaryPassword();
    await resetPasswordForUser(migrator, userId, temp, 1);
    await admin`UPDATE users SET temp_password_expires_at = now() - interval '1 minute' WHERE id = ${userId}`;
    const r = await login(p, temp);
    expect(r.status).toBe(401);
    expect(r.cookie).toBe("");
    expect(r.json.error.message).toContain("المؤقتة");
  });

  it("the app's database role can never put an account into the reset state", async () => {
    const p = phone();
    const su = await signup(p);
    const userId = su.json.data.user.id as string;
    await expect(
      app`UPDATE users SET must_change_password = true,
             temp_password_expires_at = now() + interval '1 hour' WHERE id = ${userId}`,
    ).rejects.toThrow(/admin reset tool/);
    await expect(
      app`INSERT INTO users (name, phone, must_change_password, temp_password_expires_at)
          VALUES ('x', ${"+2010" + runId.replace(/\D/g, "1").padEnd(8, "1").slice(0, 8)}, true, now())`,
    ).rejects.toThrow(/admin reset tool/);
  });

  it("a blank e-mail can never be stored (CHECK), only NULL", async () => {
    const p = phone();
    const su = await signup(p);
    await expect(
      admin`UPDATE users SET email = '  ' WHERE id = ${su.json.data.user.id}`,
    ).rejects.toThrow(/users_email_not_blank_check/);
  });
});
