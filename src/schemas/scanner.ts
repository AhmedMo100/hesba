import { z } from "zod";

/**
 * @file scanner.ts
 * @description The AI product scanner's contracts (ADR-0030): what the model may answer
 * (validated as untrusted input), and what the API returns. Only the shop's records supply
 * ids, prices, stock and units; the model's answer supplies descriptions only.
 */

/** Hard limits the server enforces whatever the admin sets (the admin may only go lower). */
export const SCAN_MAX_IMAGES_HARD = 10;
export const SCAN_MAX_IMAGE_BYTES = 2_000_000;
export const SCAN_MAX_TOTAL_BYTES = 12_000_000;
export const SCAN_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const text = z
  .string()
  .trim()
  .max(120)
  .nullish()
  .transform((v) => (v ? v : null));

/** One product the model says it saw. Unknown fields are dropped; out-of-range values fail. */
export const recognizedItemSchema = z.object({
  imageIndex: z
    .number()
    .int()
    .min(0)
    .max(SCAN_MAX_IMAGES_HARD - 1),
  brand: text,
  nameAr: text,
  nameEn: text,
  flavor: text,
  sizeValue: z
    .number()
    .positive()
    .max(100_000)
    .nullish()
    .transform((v) => v ?? null),
  sizeUnit: z
    .string()
    .trim()
    .max(12)
    .nullish()
    .transform((v) => (v ? v : null)),
  packaging: text,
  productType: text,
  quantity: z.number().int().min(1).max(99),
  confidence: z.number().min(0).max(1),
});

export const visionOutputSchema = z.object({
  items: z.array(recognizedItemSchema).max(60),
});

export type RecognizedItem = z.infer<typeof recognizedItemSchema>;

/** A shop product offered for a scanned line: everything here comes from the database. */
export interface ScanProductView {
  variantId: string;
  productId: string;
  name: string;
  unit: string;
  packQty: number;
  sellPricePiasters: number;
  stockBase: number;
  score: number;
}

export interface ScanLineView {
  key: string;
  status: "matched" | "uncertain" | "unmatched";
  /** What the model described (shown so the user can judge the match). */
  description: string;
  confidence: number;
  imageIndexes: number[];
  quantity: number;
  candidates: ScanProductView[];
}

export interface ScannerQuotaView {
  enabled: boolean;
  /** The admin switched the scanner off (for everyone, or for this shop). */
  disabledReason: "platform" | "shop" | null;
  dailyLimit: number;
  monthlyLimit: number;
  usedToday: number;
  usedThisMonth: number;
  remainingToday: number;
  remainingThisMonth: number;
  bonusCredits: number;
  maxImages: number;
  resetsAt: string;
}

export interface ScanResultView {
  scanId: string;
  duplicate: boolean;
  provider: string;
  lines: ScanLineView[];
  quota: ScannerQuotaView;
}

export const scanOpIdSchema = z.string().uuid("رقم العملية غير صحيح");
