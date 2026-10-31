import "server-only";
import { AppError } from "@/server/platform/error";
import type { StoreMemberRole } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";

export async function getStoreMembership(storeId: string, userId: string) {
  return await withTenant(storeId, userId, async (tx) => {
    return await tx.storeMember.findUnique({
      where: {
        storeId_userId: {
          storeId,
          userId,
        },
      },
      include: {
        store: true,
        user: true,
      },
    });
  });
}

export async function assertStoreAccess(
  storeId: string,
  userId: string,
  allowedRoles?: StoreMemberRole[],
) {
  const member = await getStoreMembership(storeId, userId);

  if (!member) {
    throw AppError.forbidden("ليس لديك صلاحية للوصول إلى هذا المتجر");
  }

  if (allowedRoles && !allowedRoles.includes(member.role)) {
    if (allowedRoles.length === 1 && allowedRoles[0] === "owner") {
      throw AppError.forbidden("هذا الإجراء مخصص لمالك المتجر فقط");
    }
    throw AppError.forbidden(
      "ليس لديك الصلاحية الكافية في هذا المتجر لتنفيذ هذا الإجراء",
    );
  }

  return member;
}

export async function assertStoreOwner(storeId: string, userId: string) {
  return await assertStoreAccess(storeId, userId, ["owner"]);
}
