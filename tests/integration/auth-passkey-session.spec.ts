import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import {
  createSession,
  validateSession,
  rotateSession,
  revokeSession,
  revokeOtherUserSessions,
  requestAccountRecovery,
  verifyRecoveryToken,
  requestMagicLink,
  verifyMagicLink,
  signupUserAndStore,
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

describe("Hesba Authentication & Sessions Integration — Magic Link & Local PIN", () => {
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
        await prisma.magicLinkToken.deleteMany({
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

  describe("2. Magic Link Login Lifecycle (Experience B)", () => {
    beforeAll(() => {
      authRateLimiter.clear();
      mockEmailProvider.clear();
    });

    it("returns generic message for non-existent email to prevent enumeration", async () => {
      const response = await requestMagicLink("unknown-user@hesba.test");
      expect(response.message).toContain("تم إرسال رابط الدخول");
      expect(mockEmailProvider.getSentEmails()).toHaveLength(0);
    });

    it("sends magic link email with hashed token when user exists", async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: testUserId },
      });
      const response = await requestMagicLink(user.email);
      expect(response.message).toContain("تم إرسال رابط الدخول");

      const sent = mockEmailProvider.getLastEmailFor(user.email);
      expect(sent).toBeDefined();
      expect(sent?.type).toBe("magic-link");
      expect(sent?.url).toContain("token=");

      const urlToken = new URL(sent!.url!).searchParams.get("token")!;
      const tokenRecord = await prisma.magicLinkToken.findUnique({
        where: { tokenHash: hashToken(urlToken) },
      });
      expect(tokenRecord).toBeDefined();
      expect(tokenRecord?.userId).toBe(testUserId);
      expect(tokenRecord?.usedAt).toBeNull();
    });

    it("verifies valid magic link token, sets emailVerified, creates device and establishes session", async () => {
      const rawToken = "magic-test-token-" + Math.random();
      await prisma.magicLinkToken.create({
        data: {
          userId: testUserId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      const result = await verifyMagicLink(rawToken, "جهاز المتجر رقم 2");
      expect(result.token).toBeTypeOf("string");
      expect(result.session.userId).toBe(testUserId);
      expect(result.session.storeId).toBe(testStoreId);
      expect(result.user.emailVerified).toBe(true);

      // Verify token is now marked as used
      const tokenRecord = await prisma.magicLinkToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
      });
      expect(tokenRecord?.usedAt).not.toBeNull();
    });

    it("atomically enforces single-use: second consumption fails", async () => {
      const rawToken = "single-use-token-" + Math.random();
      await prisma.magicLinkToken.create({
        data: {
          userId: testUserId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      // First consumption succeeds
      await verifyMagicLink(rawToken);

      // Second consumption throws error
      await expect(verifyMagicLink(rawToken)).rejects.toThrow(
        "رابط الدخول غير صالح أو انتهت صلاحيته",
      );
    });

    it("rejects expired magic link tokens", async () => {
      const rawToken = "expired-token-" + Math.random();
      await prisma.magicLinkToken.create({
        data: {
          userId: testUserId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        },
      });

      await expect(verifyMagicLink(rawToken)).rejects.toThrow(
        "رابط الدخول غير صالح أو انتهت صلاحيته",
      );
    });

    it("enforces rate limiting on magic link requests (max 3/hr per email)", async () => {
      const email = `ratelimit-magic-${Math.random()}@hesba.test`;

      await requestMagicLink(email);
      await requestMagicLink(email);
      await requestMagicLink(email);

      await expect(requestMagicLink(email)).rejects.toThrow(
        "تجاوزت الحد الأقصى لمحاولات تسجيل الدخول",
      );
    });
  });

  describe("3. Three-Step Registration Lifecycle (Experience A)", () => {
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

      expect(result.token).toBeTypeOf("string");
      expect(result.user.email).toBe(email);
      expect(result.store.name).toBe("سوبر ماركت النور");

      // Verify email verification token was created in DB
      const verificationRecord = await prisma.emailVerificationToken.findFirst({
        where: { userId: result.user.id },
      });
      expect(verificationRecord).toBeDefined();

      // Clean up newly created signup data
      await prisma.session.deleteMany({ where: { userId: result.user.id } });
      await withTenant(result.store.id, result.user.id, async (tx) => {
        await tx.device.deleteMany({ where: { storeId: result.store.id } });
        await tx.storeMember.deleteMany({
          where: { storeId: result.store.id },
        });
        await tx.store.deleteMany({ where: { id: result.store.id } });
      });
      await prisma.emailVerificationToken.deleteMany({
        where: { userId: result.user.id },
      });
      await prisma.user.deleteMany({ where: { id: result.user.id } });
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

  describe("5. Account Recovery via Email Link (Experience C)", () => {
    it("returns generic message for non-existent email to prevent enumeration", async () => {
      const response = await requestAccountRecovery(
        "non-existent-user@hesba.test",
      );
      expect(response.message).toContain("تم إرسال رابط الاسترداد");
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
  });

  describe("6. Tenancy & Role-based Authorization", () => {
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
