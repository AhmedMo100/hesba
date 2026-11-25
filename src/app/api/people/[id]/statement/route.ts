import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { getPersonStatement } from "@/server/modules/people";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/people/:id/statement — the person's account statement (ADR-0036): every entry with
 * its running balance, its source (credit invoice, supplier invoice, daily total, manual debt,
 * payment) and the products behind it. Read-only; another shop's person is a 404.
 */
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const id = z
      .string()
      .uuid("الشخص غير صحيح")
      .parse((await params).id);
    return NextResponse.json(
      await getPersonStatement(context.store.id, context.user.id, id),
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
