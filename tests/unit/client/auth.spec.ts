import { describe, it, expect, beforeEach } from "vitest";
import { fixtureAuthApi } from "@/client/shared/api/auth.fixture";
import { okPhone, okMail, normDigits } from "@/client/shared/auth/AuthScreen";

describe("Hesba Authentication Client — Magic Link & Local PIN", () => {
  beforeEach(async () => {
    await fixtureAuthApi.logout();
    await fixtureAuthApi.setPin(null);
    fixtureAuthApi.resetPinAttempts();
  });

  describe("Input Validation & Normalization", () => {
    it("validates Egyptian phone numbers correctly and normalizes Arabic-Indic digits", () => {
      // Valid Vodafone, Orange, Etisalat, WE
      expect(okPhone("01012345678")).toBe(true);
      expect(okPhone("01112345678")).toBe(true);
      expect(okPhone("01212345678")).toBe(true);
      expect(okPhone("01512345678")).toBe(true);

      // Normalization of Arabic digits
      expect(normDigits("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
      expect(okPhone("٠١٠١٢٣٤٥٦٧٨")).toBe(true);

      // Invalid lengths and prefixes
      expect(okPhone("01312345678")).toBe(false);
      expect(okPhone("0101234567")).toBe(false);
      expect(okPhone("010123456789")).toBe(false);
      expect(okPhone("")).toBe(false);
    });

    it("validates email correctly (mandatory for account recovery & magic links)", () => {
      expect(okMail("")).toBe(false);
      expect(okMail("test@example.com")).toBe(true);
      expect(okMail("invalid-email")).toBe(false);
      expect(okMail("owner@hesba.app")).toBe(true);
    });
  });

  describe("Three-Step Registration (Experience A)", () => {
    it("creates account and initializes local PIN in one complete flow", async () => {
      const res = await fixtureAuthApi.signup({
        ownerName: "أحمد علي",
        phone: "01098765432",
        email: "ahmed@example.com",
        storeName: "بقالة الأمل",
        shopType: "بقالة",
        governorate: "الجيزة",
        area: "الدقي",
        openedOn: "2023-01-01",
        workersCount: 2,
        withDemoData: true,
      });

      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();
      expect(res.data?.user.name).toContain("(TEST)");
      expect(res.data?.store.name).toContain("(TEST)");

      // Set local 6-digit PIN on this device
      await fixtureAuthApi.setPin("123456");
      expect(fixtureAuthApi.hasLocalPin()).toBe(true);

      const isPinOk = await fixtureAuthApi.verifyPin("123456");
      expect(isPinOk).toBe(true);
    });
  });

  describe("Magic Link Login for New Devices (Experience B)", () => {
    it("requests magic login link with anti-enumeration response", async () => {
      const res = await fixtureAuthApi.requestMagicLink("owner@hesba.app");
      expect(res.success).toBe(true);
      expect(res.data?.message).toContain("تم إرسال رابط الدخول");
    });

    it("authenticates device upon verifying valid magic link token", async () => {
      const res = await fixtureAuthApi.verifyMagicLink(
        "valid-magic-link-token",
      );
      expect(res.success).toBe(true);
      expect(res.data?.user.email).toBe("magdi.test@hesba.app");
      expect(res.data?.token).toBeDefined();
    });

    it("rejects invalid or expired magic link token", async () => {
      const res = await fixtureAuthApi.verifyMagicLink("invalid-token");
      expect(res.success).toBe(false);
      expect(res.error).toContain("غير صالح");
    });
  });

  describe("Account Recovery & PIN Reset (Experience C)", () => {
    it("requests recovery link with generic anti-enumeration response", async () => {
      const res = await fixtureAuthApi.requestAccountRecovery(
        "magdi.test@hesba.app",
      );
      expect(res.success).toBe(true);
      expect(res.data?.message).toContain("تم إرسال رابط الاسترداد");
    });

    it("authenticates device upon verifying recovery token and enables setting new PIN", async () => {
      const res = await fixtureAuthApi.verifyRecoveryToken("valid-token");
      expect(res.success).toBe(true);
      expect(res.data?.user.email).toBe("magdi.test@hesba.app");

      // Set new device PIN
      await fixtureAuthApi.setPin("654321");
      const ok = await fixtureAuthApi.verifyPin("654321");
      expect(ok).toBe(true);
    });

    it("rejects invalid recovery tokens", async () => {
      const res = await fixtureAuthApi.verifyRecoveryToken("invalid-token");
      expect(res.success).toBe(false);
      expect(res.error).toContain("غير صالح");
    });
  });

  describe("Local 6-digit PIN Security & Rate Limiting Lockout", () => {
    it("handles correct and incorrect PIN checks", async () => {
      await fixtureAuthApi.setPin("123456");
      expect(await fixtureAuthApi.verifyPin("123456")).toBe(true);
      expect(await fixtureAuthApi.verifyPin("000000")).toBe(false);
    });

    it("applies 30-second lockout after 5 consecutive failed PIN attempts", async () => {
      await fixtureAuthApi.setPin("123456");

      // 4 failed attempts: not locked out yet
      for (let i = 0; i < 4; i++) {
        const ok = await fixtureAuthApi.verifyPin("999999");
        expect(ok).toBe(false);
        expect(fixtureAuthApi.getPinLockoutRemainingSeconds()).toBe(0);
      }

      // 5th failed attempt: triggers lockout
      const ok5 = await fixtureAuthApi.verifyPin("999999");
      expect(ok5).toBe(false);
      expect(fixtureAuthApi.getPinLockoutRemainingSeconds()).toBeGreaterThan(0);

      // During lockout: even correct PIN is rejected
      const lockedAttempt = await fixtureAuthApi.verifyPin("123456");
      expect(lockedAttempt).toBe(false);

      // Resetting attempts clears lockout
      fixtureAuthApi.resetPinAttempts();
      expect(fixtureAuthApi.getPinLockoutRemainingSeconds()).toBe(0);
      expect(await fixtureAuthApi.verifyPin("123456")).toBe(true);
    });
  });

  describe("Offline Safety & Session Expiry", () => {
    it("flags offline expired session while retaining local data without discarding outbox", async () => {
      await fixtureAuthApi.verifyMagicLink("valid-token");
      await fixtureAuthApi.simulateOfflineExpiry();

      const session = await fixtureAuthApi.getSession();
      expect(session?.isOfflineExpired).toBe(true);
      expect(session?.user.id).toBeDefined();
    });
  });
});
