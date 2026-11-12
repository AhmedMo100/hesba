import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { updateStoreProfile } from "@/server/modules/tenancy";
import { storeProfileUpdateSchema } from "@/schemas/auth";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * PUT /api/auth/profile
 * The owner saves their details and the store's profile in one tenant transaction (QA-11).
 * Returns the values as stored (the phone in its canonical `+20…` form).
 * 400 invalid input · 401 no session · 403 not the owner · 409 phone/email of another account.
 */
export async function PUT(req: Request) {
  try {
    const context = await requireSession(req);
    const data = storeProfileUpdateSchema.parse(await readJsonBody(req));
    const saved = await updateStoreProfile(
      context.store.id,
      context.user.id,
      data,
    );
    return NextResponse.json({ success: true, data: saved });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
