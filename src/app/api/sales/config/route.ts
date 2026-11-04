import "server-only";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireSession } from "@/server/modules/auth";
import { withTenant } from "@/server/infra/db/tenant";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export interface SalesViewConfig {
  enabledServiceIds: string[];
  enabledProductIds?: string[];
  updatedAt?: string;
}

/**
 * GET /api/sales/config
 * Retrieves the customized sales view configuration for the active supermarket.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);

    const config = await withTenant(
      context.store.id,
      context.user.id,
      async (tx) => {
        const store = await tx.store.findUnique({
          where: { id: context.store.id },
          select: { settings: true },
        });

        const rawSettings = (store?.settings as Record<string, unknown>) || {};
        const salesConfig = rawSettings.salesConfig as
          SalesViewConfig | undefined;

        return (
          salesConfig || {
            enabledServiceIds: [],
            enabledProductIds: [],
          }
        );
      },
    );

    return NextResponse.json({ config });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/sales/config
 * Updates and persists the customized sales view configuration for the active supermarket in Postgres.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();

    const { enabledServiceIds, enabledProductIds } = body;

    const updatedConfig: SalesViewConfig = {
      enabledServiceIds: Array.isArray(enabledServiceIds)
        ? Array.from(new Set(enabledServiceIds.map(String)))
        : [],
      enabledProductIds: Array.isArray(enabledProductIds)
        ? Array.from(new Set(enabledProductIds.map(String)))
        : [],
      updatedAt: new Date().toISOString(),
    };

    await withTenant(context.store.id, context.user.id, async (tx) => {
      const store = await tx.store.findUnique({
        where: { id: context.store.id },
        select: { settings: true },
      });

      const currentSettings =
        (store?.settings as Record<string, unknown>) || {};
      const newSettings = {
        ...currentSettings,
        salesConfig: updatedConfig,
      };

      await tx.store.update({
        where: { id: context.store.id },
        data: {
          settings: newSettings as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({ success: true, config: updatedConfig });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
