import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { MachinesService } from "@/server/modules/machines";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * POST /api/machines/deduct
 * Deducts balance from a POS machine upon executing a service/bill sale.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();

    const { machineId, amountPiasters, source, reference, notes } = body;

    if (!machineId) {
      return NextResponse.json(
        { error: { message: "معرف الماكينة مطلوب" } },
        { status: 400 },
      );
    }

    if (!amountPiasters || Number(amountPiasters) <= 0) {
      return NextResponse.json(
        { error: { message: "قيمة الخصم يجب أن تكون أكبر من صفر" } },
        { status: 400 },
      );
    }

    const machinesService = new MachinesService(prisma);
    const machine = await machinesService.deductMachineBalance(
      context.store.id,
      context.user.id,
      machineId,
      Number(amountPiasters),
      { source, reference, notes },
    );

    return NextResponse.json({ machine });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
