import "server-only";

/**
 * @file password.service.ts
 * @description Argon2id password hashing for phone + password login.
 *
 * @usedBy
 * `signup.service.ts`, `login.service.ts`, `forgot-password.service.ts`.
 */

import { hash, verify } from "@node-rs/argon2";

// A REAL Argon2id hash with the same parameters as {@link hashPassword} (QA-38): verifying
// against it costs exactly what a wrong password on an existing account costs. The previous
// placeholder was not valid base64, so verify failed in ~0.1 ms and "unknown phone" answered
// faster than "wrong password" (measured 0.11 ms vs 12.9 ms locally).
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$dAK6PkyaF/cA6rrDt4EQtg$5s8HBhCua8jzM1BkXBF77Bs2qNzqdtc2W8arqx5tHpY";

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
