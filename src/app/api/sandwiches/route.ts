import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { createSandwich, listSandwiches } from "@/server/modules/sandwiches";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { sandwichInputSchema } from "@/schemas/sandwich";

export const dynamic = "force-dynamic";

/**
 * GET /api/sandwiches[?includeHidden=true]
 * The store's sandwiches with their recipe and live cost (ADR-0018).
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const includeHidden =
      new URL(req.url).searchParams.get("includeHidden") === "true";
    const sandwiches = await listSandwiches(context.store.id, context.user.id, {
      includeHidden,
    });
    return NextResponse.json({ sandwiches });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/sandwiches
 * Creates a sandwich from a name, a selling price and a recipe. Online only.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = sandwichInputSchema.parse(await readJsonBody(req));
    const sandwich = await createSandwich(
      context.store.id,
      context.user.id,
      input,
    );
    return NextResponse.json({ sandwich }, { status: 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
