import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { assertStoreOwner } from "@/server/modules/tenancy";
import { prisma } from "@/server/infra/db/client";
import { storeProfileUpdateSchema } from "@/schemas/auth";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  try {
    const context = await requireSession(req);
    await assertStoreOwner(context.store.id, context.user.id);

    const body = await req.json();
    const data = storeProfileUpdateSchema.parse(body);

    const openedOnDate = data.openedOn ? new Date(data.openedOn) : null;

    // Update in transaction
    const [updatedUser, updatedStore] = await prisma.$transaction([
      prisma.user.update({
        where: { id: context.user.id },
        data: {
          name: data.ownerName,
          phone: data.phone,
          email: data.email,
        },
      }),
      prisma.store.update({
        where: { id: context.store.id },
        data: {
          name: data.storeName,
          shopType: data.shopType,
          governorate: data.governorate,
          area: data.area ?? null,
          openedOn: openedOnDate,
          workersCount: data.workersCount,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        ownerName: updatedUser.name,
        phone: updatedUser.phone,
        email: updatedUser.email,
        emailVerified: !!updatedUser.emailVerifiedAt,
        storeName: updatedStore.name,
        shopType: updatedStore.shopType,
        governorate: updatedStore.governorate,
        area: updatedStore.area ?? undefined,
        openedOn: updatedStore.openedOn?.toISOString() ?? "",
        workersCount: updatedStore.workersCount ?? 1,
      },
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
