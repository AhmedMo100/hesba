import "server-only";
import pino, { type LoggerOptions, type DestinationStream } from "pino";

export const REDACTED_PATHS = [
  "password",
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
