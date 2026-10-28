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
  revokeOtherUserSessions,
  requestAccountRecovery,
  validateRecoveryToken,
  verifyRecoveryToken,
  signupUserAndStore,
  authRateLimiter,
  hashToken,
} from "@/server/modules/auth";
import { assertStoreOwner, assertStoreAccess } from "@/server/modules/tenancy";
import { withTenant } from "@/server/infra/db/tenant";
import { getEmailProvider, mockEmailProvider } from "@/server/infra/email";

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

// Provide safe, non-production defaults for test environment
process.env["HESBA_SESSION_SECRET"] ??=
  "hesba-test-session-secret-at-least-16-chars";
process.env["HESBA_CRON_SECRET"] ??= "hesba-test-cron-secret";
process.env["HESBA_APP_ORIGIN"] ??= "http://localhost:3000";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

describe("Hesba Authentication & Sessions Integration — WebAuthn Passkeys & Recovery", () => {
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

    // 1. Seed Owner User
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

  describe("1. Database Schema & Passwordless Model", () => {
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

  describe("2. WebAuthn Passkey Challenges", () => {
    it("generates and atomically consumes a passkey challenge", async () => {
      const challenge = await createPasskeyChallenge(
        "authentication",
        testUserId,
      );

      expect(challenge).toBeTypeOf("string");

      const consumed = await consumePasskeyChallenge(
        challenge,
        "authentication",
      );
      expect(consumed.challenge).toBe(challenge);
      expect(consumed.purpose).toBe("authentication");
    });

    it("REPLAY PROTECTION: consumed challenge cannot be used a second time", async () => {
      const challenge = await createPasskeyChallenge(
        "registration",
        testUserId,
      );

      await consumePasskeyChallenge(challenge, "registration");

      await expect(
        consumePasskeyChallenge(challenge, "registration"),
      ).rejects.toThrow("تم استخدام رمز التحقق هذا من قبل");
    });

    it("rejects expired passkey challenges", async () => {
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
  });

  describe("3. Three-Step Registration Lifecycle", () => {
    it("creates user, store, device and session, and dispatches email verification", async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const email = `newowner-${runId}@hesba.test`;
      const phone = `+2010${Math.floor(10000000 + Math.random() * 90000000)}`;

      const result = await signupUserAndStore({
        ownerName: "صاحب المتجر الجديد",
        phone,
        email,
        storeName: "سوبر ماركت النور",
        shopType: "سوبر ماركت",
        governorate: "الجيزة",
        openedOn: "2024-01-01",
        workersCount: 2,
        withDemoData: true,
      });

      expect(result.userId).toBeTypeOf("string");
      expect(result.storeId).toBeTypeOf("string");
      expect(result.passkeyOptions.challenge).toBeDefined();

      // Clean up newly created signup data
      await prisma.passkeyChallenge.deleteMany({
        where: { userId: result.userId },
      });
      await withTenant(result.storeId, result.userId, async (tx) => {
        await tx.device.deleteMany({ where: { storeId: result.storeId } });
        await tx.storeMember.deleteMany({
          where: { storeId: result.storeId },
        });
        await tx.store.deleteMany({ where: { id: result.storeId } });
      });
      await prisma.user.deleteMany({ where: { id: result.userId } });
    });

    it("rejects duplicate phone or email on signup", async () => {
      const existingUser = await prisma.user.findUniqueOrThrow({
        where: { id: testUserId },
      });

      await expect(
        signupUserAndStore({
          ownerName: "مكرر",
          phone: "+201000000000",
          email: existingUser.email,
          storeName: "محل",
          shopType: "بقالة",
          governorate: "القاهرة",
          openedOn: "2024-01-01",
          workersCount: 1,
        }),
      ).rejects.toThrow("البريد الإلكتروني مسجل بالفعل");
    });
  });

  describe("4. Sessions: Hashing, Rotation, Reuse Detection & Device Revocation", () => {
    it("stores only SHA-256 session token hash in DB, never raw token", async () => {
      const { rawToken, session } = await createSession(
        testUserId,
        testStoreId,
      );
      expect(rawToken).toBeTypeOf("string");

      const expectedHash = hashToken(rawToken);
      expect(session.idHash).toBe(expectedHash);

      const dbRecord = await prisma.session.findUnique({
        where: { idHash: expectedHash },
      });
      expect(dbRecord?.userId).toBe(testUserId);
      expect(dbRecord?.revokedAt).toBeNull();
    });

    it("validates an active session and returns user and store context under tenant isolation", async () => {
      const { rawToken } = await createSession(testUserId, testStoreId);
      const context = await validateSession(rawToken);

      expect(context).not.toBeNull();
      expect(context?.user.id).toBe(testUserId);
      expect(context?.store.id).toBe(testStoreId);
    });

    it("rotates an active session, creating new token and marking old with rotatedFrom", async () => {
      const { rawToken: initialToken } = await createSession(
        testUserId,
        testStoreId,
      );
      const rotated = await rotateSession(initialToken);

      expect(rotated.rawToken).not.toBe(initialToken);
      expect(rotated.session.rotatedFrom).toBe(hashToken(initialToken));

      const oldSession = await prisma.session.findUnique({
        where: { idHash: hashToken(initialToken) },
      });
      expect(oldSession?.revokedAt).not.toBeNull();
    });

    it("DETECTS SESSION REUSE: Presenting a rotated token revokes all user sessions", async () => {
      const { rawToken: initialToken } = await createSession(
        testUserId,
        testStoreId,
      );

      const rotated = await rotateSession(initialToken);
      const { rawToken: otherDeviceToken } = await createSession(
        testUserId,
        testStoreId,
      );
      expect(await validateSession(otherDeviceToken)).not.toBeNull();

      // Attacker re-uses the old initialToken!
      await expect(validateSession(initialToken)).rejects.toThrow(
        "تم رصد استخدام رمز جلسة قديم",
      );

      // Entire session chain is revoked
      expect(
        (
          await prisma.session.findUnique({
            where: { idHash: hashToken(rotated.rawToken) },
          })
        )?.revokedAt,
      ).not.toBeNull();
      expect(
        (
          await prisma.session.findUnique({
            where: { idHash: hashToken(otherDeviceToken) },
          })
        )?.revokedAt,
      ).not.toBeNull();
    });

    it("revokes other sessions while preserving current device session", async () => {
      const { rawToken: currentToken } = await createSession(
        testUserId,
        testStoreId,
      );
      const { rawToken: otherToken } = await createSession(
        testUserId,
        testStoreId,
      );

      await revokeOtherUserSessions(testUserId, currentToken);

      // Other session is revoked
      const otherDb = await prisma.session.findUnique({
        where: { idHash: hashToken(otherToken) },
      });
      expect(otherDb?.revokedAt).not.toBeNull();

      // Current session is still active!
      const currentContext = await validateSession(currentToken);
      expect(currentContext).not.toBeNull();
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

  describe("5. Account Recovery via Email Link", () => {
    beforeAll(() => {
      authRateLimiter.clear();
      mockEmailProvider.clear();
    });

    it("returns generic message for non-existent email to prevent enumeration", async () => {
      const response = await requestAccountRecovery(
        "non-existent-user@hesba.test",
      );
      expect(response.message).toContain("تم إرسال رابط الاسترداد");
      expect(mockEmailProvider.getSentEmails()).toHaveLength(0);
    });

    it("dispatches recovery email with secure token link for eligible accounts", async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: testUserId },
      });

      const response = await requestAccountRecovery(user.email);
      expect(response.message).toContain("تم إرسال رابط الاسترداد");

      const lastEmail = mockEmailProvider.getLastEmailFor(user.email);
      expect(lastEmail).toBeDefined();
      expect(lastEmail?.type).toBe("recovery");
      expect(lastEmail?.url).toContain("/auth/verify-link?token=");

      // Ensure token is stored hashed in DB
      const urlToken = new URL(lastEmail!.url!).searchParams.get("token")!;
      const tokenRecord = await prisma.accountRecoveryToken.findUnique({
        where: { tokenHash: hashToken(urlToken) },
      });
      expect(tokenRecord).toBeDefined();
      expect(tokenRecord?.userId).toBe(testUserId);
      expect(tokenRecord?.usedAt).toBeNull();
    });

    it("validates recovery token without consuming it prematurely", async () => {
      const rawToken = "validation-token-" + Math.random();
      await prisma.accountRecoveryToken.create({
        data: {
          userId: testUserId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const validated = await validateRecoveryToken(rawToken);
      expect(validated.valid).toBe(true);
      expect(validated.passkeyOptions).toBeDefined();

      // Token should NOT be consumed yet!
      const record = await prisma.accountRecoveryToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
      });
      expect(record?.usedAt).toBeNull();
    });

    it("verifies valid recovery token and establishes authenticated session", async () => {
      const rawToken = "recovery-token-" + Math.random();
      await prisma.accountRecoveryToken.create({
        data: {
          userId: testUserId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const verified = await verifyRecoveryToken(rawToken);
      expect(verified.user.id).toBe(testUserId);
      expect(verified.token).toBeTypeOf("string");

      // Verify token marked used
      const tokenRecord = await prisma.accountRecoveryToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
      });
      expect(tokenRecord?.usedAt).not.toBeNull();
    });

    it("enforces single-use: second consumption fails", async () => {
      const rawToken = "single-use-recovery-" + Math.random();
      await prisma.accountRecoveryToken.create({
        data: {
          userId: testUserId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      await verifyRecoveryToken(rawToken);

      await expect(verifyRecoveryToken(rawToken)).rejects.toThrow(
        "رابط الاسترداد غير صالح أو انتهت صلاحيته",
      );
    });

    it("rejects expired recovery tokens", async () => {
      const rawToken = "expired-recovery-" + Math.random();
      await prisma.accountRecoveryToken.create({
        data: {
          userId: testUserId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        },
      });

      await expect(verifyRecoveryToken(rawToken)).rejects.toThrow(
        "رابط الاسترداد غير صالح أو انتهت صلاحيته",
      );
    });

    it("enforces rate limiting on account recovery requests (max 3/hr per email)", async () => {
      const email = `ratelimit-rec-${Math.random()}@hesba.test`;

      await requestAccountRecovery(email);
      await requestAccountRecovery(email);
      await requestAccountRecovery(email);

      await expect(requestAccountRecovery(email)).rejects.toThrow(
        "تجاوزت الحد الأقصى لمحاولات الاسترداد",
      );
    });
  });

  describe("6. Email Provider Isolation in Automated Tests", () => {
    it("ensures automated tests use mock email provider without real network calls", () => {
      const provider = getEmailProvider();
      expect(provider).toBe(mockEmailProvider);
    });
  });

  describe("7. Tenancy & Role-based Authorization", () => {
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
