import "server-only";
import { prisma } from "@/server/infra/db/client";
import { hashToken, generateSecureToken } from "./crypto";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";

export const SESSION_COOKIE_NAME = "hesba_session";
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionContext {
  session: {
    idHash: string;
    userId: string;
    storeId: string;
    deviceId: string | null;
    expiresAt: Date;
    createdAt: Date;
  };
  user: {
    id: string;
    name: string;
    phone: string;
    email: string;
    emailVerifiedAt: Date | null;
  };
  store: {
    id: string;
    name: string;
    shopType: string;
    governorate: string;
    area: string | null;
    openedOn: Date | null;
    workersCount: number | null;
  };
}

export function getSessionCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
  };
}

export async function createSession(
  userId: string,
  storeId: string,
  deviceId?: string,
) {
  const rawToken = generateSecureToken(32);
  const idHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  const session = await prisma.session.create({
    data: {
      idHash,
      userId,
      storeId,
      deviceId: deviceId ?? null,
      expiresAt,
      lastSeenAt: now,
    },
  });

  return { rawToken, session };
}

import { withTenant } from "@/server/infra/db/tenant";

export async function validateSession(
  rawToken: string,
): Promise<SessionContext | null> {
  if (!rawToken || typeof rawToken !== "string") {
    return null;
  }

  const idHash = hashToken(rawToken);
  const now = new Date();

  const record = await prisma.session.findUnique({
    where: { idHash },
    include: {
      user: true,
    },
  });

  if (!record) {
    return null;
  }

  // REUSE DETECTION: If this session was already revoked/rotated, this is token reuse!
  if (record.revokedAt !== null) {
    logger.error(
      { userId: record.userId, storeId: record.storeId },
      "Session reuse detected! Revoking all sessions for user chain.",
    );

    // Revoke all active sessions for this user immediately
    await prisma.session.updateMany({
      where: {
        userId: record.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    throw AppError.unauthorized(
      "تم رصد استخدام رمز جلسة قديم، وتم إلغاء كافة الجلسات النشطة لحماية حسابك.",
    );
  }

  // EXPIRY CHECK
  if (record.expiresAt < now) {
    logger.info({ userId: record.userId }, "Session expired");
    throw AppError.unauthorized(
      "انتهت صلاحية الجلسة، يُرجى تسجيل الدخول مجدداً.",
    );
  }

  // Load store inside its tenant context
  const store = await withTenant(record.storeId, record.userId, async (tx) => {
    return await tx.store.findUnique({
      where: { id: record.storeId },
    });
  });

  if (!store) {
    logger.warn({ storeId: record.storeId }, "Store not found for session");
    return null;
  }

  // Touch session lastSeenAt
  await prisma.session.update({
    where: { idHash },
    data: { lastSeenAt: now },
  });

  return {
    session: {
      idHash: record.idHash,
      userId: record.userId,
      storeId: record.storeId,
      deviceId: record.deviceId,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    },
    user: {
      id: record.user.id,
      name: record.user.name,
      phone: record.user.phone,
      email: record.user.email,
      emailVerifiedAt: record.user.emailVerifiedAt,
    },
    store: {
      id: store.id,
      name: store.name,
      shopType: store.shopType,
      governorate: store.governorate,
      area: store.area,
      openedOn: store.openedOn,
      workersCount: store.workersCount,
    },
  };
}

export async function rotateSession(rawToken: string) {
  const context = await validateSession(rawToken);
  if (!context) {
    throw AppError.unauthorized("جلسة غير صالحة للتدوير");
  }

  const oldIdHash = context.session.idHash;
  const newRawToken = generateSecureToken(32);
  const newIdHash = hashToken(newRawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  // Atomically revoke old and create new with rotatedFrom pointer
  const newSession = await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { idHash: oldIdHash },
      data: { revokedAt: now },
    });

    return await tx.session.create({
      data: {
        idHash: newIdHash,
        userId: context.user.id,
        storeId: context.store.id,
        deviceId: context.session.deviceId,
        expiresAt,
        lastSeenAt: now,
        rotatedFrom: oldIdHash,
      },
    });
  });

  return {
    rawToken: newRawToken,
    session: newSession,
    user: context.user,
    store: context.store,
  };
}

export async function revokeSession(rawToken: string) {
  if (!rawToken) return;
  const idHash = hashToken(rawToken);
  await prisma.session.updateMany({
    where: { idHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeOtherUserSessions(
  userId: string,
  currentSessionToken: string,
) {
  const currentIdHash = hashToken(currentSessionToken);
  await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      idHash: { not: currentIdHash },
    },
    data: { revokedAt: new Date() },
  });
}

export async function getSessionFromRequest(
  req: Request,
): Promise<SessionContext | null> {
  const cookieHeader = req.headers.get("cookie");
  let rawToken: string | undefined;

  if (cookieHeader) {
    const match = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    if (match) {
      rawToken = match.substring(SESSION_COOKIE_NAME.length + 1);
    }
  }

  if (!rawToken) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      rawToken = authHeader.substring(7);
    }
  }

  if (!rawToken) {
    return null;
  }

  return await validateSession(rawToken);
}

export async function requireSession(req: Request): Promise<SessionContext> {
  const context = await getSessionFromRequest(req);
  if (!context) {
    throw AppError.unauthorized();
  }
  return context;
}
