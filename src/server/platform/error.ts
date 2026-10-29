import "server-only";
import { z } from "zod";

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
 * Converts any unknown error into a safe standardized JSON error response.
 * Never leaks stack traces, database schema, or internal credentials to clients.
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

  return AppError.internal().toResponse(requestId);
}
