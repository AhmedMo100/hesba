import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { toSafeErrorResponse } from "@/server/platform/error";
import { storeAccessView } from "@/domain/subscription";
import { env } from "@/server/config/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/subscription — the shop's operating mode and subscription as the server sees them now,
 * and how to reach Hesba to activate it (ADR-0008, ADR-0033). Readable when the trial or
 * subscription is over: it is what the expiry screen shows. Read-only: there is no endpoint that
 * changes a subscription (Hesba activates shops in the database).
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req, { allowInactive: true });
    return NextResponse.json({
      store: { id: context.store.id, name: context.store.name },
      ...storeAccessView(context.store, new Date()),
      contact: {
        whatsapp: env.HESBA_RENEWAL_WHATSAPP ?? null,
        vodafoneCash: env.HESBA_RENEWAL_VODAFONE_CASH ?? null,
        instapay: env.HESBA_RENEWAL_INSTAPAY ?? null,
      },
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
