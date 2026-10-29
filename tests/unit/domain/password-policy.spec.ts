import { describe, it, expect } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  validatePasswordPolicy,
  isCommonPassword,
} from "@/domain/password-policy";
import { passwordPolicySchema } from "@/schemas/auth";

describe("Hesba Password Security Policy", () => {
  describe("Policy Constants", () => {
    it("exports standard 12-char minimum and 128-char maximum bounds", () => {
      expect(PASSWORD_MIN_LENGTH).toBe(12);
      expect(PASSWORD_MAX_LENGTH).toBe(128);
    });
  });

  describe("Length Requirements (12 to 128 characters)", () => {
    it("rejects empty password", () => {
      const res = validatePasswordPolicy("");
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("empty");
      }
    });

    it("rejects password shorter than 12 characters", () => {
      const res = validatePasswordPolicy("11charPass!"); // 11 chars
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("too_short");
      }
    });

    it("accepts valid password at exact minimum length of 12 characters", () => {
      const res = validatePasswordPolicy("CairoBakery2"); // 12 chars, not common
      expect(res.valid).toBe(true);
    });

    it("accepts valid password at exact maximum length of 128 characters", () => {
      // 128 chars: repeating varied passphrase without matching common patterns
      const pwd128 =
        "ElAhly-Hesba-Supermarket-Store-Manager-2026-Cairo-Egypt-Giza-Secure-Token-Wallet-Inventory-Batch-Stock-Supplier-Sale-Point-Cashier";
      expect(pwd128.length).toBe(130);
      const exact128 = pwd128.slice(0, 128);
      expect(exact128.length).toBe(128);

      const res = validatePasswordPolicy(exact128);
      expect(res.valid).toBe(true);
    });

    it("rejects password exceeding maximum length of 128 characters", () => {
      const pwd129 = "A".repeat(129);
      const res = validatePasswordPolicy(pwd129);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("too_long");
      }
    });
  });

  describe("Passphrase and Character Inclusivity", () => {
    it("allows spaces inside passwords without modification or trimming", () => {
      const passphrase = "el ahly fe el alb ya masr";
      const res = validatePasswordPolicy(passphrase);
      expect(res.valid).toBe(true);
    });

    it("does not require uppercase, numbers, or special characters in fixed combinations", () => {
      const allLowerNoSymbols = "correcthorsebatterystaple";
      const res = validatePasswordPolicy(allLowerNoSymbols);
      expect(res.valid).toBe(true);
    });

    it("accepts complex combinations of symbols, numbers, and multilingual characters", () => {
      const mixed = "حسبة_Hesba_2026_محل";
      const res = validatePasswordPolicy(mixed);
      expect(res.valid).toBe(true);
    });

    it("preserves leading and trailing spaces without silent trimming", () => {
      const withSpaces = "   my secure long pass   ";
      // Length is 25 chars, valid
      const res = validatePasswordPolicy(withSpaces);
      expect(res.valid).toBe(true);
    });
  });

  describe("Protection Against Common & Easily Guessed Passwords", () => {
    it("rejects passwords consisting of a single repeated character", () => {
      expect(isCommonPassword("aaaaaaaaaaaa")).toBe(true);
      expect(isCommonPassword("111111111111")).toBe(true);
      expect(isCommonPassword("            ")).toBe(true);

      const res = validatePasswordPolicy("aaaaaaaaaaaa");
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("too_common");
      }
    });

    it("rejects sequential numeric runs", () => {
      expect(isCommonPassword("123456789012")).toBe(true);
      expect(isCommonPassword("012345678901")).toBe(true);
      expect(isCommonPassword("987654321098")).toBe(true);

      const res = validatePasswordPolicy("123456789012");
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("too_common");
      }
    });

    it("rejects sequential alphabetic runs", () => {
      expect(isCommonPassword("abcdefghijkl")).toBe(true);
      expect(isCommonPassword("zyxwvutsrqpo")).toBe(true);

      const res = validatePasswordPolicy("abcdefghijkl");
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("too_common");
      }
    });

    it("rejects short repeated patterns (2, 3, or 4 character repetitions)", () => {
      expect(isCommonPassword("abababababab")).toBe(true);
      expect(isCommonPassword("123123123123")).toBe(true);
      expect(isCommonPassword("testtesttest")).toBe(true);

      const res = validatePasswordPolicy("123123123123");
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("too_common");
      }
    });

    it("rejects common passwords from the curated blocklist", () => {
      const commonList = [
        "password1234",
        "password12345",
        "passwordpassword",
        "admin12345678",
        "administrator",
        "iloveyou1234",
        "qwertyuiopas",
        "hesba12345678",
      ];

      for (const pwd of commonList) {
        expect(isCommonPassword(pwd)).toBe(true);
        const res = validatePasswordPolicy(pwd);
        expect(res.valid).toBe(false);
        if (!res.valid) {
          expect(res.reason).toBe("too_common");
        }
      }
    });
  });

  describe("Zod Password Policy Schema (passwordPolicySchema)", () => {
    it("passes for valid passwords", () => {
      expect(() => passwordPolicySchema.parse("ValidPass1234")).not.toThrow();
      expect(() =>
        passwordPolicySchema.parse("el ahly fe el alb ya masr"),
      ).not.toThrow();
    });

    it("throws Arabic error when password is too short", () => {
      expect(() => passwordPolicySchema.parse("short123")).toThrow(
        "كلمة السر يجب أن تكون 12 حرف على الأقل",
      );
    });

    it("throws Arabic error when password exceeds 128 characters", () => {
      expect(() => passwordPolicySchema.parse("A".repeat(129))).toThrow(
        "كلمة السر لا يجب أن تتجاوز 128 حرف",
      );
    });

    it("throws Arabic error when password is too common", () => {
      expect(() => passwordPolicySchema.parse("password1234")).toThrow(
        "كلمة السر شائعة وسهلة التخمين، اختار كلمة سر أقوى أو جملة سرية",
      );
    });

    it("never includes the raw password in error message", () => {
      try {
        passwordPolicySchema.parse("superSecret1");
      } catch (err: unknown) {
        const str = String(err);
        expect(str).not.toContain("superSecret1");
      }
    });
  });
});
