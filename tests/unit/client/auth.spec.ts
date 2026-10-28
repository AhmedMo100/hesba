import { describe, it, expect, beforeEach } from "vitest";
import { fixtureAuthApi } from "@/client/shared/api/auth.fixture";
import { okPhone, okMail, normDigits } from "@/client/shared/auth/AuthScreen";

describe("Hesba Authentication Client — WebAuthn Passkeys & Recovery", () => {
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

    it("validates email correctly (mandatory for account recovery)", () => {
      expect(okMail("")).toBe(false);
      expect(okMail("test@example.com")).toBe(true);
      expect(okMail("invalid-email")).toBe(false);
      expect(okMail("owner@hesba.app")).toBe(true);
    });
  });

  describe("WebAuthn Passkey Registration Flow", () => {
    it("starts signup and returns WebAuthn registration challenge options", async () => {
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
      expect(res.data?.session.user.name).toContain("(TEST)");
      expect(res.data?.session.store.name).toContain("(TEST)");
      expect(res.data?.passkeyOptions.challenge).toBeDefined();
      expect(res.data?.passkeyOptions.rp.id).toBe("localhost");
    });

    it("completes passkey registration and persists active session", async () => {
      await fixtureAuthApi.signup({
        ownerName: "أحمد علي",
        phone: "01098765432",
        email: "ahmed@example.com",
        storeName: "بقالة الأمل",
        shopType: "بقالة",
        governorate: "الجيزة",
        openedOn: "2023-01-01",
        workersCount: 2,
      });

      const res = await fixtureAuthApi.completePasskeyRegistration({
        id: "cred-test-01",
        rawId: "raw-cred-01",
        type: "public-key",
        response: { clientDataJSON: "eyJjaGFsbGVuZ2UiOiJ0ZXN0In0=" },
      });

      expect(res.success).toBe(true);
      expect(res.data?.user).toBeDefined();

      const passkeys = await fixtureAuthApi.listPasskeys();
      expect(passkeys.success).toBe(true);
      expect(passkeys.data?.length).toBeGreaterThan(0);
    });
  });

  describe("WebAuthn Passkey Login Flow", () => {
    it("requests authentication options and signs in with passkey", async () => {
      const opts = await fixtureAuthApi.getPasskeyAuthOptions("01012345678");
      expect(opts.success).toBe(true);
      expect(opts.data?.challenge).toBeDefined();

      const loginRes = await fixtureAuthApi.loginWithPasskey();
      expect(loginRes.success).toBe(true);
      expect(loginRes.data?.user.phone).toBe("01012345678");
      expect(loginRes.data?.token).toBeDefined();

      const currentSession = await fixtureAuthApi.getSession();
      expect(currentSession).not.toBeNull();
    });
  });

  describe("Account Recovery Flow", () => {
    it("requests recovery link with generic anti-enumeration message", async () => {
      const res = await fixtureAuthApi.requestAccountRecovery(
        "magdi.test@hesba.app",
      );
      expect(res.success).toBe(true);
      expect(res.data?.message).toContain("إذا كان البريد مسجلاً");
    });

    it("verifies recovery token and prepares new passkey registration options", async () => {
      const res = await fixtureAuthApi.verifyRecoveryToken("valid-token");
      expect(res.success).toBe(true);
      expect(res.data?.email).toBe("magdi.test@hesba.app");
      expect(res.data?.passkeyOptions).toBeDefined();
    });

    it("rejects invalid or expired recovery token", async () => {
      const res = await fixtureAuthApi.verifyRecoveryToken("invalid-token");
      expect(res.success).toBe(false);
      expect(res.error).toContain("غير صالح");
    });

    it("completes account recovery by registering a new passkey", async () => {
      const res = await fixtureAuthApi.completeAccountRecovery({
        token: "valid-token",
        passkeyLabel: "جهاز مسترد",
      });
      expect(res.success).toBe(true);
      expect(res.data?.token).toBeDefined();
      expect(res.data?.user.email).toBe("magdi.test@hesba.app");
    });
  });

  describe("Session Management & Logout", () => {
    it("clears session on logout without affecting offline database", async () => {
      await fixtureAuthApi.loginWithPasskey();
      expect(await fixtureAuthApi.getSession()).not.toBeNull();

      await fixtureAuthApi.logout();
      expect(await fixtureAuthApi.getSession()).toBeNull();
    });
  });

  describe("Optional Local Screen Lock (PIN)", () => {
    it("sets and verifies local 6-digit device PIN", async () => {
      await fixtureAuthApi.setPin("123456");
      expect(fixtureAuthApi.hasLocalPin()).toBe(true);

      const isOk = await fixtureAuthApi.verifyPin("123456");
      expect(isOk).toBe(true);

      const isBad = await fixtureAuthApi.verifyPin("654321");
      expect(isBad).toBe(false);
    });

    it("enforces temporary lockout after 5 failed attempts", () => {
      for (let i = 0; i < 4; i++) {
        expect(fixtureAuthApi.recordFailedPinAttempt()).toBe(i + 1);
        expect(fixtureAuthApi.getPinLockoutRemainingSeconds()).toBe(0);
      }
      expect(fixtureAuthApi.recordFailedPinAttempt()).toBe(5);
      expect(fixtureAuthApi.getPinLockoutRemainingSeconds()).toBeGreaterThan(0);
    });
  });
});
