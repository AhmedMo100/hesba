import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { MachinesService } from "@/server/modules/machines";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";
import { upsertMachineSchema } from "@/schemas/machine";

export const dynamic = "force-dynamic";

/**
 * GET /api/machines
 * Returns all active POS machines with current balance and topup history for the tenant store.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const machinesService = new MachinesService(prisma);
    const machines = await machinesService.getStoreMachines(
      context.store.id,
      context.user.id,
    );

    return NextResponse.json({ machines });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/machines
 * Creates or updates a POS machine.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = upsertMachineSchema.parse(await readJsonBody(req));

    const machinesService = new MachinesService(prisma);
    const machine = await machinesService.upsertMachine(
      context.store.id,
      context.user.id,
      input,
    );

    return NextResponse.json({ machine }, { status: 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * DELETE /api/machines?id=...
 * Soft-deletes a POS machine.
 */
export async function DELETE(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const machineId = searchParams.get("id");

    if (!machineId) {
      return NextResponse.json(
        { error: { message: "معرف الماكينة مطلوب" } },
        { status: 400 },
      );
    }

    const machinesService = new MachinesService(prisma);
    await machinesService.deleteMachine(
      context.store.id,
      context.user.id,
      machineId,
    );

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
