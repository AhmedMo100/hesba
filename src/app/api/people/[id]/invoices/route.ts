import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { listCustomerInvoices } from "@/server/modules/sales";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/people/:id/invoices — a customer's credit invoices, products, payments, remaining. */
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const id = z
      .string()
      .uuid("الزبون غير صحيح")
      .parse((await params).id);
    return NextResponse.json(
      await listCustomerInvoices(context.store.id, context.user.id, id),
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
