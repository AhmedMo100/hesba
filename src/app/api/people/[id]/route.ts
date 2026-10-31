import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import {
  getPersonDetails,
  updatePerson,
  deletePerson,
} from "@/server/modules/people";
import { updatePersonInputSchema } from "@/schemas/people";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/people/[id]
 * Returns details and full transaction history for a person / supplier.
 */
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;

    const result = await getPersonDetails(
      context.store.id,
      id,
      context.user.id,
      prisma,
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * PATCH /api/people/[id]
 * Updates person details, supplied products, or registers balance adjustments.
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const body = await req.json();

    const validated = updatePersonInputSchema.parse(body);

    const person = await updatePerson(
      context.store.id,
      id,
      validated,
      context.user.id,
      prisma,
    );

    return NextResponse.json({ person });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * DELETE /api/people/[id]
 * Soft deletes a person while preserving their ledger transaction history.
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;

    const result = await deletePerson(
      context.store.id,
      id,
      context.user.id,
      prisma,
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
