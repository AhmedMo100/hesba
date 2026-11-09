import { z } from "zod";

/**
 * Body of `POST /api/sales` — one sold item recorded as a one-line cash sale.
 *
 * Money is integer piasters and quantity is integer base units (AGENTS.md rule 5).
 * The target product is resolved server-side from `variantId`, then `productId`, then `name`.
 *
 * `commissionPiasters`, `machineId`, `machineDeductPiasters` and `machineName` are accepted
 * for client compatibility but are not persisted by the sales module today (`machineId` only
 * influences the category of an auto-created product).
 */
export const createSaleSchema = z.object({
  id: z.string().optional(),
  productId: z.string().optional(),
  variantId: z.string().optional(),
  name: z.string().trim().optional(),
  quantityBase: z.number().int().positive().default(1),
  amountPiasters: z.number().int().min(0),
  label: z.string().optional(),
  isCarton: z.boolean().optional(),
  commissionPiasters: z.number().int().optional(),
  machineId: z.string().optional().nullable(),
  machineDeductPiasters: z.number().int().optional().nullable(),
  machineName: z.string().optional().nullable(),
  timestamp: z.number().optional(),
  /**
   * Client-generated operation id (UUID). Used by sandwich sales (ADR-0018) to make a retried
   * request return the first sale instead of selling twice; ignored for other items.
   */
  opId: z.string().uuid().optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
