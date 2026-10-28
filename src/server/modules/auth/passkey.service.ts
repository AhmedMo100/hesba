import "server-only";
import {
  generateRegistrationOptions as simpleGenerateRegistrationOptions,
  verifyRegistrationResponse as simpleVerifyRegistrationResponse,
  generateAuthenticationOptions as simpleGenerateAuthenticationOptions,
  verifyAuthenticationResponse as simpleVerifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import { prisma } from "@/server/infra/db/client";
import { getWebAuthnConfig } from "./config";
import { consumePasskeyChallenge } from "./challenge.service";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";

const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export interface UserContext {
  id: string;
  name: string;
  email: string;
}

export async function generateRegistrationOptionsForUser(user: UserContext) {
  const { rpName, rpID } = getWebAuthnConfig();

  // Get existing credentials to exclude
  const existingPasskeys = await prisma.userPasskey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  const options = await simpleGenerateRegistrationOptions({
    rpName,
    rpID,
    userID: Buffer.from(user.id, "utf-8"),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    timeout: 60000,
  });

  // Store challenge
  await prisma.passkeyChallenge.create({
    data: {
      challenge: options.challenge,
      purpose: "registration",
      userId: user.id,
      expiresAt: new Date(Date.now() + CHALLENGE_EXPIRY_MS),
    },
  });

  return options;
}

export async function verifyAndSaveRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  deviceName = "جهاز",
) {
  const { rpID, origin } = getWebAuthnConfig();

  // Extract challenge from clientDataJSON
  let clientChallenge: string;
  try {
    const clientData = JSON.parse(
      Buffer.from(response.response.clientDataJSON, "base64url").toString(
        "utf-8",
      ),
    );
    clientChallenge = clientData.challenge;
  } catch (err) {
    logger.warn({ err }, "Failed to parse clientDataJSON in registration");
    throw AppError.badRequest("بيانات المصادقة غير صالحة");
  }

  // Atomically consume challenge
  const challengeRecord = await consumePasskeyChallenge(
    clientChallenge,
    "registration",
  );

  // If challenge belonged to another user, reject
  if (challengeRecord.userId && challengeRecord.userId !== userId) {
    logger.warn(
      { challengeUserId: challengeRecord.userId, actualUserId: userId },
      "Passkey challenge userId mismatch",
    );
    throw AppError.badRequest("رمز التحقق غير مخصص لهذا الحساب");
  }

  const verification = await simpleVerifyRegistrationResponse({
    response,
    expectedChallenge: challengeRecord.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    logger.warn({ verification }, "Passkey registration verification failed");
    throw AppError.badRequest("فشل التحقق من مفتاح المرور");
  }

  const { credential, aaguid, credentialBackedUp, credentialDeviceType } =
    verification.registrationInfo;

  // Save credential to database
  const created = await prisma.userPasskey.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      deviceName: deviceName || "جهاز",
      aaguid: aaguid ?? null,
      transports: (credential.transports as string[]) || [],
      backupEligible: credentialDeviceType === "multiDevice",
      backupStatus: credentialBackedUp ?? false,
      lastUsedAt: new Date(),
    },
  });

  return created;
}

export async function generateAuthenticationOptionsForLogin(
  identifier?: string,
) {
  const { rpID } = getWebAuthnConfig();

  let allowCredentials:
    Array<{ id: string; transports?: AuthenticatorTransport[] }> | undefined;
  let userId: string | undefined;

  if (identifier) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
      include: {
        passkeys: {
          select: { credentialId: true, transports: true },
        },
      },
    });

    if (user && user.passkeys.length > 0) {
      userId = user.id;
      allowCredentials = user.passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransport[],
      }));
    }
  }

  const options = await simpleGenerateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: "preferred",
    timeout: 60000,
  });

  // Store challenge
  await prisma.passkeyChallenge.create({
    data: {
      challenge: options.challenge,
      purpose: "authentication",
      userId: userId ?? null,
      expiresAt: new Date(Date.now() + CHALLENGE_EXPIRY_MS),
    },
  });

  return options;
}

export async function verifyAuthenticationAndGetUser(
  response: AuthenticationResponseJSON,
) {
  const { rpID, origin } = getWebAuthnConfig();

  // Extract challenge from clientDataJSON
  let clientChallenge: string;
  try {
    const clientData = JSON.parse(
      Buffer.from(response.response.clientDataJSON, "base64url").toString(
        "utf-8",
      ),
    );
    clientChallenge = clientData.challenge;
  } catch (err) {
    logger.warn({ err }, "Failed to parse clientDataJSON in authentication");
    throw AppError.badRequest("بيانات المصادقة غير صالحة");
  }

  // Atomically consume challenge
  const challengeRecord = await consumePasskeyChallenge(
    clientChallenge,
    "authentication",
  );

  // Find passkey by credentialId
  const passkey = await prisma.userPasskey.findUnique({
    where: { credentialId: response.id },
    include: { user: true },
  });

  if (!passkey) {
    logger.warn(
      { credentialId: response.id },
      "Passkey credential not found during authentication",
    );
    throw AppError.badRequest("مفتاح المرور غير مسجل أو محذوف");
  }

  // If challenge was bound to a specific user, verify match
  if (challengeRecord.userId && challengeRecord.userId !== passkey.userId) {
    logger.warn(
      {
        challengeUserId: challengeRecord.userId,
        passkeyUserId: passkey.userId,
      },
      "Passkey challenge userId mismatch during login",
    );
    throw AppError.badRequest("رمز التحقق غير مخصص لهذا الحساب");
  }

  const verification = await simpleVerifyAuthenticationResponse({
    response,
    expectedChallenge: challengeRecord.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(
        passkey.publicKey.buffer,
        passkey.publicKey.byteOffset,
        passkey.publicKey.byteLength,
      ).slice(),
      counter: Number(passkey.counter),
      transports: passkey.transports as AuthenticatorTransport[],
    },
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.authenticationInfo) {
    logger.warn(
      { credentialId: response.id },
      "Passkey authentication verification failed",
    );
    throw AppError.unauthorized("فشل التحقق من مفتاح المرور");
  }

  const { newCounter } = verification.authenticationInfo;

  // Counter check for replay attack prevention:
  // If counter > 0 and newCounter <= counter, potential cloned authenticator
  if (passkey.counter > 0 && BigInt(newCounter) <= passkey.counter) {
    logger.error(
      {
        passkeyId: passkey.id,
        storedCounter: passkey.counter.toString(),
        newCounter,
      },
      "Replay attack detected: WebAuthn counter did not increase",
    );
    throw AppError.unauthorized("تم رصد محاولة تكرار غير مصرح بها للمفتاح");
  }

  // Update passkey counter and last used
  await prisma.userPasskey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(newCounter),
      lastUsedAt: new Date(),
    },
  });

  return passkey.user;
}

export async function listUserPasskeys(userId: string) {
  const passkeys = await prisma.userPasskey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      deviceName: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return passkeys.map((p) => ({
    id: p.id,
    label: p.deviceName,
    createdAt: p.createdAt.toISOString(),
    lastUsedAt: p.lastUsedAt?.toISOString(),
  }));
}

export async function revokeUserPasskey(userId: string, passkeyId: string) {
  const passkey = await prisma.userPasskey.findFirst({
    where: { id: passkeyId, userId },
  });

  if (!passkey) {
    throw AppError.notFound("مفتاح المرور غير موجود");
  }

  // Enforce keeping at least 1 passkey or requiring email verified
  const count = await prisma.userPasskey.count({
    where: { userId },
  });

  if (count <= 1) {
    throw AppError.badRequest(
      "لا يمكن حذف مفتاح المرور الوحيد. أضف مفتاحاً آخر أولاً.",
    );
  }

  await prisma.userPasskey.delete({
    where: { id: passkeyId },
  });

  return { success: true };
}
