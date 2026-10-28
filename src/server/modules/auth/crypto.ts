import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Computes SHA-256 hash of a string/token.
 * Used for hashing session tokens, email verification tokens, and recovery tokens.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a cryptographically strong random token string (base64url).
 */
export function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}
