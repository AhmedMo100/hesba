import "server-only";
import { prisma } from "@/server/infra/db/client";
import { type SignupInput, signupInputSchema } from "@/schemas/auth";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import { hashPassword } from "./password.service";
import { createSession } from "./session.service";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/server/infra/db/tenant";

export function normalizePhone(v: string): string {
  let cleaned = v
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\s\-_]/g, "")
    .trim();

  if (cleaned.startsWith("0020")) {
    cleaned = "+20" + cleaned.slice(4);
  } else if (cleaned.startsWith("20") && cleaned.length === 12) {
    cleaned = "+" + cleaned;
  } else if (cleaned.startsWith("01") && cleaned.length === 11) {
    cleaned = "+2" + cleaned;
  } else if (cleaned.startsWith("1") && cleaned.length === 10) {
    cleaned = "+20" + cleaned;
  }
  return cleaned;
}

export async function registerUserWithPassword(rawInput: SignupInput) {
  const data = signupInputSchema.parse(rawInput);
  const normalizedPhone = normalizePhone(data.phone);
  const normalizedEmail = data.email.trim().toLowerCase();

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ phone: normalizedPhone }, { email: normalizedEmail }],
    },
  });

  if (existing) {
    if (existing.phone === normalizedPhone) {
      throw AppError.conflict("رقم الموبايل مسجل بالفعل");
    }
    throw AppError.conflict("البريد الإلكتروني مسجل بالفعل");
  }

  const hashedPassword = await hashPassword(data.password);

  const storeId = randomUUID();
  const openedOnDate = data.openedOn ? new Date(data.openedOn) : new Date();

  // 1. Create User (users table has NO RLS, accessed under service role)
  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: data.ownerName.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        passwordHash: hashedPassword,
      },
    });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const meta = (err as { meta?: { target?: string[] | string } }).meta;
      const targetStr = JSON.stringify(meta?.target ?? "");
      if (targetStr.includes("phone")) {
        throw AppError.conflict("رقم الموبايل مسجل بالفعل");
      }
      throw AppError.conflict("البريد الإلكتروني مسجل بالفعل");
    }
    throw err;
  }

  // 2. Create Store, StoreMember, and Device under withTenant context
  const { store, device } = await withTenant(storeId, user.id, async (tx) => {
    const s = await tx.store.create({
      data: {
        id: storeId,
        name: data.storeName.trim(),
        shopType: data.shopType,
        governorate: data.governorate,
        area: data.area ?? null,
        openedOn: openedOnDate,
        workersCount: data.workersCount ?? 1,
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

  // 3. Create initial authenticated session
  const { rawToken: sessionToken, session } = await createSession(
    user.id,
    store.id,
    device.id,
  );

  logger.info(
    { userId: user.id, storeId: store.id },
    "User registered successfully with password",
  );

  return {
    userId: user.id,
    storeId: store.id,
    sessionToken,
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
