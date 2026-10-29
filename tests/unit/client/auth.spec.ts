import { describe, it, expect, beforeEach } from "vitest";
import { fixtureAuthApi } from "@/client/shared/api/auth.fixture";
import { okPhone, okMail, normDigits } from "@/client/shared/auth/AuthScreen";

describe("Hesba Authentication Client — Phone, Password & Recovery Code", () => {
  beforeEach(async () => {
    await fixtureAuthApi.logout();
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

    it("validates email correctly", () => {
      expect(okMail("")).toBe(false);
      expect(okMail("test@example.com")).toBe(true);
      expect(okMail("invalid-email")).toBe(false);
      expect(okMail("owner@hesba.app")).toBe(true);
    });
  });

  describe("Phone & Password Login Flow", () => {
    it("authenticates valid mobile number and password", async () => {
      const res = await fixtureAuthApi.login({
        phone: "01012345678",
        password: "password123",
      });

      expect(res.success).toBe(true);
      expect(res.data?.user.phone).toBe("01012345678");
      expect(res.data?.token).toBeDefined();

      const session = await fixtureAuthApi.getSession();
      expect(session).not.toBeNull();
      expect(session?.user.phone).toBe("01012345678");
    });

    it("rejects invalid phone numbers or short passwords", async () => {
      const invalidPhoneRes = await fixtureAuthApi.login({
        phone: "01312345678",
        password: "validPassword123",
      });
      expect(invalidPhoneRes.success).toBe(false);
      expect(invalidPhoneRes.error).toBe("رقم الموبايل غير صحيح");

      const shortPassRes = await fixtureAuthApi.login({
        phone: "01012345678",
        password: "123",
      });
      expect(shortPassRes.success).toBe(false);
      expect(shortPassRes.error).toBe("كلمة السر غير صحيحة");
    });
  });

  describe("First-Time Registration Flow", () => {
    it("creates account with owner and shop details", async () => {
      const res = await fixtureAuthApi.signup({
        ownerName: "أحمد علي",
        phone: "01098765432",
        email: "ahmed@example.com",
        password: "secretPassword123",
        storeName: "بقالة الأمل",
        shopType: "بقالة",
        governorate: "الجيزة",
        area: "الدقي",
        openedOn: "2023-01-01",
        workersCount: 2,
        withDemoData: true,
      });

      expect(res.success).toBe(true);
      expect(res.data?.user.name).toBe("أحمد علي");
      expect(res.data?.store.name).toBe("بقالة الأمل");
      expect(res.data?.user.phone).toBe("01098765432");

      const session = await fixtureAuthApi.getSession();
      expect(session?.user.email).toBe("ahmed@example.com");
    });

    it("rejects registration with short password (< 12 chars)", async () => {
      const res = await fixtureAuthApi.signup({
        ownerName: "محمود",
        phone: "01098765432",
        email: "m@example.com",
        password: "short1234", // 9 chars
        storeName: "محل",
        shopType: "بقالة",
        governorate: "القاهرة",
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("كلمة السر يجب أن تكون 12 حرف على الأقل");
    });

    it("rejects registration with common password", async () => {
      const res = await fixtureAuthApi.signup({
        ownerName: "محمود",
        phone: "01098765432",
        email: "m@example.com",
        password: "password1234", // in blocklist
        storeName: "محل",
        shopType: "بقالة",
        governorate: "القاهرة",
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "كلمة السر شائعة وسهلة التخمين، اختار كلمة أصعب أو جملة سرية",
      );
    });

    it("rejects registration with password exceeding 128 chars", async () => {
      const res = await fixtureAuthApi.signup({
        ownerName: "محمود",
        phone: "01098765432",
        email: "m@example.com",
        password: "A".repeat(129),
        storeName: "محل",
        shopType: "بقالة",
        governorate: "القاهرة",
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("كلمة السر لا يجب أن تتجاوز 128 حرف");
    });
  });

  describe("Forgot Password via 6-Digit Email Code Flow", () => {
    it("dispatches reset code and allows resetting password with code", async () => {
      const email = "owner@example.com";
      const reqRes = await fixtureAuthApi.requestPasswordReset(email);
      expect(reqRes.success).toBe(true);
      expect(reqRes.data?.message).toContain("تم إرسال كود التأكيد");

      // Verify and set new password
      const resetRes = await fixtureAuthApi.resetPassword({
        email,
        code: "123456",
        newPassword: "newSecurePassword123",
      });
      expect(resetRes.success).toBe(true);
      expect(resetRes.data?.message).toContain("تم تغيير كلمة السر بنجاح");
    });

    it("rejects invalid code", async () => {
      const res = await fixtureAuthApi.resetPassword({
        email: "owner@example.com",
        code: "000000",
        newPassword: "newSecurePassword123",
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("كود التأكيد غير صحيح");
    });

    it("rejects reset with short password (< 12 chars)", async () => {
      const res = await fixtureAuthApi.resetPassword({
        email: "owner@example.com",
        code: "123456",
        newPassword: "short1234",
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("كلمة السر الجديدة يجب أن تكون 12 حرف على الأقل");
    });

    it("rejects reset with common password", async () => {
      const res = await fixtureAuthApi.resetPassword({
        email: "owner@example.com",
        code: "123456",
        newPassword: "password1234",
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "كلمة السر شائعة وسهلة التخمين، اختار كلمة أصعب أو جملة سرية",
      );
    });
  });

  describe("Session Management & Logout", () => {
    it("logs out and clears session", async () => {
      await fixtureAuthApi.login({
        phone: "01012345678",
        password: "password123",
      });

      expect(await fixtureAuthApi.getSession()).not.toBeNull();
      await fixtureAuthApi.logout();
      expect(await fixtureAuthApi.getSession()).toBeNull();
    });
  });
});
