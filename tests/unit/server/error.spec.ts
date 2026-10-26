import { describe, it, expect } from "vitest";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";

describe("AppError model and safe error response", () => {
  it("creates AppError with code, safe message, and status code", () => {
    const err = AppError.badRequest("قيمة غير مقبولة", { field: "price" });

    expect(err.code).toBe("BAD_REQUEST");
    expect(err.safeMessage).toBe("قيمة غير مقبولة");
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ field: "price" });

    const json = err.toJSON("req_123");
    expect(json).toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "قيمة غير مقبولة",
        details: { field: "price" },
        request_id: "req_123",
      },
    });
  });

  it("converts AppError into safe JSON response", async () => {
    const err = AppError.unauthorized("يرجى تسجيل الدخول");
    const response = toSafeErrorResponse(err, "req_456");

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("يرجى تسجيل الدخول");
    expect(body.error.request_id).toBe("req_456");
  });

  it("safely sanitizes arbitrary internal exceptions into generic 500 without leaking stack or secrets", async () => {
    const internalCrash = new Error(
      "FATAL: relation 'users' does not exist at postgres.internal.execute()",
    );
    const response = toSafeErrorResponse(internalCrash, "req_999");

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe(
      "حصل خطأ غير متوقع في السيرفر. شغلك محفوظ.",
    );
    expect(body.error.request_id).toBe("req_999");

    // Must never leak database schema or internal query in client response
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("relation 'users' does not exist");
    expect(raw).not.toContain("postgres.internal.execute");
  });
});
