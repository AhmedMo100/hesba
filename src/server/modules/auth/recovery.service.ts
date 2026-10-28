import "server-only";
import { prisma } from "@/server/infra/db/client";
import { hashToken, generateSecureToken } from "./crypto";
import { authRateLimiter } from "./rate-limiter";
import { getEmailProvider } from "@/server/infra/email";
import { env } from "@/server/config/env";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import { createSession, revokeAllUserSessions } from "./session.service";
import {
  generateRegistrationOptionsForUser,
  verifyAndSaveRegistration,
} from "./passkey.service";
import { withTenant } from "@/server/infra/db/tenant";
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

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  const genericResponse = {
    message: "إذا كان البريد مسجلاً لدينا، تم إرسال رابط الاسترداد.",
  };

  if (!user) {
    logger.info(
      { email: normalizedEmail },
      "Recovery requested for non-existent email (anti-enumeration)",
    );
    return genericResponse;
  }

  const rawToken = generateSecureToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_EXPIRY_MS);

  // Invalidate previous unused recovery tokens
  await prisma.accountRecoveryToken.updateMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });

  await prisma.accountRecoveryToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const recoveryUrl = `${env.HESBA_APP_ORIGIN}/auth/verify-link?token=${rawToken}&type=recovery`;

  await getEmailProvider().sendRecoveryEmail(user.email, recoveryUrl);

  logger.info({ userId: user.id }, "Account recovery email dispatched");

  return genericResponse;
}

export async function validateRecoveryToken(rawToken: string) {
  if (!rawToken || typeof rawToken !== "string") {
    throw AppError.badRequest("رمز الاسترداد مطلوب");
  }

  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const record = await prisma.accountRecoveryToken.findUnique({
    where: { tokenHash },
    include: {
      user: true,
    },
  });

  if (!record || record.usedAt !== null || record.expiresAt < now) {
    logger.warn("Invalid or expired account recovery token check");
    throw AppError.badRequest("رابط الاسترداد غير صالح أو انتهت صلاحيته");
  }

  const passkeyOptions = await generateRegistrationOptionsForUser({
    id: record.user.id,
    name: record.user.name,
    email: record.user.email,
  });

  return {
    valid: true,
    email: record.user.email,
    passkeyOptions,
  };
}

export async function completeAccountRecovery(
  rawToken: string,
  credential: RegistrationResponseJSON,
  passkeyLabel = "مفتاح بعد الاسترداد",
) {
  if (!rawToken || typeof rawToken !== "string") {
    throw AppError.badRequest("رمز الاسترداد مطلوب");
  }

  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const record = await prisma.accountRecoveryToken.findUnique({
    where: { tokenHash },
    include: {
      user: true,
    },
  });

  if (!record || record.usedAt !== null || record.expiresAt < now) {
    logger.warn("Invalid or expired account recovery token during completion");
    throw AppError.badRequest("رابط الاسترداد غير صالح أو انتهت صلاحيته");
  }

  // Atomically mark token as used
  await prisma.accountRecoveryToken.update({
    where: { id: record.id },
    data: { usedAt: now },
  });

  // Verify and register the new Passkey
  await verifyAndSaveRegistration(record.userId, credential, passkeyLabel);

  // Security Policy: Revoke all existing sessions for this user across all devices
  await revokeAllUserSessions(record.userId);

  // Mark email as verified if not already
  if (!record.user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
    });
  }

  // Find user's primary store membership under app.user_id context
  const primaryMember = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${record.userId}, true)`;
    return await tx.storeMember.findFirst({
      where: { userId: record.userId },
      include: { store: true },
      orderBy: { createdAt: "asc" },
    });
  });

  if (!primaryMember) {
    throw AppError.internal("لم يتم العثور على متجر مرتبط بهذا المستخدم");
  }

  // Register device for this recovery under tenant context
  const device = await withTenant(
    primaryMember.storeId,
    record.userId,
    async (tx) => {
      return await tx.device.create({
        data: {
          storeId: primaryMember.storeId,
          userId: record.userId,
          label: passkeyLabel,
        },
      });
    },
  );

  const { rawToken: newSessionToken, session } = await createSession(
    record.userId,
    primaryMember.storeId,
    device.id,
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

export async function verifyRecoveryToken(
  rawToken: string,
  deviceLabel = "جهاز مسترد",
) {
  if (!rawToken || typeof rawToken !== "string") {
    throw AppError.badRequest("رمز الاسترداد مطلوب");
  }

  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const record = await prisma.accountRecoveryToken.findUnique({
    where: { tokenHash },
    include: {
      user: true,
    },
  });

  if (!record || record.usedAt !== null || record.expiresAt < now) {
    logger.warn(
      "Invalid or expired account recovery token verification attempt",
    );
    throw AppError.badRequest("رابط الاسترداد غير صالح أو انتهت صلاحيته");
  }

  // Atomically mark token as used
  await prisma.accountRecoveryToken.update({
    where: { id: record.id },
    data: { usedAt: now },
  });

  // Security Policy: Revoke all existing sessions for this user
  await revokeAllUserSessions(record.userId);

  // Mark email as verified if not already
  if (!record.user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
    });
  }

  // Find user's primary store membership under app.user_id context
  const primaryMember = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${record.userId}, true)`;
    return await tx.storeMember.findFirst({
      where: { userId: record.userId },
      include: { store: true },
      orderBy: { createdAt: "asc" },
    });
  });

  if (!primaryMember) {
    throw AppError.internal("لم يتم العثور على متجر مرتبط بهذا المستخدم");
  }

  // Register device for this recovery under tenant context
  const device = await withTenant(
    primaryMember.storeId,
    record.userId,
    async (tx) => {
      return await tx.device.create({
        data: {
          storeId: primaryMember.storeId,
          userId: record.userId,
          label: deviceLabel,
        },
      });
    },
  );

  const { rawToken: newSessionToken, session } = await createSession(
    record.userId,
    primaryMember.storeId,
    device.id,
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

  const verificationUrl = `${env.HESBA_APP_ORIGIN}/auth/verify-link?token=${rawToken}&type=verify_email`;
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
