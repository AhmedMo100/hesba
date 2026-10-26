import { describe, it, expect } from "vitest";
import { validateEnv } from "@/server/config/env";

describe("Environment configuration validator", () => {
  const validMockEnv = {
    HESBA_DATABASE_URL: "postgres://hesba_app:secret-pw@localhost:5432/hesba",
    HESBA_DIRECT_URL:
      "postgres://hesba_migrator:secret-pw@localhost:5432/hesba",
    HESBA_SESSION_SECRET: "this-is-a-very-long-secret-key-32-chars-long",
    HESBA_CRON_SECRET: "cron-secret-key-1234",
    HESBA_APP_ORIGIN: "http://localhost:3000",
  };

  it("validates successfully when all required variables are present and sets defaults", () => {
    const validated = validateEnv(validMockEnv);

    expect(validated.HESBA_DATABASE_URL).toBe(validMockEnv.HESBA_DATABASE_URL);
    expect(validated.HESBA_POSTGRES_PORT).toBe(5432);
    expect(validated.HESBA_SMS_PROVIDER).toBe("mock");
    expect(validated.HESBA_LLM_PROVIDER).toBe("mock");
    expect(validated.NODE_ENV).toBe("development");
  });

  it("refuses to start and prints missing variable names when required variables are absent", () => {
    const invalidEnv = {
      HESBA_APP_ORIGIN: "http://localhost:3000",
      // Missing HESBA_DATABASE_URL, HESBA_DIRECT_URL, HESBA_SESSION_SECRET, HESBA_CRON_SECRET
    };

    expect(() => validateEnv(invalidEnv)).toThrowError(
      /Missing or invalid environment variables/,
    );

    try {
      validateEnv(invalidEnv);
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).toContain("HESBA_DATABASE_URL");
      expect(message).toContain("HESBA_DIRECT_URL");
      expect(message).toContain("HESBA_SESSION_SECRET");
      expect(message).toContain("HESBA_CRON_SECRET");
    }
  });

  it("never prints variable values in error messages", () => {
    const sensitiveInvalidEnv = {
      HESBA_DATABASE_URL:
        "postgres://hesba_app:very_secret_db_password_123@localhost:5432/hesba",
      HESBA_DIRECT_URL:
        "postgres://hesba_migrator:another_secret_migrator_pw@localhost:5432/hesba",
      HESBA_SESSION_SECRET: "short", // invalid because < 16 chars
      HESBA_CRON_SECRET: "cron", // invalid because < 8 chars
      HESBA_APP_ORIGIN: "not-a-valid-url", // invalid URL
    };

    try {
      validateEnv(sensitiveInvalidEnv);
      expect.fail("Expected validateEnv to throw");
    } catch (err: unknown) {
      const message = (err as Error).message;
      // It names the invalid keys
      expect(message).toContain("HESBA_SESSION_SECRET");
      expect(message).toContain("HESBA_CRON_SECRET");
      expect(message).toContain("HESBA_APP_ORIGIN");

      // It NEVER prints the actual secret values
      expect(message).not.toContain("very_secret_db_password_123");
      expect(message).not.toContain("another_secret_migrator_pw");
      expect(message).not.toContain("not-a-valid-url");
    }
  });
});
