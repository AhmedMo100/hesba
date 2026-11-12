import "server-only";

/**
 * @file logger.ts
 * @description The server's structured JSON logger (pino).
 *
 * @remarks
 * Personal data must not reach the logs (AGENTS.md rule 12). Values at the keys in
 * `REDACTED_PATHS` (top level and up to two levels deep for most keys) are replaced with
 * `[REDACTED]`; any other key is logged as-is, so log ids rather than personal fields.
 * The level comes from `LOG_LEVEL` (default `info`).
 */

import pino, { type LoggerOptions, type DestinationStream } from "pino";

export const REDACTED_PATHS = [
  "password",
  "newPassword",
  "confirmPassword",
  "secret",
  "token",
  "sessionToken",
  "sessionId",
  "session_token",
  "phone",
  "mobile",
  "phoneNumber",
  "phone_number",
  "otp",
  "code",
  "pin",
  "cardNumber",
  "card_number",
  "card_serial",
  "name",
  "customerName",
  "supplierName",
  "authorization",
  "cookie",
  "*.password",
  "*.newPassword",
  "*.confirmPassword",
  "*.secret",
  "*.token",
  "*.sessionToken",
  "*.phone",
  "*.mobile",
  "*.phoneNumber",
  "*.phone_number",
  "*.otp",
  "*.code",
  "*.pin",
  "*.cardNumber",
  "*.name",
  "*.authorization",
  "*.cookie",
  "*.*.password",
  "*.*.newPassword",
  "*.*.confirmPassword",
  "*.*.token",
  "*.*.secret",
  "*.*.phone",
  "*.*.mobile",
];

export function createLogger(
  options?: LoggerOptions,
  destination?: DestinationStream,
) {
  return pino(
    {
      level: process.env["LOG_LEVEL"] || "info",
      redact: {
        paths: REDACTED_PATHS,
        censor: "[REDACTED]",
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      ...options,
    },
    destination,
  );
}

export const logger = createLogger();
