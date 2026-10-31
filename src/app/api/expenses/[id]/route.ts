import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { ExpenseService } from "@/server/modules/expenses";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/expenses/[id]
 * Updates a specific expense.
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const body = await req.json();

    const expenseService = new ExpenseService(prisma);
    const expense = await expenseService.updateExpense(
      context.store.id,
      context.user.id,
      id,
      body,
    );

    return NextResponse.json({ expense });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * DELETE /api/expenses/[id]
 * Deletes a specific expense.
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;

    const expenseService = new ExpenseService(prisma);
    const result = await expenseService.deleteExpense(
      context.store.id,
      context.user.id,
      id,
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
