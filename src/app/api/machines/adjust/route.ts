import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { MachinesService } from "@/server/modules/machines";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * POST /api/machines/adjust
 * Sets / adjusts the exact balance of a POS machine (reconciliation / correction).
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();

    const {
      machineId,
      targetBalancePiasters,
      source,
      reason,
      reference,
      notes,
    } = body;

    if (!machineId) {
      return NextResponse.json(
        { error: { message: "معرف الماكينة مطلوب" } },
        { status: 400 },
      );
    }

    if (
      targetBalancePiasters === undefined ||
      targetBalancePiasters === null ||
      Number(targetBalancePiasters) < 0
    ) {
      return NextResponse.json(
        { error: { message: "رصيد الماكينة يجب ألا يقل عن صفر" } },
        { status: 400 },
      );
    }

    const machinesService = new MachinesService(prisma);
    const machine = await machinesService.adjustMachineBalance(
      context.store.id,
      context.user.id,
      machineId,
      Number(targetBalancePiasters),
      { source, reason, reference, notes },
    );

    return NextResponse.json({ machine });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
