import "server-only";
import { prisma } from "@/server/infra/db/client";
import { hashToken, generateSecureToken } from "./crypto";
import { authRateLimiter } from "./rate-limiter";
import { getEmailProvider } from "@/server/infra/email";
import { env } from "@/server/config/env";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import {
  generateRegistrationOptionsForUser,
  verifyAndSaveRegistration,
} from "./passkey.service";
import { createSession, revokeAllUserSessions } from "./session.service";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

const RECOVERY_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function requestAccountRecovery(email: string, clientIp?: string) {
  const normalizedEmail = email.trim().toLowerCase();

  // Rate Limiting: Max 3 requests per hour per email
  if (
    !authRateLimiter.check(
      `recovery-email:${normalizedEmail}`,
      3,
      60 * 60 * 1000,
    )
  ) {
    logger.warn(
      { email: normalizedEmail },
      "Account recovery rate limit exceeded for email",
    );
    throw AppError.badRequest(
      "تجاوزت الحد الأقصى لمحاولات الاسترداد. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  // Rate Limiting by IP: Max 10 requests per hour
  if (
    clientIp &&
    !authRateLimiter.check(`recovery-ip:${clientIp}`, 10, 60 * 60 * 1000)
  ) {
    logger.warn({ clientIp }, "Account recovery rate limit exceeded for IP");
    throw AppError.badRequest(
      "تجاوزت الحد الأقصى للمحاولات من هذا العنوان. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  // Find user
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  // Generic anti-enumeration response: Always return success message
  const genericResponse = {
    message: "إذا كان البريد مسجلاً لدينا، تم إرسال رابط الاسترداد.",
  };

  if (!user) {
    logger.info(
      { email: normalizedEmail },
      "Recovery requested for non-existent email (enumeration resistant)",
    );
    return genericResponse;
  }

  const rawToken = generateSecureToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_EXPIRY_MS);

  await prisma.accountRecoveryToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const recoveryUrl = `${env.HESBA_APP_ORIGIN}/app/auth/recovery?token=${rawToken}`;

  // Send recovery email via provider (Mock in development/tests)
  await getEmailProvider().sendRecoveryEmail(user.email, recoveryUrl);

  logger.info({ userId: user.id }, "Account recovery email dispatched");

  return genericResponse;
}

export async function verifyRecoveryToken(rawToken: string) {
  if (!rawToken || typeof rawToken !== "string") {
    throw AppError.badRequest("رمز الاسترداد مطلوب");
  }

  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const record = await prisma.accountRecoveryToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.usedAt !== null || record.expiresAt < now) {
    logger.warn(
      "Invalid or expired account recovery token verification attempt",
    );
    throw AppError.badRequest("رابط الاسترداد غير صالح أو انتهت صلاحيته");
  }

  // Generate Passkey registration options so user can add a new Passkey right now
  const passkeyOptions = await generateRegistrationOptionsForUser({
    id: record.user.id,
    name: record.user.name,
    email: record.user.email,
  });

  return {
    email: record.user.email,
    passkeyOptions,
  };
}

export async function completeAccountRecovery(
  rawToken: string,
  credential: RegistrationResponseJSON,
  passkeyLabel = "مفتاح بعد الاسترداد",
) {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const record = await prisma.accountRecoveryToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          members: {
            include: { store: true },
          },
        },
      },
    },
  });

  if (!record || record.usedAt !== null || record.expiresAt < now) {
    throw AppError.badRequest("رابط الاسترداد غير صالح أو منتهي الصلاحية");
  }

  // Atomically mark token as used
  await prisma.accountRecoveryToken.update({
    where: { id: record.id },
    data: { usedAt: now },
  });

  // Verify and register the new Passkey
  await verifyAndSaveRegistration(record.userId, credential, passkeyLabel);

  // Security Policy: Revoke all existing sessions for this user (security revocation)
  await revokeAllUserSessions(record.userId);

  // Mark email as verified if not already
  if (!record.user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
    });
  }

  // Find store to create initial session
  const primaryMember = record.user.members[0];
  if (!primaryMember) {
    throw AppError.internal("لم يتم العثور على متجر مرتبط بهذا المستخدم");
  }

  const { rawToken: newSessionToken, session } = await createSession(
    record.userId,
    primaryMember.storeId,
  );

  return {
    token: newSessionToken,
    session: {
      idHash: session.idHash,
      userId: record.userId,
      storeId: primaryMember.storeId,
      expiresAt: session.expiresAt.toISOString(),
    },
    user: {
      id: record.user.id,
      name: record.user.name,
      phone: record.user.phone,
      email: record.user.email,
      emailVerified: true,
    },
    store: {
      id: primaryMember.store.id,
      name: primaryMember.store.name,
      shopType: primaryMember.store.shopType,
      governorate: primaryMember.store.governorate,
      area: primaryMember.store.area ?? undefined,
      openedOn: primaryMember.store.openedOn?.toISOString() ?? "",
      workersCount: primaryMember.store.workersCount ?? 1,
    },
  };
}

export async function sendEmailVerification(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw AppError.notFound("المستخدم غير موجود");
  }

  const rawToken = generateSecureToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);

  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const verificationUrl = `${env.HESBA_APP_ORIGIN}/app/auth/verify-email?token=${rawToken}`;
  await getEmailProvider().sendVerificationEmail(user.email, verificationUrl);
}

export async function verifyEmailToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.usedAt !== null || record.expiresAt < now) {
    throw AppError.badRequest("رمز تأكيد البريد غير صالح أو منتهي الصلاحية");
  }

  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    });

    await tx.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
    });
  });

  return { success: true };
}
