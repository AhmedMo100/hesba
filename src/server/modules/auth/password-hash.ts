/**
 * @file password-hash.ts
 * @description The ONE Argon2id configuration of Hesba. The app (`password.service.ts`) and the
 * admin reset tool (`scripts/admin-reset-password.ts`, which runs outside Next and so cannot
 * import `server-only` modules) both hash through here, so a temporary password is stored
 * exactly like any other password.
 */

import { hash } from "@node-rs/argon2";

/** Argon2id, 19 MiB memory, 2 iterations, 1 lane, 32-byte output (OWASP minimum profile). */
export const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const;

export async function argon2idHash(password: string): Promise<string> {
  return await hash(password, ARGON2_OPTIONS);
}
