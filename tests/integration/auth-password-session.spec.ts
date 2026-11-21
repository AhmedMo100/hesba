import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import {
  registerUserWithPassword,
  loginWithPassword,
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  rotateSession,
  revokeSession,
  revokeOtherUserSessions,
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
  // Fixtures only (seed, inspect, clean up): a test-database admin connection. The migrator
  // no longer sees shops' rows (ADR-0024); isolation itself is tested through the app role.
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";

describe("Hesba Authentication & Sessions Integration — Phone + Password & Sessions", () => {
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
        operatingMode: "pos",
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
          password: "ValidPass1234",
          storeName: "محل مكرر",
          shopType: "بقالة",
          governorate: "القاهرة",
          operatingMode: "pos",
          openedOn: "2024-01-01",
          workersCount: 1,
        }),
      ).rejects.toThrow("رقم الموبايل مسجل بالفعل");

      await expect(
        registerUserWithPassword({
          ownerName: "مكرر",
          phone: "01099999999",
          email: testUserEmail,
          password: "ValidPass1234",
          storeName: "محل مكرر",
          shopType: "بقالة",
          governorate: "القاهرة",
          operatingMode: "pos",
          openedOn: "2024-01-01",
          workersCount: 1,
        }),
      ).rejects.toThrow("البريد الإلكتروني مسجل بالفعل");
    });

    it("accepts an empty or blank e-mail (optional: stored as NULL), rejects an invalid one", async () => {
      // The e-mail is optional on the sign-up screen: empty and whitespace-only mean «none».
      const created: Array<{ userId: string; storeId: string }> = [];
      try {
        for (const email of ["", "   "]) {
          const r = await registerUserWithPassword({
            ownerName: "صاحب",
            phone: `0108${String(Math.floor(1e6 + Math.random() * 9e6))}`,
            email,
            password: "ValidPass1234",
            storeName: "محل",
            shopType: "بقالة",
            governorate: "القاهرة",
            operatingMode: "pos",
          });
          created.push({ userId: r.userId, storeId: r.storeId });
          expect(r.user.email).toBeNull();
        }
        const rows = await sql<{ email: string | null }[]>`
          SELECT email FROM users WHERE id IN ${sql(created.map((c) => c.userId))}`;
        expect(rows.every((r) => r.email === null)).toBe(true);
      } finally {
        for (const c of created) {
          await sql`DELETE FROM sessions WHERE user_id = ${c.userId}`;
          await sql`DELETE FROM devices WHERE store_id = ${c.storeId}`;
          await sql`DELETE FROM store_members WHERE store_id = ${c.storeId}`;
          await sql`DELETE FROM stores WHERE id = ${c.storeId}`;
          await sql`DELETE FROM users WHERE id = ${c.userId}`;
        }
      }

      // An address that is typed must be a real one.
      await expect(
        registerUserWithPassword({
          ownerName: "صاحب",
          phone: "01088888813",
          email: "not-an-email",
          password: "ValidPass1234",
          storeName: "محل",
          shopType: "بقالة",
          governorate: "القاهرة",
          operatingMode: "pos",
        }),
      ).rejects.toThrow("بريد إلكتروني غير صحيح");
    });

    it("rejects signup when password does not meet security policy (short, too long, common)", async () => {
      // 1. Password too short (< 12)
      await expect(
        registerUserWithPassword({
          ownerName: "صاحب",
          phone: "01088888881",
          email: "short-pass@hesba.test",
          password: "shortpass12", // 11 chars
          storeName: "محل",
          shopType: "بقالة",
          governorate: "القاهرة",
          operatingMode: "pos",
        }),
      ).rejects.toThrow("كلمة السر يجب أن تكون 12 حرف على الأقل");

      // 2. Password too long (> 128)
      await expect(
        registerUserWithPassword({
          ownerName: "صاحب",
          phone: "01088888882",
          email: "long-pass@hesba.test",
          password: "A".repeat(129),
          storeName: "محل",
          shopType: "بقالة",
          governorate: "القاهرة",
          operatingMode: "pos",
        }),
      ).rejects.toThrow("كلمة السر لا يجب أن تتجاوز 128 حرف");

      // 3. Common / easily guessed password
      await expect(
        registerUserWithPassword({
          ownerName: "صاحب",
          phone: "01088888883",
          email: "common-pass@hesba.test",
          password: "password1234",
          storeName: "محل",
          shopType: "بقالة",
          governorate: "القاهرة",
          operatingMode: "pos",
        }),
      ).rejects.toThrow(
        "كلمة السر شائعة وسهلة التخمين، اختار كلمة سر أقوى أو جملة سرية",
      );
    });

    it("accepts signup with a valid passphrase containing spaces without trimming", async () => {
      const passphrase = "el ahly fe el alb ya masr 2026";
      const result = await registerUserWithPassword({
        ownerName: "صاحب المحل",
        phone: "01088888884",
        email: "passphrase-owner@hesba.test",
        password: passphrase,
        storeName: "محل الأهلي",
        shopType: "سوبر ماركت",
        governorate: "القاهرة",
        operatingMode: "pos",
      });

      expect(result.userId).toBeDefined();

      // Verify the user can log in with the exact passphrase
      const loginRes = await loginWithPassword({
        identifier: "01088888884",
        password: passphrase,
      });
      expect(loginRes.userId).toBe(result.userId);

      // Clean up created user and store
      await prisma.store.deleteMany({ where: { id: result.storeId } });
      await prisma.user.deleteMany({ where: { id: result.userId } });
    });

    it("rejects signup when password lacks letters", async () => {
      await expect(
        registerUserWithPassword({
          ownerName: "صاحب المحل",
          phone: "01088888885",
          email: "noletters-owner@hesba.test",
          password: "1234567890123",
          storeName: "محل",
          shopType: "سوبر ماركت",
          governorate: "القاهرة",
          operatingMode: "pos",
        }),
      ).rejects.toThrow("كلمة السر يجب أن تحتوي على حرف واحد على الأقل");
    });

    it("rejects signup when password lacks numbers", async () => {
      await expect(
        registerUserWithPassword({
          ownerName: "صاحب المحل",
          phone: "01088888886",
          email: "nonumbers-owner@hesba.test",
          password: "LongPasswordWithoutNumbers",
          storeName: "محل",
          shopType: "سوبر ماركت",
          governorate: "القاهرة",
          operatingMode: "pos",
        }),
      ).rejects.toThrow("كلمة السر يجب أن تحتوي على رقم واحد على الأقل");
    });
  });

  describe("3. Mobile + Password Login", () => {
    it("successfully logs in with normalized local phone (010...) and password", async () => {
      // testUserPhone is stored as +20109xxxxxx, user can enter 0109xxxxxx
      const localPhone = testUserPhone.replace(/^\+2/, "");

      const result = await loginWithPassword(
        { identifier: localPhone, password: testUserPassword },
        "127.0.0.1",
      );

      expect(result.userId).toBe(testUserId);
      expect(result.storeId).toBe(testStoreId);
      expect(result.sessionToken).toBeTypeOf("string");

      const session = await validateSession(result.sessionToken);
      expect(session?.user.id).toBe(testUserId);
      expect(session?.store.id).toBe(testStoreId);
    });

    it("allows existing legacy accounts with simple or short passwords to log in without 12-char/letter/number enforcement", async () => {
      // Create a legacy user directly with a short password hash (e.g. 6 chars "old123")
      const legacyHashed = await hashPassword("old123");
      const runId = Math.random().toString(36).substring(2, 8);
      const randomDigits = Math.floor(10000000 + Math.random() * 90000000);
      const localPhone = `010${randomDigits}`;
      const legacyPhone = `+2010${randomDigits}`;
      const legacyEmail = `legacy-${runId}@hesba.test`;
      const legacyStoreId = randomUUID();

      const legacyUser = await prisma.user.create({
        data: {
          name: "صاحب حساب قديم",
          phone: legacyPhone,
          email: legacyEmail,
          passwordHash: legacyHashed,
        },
      });

      try {
        // Create store and membership under withTenant context
        await withTenant(legacyStoreId, legacyUser.id, async (tx) => {
          await tx.store.create({
            data: {
              id: legacyStoreId,
              name: "محل قديم",
              shopType: "بقالة",
              governorate: "القاهرة",
            },
          });
          await tx.storeMember.create({
            data: {
              storeId: legacyStoreId,
              userId: legacyUser.id,
              role: "owner",
            },
          });
        });

        // Verify the legacy user logs in successfully with their old 6-char password
        const loginRes = await loginWithPassword({
          identifier: localPhone,
          password: "old123",
        });
        expect(loginRes.userId).toBe(legacyUser.id);
        expect(loginRes.storeId).toBe(legacyStoreId);
      } finally {
        // Clean up
        await prisma.session.deleteMany({ where: { userId: legacyUser.id } });
        await withTenant(legacyStoreId, legacyUser.id, async (tx) => {
          await tx.device.deleteMany({ where: { storeId: legacyStoreId } });
          await tx.storeMember.deleteMany({
            where: { storeId: legacyStoreId },
          });
          await tx.store.deleteMany({ where: { id: legacyStoreId } });
        });
        await prisma.user.deleteMany({ where: { id: legacyUser.id } });
      }
    });

    it("rejects invalid password with generic error message", async () => {
      await expect(
        loginWithPassword(
          { identifier: testUserPhone, password: "WrongPasswordHere!" },
          "127.0.0.1",
        ),
      ).rejects.toThrow("البيانات غير صحيحة");
    });

    it("rejects non-existent phone with identical generic error message (timing safe)", async () => {
      await expect(
        loginWithPassword(
          { identifier: "01011111119", password: "AnyPassword123" },
          "127.0.0.1",
        ),
      ).rejects.toThrow("البيانات غير صحيحة");
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

    it("DETECTS SESSION REUSE: a rotated token reused after the grace period revokes its own chain only (QA-14)", async () => {
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

      // The rotation happened a while ago (past the in-flight grace period).
      await prisma.session.update({
        where: { idHash: hashToken(initialToken) },
        data: { revokedAt: new Date(Date.now() - 5 * 60_000) },
      });
      // Attacker re-uses the old initialToken!
      await expect(validateSession(initialToken)).rejects.toThrow(
        "الجلسة دي اتقفلت لحماية حسابك",
      );

      // This device's chain (the token that replaced it) is revoked…
      expect(
        (
          await prisma.session.findUnique({
            where: { idHash: hashToken(rotated.rawToken) },
          })
        )?.revokedAt,
      ).not.toBeNull();
      // …and the other device keeps working.
      expect(await validateSession(otherDeviceToken)).not.toBeNull();
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

  // 5. The e-mail reset-code flow was retired: a forgotten password is reset by Hesba's team
  // with a temporary password (tests/integration/password-reset-admin.spec.ts).

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
