import "server-only";

/**
 * @file password-change.service.ts
 * @description The signed-in account changes its own password: the forced change after an
 * admin reset (`users.must_change_password`), or a normal change.
 *
 * @usedBy `src/app/api/auth/change-password/route.ts`.
 *
 * @remarks
 * - The current (or temporary) password is verified with Argon2id first: a stolen session alone
 *   cannot take over the account. Wrong attempts are limited per account (5 per 15 minutes).
 * - The new hash, clearing the temporary-password flag and revoking EVERY other session of the
 *   account happen in one transaction: after the change, only the device that made it stays
 *   signed in (any session opened with the temporary password elsewhere is closed).
 * - Nothing about the password (old, temporary or new) is ever logged.
 */

import { prisma } from "@/server/infra/db/client";
import { changePasswordSchema, type ChangePasswordInput } from "@/schemas/auth";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import { hashPassword, verifyPassword } from "./password.service";
import { authRateLimiter } from "./rate-limiter";
import type { SessionContext } from "./session.service";

const MAX_CHANGE_FAILURES = 5;
const CHANGE_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * @returns How many other sessions were closed.
 * @throws AppError 400 (wrong current password / weak new one), 429 (too many wrong attempts).
 */
export async function changeOwnPassword(
  context: SessionContext,
  rawInput: ChangePasswordInput,
): Promise<{ revokedSessions: number }> {
  const data = changePasswordSchema.parse(rawInput);
  const userId = context.user.id;

  const attempt = authRateLimiter.reserveAttempt(
    `password-change:${userId}`,
    MAX_CHANGE_FAILURES,
    CHANGE_LOCKOUT_MS,
  );
  if (attempt.locked) {
    throw AppError.rateLimited(
      "محاولات غلط كتير. استنى شوية وجرب تاني.",
      undefined,
      attempt.retryAfterMs / 1000,
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  const ok =
    !!user?.passwordHash &&
    (await verifyPassword(user.passwordHash, data.currentPassword));
  if (!ok) {
    logger.warn({ userId }, "Password change refused: wrong current password");
    throw new AppError(
      "VALIDATION_ERROR",
      "كلمة المرور الحالية غير صحيحة",
      400,
      { field: "currentPassword" },
    );
  }
  attempt.release();

  const newHash = await hashPassword(data.newPassword);
  const now = new Date();
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        tempPasswordExpiresAt: null,
      },
    });
    return await tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        idHash: { not: context.session.idHash },
      },
      data: { revokedAt: now },
    });
  });

  authRateLimiter.reset(`password-change:${userId}`);
  logger.info(
    {
      userId,
      revokedSessions: revoked.count,
      wasTemporary: context.user.mustChangePassword,
    },
    "Password changed; other sessions revoked",
  );
  return { revokedSessions: revoked.count };
}
