import { z } from "zod";

export const STOCKTAKE_SCOPES = ["full", "category", "selected"] as const;
export type StocktakeScope = (typeof STOCKTAKE_SCOPES)[number];

export const STOCKTAKE_STATUSES = [
  "in_progress",
  "reconciled",
  "cancelled",
] as const;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

export const STOCKTAKE_DISCREPANCY_KINDS = [
  "unrecorded_sales",
  "damaged_or_expired",
  "unknown_adjustment",
] as const;
export type StocktakeDiscrepancyKind =
  (typeof STOCKTAKE_DISCREPANCY_KINDS)[number];

export const createStocktakeSessionSchema = z.object({
  scope: z.enum(STOCKTAKE_SCOPES).default("full"),
  category: z.string().trim().optional(),
  selectedVariantIds: z.array(z.string().uuid()).optional(),
  notes: z.string().trim().max(500).optional(),
  opId: z.string().uuid().optional(),
});
export type CreateStocktakeSessionInput = z.infer<
  typeof createStocktakeSessionSchema
>;

export const stocktakeCountItemSchema = z.object({
  storeVariantId: z.string().uuid(),
  countedQuantityBase: z.number().int().min(0),
  classification: z.enum(STOCKTAKE_DISCREPANCY_KINDS).optional(),
  notes: z.string().trim().max(300).optional(),
});

export const updateStocktakeCountsSchema = z.object({
  items: z.array(stocktakeCountItemSchema).min(1),
});
export type UpdateStocktakeCountsInput = z.infer<
  typeof updateStocktakeCountsSchema
>;

export const reconcileStocktakeSchema = z.object({
  opId: z.string().uuid().optional(),
  notes: z.string().trim().max(500).optional(),
  itemClassifications: z
    .record(
      z.string().uuid(),
      z.object({
        classification: z.enum(STOCKTAKE_DISCREPANCY_KINDS),
        notes: z.string().trim().max(300).optional(),
      }),
    )
    .optional(),
});
export type ReconcileStocktakeInput = z.infer<typeof reconcileStocktakeSchema>;

export interface StocktakeItemDTO {
  id: string;
  storeVariantId: string;
  storeProductId: string;
  productName: string;
  category: string;
  unit: string;
  barcode: string | null;
  snapshotQuantityBase: number;
  snapshotCostPiasters: number | null;
  countedQuantityBase: number | null;
  countedAt: string | null;
  expectedQuantityBase: number;
  discrepancyQuantityBase: number | null;
  discrepancyCostPiasters: number | null;
  costConfirmed: boolean;
  classification: StocktakeDiscrepancyKind | null;
  notes: string | null;
  // Movements occurred after count
  movementsAfterCount: boolean;
  movementsSinceSnapshot: {
    sales: number;
    purchases: number;
    returns: number;
    waste: number;
    adjustments: number;
  };
}

export interface StocktakeSessionSummary {
  id: string;
  status: StocktakeStatus;
  scope: StocktakeScope;
  category: string | null;
  notes: string | null;
  totalProducts: number;
  countedProducts: number;
  shortageCount: number;
  surplusCount: number;
  matchedCount: number;
  netCostPiasters: number;
  costConfirmed: boolean;
  createdAt: string;
  reconciledAt: string | null;
  reconciledBy: string | null;
  cancelledAt: string | null;
}

export interface StocktakeSessionDetails extends StocktakeSessionSummary {
  items: StocktakeItemDTO[];
}
