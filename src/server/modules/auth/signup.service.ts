import "server-only";
import { prisma } from "@/server/infra/db/client";
import { type SignupInputRaw, signupInputSchema } from "@/schemas/auth";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import { createSession } from "./session.service";
import { sendEmailVerification } from "./recovery.service";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/server/infra/db/tenant";

export async function signupUserAndStore(rawInput: SignupInputRaw) {
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

  // 1. Create User
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
  const { store, device } = await withTenant(storeId, user.id, async (tx) => {
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

  // 3. Create active session
  const { rawToken, session } = await createSession(
    user.id,
    store.id,
    device.id,
  );

  // 4. Send background email verification link
  sendEmailVerification(user.id).catch((err) => {
    logger.error(
      { err, userId: user.id },
      "Failed to send email verification during signup",
    );
  });

  logger.info(
    { userId: user.id, storeId: store.id },
    "User, store and device successfully created and authenticated",
  );

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
      emailVerified: false,
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
