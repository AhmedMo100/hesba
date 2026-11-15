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
const MAX_LOGIN_ATTEMPTS_PER_IP = 15;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

/**
 * Phone or email + password login.
 *
 * Flow: lockout check (5 FAILED attempts per identifier, 15 per IP, per 15 minutes; successes
 * do not count and clear the identifier, QA-24) → look up the user by normalized phone or
 * lowercased email → verify the Argon2id hash → pick the user's oldest store membership →
 * register a new device row → create a session for that store.
 *
 * Unknown identifiers and wrong passwords return the same message so the response does not
 * reveal which phones/emails have accounts.
 *
 * @param rawInput - Identifier (phone or email) and password (validated with `loginInputSchema`).
 * @param clientIp - Used only for the per-IP rate limit, when known.
 * @param deviceLabel - Label stored on the device row created for this login.
 * @returns The raw session token (for the cookie) plus the user and store summary.
 * @throws AppError (429 + Retry-After) when locked out; (401) on bad credentials; (500) when the user has
 * no store membership. A zod error on invalid input.
 */
export async function loginWithPassword(
  rawInput: LoginInput,
  clientIp?: string,
  deviceLabel = "جهاز تسجيل الدخول",
) {
  const data = loginInputSchema.parse(rawInput);
  const isEmail = isEmailIdentifier(data.identifier);
  const normalizedIdentifier = isEmail
    ? data.identifier.trim().toLowerCase()
    : normalizePhone(data.identifier);

  const rateLimitKey = `login-id:${normalizedIdentifier}`;
  const identifierAttempt = authRateLimiter.reserveAttempt(
    rateLimitKey,
    MAX_LOGIN_ATTEMPTS,
    LOGIN_LOCKOUT_MS,
  );
  if (identifierAttempt.locked) {
    logger.warn("Login locked out for an identifier after repeated failures");
    throw AppError.rateLimited(
      "محاولات دخول غلط كتير. استنى شوية وجرب تاني.",
      undefined,
      identifierAttempt.retryAfterMs / 1000,
    );
  }
  const ipAttempt = clientIp
    ? authRateLimiter.reserveAttempt(
        `login-ip:${clientIp}`,
        MAX_LOGIN_ATTEMPTS_PER_IP,
        LOGIN_LOCKOUT_MS,
      )
    : null;
  if (ipAttempt?.locked) {
    identifierAttempt.release();
    logger.warn("Login locked out for an IP after repeated failures");
    throw AppError.rateLimited(
      "محاولات دخول غلط كتير من الجهاز ده. استنى شوية وجرب تاني.",
      undefined,
      ipAttempt.retryAfterMs / 1000,
    );
  }

  const user = isEmail
    ? await prisma.user.findFirst({ where: { email: normalizedIdentifier } })
    : await prisma.user.findUnique({ where: { phone: normalizedIdentifier } });

  if (!user || !user.passwordHash) {
    await dummyVerifyTimingProtection();
    logger.warn("Failed login attempt: user not found or no password");
    throw AppError.unauthorized("البيانات غير صحيحة");
  }

  const isValidPassword = await verifyPassword(
    user.passwordHash,
    data.password,
  );

  if (!isValidPassword) {
    logger.warn({ userId: user.id }, "Failed login attempt: invalid password");
    throw AppError.unauthorized("البيانات غير صحيحة");
  }

  authRateLimiter.reset(rateLimitKey);
  if (ipAttempt && !ipAttempt.locked) ipAttempt.release();

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
