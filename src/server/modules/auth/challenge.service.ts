import "server-only";
import { prisma } from "@/server/infra/db/client";
import { generateSecureToken } from "./crypto";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";

const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export type ChallengePurpose = "registration" | "authentication" | "reauth";

export async function createPasskeyChallenge(
  purpose: ChallengePurpose,
  userId?: string,
): Promise<string> {
  const challenge = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRY_MS);

  await prisma.passkeyChallenge.create({
    data: {
      challenge,
      purpose,
      userId: userId ?? null,
      expiresAt,
    },
  });

  return challenge;
}

export async function consumePasskeyChallenge(
  challenge: string,
  expectedPurpose: ChallengePurpose,
) {
  const now = new Date();

  // Atomically find and consume the challenge in a transaction
  return await prisma.$transaction(async (tx) => {
    const record = await tx.passkeyChallenge.findUnique({
      where: { challenge },
    });

    if (!record) {
      logger.warn({ expectedPurpose }, "Passkey challenge not found");
      throw AppError.badRequest("رمز التحقق غير صحيح أو انتهت صلاحيته");
    }

    if (record.usedAt !== null) {
      logger.warn(
        { challengeId: record.id, purpose: record.purpose },
        "Replay attempt on already consumed passkey challenge",
      );
      throw AppError.badRequest("تم استخدام رمز التحقق هذا من قبل");
    }

    if (record.expiresAt < now) {
      logger.warn({ challengeId: record.id }, "Passkey challenge has expired");
      throw AppError.badRequest("انتهت صلاحية رمز التحقق");
    }

    if (record.purpose !== expectedPurpose) {
      logger.warn(
        { foundPurpose: record.purpose, expectedPurpose },
        "Passkey challenge purpose mismatch",
      );
      throw AppError.badRequest("غرض رمز التحقق غير مطابق");
    }

    // Mark as consumed
    const updated = await tx.passkeyChallenge.update({
      where: { id: record.id },
      data: { usedAt: now },
    });

    return updated;
  });
}
