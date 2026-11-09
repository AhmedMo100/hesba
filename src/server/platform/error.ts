import "server-only";

/**
 * @file error.ts
 * @description The API error contract: `AppError` and the single converter every route
 * handler uses in its `catch` block.
 *
 * @usedBy
 * All route handlers under `src/app/api` and the server modules that throw `AppError`.
 *
 * @remarks
 * Error body shape: `{ error: { code, message, details?, request_id? } }`, where `message` is a
 * short Arabic text safe to show to the user. Internal details (stack, SQL, Prisma messages)
 * are logged, never returned.
 */

import { z } from "zod";
import { logger } from "@/server/platform/logger";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "MAINTENANCE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ErrorResponsePayload {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}

/**
 * Standard Application Error carrying a stable machine-readable code
 * and a safe colloquial Arabic user-facing message.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly safeMessage: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    safeMessage: string,
    statusCode = 400,
    details?: unknown,
  ) {
    super(safeMessage);
    this.name = "AppError";
    this.code = code;
    this.safeMessage = safeMessage;
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(
    message = "البيانات المدخلة غير صحيحة",
    details?: unknown,
  ): AppError {
    return new AppError("BAD_REQUEST", message, 400, details);
  }

  static unauthorized(message = "سجّل دخولك للمتابعة"): AppError {
    return new AppError("UNAUTHORIZED", message, 401);
  }

  static forbidden(message = "ليس لديك صلاحية لتنفيذ هذا الإجراء"): AppError {
    return new AppError("FORBIDDEN", message, 403);
  }

  static notFound(message = "العنصر المطلوب غير موجود"): AppError {
    return new AppError("NOT_FOUND", message, 404);
  }

  static conflict(message = "يوجد تعارض في العملية"): AppError {
    return new AppError("CONFLICT", message, 409);
  }

  static rateLimited(
    message = "تجاوزت الحد المسموح من المحاولات. يُرجى الانتظار والمحاولة لاحقاً.",
    details?: unknown,
  ): AppError {
    return new AppError("RATE_LIMITED", message, 429, details);
  }

  static serviceUnavailable(
    message = "الخدمة غير متوفرة حالياً. يُرجى المحاولة لاحقاً.",
    details?: unknown,
  ): AppError {
    return new AppError("SERVICE_UNAVAILABLE", message, 503, details);
  }

  static internal(
    message = "حصل خطأ غير متوقع في السيرفر. شغلك محفوظ.",
  ): AppError {
    return new AppError("INTERNAL_ERROR", message, 500);
  }

  toJSON(requestId?: string): ErrorResponsePayload {
    return {
      error: {
        code: this.code,
        message: this.safeMessage,
        ...(this.details !== undefined && { details: this.details }),
        ...(requestId && { request_id: requestId }),
      },
    };
  }

  toResponse(requestId?: string): Response {
    return Response.json(this.toJSON(requestId), {
      status: this.statusCode,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
}

/**
 * Reads a request's JSON body. A missing or malformed body is the client's mistake, so it
 * becomes a 400 `VALIDATION_ERROR` instead of an unhandled `SyntaxError` (which
 * `toSafeErrorResponse` would report as a 500).
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "البيانات المرسلة غير صحيحة", 400);
  }
}

/**
 * Converts any unknown error into a safe standardized JSON error response.
 * Never leaks stack traces, database schema, or internal credentials to clients.
 *
 * Mapping: `AppError` → its own status; `ZodError` → 400 `VALIDATION_ERROR` with the first
 * issue's message and field path; database unreachable (initialization error / P1001) → 503;
 * anything else → 500 `INTERNAL_ERROR`. The 503 and 500 cases are written to the pino log.
 *
 * @param error - Whatever was thrown.
 * @param requestId - Optional id echoed as `request_id` in the body.
 */
export function toSafeErrorResponse(
  error: unknown,
  requestId?: string,
): Response {
  if (error instanceof AppError) {
    return error.toResponse(requestId);
  }

  if (error instanceof z.ZodError) {
    const firstIssue = error.issues[0];
    const safeMessage = firstIssue?.message || "البيانات المدخلة غير صحيحة";
    const field = firstIssue?.path ? firstIssue.path.join(".") : undefined;
    return new AppError("VALIDATION_ERROR", safeMessage, 400, {
      field,
    }).toResponse(requestId);
  }

  if (
    error instanceof Error &&
    (error.name === "PrismaClientInitializationError" ||
      error.message.includes("Can't reach database server") ||
      (error as { code?: string }).code === "P1001")
  ) {
    logger.error({ err: error, requestId }, "Database connection error");
    return AppError.serviceUnavailable(
      "تعذر الاتصال بقاعدة البيانات حالياً. جاري إعادة المحاولة... شغلك محفوظ.",
    ).toResponse(requestId);
  }

  logger.error({ err: error, requestId }, "Internal API error");
  return AppError.internal().toResponse(requestId);
}
