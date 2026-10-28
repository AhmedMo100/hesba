import "server-only";
import { prisma } from "@/server/infra/db/client";
import { type SignupInput, signupInputSchema } from "@/schemas/auth";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import {
  generateRegistrationOptionsForUser,
  verifyAndSaveRegistration,
} from "./passkey.service";
import { createSession } from "./session.service";
import { sendEmailVerification } from "./recovery.service";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/server/infra/db/tenant";

export async function startSignup(rawInput: SignupInput) {
  const data = signupInputSchema.parse(rawInput);

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ phone: data.phone }, { email: data.email }],
    },
  });

  if (existing) {
    if (existing.phone === data.phone) {
      throw AppError.conflict("رقم الهاتف مسجل بالفعل");
    }
    throw AppError.conflict("البريد الإلكتروني مسجل بالفعل");
  }

  // 1. Create User (users table has NO RLS, accessed under service role)
  const user = await prisma.user.create({
    data: {
      name: data.ownerName,
      phone: data.phone,
      email: data.email,
      passwordHash: null,
    },
  });

  const storeId = randomUUID();
  const openedOnDate = data.openedOn ? new Date(data.openedOn) : null;

  // 2. Create Store, StoreMember, and Device under withTenant context (satisfies RLS on stores)
  const { store } = await withTenant(storeId, user.id, async (tx) => {
    const s = await tx.store.create({
      data: {
        id: storeId,
        name: data.storeName,
        shopType: data.shopType,
        governorate: data.governorate,
        area: data.area ?? null,
        openedOn: openedOnDate,
        workersCount: data.workersCount,
        createdBy: user.id,
      },
    });

    await tx.storeMember.create({
      data: {
        storeId,
        userId: user.id,
        role: "owner",
      },
    });

    const d = await tx.device.create({
      data: {
        storeId,
        userId: user.id,
        label: "جهاز التسجيل الأول",
      },
    });

    return { store: s, device: d };
  });

  logger.info(
    { userId: user.id, storeId: store.id },
    "User and store pre-registered for WebAuthn passkey registration",
  );

  // Generate Passkey Registration Options
  const passkeyOptions = await generateRegistrationOptionsForUser({
    id: user.id,
    name: user.name,
    email: user.email,
  });

  return {
    userId: user.id,
    storeId: store.id,
    passkeyOptions,
  };
}

export async function completeSignup(
  userId: string,
  storeId: string,
  credential: RegistrationResponseJSON,
  label = "جهاز المالك",
) {
  // 1. Verify and register Passkey with SimpleWebAuthn
  await verifyAndSaveRegistration(userId, credential, label);

  // 2. Send background email verification
  sendEmailVerification(userId).catch((err) => {
    logger.error(
      { err, userId },
      "Failed to send email verification during signup",
    );
  });

  // 3. Register device if not existing or get existing device
  let device = await prisma.device.findFirst({
    where: { storeId, userId },
  });

  if (!device) {
    device = await withTenant(storeId, userId, async (tx) => {
      return await tx.device.create({
        data: {
          storeId,
          userId,
          label,
        },
      });
    });
  }

  // 4. Create active session
  const { rawToken, session } = await createSession(userId, storeId, device.id);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });

  return {
    token: rawToken,
    session: {
      idHash: session.idHash,
      userId: user.id,
      storeId: store.id,
      expiresAt: session.expiresAt.toISOString(),
    },
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      emailVerified: !!user.emailVerifiedAt,
    },
    store: {
      id: store.id,
      name: store.name,
      shopType: store.shopType,
      governorate: store.governorate,
      area: store.area ?? undefined,
      openedOn: store.openedOn?.toISOString() ?? "",
      workersCount: store.workersCount ?? 1,
    },
  };
}

export async function signupUserAndStore(rawInput: SignupInput) {
  return await startSignup(rawInput);
}
