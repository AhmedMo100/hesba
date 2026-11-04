import "server-only";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { withTenant } from "@/server/infra/db/tenant";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

const taxonomyInputSchema = z.object({
  newCategory: z.string().trim().min(1).optional(),
  newSellingMethod: z.string().trim().min(1).optional(),
});

/**
 * GET /api/store/custom-taxonomy
 * Returns custom categories and custom selling methods saved for the active store.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);

    const result = await withTenant(
      context.store.id,
      context.user.id,
      async (tx) => {
        const store = await tx.store.findUnique({
          where: { id: context.store.id },
          select: { settings: true },
        });

        const settings = (store?.settings as Record<string, unknown>) || {};
        const customCategories = Array.isArray(settings.customCategories)
          ? (settings.customCategories as string[])
          : [];
        const customSellingMethods = Array.isArray(
          settings.customSellingMethods,
        )
          ? (settings.customSellingMethods as string[])
          : [];

        return { customCategories, customSellingMethods };
      },
    );

    return NextResponse.json(result);
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
    const body = await req.json();
    const input = taxonomyInputSchema.parse(body);

    const result = await withTenant(
      context.store.id,
      context.user.id,
      async (tx) => {
        const store = await tx.store.findUnique({
          where: { id: context.store.id },
          select: { settings: true },
        });

        const currentSettings =
          (store?.settings as Record<string, unknown>) || {};

        const customCategories: string[] = Array.isArray(
          currentSettings.customCategories,
        )
          ? [...(currentSettings.customCategories as string[])]
          : [];

        const customSellingMethods: string[] = Array.isArray(
          currentSettings.customSellingMethods,
        )
          ? [...(currentSettings.customSellingMethods as string[])]
          : [];

        if (input.newCategory && input.newCategory !== "أخرى") {
          const trimmed = input.newCategory.trim();
          if (trimmed && !customCategories.includes(trimmed)) {
            customCategories.push(trimmed);
          }
        }

        if (input.newSellingMethod && input.newSellingMethod !== "أخرى") {
          const trimmed = input.newSellingMethod.trim();
          if (trimmed && !customSellingMethods.includes(trimmed)) {
            customSellingMethods.push(trimmed);
          }
        }

        const newSettings = {
          ...currentSettings,
          customCategories,
          customSellingMethods,
        };

        await tx.store.update({
          where: { id: context.store.id },
          data: {
            settings: newSettings as unknown as Prisma.InputJsonValue,
          },
        });

        return { customCategories, customSellingMethods };
      },
    );

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
