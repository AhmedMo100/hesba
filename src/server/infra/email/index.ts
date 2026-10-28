import "server-only";
import type { EmailProvider } from "./provider";
import { mockEmailProvider } from "./mock-provider";
import { ResendEmailProvider } from "./resend-provider";
import { env } from "@/server/config/env";
import { logger } from "@/server/platform/logger";

export * from "./provider";
export * from "./mock-provider";
export * from "./resend-provider";

let resendProviderInstance: ResendEmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  // Automated tests must ALWAYS use deterministic mock provider without external HTTP calls
  if (process.env.NODE_ENV === "test") {
    return mockEmailProvider;
  }

  // If RESEND_API_KEY is configured, use real production Resend adapter
  if (env.RESEND_API_KEY) {
    if (!resendProviderInstance) {
      resendProviderInstance = new ResendEmailProvider(
        env.RESEND_API_KEY,
        env.RESEND_FROM_EMAIL,
      );
    }
    return resendProviderInstance;
  }

  // Production must fail closed if required email provider configuration is missing
  if (process.env.NODE_ENV === "production") {
    logger.error("FATAL: RESEND_API_KEY is missing in production environment");
    throw new Error(
      "RESEND_API_KEY is required in production. Configure RESEND_API_KEY to send transactional recovery emails.",
    );
  }

  // Development fallback when no RESEND_API_KEY is configured
  return mockEmailProvider;
}
