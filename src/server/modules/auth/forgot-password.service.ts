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

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CODE_ATTEMPTS = 5;

function computeKeyedCodeHash(userId: string, code: string): string {
  return crypto
    .createHmac("sha256", env.HESBA_SESSION_SECRET)
    .update(`pwd-reset:${userId}:${code}`)
    .digest("hex");
}

export async function requestPasswordResetCode(
  rawInput: ForgotPasswordRequestInput,
  clientIp?: string,
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
    logger.warn(
      { email: normalizedEmail },
      "Password reset rate limit exceeded for email",
    );
    throw AppError.badRequest(
      "تجاوزت الحد الأقصى لطلب الأكواد. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  // Rate Limiting by IP: Max 10 requests per hour
  if (
    clientIp &&
    !authRateLimiter.check(`pwd-reset-ip:${clientIp}`, 10, 60 * 60 * 1000)
  ) {
    logger.warn({ clientIp }, "Password reset rate limit exceeded for IP");
    throw AppError.badRequest(
      "تجاوزت الحد الأقصى للمحاولات من هذا العنوان. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  const genericResponse = {
    message: "إذا كان البريد مسجلاً لدينا، تم إرسال كود التأكيد.",
  };

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    logger.info(
      { email: normalizedEmail },
      "Password reset requested for non-existent email (anti-enumeration)",
    );
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

  await prisma.passwordResetCode.create({
    data: {
      userId: user.id,
      codeHash,
      expiresAt,
    },
  });

  await getEmailProvider().sendPasswordResetCode(user.email, code);

  logger.info({ userId: user.id }, "Password reset code dispatched via email");

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
    throw AppError.badRequest(
      "تجاوزت الحد الأقصى للمحاولات. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    logger.warn(
      { email: normalizedEmail },
      "Password reset attempt for non-existent user",
    );
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
