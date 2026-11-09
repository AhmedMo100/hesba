import "server-only";
import { prisma } from "@/server/infra/db/client";
import { type LoginInput, loginInputSchema } from "@/schemas/auth";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import {
  verifyPassword,
  dummyVerifyTimingProtection,
} from "./password.service";
import { createSession } from "./session.service";
import { authRateLimiter } from "./rate-limiter";
import { withTenant } from "@/server/infra/db/tenant";
import { normalizePhone } from "./signup.service";

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Phone + password login.
 *
 * Flow: rate-limit (5 attempts per phone, 15 per IP, per 15 minutes) → look up the user by
 * normalized phone → verify the Argon2id hash → pick the user's oldest store membership →
 * register a new device row → create a session for that store.
 *
 * Unknown phones and wrong passwords return the same message so the response does not reveal
 * which phones have accounts.
 *
 * @param rawInput - Phone and password (validated with `loginInputSchema`).
 * @param clientIp - Used only for the per-IP rate limit, when known.
 * @param deviceLabel - Label stored on the device row created for this login.
 * @returns The raw session token (for the cookie) plus the user and store summary.
 * @throws AppError (400) when rate-limited; (401) on bad credentials; (500) when the user has
 * no store membership. A zod error on invalid input.
 */
export async function loginWithPassword(
  rawInput: LoginInput,
  clientIp?: string,
  deviceLabel = "جهاز تسجيل الدخول",
) {
  const data = loginInputSchema.parse(rawInput);
  const normalizedPhone = normalizePhone(data.phone);

  // Rate Limiting by phone: Max 5 attempts per 15 min
  if (
    !authRateLimiter.check(
      `login-phone:${normalizedPhone}`,
      MAX_LOGIN_ATTEMPTS,
      LOGIN_LOCKOUT_MS,
    )
  ) {
    logger.warn(
      { phone: normalizedPhone },
      "Login rate limit exceeded for phone",
    );
    throw AppError.badRequest(
      "تجاوزت الحد الأقصى لمحاولات الدخول. يُرجى الانتظار 15 دقيقة والمحاولة لاحقاً.",
    );
  }

  // Rate Limiting by IP: Max 15 attempts per 15 min
  if (
    clientIp &&
    !authRateLimiter.check(`login-ip:${clientIp}`, 15, LOGIN_LOCKOUT_MS)
  ) {
    logger.warn({ clientIp }, "Login rate limit exceeded for IP");
    throw AppError.badRequest(
      "تجاوزت الحد الأقصى لمحاولات الدخول من هذا العنوان. يُرجى الانتظار والمحاولة لاحقاً.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { phone: normalizedPhone },
  });

  if (!user || !user.passwordHash) {
    await dummyVerifyTimingProtection();
    logger.warn(
      { phone: normalizedPhone },
      "Failed login attempt: user not found or no password",
    );
    throw AppError.unauthorized("رقم الموبايل أو كلمة السر غير صحيحة");
  }

  const isValidPassword = await verifyPassword(
    user.passwordHash,
    data.password,
  );

  if (!isValidPassword) {
    logger.warn({ userId: user.id }, "Failed login attempt: invalid password");
    throw AppError.unauthorized("رقم الموبايل أو كلمة السر غير صحيحة");
  }

  // Find user's primary store membership under app.user_id context
  const primaryMember = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
    return await tx.storeMember.findFirst({
      where: { userId: user.id },
      include: { store: true },
      orderBy: { createdAt: "asc" },
    });
  });

  if (!primaryMember) {
    throw AppError.internal("لم يتم العثور على متجر مرتبط بهذا المستخدم");
  }

  // Register device for this session under tenant context
  const device = await withTenant(
    primaryMember.storeId,
    user.id,
    async (tx) => {
      return await tx.device.create({
        data: {
          storeId: primaryMember.storeId,
          userId: user.id,
          label: deviceLabel,
        },
      });
    },
  );

  const { rawToken: sessionToken, session } = await createSession(
    user.id,
    primaryMember.storeId,
    device.id,
  );

  logger.info({ userId: user.id }, "User logged in successfully with password");

  return {
    userId: user.id,
    storeId: primaryMember.storeId,
    sessionToken,
    session: {
      idHash: session.idHash,
      userId: user.id,
      storeId: primaryMember.storeId,
      expiresAt: session.expiresAt.toISOString(),
    },
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
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
