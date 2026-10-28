import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import {
  registerUserWithPassword,
  loginWithPassword,
  requestPasswordResetCode,
  resetPasswordWithCode,
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  rotateSession,
  revokeSession,
  revokeOtherUserSessions,
  hashToken,
  authRateLimiter,
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

describe("Hesba Authentication & Sessions Integration — Phone + Password & Reset Code", () => {
  let prisma: PrismaClient;
  let sql: postgres.Sql;

  // Test entities
  let testUserId: string;
  let testStoreId: string;
  let testUserPhone: string;
  let testUserEmail: string;
  const testUserPassword = "TestPassword@123";
  let workerUserId: string;

  beforeAll(async () => {
    sql = postgres(directUrl, { max: 1 });
    prisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });

    const runId = Math.random().toString(36).substring(2, 8);
    const ownerDigits = Math.floor(
      10000000 + Math.random() * 90000000,
    ).toString();
    const workerDigits = Math.floor(
      10000000 + Math.random() * 90000000,
    ).toString();
    testStoreId = crypto.randomUUID();
    testUserPhone = `+2010${ownerDigits}`;
    testUserEmail = `owner-${runId}@hesba.test`;

    const hashedPassword = await hashPassword(testUserPassword);

    // 1. Seed Owner User with Argon2id hashed password
    const owner = await prisma.user.create({
      data: {
        name: `مالك المتجر ${runId}`,
        phone: testUserPhone,
        email: testUserEmail,
        passwordHash: hashedPassword,
      },
    });
    testUserId = owner.id;

    // 2. Seed Worker User
    const worker = await prisma.user.create({
      data: {
        name: `عامل المتجر ${runId}`,
        phone: `+2010${workerDigits}`,
        email: `worker-${runId}@hesba.test`,
        passwordHash: hashedPassword,
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
        await prisma.passwordResetCode.deleteMany({
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

  describe("1. Database Schema & Password Hashing Model", () => {
    it("hashes password with Argon2id and verifies successfully", async () => {
      const password = "Secr3tPassword!456";
      const hash = await hashPassword(password);

      expect(hash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(hash, password)).toBe(true);
      expect(await verifyPassword(hash, "WrongPassword")).toBe(false);
    });

    it("verifies user passwordHash is stored as Argon2id", async () => {
      const user = await prisma.user.findUnique({
        where: { id: testUserId },
      });
      expect(user).toBeDefined();
      expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user?.email).toContain("@hesba.test");
    });

    it("enforces unique phone constraint on users", async () => {
      const duplicatePromise = prisma.user.create({
        data: {
          name: "Duplicate Phone User",
          phone: testUserPhone,
          email: `unique-${Math.random()}@hesba.test`,
          passwordHash: await hashPassword("password123"),
        },
      });

      await expect(duplicatePromise).rejects.toThrow();
    });

    it("enforces unique email constraint on users", async () => {
      const duplicatePromise = prisma.user.create({
        data: {
          name: "Duplicate Email User",
          phone: `+20101${Math.floor(100000 + Math.random() * 900000)}`,
          email: testUserEmail,
          passwordHash: await hashPassword("password123"),
        },
      });

      await expect(duplicatePromise).rejects.toThrow();
    });
  });

  describe("2. Two-Step Registration Lifecycle", () => {
    it("creates user, store, device and session with phone + password", async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const email = `newowner-${runId}@hesba.test`;
      const localPhone = `010${Math.floor(10000000 + Math.random() * 90000000)}`;

      const result = await registerUserWithPassword({
        ownerName: "صاحب المتجر الجديد",
        phone: localPhone,
        email,
        password: "MySecurePassword123",
        storeName: "سوبر ماركت الإخلاص",
        shopType: "سوبر ماركت",
        governorate: "الجيزة",
        openedOn: "2024-01-01",
        workersCount: 2,
        withDemoData: true,
      });

      expect(result.userId).toBeTypeOf("string");
      expect(result.storeId).toBeTypeOf("string");
      expect(result.sessionToken).toBeTypeOf("string");

      // Verify user has Argon2id password hash
      const createdUser = await prisma.user.findUnique({
        where: { id: result.userId },
      });
      expect(createdUser?.passwordHash).toMatch(/^\$argon2id\$/);
      // Normalized Egyptian phone
      expect(createdUser?.phone).toMatch(/^\+2010/);

      // Clean up newly created signup data
      await prisma.session.deleteMany({ where: { userId: result.userId } });
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
      await expect(
        registerUserWithPassword({
          ownerName: "مكرر",
          phone: testUserPhone,
          email: "another-email@hesba.test",
          password: "password123",
          storeName: "محل مكرر",
          shopType: "بقالة",
          governorate: "القاهرة",
          openedOn: "2024-01-01",
          workersCount: 1,
        }),
      ).rejects.toThrow("رقم الموبايل مسجل بالفعل");

      await expect(
        registerUserWithPassword({
          ownerName: "مكرر",
          phone: "01099999999",
          email: testUserEmail,
          password: "password123",
          storeName: "محل مكرر",
          shopType: "بقالة",
          governorate: "القاهرة",
          openedOn: "2024-01-01",
          workersCount: 1,
        }),
      ).rejects.toThrow("البريد الإلكتروني مسجل بالفعل");
    });
  });

  describe("3. Mobile + Password Login", () => {
    it("successfully logs in with normalized local phone (010...) and password", async () => {
      // testUserPhone is stored as +20109xxxxxx, user can enter 0109xxxxxx
      const localPhone = testUserPhone.replace(/^\+2/, "");

      const result = await loginWithPassword(
        { phone: localPhone, password: testUserPassword },
        "127.0.0.1",
      );

      expect(result.userId).toBe(testUserId);
      expect(result.storeId).toBe(testStoreId);
      expect(result.sessionToken).toBeTypeOf("string");

      const session = await validateSession(result.sessionToken);
      expect(session?.user.id).toBe(testUserId);
      expect(session?.store.id).toBe(testStoreId);
    });

    it("rejects invalid password with generic error message", async () => {
      await expect(
        loginWithPassword(
          { phone: testUserPhone, password: "WrongPasswordHere!" },
          "127.0.0.1",
        ),
      ).rejects.toThrow("رقم الموبايل أو كلمة السر غير صحيحة");
    });

    it("rejects non-existent phone with identical generic error message (timing safe)", async () => {
      await expect(
        loginWithPassword(
          { phone: "01011111119", password: "AnyPassword123" },
          "127.0.0.1",
        ),
      ).rejects.toThrow("رقم الموبايل أو كلمة السر غير صحيحة");
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

  describe("5. Forgot Password: 6-Digit Email Verification Code Flow", () => {
    beforeAll(() => {
      authRateLimiter.clear();
      mockEmailProvider.clear();
    });

    it("returns generic message for non-existent email to prevent enumeration", async () => {
      const response = await requestPasswordResetCode({
        email: "non-existent-user@hesba.test",
      });
      expect(response.message).toContain("تم إرسال كود التأكيد");
      expect(mockEmailProvider.getSentEmails()).toHaveLength(0);
    });

    it("dispatches 6-digit code via email and stores keyed HMAC hash", async () => {
      const response = await requestPasswordResetCode({
        email: testUserEmail,
      });
      expect(response.message).toContain("تم إرسال كود التأكيد");

      const lastEmail = mockEmailProvider.getLastEmailFor(testUserEmail);
      expect(lastEmail).toBeDefined();
      expect(lastEmail?.type).toBe("recovery");
      expect(lastEmail?.code).toMatch(/^\d{6}$/);

      // Verify code in DB
      const codeRecord = await prisma.passwordResetCode.findFirst({
        where: { userId: testUserId },
        orderBy: { createdAt: "desc" },
      });
      expect(codeRecord).toBeDefined();
      expect(codeRecord?.usedAt).toBeNull();
      expect(codeRecord?.attempts).toBe(0);
      expect(codeRecord?.codeHash).not.toBe(lastEmail!.code);
    });

    it("rejects wrong verification code and increments attempts", async () => {
      await expect(
        resetPasswordWithCode({
          email: testUserEmail,
          code: "000000",
          newPassword: "NewBrandPassword@123",
        }),
      ).rejects.toThrow("كود التأكيد غير صحيح");

      const codeRecord = await prisma.passwordResetCode.findFirst({
        where: { userId: testUserId },
        orderBy: { createdAt: "desc" },
      });
      expect(codeRecord?.attempts).toBe(1);
    });

    it("successfully resets password with correct code and revokes all sessions", async () => {
      // First create active session to verify revocation
      const { rawToken: activeToken } = await createSession(
        testUserId,
        testStoreId,
      );
      expect(await validateSession(activeToken)).not.toBeNull();

      // Retrieve the generated code from mock email provider
      const lastEmail = mockEmailProvider.getLastEmailFor(testUserEmail);
      const validCode = lastEmail!.code!;

      const newPassword = "BrandNewPassword#999";
      const result = await resetPasswordWithCode({
        email: testUserEmail,
        code: validCode,
        newPassword,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("تم تغيير كلمة السر بنجاح");

      // Verify code is marked as used
      const codeRecord = await prisma.passwordResetCode.findFirst({
        where: { userId: testUserId },
        orderBy: { createdAt: "desc" },
      });
      expect(codeRecord?.usedAt).not.toBeNull();

      // Verify previous session was revoked
      const sessionDb = await prisma.session.findUnique({
        where: { idHash: hashToken(activeToken) },
      });
      expect(sessionDb?.revokedAt).not.toBeNull();

      // Verify user can now log in with the new password
      const loginResult = await loginWithPassword({
        phone: testUserPhone,
        password: newPassword,
      });
      expect(loginResult.userId).toBe(testUserId);

      // Verify old password no longer works
      await expect(
        loginWithPassword({
          phone: testUserPhone,
          password: testUserPassword,
        }),
      ).rejects.toThrow("رقم الموبايل أو كلمة السر غير صحيحة");
    });

    it("REPLAY PROTECTION: consumed code cannot be reused", async () => {
      const lastEmail = mockEmailProvider.getLastEmailFor(testUserEmail);
      const usedCode = lastEmail!.code!;

      await expect(
        resetPasswordWithCode({
          email: testUserEmail,
          code: usedCode,
          newPassword: "AnotherPassword123",
        }),
      ).rejects.toThrow("كود التأكيد غير صحيح أو انتهت صلاحيته");
    });

    it("enforces attempt limit: locks after 5 wrong attempts", async () => {
      mockEmailProvider.clear();
      authRateLimiter.clear();

      await requestPasswordResetCode({ email: testUserEmail });
      const lastEmail = mockEmailProvider.getLastEmailFor(testUserEmail);
      const correctCode = lastEmail!.code!;

      // Attempt wrong code 5 times
      for (let i = 0; i < 5; i++) {
        await expect(
          resetPasswordWithCode({
            email: testUserEmail,
            code: "111111",
            newPassword: "AnyPass@123",
          }),
        ).rejects.toThrow();
      }

      // 6th attempt with CORRECT code should fail because limit reached
      await expect(
        resetPasswordWithCode({
          email: testUserEmail,
          code: correctCode,
          newPassword: "AnyPass@123",
        }),
      ).rejects.toThrow("الحد الأقصى للمحاولات الخاطئة");
    });

    it("enforces rate limiting on forgot password requests (max 3/hr per email)", async () => {
      authRateLimiter.clear();
      const email = `ratelimit-reset-${Math.random()}@hesba.test`;

      await requestPasswordResetCode({ email });
      await requestPasswordResetCode({ email });
      await requestPasswordResetCode({ email });

      await expect(requestPasswordResetCode({ email })).rejects.toThrow(
        "تجاوزت الحد الأقصى لطلب الأكواد",
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
