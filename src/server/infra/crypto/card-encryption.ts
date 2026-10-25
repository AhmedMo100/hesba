import "server-only";
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH_BYTES = 12; // 96-bit nonce for GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128-bit auth tag

function getEncryptionKey(): Buffer {
  if (!process.env["HESBA_CARD_KEY"]) {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      try {
        process.loadEnvFile(".env");
      } catch {
        // Ignore if env file does not exist
      }
    }
  }

  const rawKey = process.env["HESBA_CARD_KEY"];
  if (!rawKey) {
    throw new Error(
      "Missing required HESBA_CARD_KEY environment variable for card encryption.",
    );
  }

  // Support base64 (44 chars), hex (64 chars), or raw 32-byte string
  if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }

  const base64Buffer = Buffer.from(rawKey, "base64");
  if (base64Buffer.length === 32) {
    return base64Buffer;
  }

  const utf8Buffer = Buffer.from(rawKey, "utf8");
  if (utf8Buffer.length === 32) {
    return utf8Buffer;
  }

  // Derive 32-byte key via SHA-256 if custom length string provided
  return crypto.createHash("sha256").update(rawKey).digest();
}

/**
 * Encrypts a sensitive card number or voucher PIN using AES-256-GCM.
 * Generates a cryptographically fresh 96-bit nonce per encryption.
 * Format: `<nonce_hex>:<auth_tag_hex>:<ciphertext_hex>`
 */
export function encryptCardSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TypeError("Plaintext must be a non-empty string");
  }

  const key = getEncryptionKey();
  const nonce = crypto.randomBytes(NONCE_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${nonce.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a card number or voucher PIN previously encrypted with AES-256-GCM.
 * Throws an error if the ciphertext or authentication tag has been tampered with.
 */
export function decryptCardSecret(encryptedPayload: string): string {
  if (typeof encryptedPayload !== "string") {
    throw new TypeError("Encrypted payload must be a string");
  }

  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted payload format. Expected nonce:tag:ciphertext",
    );
  }

  const [nonceHex, authTagHex, ciphertextHex] = parts;
  if (!nonceHex || !authTagHex || !ciphertextHex) {
    throw new Error("Invalid encrypted payload segments");
  }

  const key = getEncryptionKey();
  const nonce = Buffer.from(nonceHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  if (nonce.length !== NONCE_LENGTH_BYTES) {
    throw new Error(
      `Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes`,
    );
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(
      `Invalid auth tag length: expected ${AUTH_TAG_LENGTH_BYTES} bytes`,
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
