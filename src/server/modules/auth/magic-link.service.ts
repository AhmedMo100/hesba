import "server-only";
import { prisma } from "@/server/infra/db/client";
import { hashToken, generateSecureToken } from "./crypto";
import { authRateLimiter } from "./rate-limiter";
import { getEmailProvider } from "@/server/infra/email";
import { env } from "@/server/config/env";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import { createSession } from "./session.service";
import { withTenant } from "@/server/infra/db/tenant";

const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

export async function requestMagicLink(email: string, clientIp?: string) {
  const normalizedEmail = email.trim().toLowerCase();

  // Rate Limiting: Max 3 requests per hour per email
  if (
    !authRateLimiter.check(
      `magic-link-email:${normalizedEmail}`,
      3,
      60 * 60 * 1000,
    )
  ) {
    logger.warn(
      { email: normalizedEmail },
      "Magic link rate limit exceeded for email",
    );
    throw AppError.badRequest(
      "تجاوزت الحد الأقصى لمحاولات تسجيل الدخول. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  // Rate Limiting by IP: Max 10 requests per hour
  if (
    clientIp &&
    !authRateLimiter.check(`magic-link-ip:${clientIp}`, 10, 60 * 60 * 1000)
  ) {
    logger.warn({ clientIp }, "Magic link rate limit exceeded for IP");
    throw AppError.badRequest(
      "تجاوزت الحد الأقصى للمحاولات من هذا العنوان. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  const genericResponse = {
    message: "إذا كان البريد مسجلاً لدينا، تم إرسال رابط الدخول الآمن.",
  };

  if (!user) {
    logger.info(
      { email: normalizedEmail },
      "Magic link requested for non-existent email (anti-enumeration)",
    );
    return genericResponse;
  }

  const rawToken = generateSecureToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MS);

  // Invalidate older unused magic link tokens for this user
  await prisma.magicLinkToken.updateMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });

  await prisma.magicLinkToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const magicLinkUrl = `${env.HESBA_APP_ORIGIN}/auth/verify-link?token=${rawToken}&type=login`;

  await getEmailProvider().sendMagicLinkEmail(user.email, magicLinkUrl);

  logger.info({ userId: user.id }, "Magic link email dispatched");

  return genericResponse;
}

export async function verifyMagicLink(
  rawToken: string,
  deviceLabel = "جهاز جديد",
) {
  if (!rawToken || typeof rawToken !== "string") {
    throw AppError.badRequest("رمز الدخول مطلوب");
  }

  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const record = await prisma.magicLinkToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          members: {
            include: {
              store: true,
            },
          },
        },
      },
    },
  });

  if (!record || record.usedAt !== null || record.expiresAt < now) {
    logger.warn("Invalid or expired magic link verification attempt");
    throw AppError.badRequest("رابط الدخول غير صالح أو انتهت صلاحيته");
  }

  // Atomically mark token as used
  await prisma.magicLinkToken.update({
    where: { id: record.id },
    data: { usedAt: now },
  });

  // Automatically mark email as verified since owner just proved ownership of inbox
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

  // Register device for this new login under tenant context
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
