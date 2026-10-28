import "server-only";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/modules/auth";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const context = await getSessionFromRequest(req);

    if (!context) {
      return NextResponse.json({
        success: true,
        data: null,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        session: {
          idHash: context.session.idHash,
          userId: context.user.id,
          storeId: context.store.id,
          expiresAt: context.session.expiresAt.toISOString(),
        },
        user: {
          id: context.user.id,
          name: context.user.name,
          phone: context.user.phone,
          email: context.user.email,
          emailVerified: !!context.user.emailVerifiedAt,
        },
        store: {
          id: context.store.id,
          name: context.store.name,
          shopType: context.store.shopType,
          governorate: context.store.governorate,
          area: context.store.area ?? undefined,
          openedOn: context.store.openedOn?.toISOString() ?? "",
          workersCount: context.store.workersCount ?? 1,
        },
      },
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
