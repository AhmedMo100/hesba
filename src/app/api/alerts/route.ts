import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { InventoryService } from "@/server/modules/inventory";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export interface StockAlertItem {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  category: string;
  unit: string;
  unitMode: "piece" | "weight";
  packQty: number;
  packName?: string | null;
  currentStockBase: number;
  sellPricePiasters: number;
  buyPricePiasters: number;
  status: "out" | "low";
}

export interface ExpiryAlertItem {
  id: string;
  batchId: string;
  variantId: string;
  productId: string;
  name: string;
  category: string;
  unit: string;
  unitMode: "piece" | "weight";
  packQty: number;
  packName?: string | null;
  remainingQtyBase: number;
  costPricePiasters: number;
  sellPricePiasters: number;
  expiryDate: string;
  daysUntilExpiry: number;
  isExpired: boolean;
}

export interface SuggestedPromotion {
  id: string;
  title: string;
  description: string;
  type: "bundle" | "single_discount";
  items: Array<{
    productId: string;
    variantId: string;
    productName: string;
    quantityBase: number;
    unit: string;
    regularPricePiasters: number;
  }>;
  originalPricePiasters: number;
  promoPricePiasters: number;
  savingsPiasters: number;
  expiryDaysMin: number;
}

function getDaysUntilExpiry(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  const dTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  );
  const dNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = dTarget.getTime() - dNow.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * GET /api/alerts
 * Computes live out-of-stock, low-stock, expired, and near-expiry alerts,
 * and dynamically crafts smart bundle & discount suggestions for near-expiry items.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const inventoryService = new InventoryService(prisma);

    const inventory = await inventoryService.getStoreInventory(
      context.store.id,
      context.user.id,
    );

    const outOfStock: StockAlertItem[] = [];
    const lowStock: StockAlertItem[] = [];
    const expired: ExpiryAlertItem[] = [];
    const nearExpiry: ExpiryAlertItem[] = [];

    for (const inv of inventory) {
      const pId = inv.productId || inv.variantId;
      const uMode: "piece" | "weight" =
        inv.unitMode === "weight" ? "weight" : "piece";

      if (inv.status === "out" || inv.currentStockBase <= 0) {
        outOfStock.push({
          id: `out_${inv.variantId}`,
          variantId: inv.variantId,
          productId: pId,
          name: inv.productName,
          category: inv.category,
          unit: inv.unit || "piece",
          unitMode: uMode,
          packQty: inv.packQty || 1,
          packName: inv.packName,
          currentStockBase: inv.currentStockBase,
          sellPricePiasters: inv.sellPricePiasters,
          buyPricePiasters: inv.buyPricePiasters || 0,
          status: "out",
        });
      } else if (inv.status === "low") {
        lowStock.push({
          id: `low_${inv.variantId}`,
          variantId: inv.variantId,
          productId: pId,
          name: inv.productName,
          category: inv.category,
          unit: inv.unit || "piece",
          unitMode: uMode,
          packQty: inv.packQty || 1,
          packName: inv.packName,
          currentStockBase: inv.currentStockBase,
          sellPricePiasters: inv.sellPricePiasters,
          buyPricePiasters: inv.buyPricePiasters || 0,
          status: "low",
        });
      }

      // Check active batches with expiry dates
      if (inv.batches && Array.isArray(inv.batches)) {
        for (const b of inv.batches) {
          if (b.expiryDate && b.remainingQty > 0) {
            const days = getDaysUntilExpiry(b.expiryDate);
            const item: ExpiryAlertItem = {
              id: `exp_${b.id}`,
              batchId: b.id,
              variantId: inv.variantId,
              productId: pId,
              name: inv.productName,
              category: inv.category,
              unit: inv.unit || "piece",
              unitMode: uMode,
              packQty: inv.packQty || 1,
              packName: inv.packName,
              remainingQtyBase: b.remainingQty,
              costPricePiasters: b.costPricePiasters,
              sellPricePiasters: inv.sellPricePiasters,
              expiryDate: b.expiryDate,
              daysUntilExpiry: days,
              isExpired: days < 0,
            };

            if (days < 0) {
              expired.push(item);
            } else if (days <= 7) {
              nearExpiry.push(item);
            }
          }
        }
      }
    }

    // Sort expiry alerts: most critical (expired first, then nearest expiry)
    expired.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
    nearExpiry.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

    // Generate smart promotional proposals for items nearing expiry (<= 7 days)
    const suggestedPromotions: SuggestedPromotion[] = [];

    // 1. Bundle combinations for compatible near-expiry pairs
    if (nearExpiry.length >= 2) {
      for (let i = 0; i < nearExpiry.length - 1; i += 2) {
        const item1 = nearExpiry[i]!;
        const item2 = nearExpiry[i + 1]!;
        const q1 = item1.unitMode === "weight" ? 500 : 1;
        const q2 = item2.unitMode === "weight" ? 500 : 1;

        const p1 =
          item1.unitMode === "weight"
            ? Math.round((item1.sellPricePiasters * q1) / 1000)
            : item1.sellPricePiasters * q1;
        const p2 =
          item2.unitMode === "weight"
            ? Math.round((item2.sellPricePiasters * q2) / 1000)
            : item2.sellPricePiasters * q2;

        const origTotal = p1 + p2;
        // 20% discount on combo bundle
        const promoPrice = Math.max(100, Math.round(origTotal * 0.8));
        const savings = origTotal - promoPrice;
        const minDays = Math.min(item1.daysUntilExpiry, item2.daysUntilExpiry);

        suggestedPromotions.push({
          id: `promo_bundle_${item1.variantId}_${item2.variantId}`,
          title: `كومبو توفير: ${item1.name} + ${item2.name}`,
          description: `عرض مجمع لتصريف الصلاحية بتخفيض 20% قبل انتهائها`,
          type: "bundle",
          items: [
            {
              productId: item1.productId,
              variantId: item1.variantId,
              productName: item1.name,
              quantityBase: q1,
              unit: item1.unit,
              regularPricePiasters: p1,
            },
            {
              productId: item2.productId,
              variantId: item2.variantId,
              productName: item2.name,
              quantityBase: q2,
              unit: item2.unit,
              regularPricePiasters: p2,
            },
          ],
          originalPricePiasters: origTotal,
          promoPricePiasters: promoPrice,
          savingsPiasters: savings,
          expiryDaysMin: minDays,
        });
      }
    }

    // 2. Single product rapid clearance discount for near-expiry items
    for (const expItem of nearExpiry) {
      const q = expItem.unitMode === "weight" ? 1000 : 1;
      const orig = expItem.sellPricePiasters;
      // 25% rapid clearance discount
      const promoPrice = Math.max(50, Math.round(orig * 0.75));
      const savings = orig - promoPrice;

      suggestedPromotions.push({
        id: `promo_single_${expItem.variantId}_${expItem.batchId}`,
        title: `تخفيض تصفية: ${expItem.name}`,
        description: `تخفيض 25% لتشجيع سرعة البيع قبل ${expItem.daysUntilExpiry === 0 ? "نهاية اليوم" : `${expItem.daysUntilExpiry} أيام`}`,
        type: "single_discount",
        items: [
          {
            productId: expItem.productId,
            variantId: expItem.variantId,
            productName: expItem.name,
            quantityBase: q,
            unit: expItem.unit,
            regularPricePiasters: orig,
          },
        ],
        originalPricePiasters: orig,
        promoPricePiasters: promoPrice,
        savingsPiasters: savings,
        expiryDaysMin: expItem.daysUntilExpiry,
      });
    }

    const totalStockAlerts = outOfStock.length + lowStock.length;
    const totalExpiryAlerts = expired.length + nearExpiry.length;
    const totalAlerts = totalStockAlerts + totalExpiryAlerts;

    return NextResponse.json({
      outOfStock,
      lowStock,
      expired,
      nearExpiry,
      suggestedPromotions,
      totalStockAlerts,
      totalExpiryAlerts,
      totalAlerts,
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
