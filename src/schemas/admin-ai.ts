import { z } from "zod";

/**
 * @file admin-ai.ts
 * @description Platform-admin changes to AI settings and shop scanner quotas (ADR-0030). Every
 * change carries an optional reason and is written to the audit log with its old and new values.
 */

const count = (max: number) => z.number().int("لازم رقم صحيح").min(0).max(max);
const micros = z.number().int().min(0).max(1_000_000_000_000);
const reason = z.string().trim().max(500).optional();

export const aiSettingsPatchSchema = z
  .object({
    scannerEnabled: z.boolean(),
    assistantEnabled: z.boolean(),
    scannerDailyDefault: count(100_000),
    scannerMonthlyDefault: count(10_000_000),
    scannerMaxImages: z.number().int().min(1).max(10),
    scannerRpm: count(100_000),
    assistantRpm: count(100_000),
    scannerMaxConcurrent: count(1000),
    assistantMaxConcurrent: count(1000),
    shopRpm: z.number().int().min(1).max(1000),
    monthlyBudgetMicros: micros,
    scannerCostEstimateMicros: micros,
    assistantCostEstimateMicros: micros,
    warningThresholdPct: z.number().int().min(1).max(100),
    breakerFailureThreshold: z.number().int().min(1).max(1000),
    breakerCooldownSeconds: z.number().int().min(5).max(86_400),
  })
  .partial()
  .extend({ reason });

export type AiSettingsPatch = z.infer<typeof aiSettingsPatchSchema>;

export const shopQuotaPatchSchema = z.object({
  /** null = use the platform default again. */
  dailyLimit: count(100_000).nullable().optional(),
  monthlyLimit: count(10_000_000).nullable().optional(),
  enabled: z.boolean().optional(),
  /** Credits ADDED to the shop's bonus balance (a grant, not a new total). */
  grantBonusCredits: z.number().int().min(1).max(100_000).optional(),
  reason,
});

export type ShopQuotaPatch = z.infer<typeof shopQuotaPatchSchema>;
