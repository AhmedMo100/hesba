import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { ScannerService, readScanImages } from "@/server/modules/ai";
import {
  AppError,
  readJsonBody,
  toSafeErrorResponse,
} from "@/server/platform/error";
import { scanOpIdSchema, SCAN_MAX_TOTAL_BYTES } from "@/schemas/scanner";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/scan — JSON `{ opId, images: [{ data: base64 }] }` (up to N photos). Recognizes the products in the
 * photos and returns them matched to this shop's products for confirmation (ADR-0030). It
 * records nothing in sales or stock. 200 with `duplicate: true` replays a finished `opId`.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const length = Number(req.headers.get("content-length") ?? 0);
    // Base64 is 4/3 of the bytes; refuse an oversized body before reading it.
    if (length > Math.ceil((SCAN_MAX_TOTAL_BYTES * 4) / 3) + 100_000) {
      throw AppError.badRequest("الصور كبيرة قوي مع بعض");
    }
    const body = (await readJsonBody(req)) as {
      opId?: unknown;
      images?: unknown;
    };
    const opId = scanOpIdSchema.parse(String(body?.opId ?? ""));
    const images = readScanImages(body?.images);
    const result = await new ScannerService(prisma).scan(
      context.store.id,
      context.user.id,
      opId,
      images,
    );
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
