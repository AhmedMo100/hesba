import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getSandwich, updateSandwich } from "@/server/modules/sandwiches";
import {
  AppError,
  readJsonBody,
  toSafeErrorResponse,
} from "@/server/platform/error";
import { sandwichInputSchema } from "@/schemas/sandwich";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sandwichId(params: RouteParams["params"]): Promise<string> {
  const { id } = await params;
  if (!UUID_RE.test(id)) throw AppError.notFound("الساندوتش ده مش موجود");
  return id;
}

/** GET /api/sandwiches/:id — one sandwich with its recipe and live cost. */
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const sandwich = await getSandwich(
      context.store.id,
      context.user.id,
      await sandwichId(params),
    );
    return NextResponse.json({ sandwich });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * PATCH /api/sandwiches/:id
 * Replaces the name, selling price and recipe. Past sales are not changed. Online only.
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const id = await sandwichId(params);
    const input = sandwichInputSchema.parse(await readJsonBody(req));
    const sandwich = await updateSandwich(
      context.store.id,
      context.user.id,
      id,
      input,
    );
    return NextResponse.json({ sandwich });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
