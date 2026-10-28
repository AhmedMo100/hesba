import "server-only";
import { NextResponse } from "next/server";
import {
  verifyAuthenticationAndGetUser,
  createSession,
  getSessionCookieOptions,
} from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { toSafeErrorResponse, AppError } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { credential } = body;

    if (!credential) {
      throw AppError.badRequest("بيانات المصادقة مطلوبة");
    }

    const user = await verifyAuthenticationAndGetUser(credential);

    // Get user's primary store membership
    const member = await prisma.storeMember.findFirst({
      where: { userId: user.id },
      include: { store: true },
      orderBy: { createdAt: "asc" },
    });

    if (!member) {
      throw AppError.internal("لم يتم العثور على متجر مرتبط بهذا الحساب");
    }

    // Create session
    const { rawToken, session } = await createSession(user.id, member.storeId);

    const result = {
      token: rawToken,
      session: {
        idHash: session.idHash,
        userId: user.id,
        storeId: member.storeId,
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
        id: member.store.id,
        name: member.store.name,
        shopType: member.store.shopType,
        governorate: member.store.governorate,
        area: member.store.area ?? undefined,
        openedOn: member.store.openedOn?.toISOString() ?? "",
        workersCount: member.store.workersCount ?? 1,
      },
    };

    const res = NextResponse.json({
      success: true,
      data: result,
    });

    const cookieOptions = getSessionCookieOptions();
    res.cookies.set({
      name: cookieOptions.name,
      value: rawToken,
      httpOnly: cookieOptions.httpOnly,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      path: cookieOptions.path,
      maxAge: cookieOptions.maxAge,
    });

    return res;
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
