import "server-only";

/**
 * @file images.ts
 * @description Checks the scanner's uploaded photos before anything else happens (no credit is
 * reserved for a refused upload): count, size, and the real file type from its first bytes —
 * not the browser's claim. Photos are kept in memory for the one provider call and never stored.
 */
import { AppError } from "@/server/platform/error";
import type { ScanImage } from "@/server/infra/ai";
import {
  SCAN_MAX_IMAGE_BYTES,
  SCAN_MAX_IMAGES_HARD,
  SCAN_MAX_TOTAL_BYTES,
} from "@/schemas/scanner";

export function sniffImageType(b: Buffer): ScanImage["mimeType"] | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "image/jpeg";
  if (
    b.length >= 8 &&
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString("ascii") === "RIFF" &&
    b.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Decodes the scanner's photos from the JSON body (`images: [{ data: base64 }]`). The scanner
 * posts JSON, like every other write, so the same-origin / JSON-only request guard applies
 * (a cross-site form cannot submit it).
 *
 * @throws AppError 400 with an Arabic message for any unfit photo.
 */
export function readScanImages(input: unknown): ScanImage[] {
  const list = Array.isArray(input) ? input : [];
  if (list.length === 0) throw AppError.badRequest("صوّر منتج واحد على الأقل");
  if (list.length > SCAN_MAX_IMAGES_HARD) {
    throw AppError.badRequest(
      `أقصى عدد صور في الاسكان الواحد ${SCAN_MAX_IMAGES_HARD}`,
    );
  }
  let total = 0;
  const out: ScanImage[] = [];
  for (const item of list) {
    const b64 =
      item &&
      typeof item === "object" &&
      typeof (item as { data?: unknown }).data === "string"
        ? (item as { data: string }).data
        : "";
    if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
      throw AppError.badRequest("الملف ده مش صورة (JPEG أو PNG أو WebP)");
    }
    const data = Buffer.from(b64, "base64");
    if (data.length > SCAN_MAX_IMAGE_BYTES) {
      throw AppError.badRequest("صورة من الصور كبيرة قوي، صوّرها تاني");
    }
    total += data.length;
    if (total > SCAN_MAX_TOTAL_BYTES)
      throw AppError.badRequest("الصور كبيرة قوي مع بعض");
    const mimeType = sniffImageType(data);
    if (!mimeType)
      throw AppError.badRequest("الملف ده مش صورة (JPEG أو PNG أو WebP)");
    out.push({ mimeType, data });
  }
  return out;
}
