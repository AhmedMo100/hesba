/**
 * QA-58 (owner name length), QA-59 (unknown People section) and signup referral codes, through
 * the real route handlers on real Postgres (app role, FORCE RLS).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { GET as peopleRoute } from "@/app/api/people/route";
import { createSession } from "@/server/modules/auth";
import { withTenant } from "@/server/infra/db/tenant";
import { MAX_PERSON_NAME_LENGTH } from "@/domain/limits";
import { SaleFixtures, directUrl } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const admin = postgres(directUrl, { max: 1 });
const run = Math.random().toString(36).slice(2, 7);
const CODE = `mogamal${run}`;
const OFF = `old${run}`;
const createdUsers: string[] = [];
const createdStores: string[] = [];

function phone() {
  return `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`;
}

async function signup(extra: Record<string, unknown>) {
  const res = await signupRoute(
    new Request("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        ownerName: "صاحب محل",
        phone: phone(),
        email: `ref-${run}-${Math.random().toString(36).slice(2, 7)}@hesba.test`,
        password: "Referral-2026-ok",
        storeName: "محل الدعوة",
        shopType: "سوبر ماركت",
        governorate: "القاهرة",
        ...extra,
      }),
    }),
  );
  const json = (await res.json()) as {
    data?: { userId: string; storeId: string };
    error?: { code: string; message: string; details?: { field?: string } };
  };
  if (json.data) {
    createdUsers.push(json.data.userId);
    createdStores.push(json.data.storeId);
  }
  return { status: res.status, json, raw: JSON.stringify(json) };
}

const referralOf = async (storeId: string) =>
  (
    await admin<Array<{ code: string }>>`
      SELECT rc.code FROM store_referrals sr JOIN referral_codes rc ON rc.id = sr.referral_code_id
      WHERE sr.store_id = ${storeId}`
  ).map((r) => r.code);

beforeAll(async () => {
  await f.setup();
  await admin`INSERT INTO referral_codes (code, label) VALUES (${CODE}, 'مصطفى جمال (اختبار)')`;
  await admin`INSERT INTO referral_codes (code, label, is_active) VALUES (${OFF}, 'كود موقوف', false)`;
});

afterAll(async () => {
  if (createdStores.length) {
    await admin`DELETE FROM sessions WHERE store_id IN ${admin(createdStores)}`;
    await admin`DELETE FROM devices WHERE store_id IN ${admin(createdStores)}`;
    await admin`DELETE FROM store_members WHERE store_id IN ${admin(createdStores)}`;
    await admin`DELETE FROM stores WHERE id IN ${admin(createdStores)}`;
    await admin`DELETE FROM users WHERE id IN ${admin(createdUsers)}`;
  }
  await admin`DELETE FROM referral_codes WHERE code IN (${CODE}, ${OFF})`;
  await admin.end();
  await f.teardown();
});

describe("QA-58 — the owner name is limited on the server", () => {
  it("a 10,000-character owner name is a 400 on ownerName, and nothing is created", async () => {
    const before = await admin`SELECT count(*)::int AS n FROM users`;
    const r = await signup({ ownerName: "ا".repeat(10_000) });
    expect(r.status).toBe(400);
    expect(r.json.error?.code).toBe("VALIDATION_ERROR");
    expect(r.json.error?.details?.field).toBe("ownerName");
    const after = await admin`SELECT count(*)::int AS n FROM users`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("a name at the limit is accepted and stored whole", async () => {
    const name = "م".repeat(MAX_PERSON_NAME_LENGTH);
    const r = await signup({ ownerName: name });
    expect(r.status).toBe(200);
    const [u] = await admin<
      Array<{ name: string }>
    >`SELECT name FROM users WHERE id = ${r.json.data!.userId}`;
    expect(u!.name).toBe(name);
  });
});

describe("QA-59 — an unknown People section is refused", () => {
  it("400 for an unknown section; the known ones and no section still work", async () => {
    const token = (await createSession(f.shopA.userId, f.shopA.storeId))
      .rawToken;
    const get = (q: string) =>
      peopleRoute(
        new Request(`http://localhost:3000/api/people${q}`, {
          headers: { cookie: `hesba_session=${token}` },
        }),
      );
    for (const bad of [
      "?section=customers",
      "?section=OWEDTOME",
      "?section=",
    ]) {
      const res = await get(bad);
      expect(res.status, bad).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; details: { field: string } };
      };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details.field).toBe("section");
    }
    for (const ok of [
      "",
      "?section=owedToMe",
      "?section=iOwe",
      "?section=suppliers",
    ]) {
      expect((await get(ok)).status, ok).toBe(200);
    }
  });
});

describe("Signup referral codes", () => {
  it("no code: signup works, no attribution", async () => {
    const r = await signup({});
    expect(r.status).toBe(200);
    expect(await referralOf(r.json.data!.storeId)).toEqual([]);
    const blank = await signup({ referralCode: "   " });
    expect(blank.status).toBe(200);
    expect(await referralOf(blank.json.data!.storeId)).toEqual([]);
  });

  it("a valid code (any case) attributes the new shop, and the response reveals nothing about it", async () => {
    const r = await signup({ referralCode: `  ${CODE.toUpperCase()} ` });
    expect(r.status).toBe(200);
    expect(await referralOf(r.json.data!.storeId)).toEqual([CODE]);
    expect(r.raw).not.toContain("مصطفى");
    expect(r.raw).not.toContain(CODE);
  });

  it("an unknown, inactive or malformed code is a 400 on referralCode, and nothing is created", async () => {
    const before = await admin`SELECT count(*)::int AS n FROM stores`;
    for (const bad of [`nope${run}`, OFF, "x", "bad code!"]) {
      const r = await signup({ referralCode: bad });
      expect(r.status, bad).toBe(400);
      expect(r.json.error?.details?.field, bad).toBe("referralCode");
      expect(r.raw).not.toContain("كود موقوف");
    }
    const after = await admin`SELECT count(*)::int AS n FROM stores`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("the attribution is permanent and private to the shop (app role, RLS)", async () => {
    const r = await signup({ referralCode: CODE });
    const { storeId, userId } = r.json.data!;
    // The app cannot change or remove it.
    await expect(
      withTenant(
        storeId,
        userId,
        (tx) =>
          tx.$executeRaw`UPDATE store_referrals SET created_at = now() WHERE store_id = ${storeId}::uuid`,
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(
        storeId,
        userId,
        (tx) =>
          tx.$executeRaw`DELETE FROM store_referrals WHERE store_id = ${storeId}::uuid`,
      ),
    ).rejects.toThrow();
    expect(await referralOf(storeId)).toEqual([CODE]);
    // Another shop does not see it; the app cannot add or edit codes.
    const seen = await withTenant(f.shopA.storeId, f.shopA.userId, (tx) =>
      tx.storeReferral.findMany({ where: { storeId } }),
    );
    expect(seen).toEqual([]);
    await expect(
      withTenant(
        f.shopA.storeId,
        f.shopA.userId,
        (tx) =>
          tx.$executeRaw`INSERT INTO referral_codes (code, label) VALUES ('hack123', 'x')`,
      ),
    ).rejects.toThrow();
  });
});
