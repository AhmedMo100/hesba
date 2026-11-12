import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/server/infra/db/client";
import {
  type ForgotPasswordRequestInput,
  forgotPasswordRequestSchema,
  type ResetPasswordWithCodeInput,
  resetPasswordWithCodeSchema,
} from "@/schemas/auth";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import { authRateLimiter } from "./rate-limiter";
import { getEmailProvider } from "@/server/infra/email";
import { env } from "@/server/config/env";
import { hashPassword } from "./password.service";
import { revokeAllUserSessions } from "./session.service";

/**
 * @file forgot-password.service.ts
 * @description Password recovery by an emailed one-time code.
 *
 * @responsibility
 * Issue a reset code by email (`requestPasswordResetCode`) and set a new password when the
 * code is correct (`resetPasswordWithCode`).
 *
 * @usedBy
 * `src/app/api/auth/forgot-password/{request,reset}/route.ts`.
 *
 * @remarks
 * - Codes are stored as an HMAC (keyed with `HESBA_SESSION_SECRET` and bound to the user id),
 *   never in plain text. They expire after 10 minutes and allow 5 wrong attempts.
 * - Requesting a code for an unknown email returns the same generic response, so the endpoint
 *   does not reveal which emails are registered.
 * - A successful reset revokes every session of the user.
 * - Rate limits: 3 requests per email and 10 per IP per hour; 15 verify attempts per IP per
 *   15 minutes (in-memory, see `rate-limiter.ts`).
 */

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CODE_ATTEMPTS = 5;

function computeKeyedCodeHash(userId: string, code: string): string {
  return crypto
    .createHmac("sha256", env.HESBA_SESSION_SECRET)
    .update(`pwd-reset:${userId}:${code}`)
    .digest("hex");
}

/** The one public answer to a reset request, whether or not the email has an account (QA-25). */
export const PASSWORD_RESET_REQUEST_RESPONSE = {
  message: "إذا كان البريد مسجلاً لدينا، تم إرسال كود التأكيد.",
} as const;

/**
 * Starts a password reset. Whatever happens — unknown email, known email, the email provider
 * failing — the caller gets the same generic answer (QA-25): nothing in the response says
 * whether the email has an account.
 *
 * For a known email a fresh 6-digit code (HMAC-hashed, 10 minutes, single use, 5 attempts)
 * replaces any unused one, and the email is sent by `deliver`. The route passes Next's
 * `after()`, so the response does not wait for the email provider (the provider's latency
 * would otherwise tell known emails apart). A failed send is logged without the address and
 * invalidates the code. Without `deliver` (tests, scripts) the send runs before returning.
 *
 * Rate limits (by email and by IP) apply before the lookup, identically for every email.
 */
export async function requestPasswordResetCode(
  rawInput: ForgotPasswordRequestInput,
  clientIp?: string,
  options: { deliver?: (task: () => Promise<void>) => void } = {},
) {
  const data = forgotPasswordRequestSchema.parse(rawInput);
  const normalizedEmail = data.email.trim().toLowerCase();

  // Rate Limiting by Email: Max 3 requests per hour
  if (
    !authRateLimiter.check(
      `pwd-reset-email:${normalizedEmail}`,
      3,
      60 * 60 * 1000,
    )
  ) {
    logger.warn("Password reset rate limit exceeded for an email");
    throw AppError.rateLimited(
      "تجاوزت الحد الأقصى لطلب الأكواد. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  // Rate Limiting by IP: Max 10 requests per hour
  if (
    clientIp &&
    !authRateLimiter.check(`pwd-reset-ip:${clientIp}`, 10, 60 * 60 * 1000)
  ) {
    logger.warn({ clientIp }, "Password reset rate limit exceeded for IP");
    throw AppError.rateLimited(
      "تجاوزت الحد الأقصى للمحاولات من هذا العنوان. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  const genericResponse = { ...PASSWORD_RESET_REQUEST_RESPONSE };

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    // No account: nothing is created, and the answer is the same as for a real account.
    return genericResponse;
  }

  // Invalidate any previously active unused reset codes
  await prisma.passwordResetCode.updateMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });

  // Generate 6-digit random code securely
  const code = String(crypto.randomInt(100000, 999999));
  const codeHash = computeKeyedCodeHash(user.id, code);
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  const newCodeRecord = await prisma.passwordResetCode.create({
    data: {
      userId: user.id,
      codeHash,
      expiresAt,
    },
  });

  const send = async () => {
    try {
      await getEmailProvider().sendPasswordResetCode(user.email, code);
      logger.info({ userId: user.id }, "Password reset code dispatched");
    } catch (err) {
      // Never surfaced to the caller (it would reveal that the email has an account): the
      // code is invalidated and the failure is logged for the operator, without the address.
      logger.error(
        { userId: user.id, err: err instanceof Error ? err.name : "unknown" },
        "Password reset email could not be sent",
      );
      await prisma.passwordResetCode
        .update({
          where: { id: newCodeRecord.id },
          data: { usedAt: new Date() },
        })
        .catch(() => {});
    }
  };
  if (options.deliver) options.deliver(send);
  else await send();

  return genericResponse;
}

export async function resetPasswordWithCode(
  rawInput: ResetPasswordWithCodeInput,
  clientIp?: string,
) {
  const data = resetPasswordWithCodeSchema.parse(rawInput);
  const normalizedEmail = data.email.trim().toLowerCase();
  const inputCode = data.code.trim();

  // Rate Limiting by IP: Max 15 verification attempts per 15 min
  if (
    clientIp &&
    !authRateLimiter.check(`pwd-verify-ip:${clientIp}`, 15, 15 * 60 * 1000)
  ) {
    throw AppError.rateLimited(
      "تجاوزت الحد الأقصى للمحاولات. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    logger.warn("Password reset attempt for an unknown email");
    throw AppError.badRequest("كود التأكيد غير صحيح أو انتهت صلاحيته");
  }

  const now = new Date();
  const activeCode = await prisma.passwordResetCode.findFirst({
    where: {
      userId: user.id,
      usedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!activeCode) {
    logger.warn({ userId: user.id }, "No active reset code found");
    throw AppError.badRequest("كود التأكيد غير صحيح أو انتهت صلاحيته");
  }

  if (activeCode.attempts >= MAX_CODE_ATTEMPTS) {
    await prisma.passwordResetCode.update({
      where: { id: activeCode.id },
      data: { usedAt: now },
    });
    logger.warn(
      { userId: user.id },
      "Max reset code attempts exceeded, invalidating code",
    );
    throw AppError.badRequest(
      "تم تجاوز الحد الأقصى للمحاولات الخاطئة لهذا الكود. اطلب كوداً جديداً.",
    );
  }

  // Increment attempts counter
  await prisma.passwordResetCode.update({
    where: { id: activeCode.id },
    data: { attempts: { increment: 1 } },
  });

  const expectedHash = computeKeyedCodeHash(user.id, inputCode);
  const isMatch =
    activeCode.codeHash.length === expectedHash.length &&
    crypto.timingSafeEqual(
      Buffer.from(activeCode.codeHash, "hex"),
      Buffer.from(expectedHash, "hex"),
    );

  if (!isMatch) {
    logger.warn({ userId: user.id }, "Invalid reset code provided");
    throw AppError.badRequest("كود التأكيد غير صحيح");
  }

  // Code is valid! Atomically consume code, update password, and revoke all sessions
  const newPasswordHash = await hashPassword(data.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetCode.update({
      where: { id: activeCode.id },
      data: { usedAt: now },
    });

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash },
    });
  });

  // Security Policy: Revoke all existing sessions across all devices
  await revokeAllUserSessions(user.id);

  logger.info(
    { userId: user.id },
    "Password reset successfully with code, all sessions revoked",
  );

  return {
    success: true,
    message: "تم تغيير كلمة السر بنجاح. يمكنك تسجيل الدخول الآن.",
  };
}
