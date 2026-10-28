import { describe, it, expect, beforeEach } from "vitest";
import { fixtureAuthApi } from "@/client/shared/api/auth.fixture";
import { okPhone, okMail, normDigits } from "@/client/shared/auth/AuthScreen";

describe("Auth Client & Passkeys Fixture API (Pre-Phase 2.2)", () => {
  beforeEach(async () => {
    await fixtureAuthApi.logout();
    await fixtureAuthApi.setPin(null);
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

  describe("Passkey Registration & Sign-in (Task 2A)", () => {
    it("signs up a new user and returns WebAuthn challenge options", async () => {
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
      expect(res.data?.session.token).toContain("TEST");
      expect(res.data?.passkeyOptions.challenge).toContain("TEST");
      expect(res.data?.passkeyOptions.rp.id).toBe("hesba.app");
    });

    it("completes passkey registration and establishes verified credentials", async () => {
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

      const regRes = await fixtureAuthApi.completePasskeyRegistration({
        id: "passkey-new-device-1",
        rawId: "raw-new-device-1",
        type: "public-key",
        response: { clientDataJSON: "eyJjaGFsbGVuZ2UiOiJ0ZXN0In0=" },
      });

      expect(regRes.success).toBe(true);
      expect(regRes.data?.user.emailVerified).toBe(true);

      const passkeys = await fixtureAuthApi.listPasskeys();
      expect(passkeys.success).toBe(true);
      expect(passkeys.data?.some((p) => p.id === "passkey-new-device-1")).toBe(
        true,
      );
    });

    it("signs in using a registered passkey", async () => {
      const authOptions = await fixtureAuthApi.getPasskeyAuthOptions();
      expect(authOptions.success).toBe(true);
      expect(authOptions.data?.challenge).toContain("TEST");

      const loginRes = await fixtureAuthApi.loginWithPasskey({
        id: "passkey-test-device-1",
        rawId: "raw-test-device-1",
        type: "public-key",
        response: {
          clientDataJSON: "eyJjaGFsbGVuZ2UiOiJ0ZXN0In0=",
          signature: "TEST-SIG",
        },
      });

      expect(loginRes.success).toBe(true);
      expect(loginRes.data?.user.phone).toBe("01012345678");
      expect(loginRes.data?.token).toContain("TEST");
    });

    it("handles passkey cancellation, unsupported device, and challenge expiration", async () => {
      const canceledRes = await fixtureAuthApi.loginWithPasskey({
        id: "canceled",
        rawId: "canceled",
        type: "public-key",
        response: { clientDataJSON: "" },
      });
      expect(canceledRes.success).toBe(false);
      expect(canceledRes.error).toContain("إلغاء");

      const unsupportedRes = await fixtureAuthApi.loginWithPasskey({
        id: "unsupported",
        rawId: "unsupported",
        type: "public-key",
        response: { clientDataJSON: "" },
      });
      expect(unsupportedRes.success).toBe(false);
      expect(unsupportedRes.error).toContain("لا يدعم");

      const expiredRes = await fixtureAuthApi.loginWithPasskey({
        id: "expired",
        rawId: "expired",
        type: "public-key",
        response: { clientDataJSON: "" },
      });
      expect(expiredRes.success).toBe(false);
      expect(expiredRes.error).toContain("انتهت صلاحية");
    });
  });

  describe("Email Verification & Account Recovery (Task 2C)", () => {
    it("requests recovery link with generic anti-enumeration response", async () => {
      const res = await fixtureAuthApi.requestAccountRecovery({
        email: "magdi.test@hesba.app",
      });

      expect(res.success).toBe(true);
      expect(res.data?.message).toContain("لو الإيميل مسجل عندنا");
      expect(res.data?.message).toContain("TEST");
    });

    it("verifies recovery token and rejects expired/used tokens", async () => {
      const validRes = await fixtureAuthApi.verifyRecoveryToken(
        "valid-recovery-token-TEST",
      );
      expect(validRes.success).toBe(true);
      expect(validRes.data?.email).toBe("magdi.test@hesba.app");
      expect(validRes.data?.passkeyOptions).toBeDefined();

      const expiredRes = await fixtureAuthApi.verifyRecoveryToken("expired");
      expect(expiredRes.success).toBe(false);
      expect(expiredRes.error).toContain("منتهي الصلاحية");

      const usedRes = await fixtureAuthApi.verifyRecoveryToken("used");
      expect(usedRes.success).toBe(false);
      expect(usedRes.error).toContain("تم استخدامه مسبقاً");
    });

    it("completes account recovery by registering a new Passkey and revoking old credentials", async () => {
      const res = await fixtureAuthApi.completeAccountRecovery(
        { token: "valid-token-TEST", passkeyLabel: "مفتاح جديد بعد الاسترداد" },
        {
          id: "passkey-recovered-device",
          rawId: "raw-recovered-device",
          type: "public-key",
          response: { clientDataJSON: "eyJjaGFsbGVuZ2UiOiJ0ZXN0In0=" },
        },
      );

      expect(res.success).toBe(true);
      expect(res.data?.user.emailVerified).toBe(true);
      expect(res.data?.token).toContain("TEST");

      // Only the newly registered passkey remains
      const passkeys = await fixtureAuthApi.listPasskeys();
      expect(passkeys.data?.length).toBe(1);
      expect(passkeys.data?.[0]?.id).toBe("passkey-recovered-device");
    });
  });

  describe("Local PIN Lock & Passkey Re-authentication (Task 2B)", () => {
    it("handles local screen PIN lock and unlock", async () => {
      await fixtureAuthApi.loginWithPasskey({
        id: "passkey-test-device-1",
        rawId: "raw-1",
        type: "public-key",
        response: { clientDataJSON: "" },
      });
      await fixtureAuthApi.setPin("123456");

      const correct = await fixtureAuthApi.verifyPin("123456");
      expect(correct).toBe(true);

      const wrong = await fixtureAuthApi.verifyPin("000000");
      expect(wrong).toBe(false);
    });

    it("requires Passkey re-authentication before allowing local PIN reset", async () => {
      await fixtureAuthApi.loginWithPasskey({
        id: "passkey-test-device-1",
        rawId: "raw-1",
        type: "public-key",
        response: { clientDataJSON: "" },
      });
      await fixtureAuthApi.setPin("123456");

      const resetRes = await fixtureAuthApi.resetPinWithReauth();
      expect(resetRes.success).toBe(true);
      expect(resetRes.data?.allowed).toBe(true);

      // PIN is now cleared
      const session = await fixtureAuthApi.getSession();
      expect(session?.pinEnabled).toBe(false);
    });
  });

  describe("Offline Session Expiry (Task 2D)", () => {
    it("flags offline expired session while allowing local data retention for selling", async () => {
      await fixtureAuthApi.loginWithPasskey({
        id: "passkey-test-device-1",
        rawId: "raw-1",
        type: "public-key",
        response: { clientDataJSON: "" },
      });
      await fixtureAuthApi.simulateOfflineExpiry();

      const session = await fixtureAuthApi.getSession();
      expect(session?.isOfflineExpired).toBe(true);
      // Local session data still retained
      expect(session?.user.id).toBeDefined();
    });
  });

  describe("Profile Modal API & Server Error Reporting", () => {
    it("updates profile with verified email", async () => {
      await fixtureAuthApi.loginWithPasskey({
        id: "passkey-test-device-1",
        rawId: "raw-1",
        type: "public-key",
        response: { clientDataJSON: "" },
      });

      const res = await fixtureAuthApi.updateProfile({
        ownerName: "محمود حسن",
        phone: "01012345678",
        email: "mahmoud@example.com",
        storeName: "سوبر ماركت الفتح",
        shopType: "سوبر ماركت",
        governorate: "الإسكندرية",
        area: "سموحة",
        openedOn: "2021-06-01",
        workersCount: 4,
      });

      expect(res.success).toBe(true);
      expect(res.data?.ownerName).toBe("محمود حسن");
    });

    it("returns server error text when update fails", async () => {
      await fixtureAuthApi.loginWithPasskey({
        id: "passkey-test-device-1",
        rawId: "raw-1",
        type: "public-key",
        response: { clientDataJSON: "" },
      });

      const res = await fixtureAuthApi.updateProfile({
        ownerName: "خطأ (TEST)",
        phone: "01012345678",
        email: "fail@hesba.app",
        storeName: "سوبر ماركت الفتح",
        shopType: "سوبر ماركت",
        governorate: "الإسكندرية",
        openedOn: "2021-06-01",
        workersCount: 4,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("فشل في حفظ بيانات الحساب من السيرفر (TEST)");
    });
  });
});
