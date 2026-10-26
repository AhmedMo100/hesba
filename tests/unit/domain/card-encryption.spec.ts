import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptCardSecret,
  encryptCardSecret,
} from "@/server/infra/crypto/card-encryption";

describe("server/crypto - card serial and PIN encryption (AES-256-GCM)", () => {
  beforeAll(() => {
    if (!process.env["HESBA_CARD_KEY"]) {
      // Ephemeral 32-byte hex key for CI unit testing
      process.env["HESBA_CARD_KEY"] =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }
  });

  const sampleCardNumber = "1234567890123456";
  const samplePin = "98765432109876";

  it("decrypts an encrypted card number and PIN back to the exact original plaintext", () => {
    const encryptedCard = encryptCardSecret(sampleCardNumber);
    const decryptedCard = decryptCardSecret(encryptedCard);
    expect(decryptedCard).toBe(sampleCardNumber);

    const encryptedPin = encryptCardSecret(samplePin);
    const decryptedPin = decryptCardSecret(encryptedPin);
    expect(decryptedPin).toBe(samplePin);
  });

  it("ensures the ciphertext payload never contains the plaintext value", () => {
    const encrypted = encryptCardSecret(samplePin);

    // Payload format: <nonce_hex>:<auth_tag_hex>:<ciphertext_hex>
    expect(encrypted).not.toContain(samplePin);
    expect(encrypted.toLowerCase()).not.toContain(samplePin.toLowerCase());
  });

  it("uses a cryptographically fresh nonce on every encryption call (semantic security)", () => {
    const encrypted1 = encryptCardSecret(samplePin);
    const encrypted2 = encryptCardSecret(samplePin);

    // Two encryptions of the same plaintext MUST yield different outputs
    expect(encrypted1).not.toBe(encrypted2);

    const [nonce1] = encrypted1.split(":");
    const [nonce2] = encrypted2.split(":");
    expect(nonce1).not.toBe(nonce2);

    // Both decrypt to the same original PIN
    expect(decryptCardSecret(encrypted1)).toBe(samplePin);
    expect(decryptCardSecret(encrypted2)).toBe(samplePin);
  });

  it("fails to decrypt if ciphertext or authentication tag has been tampered with", () => {
    const encrypted = encryptCardSecret(samplePin);
    const parts = encrypted.split(":");
    const [nonceHex, authTagHex, ciphertextHex] = parts;

    // Tamper with ciphertext by flipping last character
    const tamperedCiphertext =
      ciphertextHex!.slice(0, -1) + (ciphertextHex!.endsWith("0") ? "1" : "0");
    const tamperedPayload = `${nonceHex}:${authTagHex}:${tamperedCiphertext}`;

    expect(() => decryptCardSecret(tamperedPayload)).toThrow();

    // Tamper with auth tag
    const tamperedTag =
      authTagHex!.slice(0, -1) + (authTagHex!.endsWith("0") ? "1" : "0");
    const tamperedTagPayload = `${nonceHex}:${tamperedTag}:${ciphertextHex}`;

    expect(() => decryptCardSecret(tamperedTagPayload)).toThrow();
  });
});
