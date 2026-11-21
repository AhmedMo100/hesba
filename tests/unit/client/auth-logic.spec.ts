import { describe, expect, it } from "vitest";
import {
  GOVERNORATES,
  SHOP_TYPES,
  normDigits,
  okPhone,
  okMail,
  validateSignup,
  isEmailIdentifier,
} from "@/client/features/auth/auth.logic";
import { validatePasswordPolicy } from "@/domain";

describe("GOVERNORATES", () => {
  it("has 27 entries", () => {
    expect(GOVERNORATES).toHaveLength(27);
  });
  it("starts with Cairo", () => {
    expect(GOVERNORATES[0]).toBe("القاهرة");
  });
});

describe("SHOP_TYPES", () => {
  it("has 5 entries", () => {
    expect(SHOP_TYPES).toHaveLength(5);
  });
});

describe("normDigits", () => {
  it("converts Arabic-Indic digits to Western", () => {
    expect(normDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });
  it("keeps Western digits unchanged", () => {
    expect(normDigits("0123456789")).toBe("0123456789");
  });
  it("preserves non-digit characters", () => {
    expect(normDigits("أحمد ٠١٠")).toBe("أحمد 010");
  });
});

describe("okPhone", () => {
  it("accepts valid Vodafone number", () => {
    expect(okPhone("01012345678")).toBe(true);
  });
  it("accepts valid Etisalat number", () => {
    expect(okPhone("01112345678")).toBe(true);
  });
  it("accepts valid Orange number", () => {
    expect(okPhone("01212345678")).toBe(true);
  });
  it("accepts valid WE number", () => {
    expect(okPhone("01512345678")).toBe(true);
  });
  it("rejects wrong prefix", () => {
    expect(okPhone("01312345678")).toBe(false);
  });
  it("rejects too short", () => {
    expect(okPhone("0101234567")).toBe(false);
  });
  it("rejects too long", () => {
    expect(okPhone("010123456789")).toBe(false);
  });
  it("accepts Arabic-Indic digits", () => {
    expect(okPhone("٠١٠١٢٣٤٥٦٧٨")).toBe(true);
  });
  it("ignores spaces and dashes", () => {
    expect(okPhone("010-1234-5678")).toBe(true);
    expect(okPhone("010 1234 5678")).toBe(true);
  });
});

describe("okMail", () => {
  it("accepts valid email", () => {
    expect(okMail("user@example.com")).toBe(true);
  });
  it("rejects empty", () => {
    expect(okMail("")).toBe(false);
  });
  it("rejects no @", () => {
    expect(okMail("userexample.com")).toBe(false);
  });
  it("rejects short TLD", () => {
    expect(okMail("user@example.c")).toBe(false);
  });
  it("trims whitespace", () => {
    expect(okMail("  user@example.com  ")).toBe(true);
  });
});

describe("isEmailIdentifier", () => {
  it("returns true for email", () => {
    expect(isEmailIdentifier("user@example.com")).toBe(true);
  });
  it("returns false for phone", () => {
    expect(isEmailIdentifier("01012345678")).toBe(false);
  });
});

const t = (key: string) => key;

describe("validateSignup", () => {
  const valid = {
    storeName: "سوبر ماركت البركة",
    phone: "01012345678",
    email: "test@example.com",
    password: "Cairo2026Pass",
  };

  it("returns empty object when all fields valid", () => {
    expect(validateSignup(valid, t, validatePasswordPolicy)).toEqual({});
  });

  it("returns storeName error when empty", () => {
    const errs = validateSignup(
      { ...valid, storeName: "" },
      t,
      validatePasswordPolicy,
    );
    expect(errs["storeName"]).toBe("errors.writeStoreName");
  });

  it("returns phone error for invalid number", () => {
    const errs = validateSignup(
      { ...valid, phone: "0131234" },
      t,
      validatePasswordPolicy,
    );
    expect(errs["phone"]).toBe("errors.invalidPhone");
  });

  it("accepts Arabic-Indic phone digits", () => {
    const errs = validateSignup(
      { ...valid, phone: "٠١٠١٢٣٤٥٦٧٨" },
      t,
      validatePasswordPolicy,
    );
    expect(errs["phone"]).toBeUndefined();
  });

  it("allows empty email (optional)", () => {
    const errs = validateSignup(
      { ...valid, email: "" },
      t,
      validatePasswordPolicy,
    );
    expect(errs["email"]).toBeUndefined();
  });

  it("returns email error when invalid format", () => {
    const errs = validateSignup(
      { ...valid, email: "bad" },
      t,
      validatePasswordPolicy,
    );
    expect(errs["email"]).toBe("errors.invalidEmail");
  });

  it("returns password error for too short", () => {
    const errs = validateSignup(
      { ...valid, password: "Ab1" },
      t,
      validatePasswordPolicy,
    );
    expect(errs["password"]).toBe("auth.passwordLength");
  });

  it("returns password error for missing letter", () => {
    const errs = validateSignup(
      { ...valid, password: "123456789012" },
      t,
      validatePasswordPolicy,
    );
    expect(errs["password"]).toBe("auth.passwordMissingLetter");
  });

  it("returns password error for missing number", () => {
    const errs = validateSignup(
      { ...valid, password: "abcdefghijkl" },
      t,
      validatePasswordPolicy,
    );
    expect(errs["password"]).toBe("auth.passwordMissingNumber");
  });
});
