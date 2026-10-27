import { describe, it, expect, beforeEach } from "vitest";
import { fixtureAuthApi } from "@/client/shared/api/auth.fixture";
import { okPhone, okMail, normDigits } from "@/client/shared/auth/AuthScreen";

describe("Auth Client & Fixture API (P2-F-01, P2-F-02, P2-F-06)", () => {
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

    it("validates email correctly (optional)", () => {
      expect(okMail("")).toBe(true);
      expect(okMail("test@example.com")).toBe(true);
      expect(okMail("invalid-email")).toBe(false);
    });
  });

  describe("Auth API Fixture (P2-F-01)", () => {
    it("signs up a new user with TEST-marked session data", async () => {
      const res = await fixtureAuthApi.signup({
        ownerName: "أحمد علي",
        phone: "01098765432",
        email: "ahmed@example.com",
        password: "password123",
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
      expect(res.data?.token).toContain("TEST");

      const session = await fixtureAuthApi.getSession();
      expect(session).toBeDefined();
      expect(session?.user.phone).toBe("01098765432");
    });

    it("logs in with phone and returns session", async () => {
      const res = await fixtureAuthApi.login({
        phone: "01012345678",
        password: "secretpassword",
      });

      expect(res.success).toBe(true);
      expect(res.data?.user.phone).toBe("01012345678");
      expect(res.data?.store.name).toContain("(TEST)");
    });

    it("requests and verifies OTP", async () => {
      const otpRes = await fixtureAuthApi.requestOtp("01012345678");
      expect(otpRes.success).toBe(true);
      expect(otpRes.data?.message).toContain("1234");
      expect(otpRes.data?.message).toContain("(TEST)");

      const verifyRes = await fixtureAuthApi.verifyOtp({
        phone: "01012345678",
        code: "1234",
      });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.data?.user.phone).toBe("01012345678");
    });
  });

  describe("Session State & PIN Lock (P2-F-02)", () => {
    it("handles PIN lock and verification", async () => {
      await fixtureAuthApi.login({ phone: "01012345678" });
      await fixtureAuthApi.setPin("5566");

      const correct = await fixtureAuthApi.verifyPin("5566");
      expect(correct).toBe(true);

      const wrong = await fixtureAuthApi.verifyPin("0000");
      expect(wrong).toBe(false);
    });

    it("flags offline expired session while allowing local data retention", async () => {
      await fixtureAuthApi.login({ phone: "01012345678" });
      await fixtureAuthApi.simulateOfflineExpiry();

      const session = await fixtureAuthApi.getSession();
      expect(session?.isOfflineExpired).toBe(true);
      // Local session data still retained
      expect(session?.user.id).toBeDefined();
    });
  });

  describe("Profile Modal API & Server Error Reporting (P2-F-06)", () => {
    it("updates profile successfully when valid", async () => {
      await fixtureAuthApi.login({ phone: "01012345678" });

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
      await fixtureAuthApi.login({ phone: "01012345678" });

      const res = await fixtureAuthApi.updateProfile({
        ownerName: "خطأ (TEST)",
        phone: "01012345678",
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
