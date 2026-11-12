import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { MachinesService } from "@/server/modules/machines";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { machineAdjustSchema } from "@/schemas/machine";

export const dynamic = "force-dynamic";

/**
 * POST /api/machines/adjust
 * Sets a POS machine's exact balance (reconciliation). Integer piasters only (400 otherwise); idempotent by `opId`; the machine row is
 * locked so concurrent operations cannot lose each other's change (ADR-0020).
 * Returns `{ machine, duplicate }`.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = machineAdjustSchema.parse(await readJsonBody(req));
    const { duplicate, ...machine } = await new MachinesService(
      prisma,
    ).adjustMachineBalance(
      context.store.id,
      context.user.id,
      input.machineId,
      input.targetBalancePiasters,
      {
        opId: input.opId,
        source: input.source,
        reference: input.reference,
        notes: input.notes,
        reason: input.reason,
      },
    );
    return NextResponse.json({ machine, duplicate });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
