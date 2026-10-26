import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "@/server/platform/logger";

describe("Logger redaction policy", () => {
  it("proves redaction: masks secrets, tokens, phone numbers, names, and never outputs raw values", () => {
    let logOutput = "";

    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logOutput += chunk.toString();
        callback();
      },
    });

    const testLogger = createLogger({ level: "info" }, destination);

    const sensitiveData = {
      user: {
        id: "usr_12345",
        name: "Ahmed Tarek",
        phone: "01012345678",
        mobile: "01287654321",
        password: "super_secret_password_xyz",
        token: "session_token_abc123",
        pin: "1234",
      },
      auth: {
        secret: "app_secret_top_secret",
        sessionToken: "bearer_xyz_987",
        cardNumber: "5412751234567890",
      },
      metadata: {
        safeField: "safe-content",
        storeId: "store_999",
      },
    };

    testLogger.info(sensitiveData, "User profile accessed");

    const parsed = JSON.parse(logOutput.trim());

    // 1. Verify safe fields are preserved
    expect(parsed.metadata.safeField).toBe("safe-content");
    expect(parsed.metadata.storeId).toBe("store_999");
    expect(parsed.user.id).toBe("usr_12345");

    // 2. Verify sensitive fields are replaced by [REDACTED]
    expect(parsed.user.name).toBe("[REDACTED]");
    expect(parsed.user.phone).toBe("[REDACTED]");
    expect(parsed.user.mobile).toBe("[REDACTED]");
    expect(parsed.user.password).toBe("[REDACTED]");
    expect(parsed.user.token).toBe("[REDACTED]");
    expect(parsed.user.pin).toBe("[REDACTED]");
    expect(parsed.auth.secret).toBe("[REDACTED]");
    expect(parsed.auth.sessionToken).toBe("[REDACTED]");
    expect(parsed.auth.cardNumber).toBe("[REDACTED]");

    // 3. Verify raw sensitive string literals never appear anywhere in the output
    expect(logOutput).not.toContain("Ahmed Tarek");
    expect(logOutput).not.toContain("01012345678");
    expect(logOutput).not.toContain("01287654321");
    expect(logOutput).not.toContain("super_secret_password_xyz");
    expect(logOutput).not.toContain("session_token_abc123");
    expect(logOutput).not.toContain("app_secret_top_secret");
    expect(logOutput).not.toContain("bearer_xyz_987");
    expect(logOutput).not.toContain("5412751234567890");
  });
});
