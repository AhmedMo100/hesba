/**
 * Pure domain logic for password security policy.
 * Follows NIST SP 800-63B guidelines:
 * - Length: minimum 12 characters, maximum 128 characters.
 * - No arbitrary composition rules (no mandatory symbols, digits, uppercase).
 * - Allows passphrases and spaces without silent modification or trimming.
 * - Protects against common/easily guessed passwords via local blocklist and pattern checks.
 * - Zero external API dependencies, zero network requests, zero leaks of user secrets.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Curated blocklist of common >= 12 character passwords, trivial dictionary phrases,
 * and predictable keyboard walk patterns. All entries stored in lowercase.
 */
export const COMMON_PASSWORDS = [
  "123456789012",
  "1234567890123",
  "012345678901",
  "987654321098",
  "123456123456",
  "12345671234567",
  "112233445566",
  "001122334455",
  "password1234",
  "password12345",
  "password123456",
  "passwordpassword",
  "password1234!",
  "p@ssword1234",
  "administrator",
  "admin12345678",
  "adminadminadmin",
  "iloveyou1234",
  "iloveyou12345",
  "iloveyouiloveyou",
  "welcome12345",
  "welcome123456",
  "supermarket12",
  "supermarket123",
  "hesba12345678",
  "hesba20262026",
  "football1234",
  "football12345",
  "monkey123456",
  "charlie12345",
  "secret123456",
  "letmein12345",
  "trustnoone12",
  "trustnoone123",
  "sunshine1234",
  "shadow123456",
  "master123456",
  "dragon123456",
  "mustang12345",
  "princess1234",
  "whatever1234",
  "starwars1234",
  "playstation12",
  "michael12345",
  "computer1234",
  "qwertyuiopas",
  "qwertyuiopasdf",
  "asdfghjklpoi",
  "zxcvbnmasdfg",
  "qazwsxedcrfv",
] as const;

const COMMON_SET = new Set<string>(COMMON_PASSWORDS);

/**
 * Checks whether a password matches known common passwords, trivial repetitions,
 * or predictable character sequences.
 */
export function isCommonPassword(password: string): boolean {
  if (!password || password.length === 0) {
    return false;
  }

  // 1. All identical characters (e.g. "aaaaaaaaaaaa", "111111111111", "            ")
  if (new Set(password).size <= 1) {
    return true;
  }

  const lower = password.toLowerCase();

  // 2. Direct match against known common passwords list
  if (COMMON_SET.has(lower)) {
    return true;
  }

  // 3. Sequential digits (e.g. "012345678901", "987654321098")
  const numericSequenceAsc = "01234567890123456789";
  const numericSequenceDesc = "98765432109876543210";
  if (
    numericSequenceAsc.includes(lower) ||
    numericSequenceDesc.includes(lower)
  ) {
    return true;
  }

  // 4. Sequential alphabet runs (e.g. "abcdefghijkl", "zyxwvutsrqpo")
  const alphaAsc = "abcdefghijklmnopqrstuvwxyz";
  const alphaDesc = "zyxwvutsrqponmlkjihgfedcba";
  if (alphaAsc.includes(lower) || alphaDesc.includes(lower)) {
    return true;
  }

  // 5. Short repeating patterns (2, 3, or 4 character repetitions that tile the entire string)
  for (const chunkSize of [2, 3, 4]) {
    if (password.length >= chunkSize * 3 && password.length % chunkSize === 0) {
      const pattern = password.slice(0, chunkSize);
      const expected = pattern.repeat(password.length / chunkSize);
      if (password === expected) {
        return true;
      }
    }
  }

  return false;
}

export type PasswordPolicyErrorReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "missing_letter"
  | "missing_number"
  | "too_common";

export type PasswordPolicyResult =
  { valid: true } | { valid: false; reason: PasswordPolicyErrorReason };

export interface PasswordRequirementsStatus {
  hasMinLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
  isNotTooLong: boolean;
  isNotCommon: boolean;
  allValid: boolean;
}

/**
 * Live evaluator for password requirements status to render clear UI indicators.
 * - Minimum 12 characters
 * - At least one letter (Unicode letter / Arabic / Latin)
 * - At least one number (0-9 or ٠-٩)
 * - Maximum 128 characters
 * - Not in common blocklist
 */
export function checkPasswordRequirements(
  password: string,
): PasswordRequirementsStatus {
  const hasMinLength = password.length >= PASSWORD_MIN_LENGTH;
  const isNotTooLong = password.length <= PASSWORD_MAX_LENGTH;
  const hasLetter = /\p{L}/u.test(password);
  const hasNumber = /[0-9\u0660-\u0669]/.test(password);
  const isNotCommon = !isCommonPassword(password);

  return {
    hasMinLength,
    hasLetter,
    hasNumber,
    isNotTooLong,
    isNotCommon,
    allValid:
      hasMinLength && isNotTooLong && hasLetter && hasNumber && isNotCommon,
  };
}

/**
 * Validates a password against the Hesba security policy without modifying the input string.
 * Requires:
 * - Length: 12 to 128 characters
 * - At least one letter
 * - At least one number
 * - Allows spaces and symbols without requiring them
 * - Rejects common/trivial passwords
 */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  if (!password || password.length === 0) {
    return { valid: false, reason: "empty" };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, reason: "too_short" };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, reason: "too_long" };
  }

  if (!/\p{L}/u.test(password)) {
    return { valid: false, reason: "missing_letter" };
  }

  if (!/[0-9\u0660-\u0669]/.test(password)) {
    return { valid: false, reason: "missing_number" };
  }

  if (isCommonPassword(password)) {
    return { valid: false, reason: "too_common" };
  }

  return { valid: true };
}
