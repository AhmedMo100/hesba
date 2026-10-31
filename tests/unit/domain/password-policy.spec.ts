import { describe, it, expect } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  validatePasswordPolicy,
  checkPasswordRequirements,
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
      const res = validatePasswordPolicy("11charPass1"); // 11 chars
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("too_short");
      }
    });

    it("accepts valid password at exact minimum length of 12 characters with letter and number", () => {
      const res = validatePasswordPolicy("CairoBakery2"); // 12 chars, not common
      expect(res.valid).toBe(true);
    });

    it("accepts valid password at exact maximum length of 128 characters", () => {
      // 128 chars: varied passphrase with letters and numbers
      const pwd128 =
        "ElAhly-Hesba-Supermarket-Store-Manager-2026-Cairo-Egypt-Giza-Secure-Token-Wallet-Inventory-Batch-Stock-Supplier-Sale-Point-Cashier1";
      const exact128 = pwd128.slice(0, 128);
      expect(exact128.length).toBe(128);

      const res = validatePasswordPolicy(exact128);
      expect(res.valid).toBe(true);
    });

    it("rejects password exceeding maximum length of 128 characters", () => {
      const pwd129 = "A1".repeat(65); // 130 chars
      const res = validatePasswordPolicy(pwd129);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("too_long");
      }
    });
  });

  describe("Character Requirements: At least 1 letter and 1 number", () => {
    it("rejects password with no letters (numbers only)", () => {
      const digitsOnly = "9875412036541"; // 13 digits, not common
      const res = validatePasswordPolicy(digitsOnly);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("missing_letter");
      }
    });

    it("rejects password with no numbers (letters and spaces only)", () => {
      const lettersOnly = "correcthorsebatterystaple";
      const res = validatePasswordPolicy(lettersOnly);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("missing_number");
      }
    });

    it("accepts password with at least one letter and at least one number", () => {
      const valid = "correcthorsebattery1";
      const res = validatePasswordPolicy(valid);
      expect(res.valid).toBe(true);
    });

    it("accepts Arabic letters and Arabic/Eastern numerals", () => {
      const arabicValid = "حسبة_سوبر_ماركت_٢٠٢٦";
      const res = validatePasswordPolicy(arabicValid);
      expect(res.valid).toBe(true);
    });
  });

  describe("Passphrase and Character Inclusivity", () => {
    it("allows spaces inside passwords without modification or trimming", () => {
      const passphrase = "el ahly fe el alb ya masr 2026";
      const res = validatePasswordPolicy(passphrase);
      expect(res.valid).toBe(true);
    });

    it("accepts complex combinations of symbols, numbers, spaces, and multilingual characters", () => {
      const mixed = "حسبة_Hesba_2026_محل!";
      const res = validatePasswordPolicy(mixed);
      expect(res.valid).toBe(true);
    });

    it("preserves leading and trailing spaces without silent trimming", () => {
      const withSpaces = "   my secure pass 123   ";
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
    });

    it("rejects sequential numeric runs", () => {
      expect(isCommonPassword("123456789012")).toBe(true);
      expect(isCommonPassword("012345678901")).toBe(true);
      expect(isCommonPassword("987654321098")).toBe(true);
    });

    it("rejects sequential alphabetical runs", () => {
      expect(isCommonPassword("abcdefghijkl")).toBe(true);
      expect(isCommonPassword("zyxwvutsrqpo")).toBe(true);
    });

    it("rejects short repeating pattern tiles", () => {
      expect(isCommonPassword("abababababab")).toBe(true);
      expect(isCommonPassword("abcabcabcabc")).toBe(true);
      expect(isCommonPassword("abcdabcdabcd")).toBe(true);
    });
  });

  describe("Live Evaluator (checkPasswordRequirements)", () => {
    it("accurately reports condition statuses for empty string", () => {
      const status = checkPasswordRequirements("");
      expect(status.hasMinLength).toBe(false);
      expect(status.hasLetter).toBe(false);
      expect(status.hasNumber).toBe(false);
      expect(status.allValid).toBe(false);
    });

    it("accurately reports when only letters are present", () => {
      const status = checkPasswordRequirements("OnlyLettersHere");
      expect(status.hasMinLength).toBe(true);
      expect(status.hasLetter).toBe(true);
      expect(status.hasNumber).toBe(false);
      expect(status.allValid).toBe(false);
    });

    it("accurately reports when all conditions are fulfilled", () => {
      const status = checkPasswordRequirements("StrongPass2026!");
      expect(status.hasMinLength).toBe(true);
      expect(status.hasLetter).toBe(true);
      expect(status.hasNumber).toBe(true);
      expect(status.isNotTooLong).toBe(true);
      expect(status.isNotCommon).toBe(true);
      expect(status.allValid).toBe(true);
    });
  });

  describe("Zod Password Policy Schema (passwordPolicySchema)", () => {
    it("passes for valid passwords with letters and numbers", () => {
      expect(() => passwordPolicySchema.parse("ValidPass1234")).not.toThrow();
      expect(() =>
        passwordPolicySchema.parse("el ahly fe el alb ya masr 2026"),
      ).not.toThrow();
    });

    it("throws Arabic error when password is too short", () => {
      expect(() => passwordPolicySchema.parse("short123")).toThrow(
        "كلمة السر يجب أن تكون 12 حرف على الأقل",
      );
    });

    it("throws Arabic error when password lacks letters", () => {
      expect(() => passwordPolicySchema.parse("1234567890123")).toThrow(
        "كلمة السر يجب أن تحتوي على حرف واحد على الأقل",
      );
    });

    it("throws Arabic error when password lacks numbers", () => {
      expect(() =>
        passwordPolicySchema.parse("LongPasswordWithoutNumbers"),
      ).toThrow("كلمة السر يجب أن تحتوي على رقم واحد على الأقل");
    });

    it("throws Arabic error when password exceeds 128 characters", () => {
      expect(() => passwordPolicySchema.parse("A1".repeat(65))).toThrow(
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
