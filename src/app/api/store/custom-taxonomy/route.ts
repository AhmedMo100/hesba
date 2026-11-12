import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getCustomTaxonomy, addCustomTaxonomy } from "@/server/modules/catalog";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";
import { customTaxonomyInputSchema } from "@/schemas/product";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/custom-taxonomy
 * Returns custom categories and custom selling methods saved for the active store.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    return NextResponse.json(
      await getCustomTaxonomy(context.store.id, context.user.id),
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/store/custom-taxonomy
 * Adds a new custom category or selling method to the active store's settings in Postgres.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = customTaxonomyInputSchema.parse(await readJsonBody(req));
    const result = await addCustomTaxonomy(
      context.store.id,
      context.user.id,
      input,
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
