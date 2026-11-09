import "server-only";

/**
 * @file password.service.ts
 * @description Argon2id password hashing for phone + password login.
 *
 * @usedBy
 * `signup.service.ts`, `login.service.ts`, `forgot-password.service.ts`.
 */

import { hash, verify } from "@node-rs/argon2";

// Precomputed dummy Argon2id hash used to prevent timing attacks when account does not exist
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$dummySalt12345678$dummyHashResultValuePlaceholderForTimingProtection";

/** Hashes a password with Argon2id (19 MiB memory, 2 iterations, 1 lane). */
export async function hashPassword(password: string): Promise<string> {
  return await hash(password, {
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

/** @returns `true` only for a matching password; a malformed hash also returns `false`. */
export async function verifyPassword(
  passwordHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}

/**
 * Runs a verify against a fixed hash when the account does not exist, intended to make
 * "unknown phone" take as long as "wrong password" so response time does not reveal which
 * phones are registered.
 */
export async function dummyVerifyTimingProtection(): Promise<void> {
  try {
    await verify(DUMMY_ARGON2_HASH, "timingProtectionDummyPassword");
  } catch {
    // Ignore error as this is purely for timing uniformity
  }
}
