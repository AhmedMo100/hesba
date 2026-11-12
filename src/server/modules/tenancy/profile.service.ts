import "server-only";

/**
 * @file profile.service.ts
 * @description The owner edits their own details and the store's profile
 * (`PUT /api/auth/profile`, audit QA-11).
 *
 * @remarks
 * - One tenant transaction (`withTenant`): the store row is protected by FORCE RLS, so it is
 *   only visible — and updatable — with `app.store_id` set. The user row (not tenant-scoped)
 *   is updated in the same transaction, so both change or neither does.
 * - The phone is stored in the canonical `+20…` form that signup writes and login looks up
 *   (`normalizePhone`), so the owner can still sign in with the new number.
 * - The email is trimmed and lower-cased (the form recovery uses). Changing it clears
 *   `email_verified_at`: the new address has not been verified.
 * - A phone or email that belongs to another account is a 409, not a 500.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { normalizePhone } from "@/server/modules/auth";
import type { StoreProfileUpdateInput } from "@/schemas/auth";
import { assertStoreOwner } from "./tenancy.service";

/** The canonical stored phone form (see `normalizePhone`). */
const CANONICAL_PHONE = /^\+201[0125]\d{8}$/;

export interface SavedStoreProfile {
  ownerName: string;
  phone: string;
  email: string;
  emailVerified: boolean;
  storeName: string;
  shopType: string;
  governorate: string;
  area?: string;
  openedOn: string;
  workersCount: number;
}

/**
 * Saves the owner's and the store's profile and returns the values as stored.
 *
 * @throws AppError 403 (not the owner), 400 (invalid phone or date), 409 (phone or email used
 *   by another account).
 */
export async function updateStoreProfile(
  storeId: string,
  userId: string,
  input: StoreProfileUpdateInput,
): Promise<SavedStoreProfile> {
  await assertStoreOwner(storeId, userId);

  const phone = normalizePhone(input.phone);
  if (!CANONICAL_PHONE.test(phone)) {
    throw new AppError("VALIDATION_ERROR", "رقم هاتف مصري غير صحيح", 400, {
      field: "phone",
    });
  }
  const email = input.email.trim().toLowerCase();
  const openedOn = input.openedOn ? new Date(input.openedOn) : null;
  if (openedOn && Number.isNaN(openedOn.getTime())) {
    throw new AppError("VALIDATION_ERROR", "تاريخ الافتتاح غير صحيح", 400, {
      field: "openedOn",
    });
  }

  try {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const current = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { email: true, emailVerifiedAt: true },
        });
        const user = await tx.user.update({
          where: { id: userId },
          data: {
            name: input.ownerName,
            phone,
            email,
            ...(current.email !== email ? { emailVerifiedAt: null } : {}),
          },
        });
        const store = await tx.store.update({
          where: { id: storeId },
          data: {
            name: input.storeName,
            shopType: input.shopType,
            governorate: input.governorate,
            area: input.area?.trim() || null,
            openedOn,
            workersCount: input.workersCount,
          },
        });
        return {
          ownerName: user.name,
          phone: user.phone,
          email: user.email,
          emailVerified: user.emailVerifiedAt !== null,
          storeName: store.name,
          shopType: store.shopType,
          governorate: store.governorate,
          area: store.area ?? undefined,
          openedOn: store.openedOn?.toISOString() ?? "",
          workersCount: store.workersCount ?? 1,
        };
      },
      prisma,
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const target = String(err.meta?.["target"] ?? "");
      throw target.includes("email")
        ? new AppError("CONFLICT", "الإيميل ده مستخدم في حساب تاني", 409, {
            field: "email",
          })
        : new AppError("CONFLICT", "رقم الموبايل ده مستخدم في حساب تاني", 409, {
            field: "phone",
          });
    }
    throw err;
  }
}
