import "server-only";

/**
 * @file session.service.ts
 * @description Server-side sessions for the httpOnly `hesba_session` cookie.
 *
 * @responsibility
 * Create, validate, rotate and revoke sessions, and resolve the authenticated
 * user + store for every API request (`requireSession`).
 *
 * @dependencies
 * Prisma (`sessions`, `users`), `withTenant` (to load the store under RLS), `./crypto`.
 *
 * @usedBy
 * Every authenticated route handler under `src/app/api` (through `requireSession`),
 * `login.service.ts`, `signup.service.ts`, the `/api/auth/{session,rotate,logout,
 * revoke-other-sessions}` routes.
 *
 * @remarks
 * - Only the SHA-256 hash of the token is stored (`idHash`); the raw token exists only in
 *   the cookie, so a database leak does not expose usable sessions.
 * - The `sessions` table is an identity table queried with the plain client (no tenant
 *   context): the session is what *establishes* the tenant for the request.
 * - The session pins one store (`storeId`). Store membership is checked at login, not on
 *   every request.
 */

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

/**
 * Creates a 30-day session for a user in one store.
 *
 * @param userId - The authenticated user.
 * @param storeId - The store this session acts on (becomes the tenant of every request).
 * @param deviceId - Optional device the session was created on.
 * @returns The raw token (to put in the cookie — never stored) and the session row.
 */
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
import { assertSameOriginWrite } from "./request-guard";

/**
 * Resolves a raw session token to the user and store it belongs to.
 *
 * Side effect: refreshes `lastSeenAt` when it is older than {@link LAST_SEEN_REFRESH_MS}.
 *
 * @param rawToken - The token from the cookie or `Authorization: Bearer` header.
 * @returns The session context, or `null` when the token is missing, unknown, or its store
 * no longer exists.
 * @throws AppError (401) when the session has expired or was revoked (QA-14):
 * - a token that was logged out, or revoked by "sign out other devices", is simply refused —
 *   no other session is touched;
 * - a token that was ROTATED (it has a successor) and is presented again after
 *   {@link ROTATION_GRACE_MS} is a stolen-token signal: that token's own rotation chain (the
 *   sessions that replaced it, on the same device) is revoked. Other devices are not touched.
 *   Within the grace period (requests that were in flight during the rotation) it is just refused.
 */
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

  if (record.revokedAt !== null) {
    const successor = await prisma.session.findFirst({
      where: { rotatedFrom: idHash },
      select: { idHash: true },
    });
    const sinceRevoked = now.getTime() - record.revokedAt.getTime();
    if (successor && sinceRevoked > ROTATION_GRACE_MS) {
      // A rotated token used again long after it was replaced: someone else may hold it.
      // Revoke the sessions that descend from it (this device's chain), nothing else.
      const chain = await rotationDescendants(successor.idHash);
      await prisma.session.updateMany({
        where: { idHash: { in: chain }, revokedAt: null },
        data: { revokedAt: now },
      });
      logger.warn(
        { userId: record.userId, storeId: record.storeId },
        "Rotated session token reused; its rotation chain was revoked",
      );
      throw AppError.unauthorized(
        "الجلسة دي اتقفلت لحماية حسابك، سجّل دخولك تاني على الجهاز ده.",
      );
    }
    // Logged out, revoked from another device, or replaced a moment ago.
    throw AppError.unauthorized("الجلسة انتهت، يُرجى تسجيل الدخول مجدداً.");
  }

  // EXPIRY CHECK
  if (record.expiresAt < now) {
    logger.info({ userId: record.userId }, "Session expired");
    throw AppError.unauthorized(
      "انتهت صلاحية الجلسة، يُرجى تسجيل الدخول مجدداً.",
    );
  }

  // Load the store inside its tenant context, only while the user is still a member of it
  // (QA-51): a member removed from the shop loses access on the next request, not at expiry.
  // One query — the membership is a condition of the store lookup that already runs.
  const store = await withTenant(record.storeId, record.userId, async (tx) => {
    return await tx.store.findFirst({
      where: {
        id: record.storeId,
        members: { some: { userId: record.userId } },
      },
    });
  });

  if (!store) {
    // The shop is gone or the user is no longer its member: this session is over for good.
    await prisma.session.updateMany({
      where: { idHash, revokedAt: null },
      data: { revokedAt: now },
    });
    logger.warn(
      { userId: record.userId, storeId: record.storeId },
      "Session refused: no membership in its store; revoked",
    );
    return null;
  }

  // Touch lastSeenAt at most every LAST_SEEN_REFRESH_MS: it is a "last active" hint, and a
  // write on every request costs a database round trip (~63 ms on Neon, QA-32). Validity,
  // expiry and revocation are still checked on every request above.
  if (
    !record.lastSeenAt ||
    now.getTime() - record.lastSeenAt.getTime() >= LAST_SEEN_REFRESH_MS
  ) {
    await prisma.session.update({
      where: { idHash },
      data: { lastSeenAt: now },
    });
  }

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

/**
 * How long a rotated token is still refused quietly (no theft signal): requests that were
 * already in flight when the client rotated still carry the old token.
 */
export const ROTATION_GRACE_MS = 30_000;

/** How stale `lastSeenAt` may get before a request refreshes it (QA-32). */
export const LAST_SEEN_REFRESH_MS = 5 * 60_000;

/** The sessions that replaced `startIdHash` by rotation, transitively (it included). */
async function rotationDescendants(startIdHash: string): Promise<string[]> {
  const chain = [startIdHash];
  let frontier = [startIdHash];
  // A device's chain is short (one link per rotation); the bound guards against cycles.
  for (let depth = 0; depth < 1000 && frontier.length > 0; depth++) {
    const next = await prisma.session.findMany({
      where: { rotatedFrom: { in: frontier } },
      select: { idHash: true },
    });
    frontier = next.map((n) => n.idHash).filter((h) => !chain.includes(h));
    chain.push(...frontier);
  }
  return chain;
}

/**
 * Replaces a valid session with a new token (same user, store and device, fresh 30-day
 * expiry). The old row is marked revoked and linked through `rotatedFrom`, in one transaction.
 *
 * @remarks The old token is refused afterwards; used again after the grace period it revokes
 * this device's chain (see {@link validateSession}). Two concurrent rotations of the same token
 * produce one successor: the second finds the token already revoked and is refused.
 * @throws AppError (401) when the current token is not a valid session.
 */
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
    const revoked = await tx.session.updateMany({
      where: { idHash: oldIdHash, revokedAt: null },
      data: { revokedAt: now },
    });
    if (revoked.count !== 1) {
      throw AppError.unauthorized("جلسة غير صالحة للتدوير");
    }

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

/**
 * Reads the session token from the `hesba_session` cookie, falling back to an
 * `Authorization: Bearer <token>` header, and validates it.
 *
 * @returns The session context, or `null` when no token is present or it is not valid.
 * @throws AppError (401) — see {@link validateSession}.
 */
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

/**
 * The authentication gate for route handlers. Use `context.store.id` and
 * `context.user.id` from the result as the tenant for every `withTenant` call.
 *
 * @throws AppError (401) when the request has no valid session.
 */
export async function requireSession(req: Request): Promise<SessionContext> {
  // Every cookie-authenticated write passes here: refuse cross-site writes (QA-39).
  assertSameOriginWrite(req);
  const context = await getSessionFromRequest(req);
  if (!context) {
    throw AppError.unauthorized();
  }
  return context;
}
