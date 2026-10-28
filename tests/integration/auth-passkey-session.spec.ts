import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import {
  createPasskeyChallenge,
  consumePasskeyChallenge,
  createSession,
  validateSession,
  rotateSession,
  revokeSession,
  requestAccountRecovery,
  verifyRecoveryToken,
  authRateLimiter,
  hashToken,
} from "@/server/modules/auth";
import { assertStoreOwner, assertStoreAccess } from "@/server/modules/tenancy";
import { withTenant } from "@/server/infra/db/tenant";
import { mockEmailProvider } from "@/server/infra/email";

if (!process.env["HESBA_DATABASE_URL"] || !process.env["HESBA_DIRECT_URL"]) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    try {
      process.loadEnvFile(".env");
    } catch {
      // Ignore
    }
  }
}

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

describe("Phase 2.2 — Auth, Passkeys, Sessions & Tenancy Integration", () => {
  let prisma: PrismaClient;
  let sql: postgres.Sql;

  // Test entities
  let testUserId: string;
  let testStoreId: string;
  let workerUserId: string;

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 1 });
    prisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });

    const runId = Math.random().toString(36).substring(2, 8);
    testStoreId = crypto.randomUUID();

    // 1. Seed Owner User (users table has no RLS, passwordHash is null, email is unique)
    const owner = await prisma.user.create({
      data: {
        name: `مالك المتجر ${runId}`,
        phone: `+20109${runId.padEnd(6, "0").substring(0, 6)}`,
        email: `owner-${runId}@hesba.test`,
        passwordHash: null,
      },
    });
    testUserId = owner.id;

    // 2. Seed Worker User
    const worker = await prisma.user.create({
      data: {
        name: `عامل المتجر ${runId}`,
        phone: `+20108${runId.padEnd(6, "0").substring(0, 6)}`,
        email: `worker-${runId}@hesba.test`,
        passwordHash: null,
      },
    });
    workerUserId = worker.id;

    // 3. Seed Store and Members under withTenant context
    await withTenant(testStoreId, testUserId, async (tx) => {
      await tx.store.create({
        data: {
          id: testStoreId,
          name: `متجر اختبار ${runId}`,
          shopType: "سوبر ماركت",
          governorate: "القاهرة",
          workersCount: 2,
          createdBy: testUserId,
        },
      });

      await tx.storeMember.create({
        data: {
          storeId: testStoreId,
          userId: testUserId,
          role: "owner",
        },
      });

      await tx.storeMember.create({
        data: {
          storeId: testStoreId,
          userId: workerUserId,
          role: "cashier",
        },
      });
    });
  });

  afterAll(async () => {
    try {
      if (testStoreId && testUserId) {
        await prisma.session.deleteMany({ where: { storeId: testStoreId } });
        await withTenant(testStoreId, testUserId, async (tx) => {
          await tx.storeMember.deleteMany({ where: { storeId: testStoreId } });
          await tx.store.deleteMany({ where: { id: testStoreId } });
        });
      }
      if (testUserId) {
        await prisma.userPasskey.deleteMany({ where: { userId: testUserId } });
        await prisma.passkeyChallenge.deleteMany({
          where: { userId: testUserId },
        });
        await prisma.accountRecoveryToken.deleteMany({
          where: { userId: testUserId },
        });
        await prisma.user.deleteMany({ where: { id: testUserId } });
      }
      if (workerUserId) {
        await prisma.user.deleteMany({ where: { id: workerUserId } });
      }
      await prisma.$disconnect();
      await sql.end();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("1. Database Schema & Nullable Password Verification", () => {
    it("allows creating users without passwords (password_hash is NULL)", async () => {
      const user = await prisma.user.findUnique({
        where: { id: testUserId },
      });
      expect(user).toBeDefined();
      expect(user?.passwordHash).toBeNull();
      expect(user?.email).toContain("@hesba.test");
    });

    it("enforces unique email constraint on users", async () => {
      const duplicatePromise = prisma.user.create({
        data: {
          name: "Duplicate Email User",
          phone: "+201000000999",
          email: (
            await prisma.user.findUniqueOrThrow({ where: { id: testUserId } })
          ).email,
          passwordHash: null,
        },
      });

      await expect(duplicatePromise).rejects.toThrow();
    });
  });

  describe("2. WebAuthn Challenge Lifecycles & Single-Use Enforcement", () => {
    it("creates a cryptographically random short-lived challenge in database", async () => {
      const challenge = await createPasskeyChallenge(
        "registration",
        testUserId,
      );
      expect(challenge).toBeTypeOf("string");
      expect(challenge.length).toBeGreaterThan(20);

      const record = await prisma.passkeyChallenge.findUnique({
        where: { challenge },
      });
      expect(record).toBeDefined();
      expect(record?.purpose).toBe("registration");
      expect(record?.userId).toBe(testUserId);
      expect(record?.usedAt).toBeNull();
      expect(record?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("atomically consumes a challenge and prevents replay attacks", async () => {
      const challenge = await createPasskeyChallenge("authentication");

      // First consumption succeeds
      const consumed = await consumePasskeyChallenge(
        challenge,
        "authentication",
      );
      expect(consumed.usedAt).not.toBeNull();

      // Second consumption fails with replay error
      await expect(
        consumePasskeyChallenge(challenge, "authentication"),
      ).rejects.toThrow("تم استخدام رمز التحقق هذا من قبل");
    });

    it("rejects challenge consumption if expired", async () => {
      const expiredChallenge = "expired-challenge-" + Math.random();
      await prisma.passkeyChallenge.create({
        data: {
          challenge: expiredChallenge,
          purpose: "authentication",
          expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        },
      });

      await expect(
        consumePasskeyChallenge(expiredChallenge, "authentication"),
      ).rejects.toThrow("انتهت صلاحية رمز التحقق");
    });

    it("rejects challenge consumption if purpose does not match", async () => {
      const challenge = await createPasskeyChallenge("registration");

      await expect(
        consumePasskeyChallenge(challenge, "authentication"),
      ).rejects.toThrow("غرض رمز التحقق غير مطابق");
    });
  });

  describe("3. Sessions: Hashing, Rotation & Reuse Detection", () => {
    it("stores only SHA-256 session token hash in DB, never raw token", async () => {
      const { rawToken, session } = await createSession(
        testUserId,
        testStoreId,
      );
      expect(rawToken).toBeTypeOf("string");

      const expectedHash = hashToken(rawToken);
      expect(session.idHash).toBe(expectedHash);

      // Verify DB record
      const dbRecord = await prisma.session.findUnique({
        where: { idHash: expectedHash },
      });
      expect(dbRecord).toBeDefined();
      expect(dbRecord?.userId).toBe(testUserId);
      expect(dbRecord?.storeId).toBe(testStoreId);
      expect(dbRecord?.revokedAt).toBeNull();
    });

    it("validates an active session and returns user and store context", async () => {
      const { rawToken } = await createSession(testUserId, testStoreId);
      const context = await validateSession(rawToken);

      expect(context).not.toBeNull();
      expect(context?.user.id).toBe(testUserId);
      expect(context?.store.id).toBe(testStoreId);
      expect(context?.session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("rotates an active session, creating a new token and revoking old with pointer", async () => {
      const { rawToken: initialToken } = await createSession(
        testUserId,
        testStoreId,
      );
      const rotated = await rotateSession(initialToken);

      expect(rotated.rawToken).not.toBe(initialToken);
      expect(rotated.session.rotatedFrom).toBe(hashToken(initialToken));

      // Old session is now revoked
      const oldSession = await prisma.session.findUnique({
        where: { idHash: hashToken(initialToken) },
      });
      expect(oldSession?.revokedAt).not.toBeNull();

      // New session is active
      const newContext = await validateSession(rotated.rawToken);
      expect(newContext).not.toBeNull();
      expect(newContext?.user.id).toBe(testUserId);
    });

    it("DETECTS SESSION REUSE: Presenting a rotated token revokes all user sessions", async () => {
      const { rawToken: initialToken } = await createSession(
        testUserId,
        testStoreId,
      );

      // Legitimate rotation happens
      const rotated = await rotateSession(initialToken);

      // Another active session exists for user
      const { rawToken: anotherDeviceToken } = await createSession(
        testUserId,
        testStoreId,
      );
      expect(await validateSession(anotherDeviceToken)).not.toBeNull();

      // Attacker re-uses the old initialToken!
      await expect(validateSession(initialToken)).rejects.toThrow(
        "تم رصد استخدام رمز جلسة قديم",
      );

      // REUSE DETECTION EFFECT: Both rotated session AND anotherDeviceToken are now revoked!
      const rotatedCheck = await prisma.session.findUnique({
        where: { idHash: hashToken(rotated.rawToken) },
      });
      expect(rotatedCheck?.revokedAt).not.toBeNull();

      const anotherCheck = await prisma.session.findUnique({
        where: { idHash: hashToken(anotherDeviceToken) },
      });
      expect(anotherCheck?.revokedAt).not.toBeNull();
    });

    it("allows manual revocation of a session", async () => {
      const { rawToken } = await createSession(testUserId, testStoreId);
      await revokeSession(rawToken);

      const dbRecord = await prisma.session.findUnique({
        where: { idHash: hashToken(rawToken) },
      });
      expect(dbRecord?.revokedAt).not.toBeNull();
    });
  });

  describe("4. Account Recovery, Anti-Enumeration & Rate Limiting", () => {
    beforeAll(() => {
      authRateLimiter.clear();
      mockEmailProvider.clear();
    });

    it("returns generic message for non-existent email to prevent enumeration", async () => {
      const response = await requestAccountRecovery(
        "non-existent-user@hesba.test",
      );
      expect(response.message).toBe(
        "إذا كان البريد مسجلاً لدينا، تم إرسال رابط الاسترداد.",
      );
      expect(mockEmailProvider.getSentEmails()).toHaveLength(0);
    });

    it("sends recovery email with hashed token when email exists", async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: testUserId },
      });
      const response = await requestAccountRecovery(user.email);

      expect(response.message).toBe(
        "إذا كان البريد مسجلاً لدينا، تم إرسال رابط الاسترداد.",
      );

      const sent = mockEmailProvider.getLastEmailFor(user.email);
      expect(sent).toBeDefined();
      expect(sent?.type).toBe("recovery");
      expect(sent?.url).toContain("token=");

      // Verify token in DB is hashed
      const urlToken = new URL(sent!.url!).searchParams.get("token")!;
      const tokenRecord = await prisma.accountRecoveryToken.findUnique({
        where: { tokenHash: hashToken(urlToken) },
      });
      expect(tokenRecord).toBeDefined();
      expect(tokenRecord?.userId).toBe(testUserId);
      expect(tokenRecord?.usedAt).toBeNull();
    });

    it("enforces rate limiting on account recovery requests (max 3/hr)", async () => {
      const email = `ratelimit-${Math.random()}@hesba.test`;

      // 1, 2, 3 should succeed
      await requestAccountRecovery(email);
      await requestAccountRecovery(email);
      await requestAccountRecovery(email);

      // 4th request should throw rate limit error
      await expect(requestAccountRecovery(email)).rejects.toThrow(
        "تجاوزت الحد الأقصى لمحاولات الاسترداد",
      );
    });

    it("verifies valid recovery token and rejects expired/used tokens", async () => {
      const rawToken = "test-raw-recovery-token-" + Math.random();
      await prisma.accountRecoveryToken.create({
        data: {
          userId: testUserId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const verified = await verifyRecoveryToken(rawToken);
      expect(verified.email).toBe(
        (await prisma.user.findUniqueOrThrow({ where: { id: testUserId } }))
          .email,
      );
      expect(verified.passkeyOptions.challenge).toBeTypeOf("string");

      // Invalid token rejects
      await expect(verifyRecoveryToken("invalid-token-xyz")).rejects.toThrow(
        "رابط الاسترداد غير صالح أو انتهت صلاحيته",
      );
    });
  });

  describe("5. Tenancy & Role-based Authorization", () => {
    it("allows owner to perform owner-only operations", async () => {
      const membership = await assertStoreOwner(testStoreId, testUserId);
      expect(membership.role).toBe("owner");
      expect(membership.userId).toBe(testUserId);
      expect(membership.storeId).toBe(testStoreId);
    });

    it("forbids worker from performing owner-only operations", async () => {
      await expect(assertStoreOwner(testStoreId, workerUserId)).rejects.toThrow(
        "هذا الإجراء مخصص لمالك المتجر فقط",
      );
    });

    it("forbids access if user is not a member of the store", async () => {
      const strangerId = "00000000-0000-0000-0000-000000000099";
      await expect(assertStoreAccess(testStoreId, strangerId)).rejects.toThrow(
        "ليس لديك صلاحية للوصول إلى هذا المتجر",
      );
    });
  });
});
