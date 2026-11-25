import { describe, it, expect, vi } from "vitest";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";

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
    // QA-18: never "شغلك محفوظ" (your work is saved) — a failed request saved nothing.
    expect(body.error.message).toBe("حصل خطأ غير متوقع في السيرفر. جرّب تاني.");
    expect(body.error.message).not.toContain("محفوظ");
    expect(body.error.request_id).toBe("req_999");

    // Without a caller id, an unexpected failure still gets one (logged + returned) for support.
    const anon = await toSafeErrorResponse(new Error("boom")).json();
    expect(anon.error.request_id).toMatch(/^[0-9a-f]{8}$/);

    // Must never leak database schema or internal query in client response
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("relation 'users' does not exist");
    expect(raw).not.toContain("postgres.internal.execute");
  });

  it("converts ZodError into 400 VALIDATION_ERROR with safe Arabic message and field name", async () => {
    const { z } = await import("zod");
    const testSchema = z.object({
      password: z.string().min(12, "كلمة السر يجب أن تكون 12 حرف على الأقل"),
    });

    let caughtError: unknown;
    try {
      testSchema.parse({ password: "short" });
    } catch (e) {
      caughtError = e;
    }

    const response = toSafeErrorResponse(caughtError, "req_val_1");
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("كلمة السر يجب أن تكون 12 حرف على الأقل");
    expect(body.error.details).toEqual({ field: "password" });
    expect(body.error.request_id).toBe("req_val_1");
  });

  // QA-18 / QA-19: request mistakes are 4xx, not 500s that hide real incidents.
  it("maps a malformed JSON body (SyntaxError) to 400", async () => {
    let err: unknown;
    try {
      JSON.parse("{not json");
    } catch (e) {
      err = e;
    }
    const res = toSafeErrorResponse(err);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  const prismaError = (code: string, meta?: Record<string, unknown>) =>
    Object.assign(new Error("prisma"), {
      name: "PrismaClientKnownRequestError",
      code,
      meta,
    });

  it("maps a malformed id (P2023, or 22P02 from a raw query) to 400", async () => {
    expect(toSafeErrorResponse(prismaError("P2023")).status).toBe(400);
    expect(
      toSafeErrorResponse(prismaError("P2010", { code: "22P02" })).status,
    ).toBe(400);
    // Another raw-query failure stays a 500.
    expect(
      toSafeErrorResponse(prismaError("P2010", { code: "40001" })).status,
    ).toBe(500);
  });

  it("maps a missing record (P2025) to 404 and a unique violation (P2002) to 409", async () => {
    expect(toSafeErrorResponse(prismaError("P2025")).status).toBe(404);
    expect(toSafeErrorResponse(prismaError("P2002")).status).toBe(409);
  });

  it("a missing table / column (pending migration) is a 500, logged as a schema mismatch", async () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      for (const err of [
        prismaError("P2021"),
        prismaError("P2022"),
        prismaError("P2010", { code: "42P01" }),
        prismaError("P2010", { code: "42703" }),
        new Error('relation "money_movements" does not exist'),
      ]) {
        spy.mockClear();
        const res = toSafeErrorResponse(err);
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error.code).toBe("INTERNAL_ERROR");
        expect(JSON.stringify(body)).not.toContain("money_movements");
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({ schemaMismatch: true }),
          expect.stringContaining("schema is behind the code"),
        );
      }
      // Any other failure keeps the generic log line.
      spy.mockClear();
      toSafeErrorResponse(new Error("boom"));
      expect(spy).toHaveBeenCalledWith(
        expect.not.objectContaining({ schemaMismatch: true }),
        "Internal API error",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("the database-unreachable 503 does not claim the work was saved", async () => {
    const res = toSafeErrorResponse(prismaError("P1001"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.message).not.toContain("محفوظ");
  });
});
