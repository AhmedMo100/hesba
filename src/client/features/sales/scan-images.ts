/**
 * @file scan-images.ts
 * @description Prepares a photo for the scanner on the device: decodes it, scales the long side
 * down to `MAX_SIDE`, and re-encodes it as JPEG. Re-encoding drops the file's metadata (EXIF:
 * location, device), and the smaller file uploads faster on a phone connection.
 */

export const MAX_SIDE = 1280;
const QUALITY = 0.8;
/** Larger originals are refused before decoding (a phone photo is ~2–8 MB). */
export const MAX_SOURCE_BYTES = 25_000_000;
export const ACCEPTED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

export interface PreparedPhoto {
  id: string;
  /** Base64 JPEG without the `data:` prefix — what is uploaded. */
  base64: string;
  /** For the thumbnail. */
  previewUrl: string;
  bytes: number;
}

export function scaledSize(
  w: number,
  h: number,
  max = MAX_SIDE,
): { w: number; h: number } {
  const longSide = Math.max(w, h);
  if (longSide <= max) return { w, h };
  const k = max / longSide;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("الملف ده مش صورة");
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error("الصورة كبيرة قوي");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("مقدرناش نفتح الصورة دي، صوّر تاني");
  });
  const { w, h } = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("مقدرناش نجهز الصورة");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    base64,
    previewUrl: dataUrl,
    bytes: Math.floor((base64.length * 3) / 4),
  };
}
