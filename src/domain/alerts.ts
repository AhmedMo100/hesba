/**
 * @file alerts.ts
 * @description Pure rules behind the Alerts screen: classify a store's inventory into
 * out-of-stock, low-stock, expired and near-expiry alerts, and propose clearance offers
 * (bundles and single-item discounts) for batches close to expiry.
 *
 * Pure (no DB, no framework) so it is unit-testable and could run on the client offline.
 * Extracted unchanged from `src/app/api/alerts/route.ts` (ADR-0017).
 *
 * @usedBy
 * - src/server/modules/alerts/alerts.service.ts
 * - src/client/features/{alerts,sales} (types only)
 *
 * @remarks Money is integer piasters; weighed quantities are grams and their price is per kg.
 * Day arithmetic uses the server's local calendar day, not Cairo time — see
 * {@link getDaysUntilExpiry}.
 */

/** A batch expiring within this many days (and not yet expired) is "near expiry". */
export const NEAR_EXPIRY_DAYS = 7;

// Clearance-offer parameters. These are product choices, not derived values.
/** Discount applied to a two-item near-expiry bundle (20% off). */
const BUNDLE_PRICE_FACTOR = 0.8;
/** Discount applied to a single near-expiry item (25% off). */
const SINGLE_PRICE_FACTOR = 0.75;
/** Lowest price a bundle offer may suggest, in piasters (1 EGP). */
const MIN_BUNDLE_PRICE_PIASTERS = 100;
/** Lowest price a single-item offer may suggest, in piasters (0.50 EGP). */
const MIN_SINGLE_PRICE_PIASTERS = 50;
/** Quantity of a weighed item put in a bundle, in grams. */
const BUNDLE_WEIGHT_GRAMS = 500;
/** Quantity of a weighed item in a single-item offer, in grams (priced per kg). */
const SINGLE_WEIGHT_GRAMS = 1000;

/** The inventory fields the alert rules read (a subset of the stock screen's row). */
export interface AlertInventoryRow {
  variantId: string;
  /** May be null for an orphaned variant; alerts then fall back to the variant id. */
  productId: string | null;
  productName: string;
  category: string;
  unitMode: string;
  unit?: string | null;
  packQty: number;
  packName?: string | null;
  sellPricePiasters: number;
  buyPricePiasters?: number | null;
  currentStockBase: number;
  status: string;
  batches: Array<{
    id: string;
    remainingQty: number;
    /** Unit cost per selling unit; null = unknown (ADR-0021). */
    costPricePiasters: number | null;
    expiryDate: string | null;
  }>;
}

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
  /** Unit cost per selling unit; null = unknown (ADR-0021). */
  costPricePiasters: number | null;
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

export interface StoreAlerts {
  outOfStock: StockAlertItem[];
  lowStock: StockAlertItem[];
  expired: ExpiryAlertItem[];
  nearExpiry: ExpiryAlertItem[];
  suggestedPromotions: SuggestedPromotion[];
  totalStockAlerts: number;
  totalExpiryAlerts: number;
  totalAlerts: number;
}

/**
 * Whole calendar days from `now` to the expiry date (negative once expired, 0 on the day).
 *
 * @remarks Uses the runtime's local timezone for the day boundary. On a UTC server this can
 * differ from the Cairo calendar day for a few hours around midnight.
 */
export function getDaysUntilExpiry(
  dateStr: string,
  now: Date = new Date(),
): number {
  const target = new Date(dateStr);
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
 * Builds every alert list and clearance suggestion for one store.
 *
 * - A variant is "out" when its status is out or stock ≤ 0, otherwise "low" when flagged low.
 * - Each batch with stock and an expiry date is "expired" (< 0 days) or "near expiry"
 *   (0–{@link NEAR_EXPIRY_DAYS} days). Both lists are sorted most urgent first.
 * - Near-expiry items are paired in list order into 20%-off bundles, and every near-expiry
 *   item also gets a 25%-off single offer.
 *
 * @param inventory - The store's stock rows (`InventoryService.getStoreInventory`).
 * @param now - Reference time for expiry maths; defaults to the current time.
 */
export function buildStoreAlerts(
  inventory: AlertInventoryRow[],
  now: Date = new Date(),
): StoreAlerts {
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

    if (inv.batches && Array.isArray(inv.batches)) {
      for (const b of inv.batches) {
        if (b.expiryDate && b.remainingQty > 0) {
          const days = getDaysUntilExpiry(b.expiryDate, now);
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
          } else if (days <= NEAR_EXPIRY_DAYS) {
            nearExpiry.push(item);
          }
        }
      }
    }
  }

  expired.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  nearExpiry.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  const suggestedPromotions: SuggestedPromotion[] = [];

  // 1. Bundle consecutive near-expiry items in pairs (an odd last item gets no bundle).
  if (nearExpiry.length >= 2) {
    for (let i = 0; i < nearExpiry.length - 1; i += 2) {
      const item1 = nearExpiry[i]!;
      const item2 = nearExpiry[i + 1]!;
      const q1 = item1.unitMode === "weight" ? BUNDLE_WEIGHT_GRAMS : 1;
      const q2 = item2.unitMode === "weight" ? BUNDLE_WEIGHT_GRAMS : 1;

      // Weighed items are priced per kg, so a gram quantity is scaled by 1/1000.
      const p1 =
        item1.unitMode === "weight"
          ? Math.round((item1.sellPricePiasters * q1) / 1000)
          : item1.sellPricePiasters * q1;
      const p2 =
        item2.unitMode === "weight"
          ? Math.round((item2.sellPricePiasters * q2) / 1000)
          : item2.sellPricePiasters * q2;

      const origTotal = p1 + p2;
      const promoPrice = Math.max(
        MIN_BUNDLE_PRICE_PIASTERS,
        Math.round(origTotal * BUNDLE_PRICE_FACTOR),
      );
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

  // 2. A rapid-clearance discount for every near-expiry item.
  for (const expItem of nearExpiry) {
    const q = expItem.unitMode === "weight" ? SINGLE_WEIGHT_GRAMS : 1;
    const orig = expItem.sellPricePiasters;
    const promoPrice = Math.max(
      MIN_SINGLE_PRICE_PIASTERS,
      Math.round(orig * SINGLE_PRICE_FACTOR),
    );
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

  return {
    outOfStock,
    lowStock,
    expired,
    nearExpiry,
    suggestedPromotions,
    totalStockAlerts,
    totalExpiryAlerts,
    totalAlerts: totalStockAlerts + totalExpiryAlerts,
  };
}
