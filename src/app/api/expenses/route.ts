import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { ExpenseService } from "@/server/modules/expenses";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/expenses
 * List store expenses for the authenticated session's store with optional date period and category filtering.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);

    const period = searchParams.get("period") || "today";
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const category = searchParams.get("category") || undefined;

    const expenseService = new ExpenseService(prisma);
    const result = await expenseService.getStoreExpenses(
      context.store.id,
      context.user.id,
      { period, from, to, category },
    );

    return NextResponse.json({
      expenses: result.expenses,
      total_piasters: result.totalPiasters,
      by_category: result.byCategory,
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/expenses
 * Creates a new expense under the authenticated store.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();

    const expenseService = new ExpenseService(prisma);
    const expense = await expenseService.createExpense(
      context.store.id,
      context.user.id,
      body,
    );

    return NextResponse.json({ expense }, { status: 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * PATCH /api/expenses
 * Updates an expense when id is supplied in body or query params.
 */
export async function PATCH(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();
    const { searchParams } = new URL(req.url);
    const id = body?.id || searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "معرف المصروف مطلوب" },
        { status: 400 },
      );
    }

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
 * DELETE /api/expenses?id=uuid
 * Deletes (soft-deletes) an expense under the authenticated store.
 */
export async function DELETE(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    let id = searchParams.get("id");

    if (!id) {
      try {
        const body = await req.json();
        id = body?.id;
      } catch {
        // body not present
      }
    }

    if (!id) {
      return NextResponse.json(
        { error: "معرف المصروف مطلوب" },
        { status: 400 },
      );
    }

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
