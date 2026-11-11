import "server-only";
import { prisma } from "@/server/infra/db/client";
import { type SignupInput, signupInputSchema } from "@/schemas/auth";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import { hashPassword } from "./password.service";
import { createSession } from "./session.service";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/server/infra/db/tenant";

/**
 * @file signup.service.ts
 * @description Owner sign-up: creates the user, their first store, the owner membership, a
 * device, and the first session.
 *
 * @usedBy
 * `src/app/api/auth/signup/route.ts`; `normalizePhone` is also used by `login.service.ts` and
 * `forgot-password.service.ts`.
 */

/**
 * Normalizes an Egyptian mobile number to the stored `+20…` form. Arabic-Indic digits,
 * spaces, `-` and `_` are accepted. Login looks users up by this normalized form, so every
 * write of `users.phone` must use it.
 *
 * @example normalizePhone("٠١٠ ١٢٣٤ ٥٦٧٨") // "+201012345678"
 */
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

/**
 * Registers a new owner and their store, and signs them in.
 *
 * The user, the store, the `owner` membership and the first device are created in one
 * `withTenant` transaction (QA-50), so a failed sign-up leaves no half-made account. The
 * session is created afterwards; if that fails the account is complete and login works.
 *
 * @param rawInput - Sign-up form data (validated with `signupInputSchema`).
 * @returns The raw session token plus the user and store summary.
 * @throws AppError (409) when the phone or email is already registered. A zod error on
 * invalid input.
 */
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

  // One transaction for the user, the store, the owner membership and the device (QA-50): a
  // failure in any step leaves nothing behind, so the same phone and email can sign up again.
  // `users` has no RLS; the tenant binding only matters for the store-scoped rows.
  const userId = randomUUID();
  let created;
  try {
    created = await withTenant(storeId, userId, async (tx) => {
      const u = await tx.user.create({
        data: {
          id: userId,
          name: data.ownerName.trim(),
          phone: normalizedPhone,
          email: normalizedEmail,
          passwordHash: hashedPassword,
        },
      });

      const s = await tx.store.create({
        data: {
          id: storeId,
          name: data.storeName.trim(),
          shopType: data.shopType,
          governorate: data.governorate,
          area: data.area ?? null,
          openedOn: openedOnDate,
          workersCount: data.workersCount ?? 1,
          createdBy: userId,
        },
      });

      await tx.storeMember.create({
        data: {
          storeId,
          userId,
          role: "owner",
        },
      });

      const d = await tx.device.create({
        data: {
          storeId,
          userId,
          label: "جهاز التسجيل الأول",
        },
      });

      return { user: u, store: s, device: d };
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
  const { user, store, device } = created;

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
