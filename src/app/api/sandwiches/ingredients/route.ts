import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { listIngredientOptions } from "@/server/modules/sandwiches";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/sandwiches/ingredients
 * Stock items that can be used in a recipe, with their registered purchase price and stock.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const ingredients = await listIngredientOptions(
      context.store.id,
      context.user.id,
    );
    return NextResponse.json({ ingredients });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
