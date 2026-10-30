import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { recordDebtTransaction } from "@/server/modules/people";
import { recordDebtTransactionInputSchema } from "@/schemas/people";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/people/[id]/transactions
 * Records a debt increase or payment/collection for a contact.
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const body = await req.json();

    const validated = recordDebtTransactionInputSchema.parse(body);

    const transaction = await recordDebtTransaction(
      context.store.id,
      id,
      validated,
      context.user.id,
      prisma,
    );

    return NextResponse.json({ transaction }, { status: 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
