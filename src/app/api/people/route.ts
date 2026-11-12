import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { getPeopleBySection, createPerson } from "@/server/modules/people";
import {
  createPersonInputSchema,
  peopleListQuerySchema,
} from "@/schemas/people";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/people
 * List contacts for a section (owedToMe, iOwe, suppliers) with totals and search.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);

    // QA-59: an unknown section is a 400, never read as «ليك». No section = «ليك» (default).
    const { section, q: search } = peopleListQuerySchema.parse({
      section: searchParams.get("section") ?? undefined,
      q: searchParams.get("q") || undefined,
    });

    const result = await getPeopleBySection(
      context.store.id,
      section,
      search,
      context.user.id,
      prisma,
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/people
 * Creates a new customer/debtor or supplier with optional initial balance.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await readJsonBody(req);

    const validated = createPersonInputSchema.parse(body);

    const person = await createPerson(
      context.store.id,
      validated,
      context.user.id,
      prisma,
    );

    return NextResponse.json({ person }, { status: 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
