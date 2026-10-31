import "server-only";
import { z } from "zod";

export const envSchema = z.object({
  // Required
  HESBA_DATABASE_URL: z.string().min(1, "HESBA_DATABASE_URL cannot be empty"),
  HESBA_DIRECT_URL: z.string().min(1, "HESBA_DIRECT_URL cannot be empty"),
  HESBA_SESSION_SECRET: z
    .string()
    .min(16, "HESBA_SESSION_SECRET must be at least 16 characters"),
  HESBA_CRON_SECRET: z
    .string()
    .min(8, "HESBA_CRON_SECRET must be at least 8 characters"),
  HESBA_APP_ORIGIN: z.string().url("HESBA_APP_ORIGIN must be a valid URL"),

  // Optional / Defaults
  HESBA_POSTGRES_PORT: z.coerce.number().optional().default(5432),
  HESBA_LLM_PROVIDER: z.string().optional().default("mock"),
  HESBA_LLM_KEY: z.string().optional(),
  HESBA_SENTRY_DSN: z.string().optional(),
  HESBA_RENEWAL_VODAFONE_CASH: z.string().optional(),
  HESBA_RENEWAL_INSTAPAY: z.string().optional(),
  HESBA_RENEWAL_WHATSAPP: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .optional()
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables against the schema.
 * If any required variable is missing or invalid, refuses to start and prints the variable names only.
 * NEVER prints variable values to avoid secret leakage.
 */
export function validateEnv(
  rawEnv: Record<string, unknown> = process.env,
): Env {
  const normalizedEnv: Record<string, unknown> = { ...rawEnv };

  // If HESBA_APP_ORIGIN is not provided, check VERCEL_URL or VERCEL_PROJECT_PRODUCTION_URL
  if (!normalizedEnv["HESBA_APP_ORIGIN"]) {
    if (normalizedEnv["VERCEL_URL"]) {
      normalizedEnv["HESBA_APP_ORIGIN"] =
        `https://${normalizedEnv["VERCEL_URL"]}`;
    } else if (normalizedEnv["VERCEL_PROJECT_PRODUCTION_URL"]) {
      normalizedEnv["HESBA_APP_ORIGIN"] =
        `https://${normalizedEnv["VERCEL_PROJECT_PRODUCTION_URL"]}`;
    }
  }

  const result = envSchema.safeParse(normalizedEnv);

  if (!result.success) {
    const missingKeys = Array.from(
      new Set(
        result.error.issues.map((issue) => issue.path.join(".") || "unknown"),
      ),
    );

    const errorMessage = `[FATAL] Missing or invalid environment variables: ${missingKeys.join(", ")}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  return result.data;
}

let cachedEnv: Env | null = null;

// Lazy proxy: evaluates validateEnv on first property access, avoiding build-time route collection crashes
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (process.env.NODE_ENV === "test") {
      const current = validateEnv();
      return current[prop as keyof Env];
    }
    if (!cachedEnv) {
      cachedEnv = validateEnv();
    }
    return cachedEnv[prop as keyof Env];
  },
});
