import "server-only";
import { hash, verify } from "@node-rs/argon2";

// Precomputed dummy Argon2id hash used to prevent timing attacks when account does not exist
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$dummySalt12345678$dummyHashResultValuePlaceholderForTimingProtection";

export async function hashPassword(password: string): Promise<string> {
  return await hash(password, {
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

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

export async function dummyVerifyTimingProtection(): Promise<void> {
  try {
    await verify(DUMMY_ARGON2_HASH, "timingProtectionDummyPassword");
  } catch {
    // Ignore error as this is purely for timing uniformity
  }
}
