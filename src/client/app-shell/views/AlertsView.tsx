"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, Icon, useToast } from "../../shared/ui";
import { formatMoney } from "../../shared/i18n";
import type { StoreProductItem } from "./ProductsView";
import { AddStockModal } from "./AddStockModal";
import type {
  StockAlertItem,
  ExpiryAlertItem,
  SuggestedPromotion,
} from "@/app/api/alerts/route";
import type { PublishedPromotion } from "@/app/api/promotions/route";
import styles from "./AlertsView.module.css";

export function AlertsView() {
  const [tab, setTab] = useState<"all" | "stock" | "exp">("all");
  const [loading, setLoading] = useState(true);
  const [outOfStock, setOutOfStock] = useState<StockAlertItem[]>([]);
  const [lowStock, setLowStock] = useState<StockAlertItem[]>([]);
  const [expired, setExpired] = useState<ExpiryAlertItem[]>([]);
  const [nearExpiry, setNearExpiry] = useState<ExpiryAlertItem[]>([]);
  const [suggestedPromos, setSuggestedPromos] = useState<SuggestedPromotion[]>(
    [],
  );

  const toast = useToast();
  const [wasteTarget, setWasteTarget] = useState<ExpiryAlertItem | null>(null);
  const [restockVariantId, setRestockVariantId] = useState<string | null>(null);
  const [restockProductObj, setRestockProductObj] =
    useState<StoreProductItem | null>(null);
  const [isSubmittingWaste, setIsSubmittingWaste] = useState(false);
  const [dismissedPromoIds, setDismissedPromoIds] = useState<Set<string>>(
    new Set(),
  );
  const [publishedPromoIds, setPublishedPromoIds] = useState<Set<string>>(
    new Set(),
  );

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) {
        const data = await res.json();
        setOutOfStock(data.outOfStock || []);
        setLowStock(data.lowStock || []);
        setExpired(data.expired || []);
        setNearExpiry(data.nearExpiry || []);
        setSuggestedPromos(data.suggestedPromotions || []);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("hesba_alerts_updated"));
        }
      }
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const fetchAlerts = async () => {
      try {
        const res = await fetch("/api/alerts");
        if (res.ok && !ignore) {
          const data = await res.json();
          setOutOfStock(data.outOfStock || []);
          setLowStock(data.lowStock || []);
          setExpired(data.expired || []);
          setNearExpiry(data.nearExpiry || []);
          setSuggestedPromos(data.suggestedPromotions || []);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("hesba_alerts_updated"));
          }
        }
      } catch {
        // Offline fallback
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    void fetchAlerts();
    return () => {
      ignore = true;
    };
  }, []);

  // Load published promo IDs to avoid re-suggesting
  useEffect(() => {
    fetch("/api/promotions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.promotions && Array.isArray(data.promotions)) {
          const ids = new Set<string>(
            data.promotions.map((p: PublishedPromotion) => p.id),
          );
          setPublishedPromoIds(ids);
        }
      })
      .catch(() => {});
  }, []);

  const totalStockAlerts = outOfStock.length + lowStock.length;
  const totalExpiryAlerts = expired.length + nearExpiry.length;
  const totalAlerts = totalStockAlerts + totalExpiryAlerts;

  const showStock = tab !== "exp";
  const showExp = tab !== "stock";

  const formatQtyText = (
    unitMode: "piece" | "weight",
    qtyBase: number,
    packQty = 1,
    unit = "قطعة",
  ) => {
    if (unitMode === "weight") {
      if (qtyBase >= 1000) {
        const kg = Math.round((qtyBase / 1000) * 10) / 10;
        return `${kg} كجم`;
      }
      return `${qtyBase} جرام`;
    }

    const unitWord =
      unit === "can" || unit === "علبة"
        ? "علبة"
        : unit === "jar" || unit === "برطمان"
          ? "برطمان"
          : unit === "bag" || unit === "كيس"
            ? "كيس"
            : unit === "carton" || unit === "كرتونة"
              ? "كرتونة"
              : unit || "قطعة";

    if (packQty > 1) {
      const cartons = Math.floor(qtyBase / packQty);
      const pieces = qtyBase % packQty;
      if (cartons > 0 && pieces > 0) {
        return `${cartons} كرتونة و ${pieces} ${unitWord}`;
      }
      if (cartons > 0) {
        return `${cartons} كرتونة`;
      }
      return `${pieces} ${unitWord}`;
    }

    return `${qtyBase} ${unitWord}`;
  };

  // Submit waste to /api/stock
  const handleConfirmWaste = async () => {
    if (!wasteTarget) return;
    setIsSubmittingWaste(true);

    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "waste",
          storeVariantId: wasteTarget.variantId,
          batchId: wasteTarget.batchId,
          quantityBase: wasteTarget.remainingQtyBase,
          reason: "expired",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || "فشل تسجيل الهالك");
      }

      toast.show({ msg: `اتسجل كفاقد: ${wasteTarget.name}`, kind: "ok" });
      setWasteTarget(null);
      void loadAlerts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
      alert(msg);
    } finally {
      setIsSubmittingWaste(false);
    }
  };

  // Approve and publish smart promotion into SalesView
  const handleApprovePromotion = async (promo: SuggestedPromotion) => {
    try {
      const res = await fetch("/api/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promo),
      });

      if (!res.ok) {
        throw new Error("تعذر نشر العرض");
      }

      setPublishedPromoIds((prev) => new Set([...prev, promo.id]));
      toast.show({
        msg: `تمت الموافقة ونشر «${promo.title}» في واجهة البيع ✓`,
        kind: "ok",
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("hesba_promotions_updated"));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ في نشر العرض";
      alert(msg);
    }
  };

  const handleDismissPromotion = (id: string) => {
    setDismissedPromoIds((prev) => new Set([...prev, id]));
  };

  const visiblePromos = useMemo(() => {
    return suggestedPromos.filter(
      (p) => !dismissedPromoIds.has(p.id) && !publishedPromoIds.has(p.id),
    );
  }, [suggestedPromos, dismissedPromoIds, publishedPromoIds]);

  return (
    <div className={styles.page} data-testid="page-alerts">
      {/* Top Header matching Image 1 */}
      <div className={styles.header}>
        <h1>التنبيهات</h1>
        <p>
          {loading
            ? "جاري فحص التنبيهات..."
            : totalAlerts > 0
              ? `${totalAlerts} حاجة محتاجة انتباهك`
              : "كله تمام، مفيش تنبيهات"}
        </p>
      </div>

      {/* Segmented control tabs matching Image 1 */}
      <div className={styles.tabsBar}>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "all" ? styles.active : ""}`}
          onClick={() => setTab("all")}
        >
          الكل ({totalAlerts})
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "stock" ? styles.active : ""}`}
          onClick={() => setTab("stock")}
        >
          نفاد ({totalStockAlerts})
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "exp" ? styles.active : ""}`}
          onClick={() => setTab("exp")}
        >
          صلاحية ({totalExpiryAlerts})
        </button>
      </div>

      {/* Empty State */}
      {!loading && totalAlerts === 0 && (
        <div style={{ marginTop: 24 }}>
          <Empty
            icon="check"
            title="مفيش تنبيهات"
            sub="المخزون والصلاحيات تمام ومفيش أي نواقص"
          />
        </div>
      )}

      {/* Smart Promotional Offers Card (User's New Feature) */}
      {showExp && visiblePromos.length > 0 && (
        <section className={styles.promoSection}>
          <div className={styles.promoHeader}>
            <span className={styles.sectionTitle} style={{ margin: 0 }}>
              عروض ذكية مقترحة لتصريف الصلاحية ⚡
            </span>
            <span className={styles.promoBadge}>
              {visiblePromos.length} عروض مقترحة
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {visiblePromos.map((promo) => (
              <div key={promo.id} className={styles.promoCard}>
                <div className={styles.promoTitleRow}>
                  <div>
                    <h4 className={styles.promoTitle}>{promo.title}</h4>
                    <p className={styles.promoDesc}>{promo.description}</p>
                  </div>
                  <span className={styles.savingsTag}>
                    وفر {formatMoney(promo.savingsPiasters)}
                  </span>
                </div>

                <div className={styles.promoItemsList}>
                  {promo.items.map((it, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                        • {it.productName} ({it.quantityBase}{" "}
                        {it.unit === "kg" || it.unit === "weight"
                          ? "جم"
                          : "قطعة"}
                        )
                      </span>
                      <span style={{ color: "var(--ink2)" }}>
                        سعرها الأصلي: {formatMoney(it.regularPricePiasters)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className={styles.promoPriceBar}>
                  <div>
                    <span>السعر في العرض: </span>
                    <span className={styles.promoOldPrice}>
                      {formatMoney(promo.originalPricePiasters)}
                    </span>
                    <span className={styles.promoNewPrice}>
                      {" "}
                      {formatMoney(promo.promoPricePiasters)}
                    </span>
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>
                    ⏰ ينتهي أقرب صنف بعد{" "}
                    {promo.expiryDaysMin === 0
                      ? "ساعات"
                      : `${promo.expiryDaysMin} يوم`}
                  </span>
                </div>

                <div className={styles.promoActionsRow}>
                  <button
                    type="button"
                    className={styles.approvePromoBtn}
                    onClick={() => handleApprovePromotion(promo)}
                    title="نشر هذا العرض في واجهة البيع ليتمكن الكاشير من بيعه"
                  >
                    <Icon n="check" s={16} />
                    <span>موافقة ونشر في واجهة البيع ✓</span>
                  </button>

                  <button
                    type="button"
                    className={styles.wastePromoBtn}
                    onClick={() => {
                      const firstIt = promo.items[0];
                      const matchedExp = nearExpiry.find(
                        (e) => e.variantId === firstIt?.variantId,
                      );
                      if (matchedExp) {
                        setWasteTarget(matchedExp);
                      }
                    }}
                    title="تسجيل كمية هذا الصنف كفاقد / تالف في المخزون"
                  >
                    <Icon n="trash" s={14} />
                    <span>تسجيل كتالف 🗑️</span>
                  </button>

                  <button
                    type="button"
                    className={styles.dismissPromoBtn}
                    onClick={() => handleDismissPromotion(promo.id)}
                    title="تجاهل الاقتراح"
                  >
                    تجاهل
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 1: Expiry Alerts matching Image 1 */}
      {showExp && totalExpiryAlerts > 0 && (
        <section>
          <div className={styles.sectionTitle}>الصلاحية</div>
          <div className={styles.listCard}>
            {/* Expired Items */}
            {expired.map((item) => (
              <div key={item.id} className={styles.alertRow}>
                <div className={styles.rowInfo}>
                  <div className={styles.rowTitleGroup}>
                    <span className={`${styles.dot} ${styles.dotRed}`} />
                    <span className={styles.itemName}>{item.name}</span>
                  </div>
                  <span className={styles.itemSub}>
                    انتهت من {Math.abs(item.daysUntilExpiry)} يوم ·{" "}
                    {formatQtyText(
                      item.unitMode,
                      item.remainingQtyBase,
                      item.packQty,
                      item.unit,
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.doneBtn}
                  onClick={() => setWasteTarget(item)}
                  title="تسجيل كفاقد وشيله من المخزون"
                >
                  <Icon n="check" s={14} />
                  <span>تم</span>
                </button>
              </div>
            ))}

            {/* Near Expiry Items */}
            {nearExpiry.map((item) => {
              const daysText =
                item.daysUntilExpiry === 0
                  ? "بتنتهي النهارده"
                  : `بتنتهي بعد ${item.daysUntilExpiry} يوم`;

              return (
                <div key={item.id} className={styles.alertRow}>
                  <div className={styles.rowInfo}>
                    <div className={styles.rowTitleGroup}>
                      <span className={`${styles.dot} ${styles.dotYellow}`} />
                      <span className={styles.itemName}>{item.name}</span>
                    </div>
                    <span className={styles.itemSub}>
                      {daysText} ·{" "}
                      {formatQtyText(
                        item.unitMode,
                        item.remainingQtyBase,
                        item.packQty,
                        item.unit,
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.doneBtn}
                    onClick={() => setWasteTarget(item)}
                    title="تسجيل كفاقد وشيله من المخزون"
                  >
                    <Icon n="check" s={14} />
                    <span>تم</span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 2: Stock Depletion Alerts matching Image 3 */}
      {showStock && totalStockAlerts > 0 && (
        <section>
          <div className={styles.sectionTitle}>نفاد المخزون</div>
          <div className={styles.listCard}>
            {/* Out of stock items */}
            {outOfStock.map((item) => (
              <div key={item.id} className={styles.alertRow}>
                <div className={styles.rowInfo}>
                  <div className={styles.rowTitleGroup}>
                    <span className={`${styles.dot} ${styles.dotRed}`} />
                    <span className={styles.itemName}>{item.name}</span>
                  </div>
                  <span className={styles.itemSub}>خلصان خالص</span>
                </div>
                <button
                  type="button"
                  className={styles.doneBtn}
                  onClick={() => {
                    setRestockVariantId(item.variantId);
                    setRestockProductObj({
                      id: item.productId,
                      name_ar: item.name,
                      category: item.category,
                      unit: item.unit,
                      sell_price_piasters: item.sellPricePiasters,
                      buy_cost_piasters: item.buyPricePiasters,
                      stock_quantity: item.currentStockBase,
                      is_custom: false,
                      variants: [
                        {
                          id: item.variantId,
                          pack_qty: item.packQty,
                          size_unit: item.packName,
                          sell_price_piasters: item.sellPricePiasters,
                          buy_cost_piasters: item.buyPricePiasters,
                          stock_quantity: item.currentStockBase,
                        },
                      ],
                    });
                  }}
                  title="إضافة بضاعة للمخزون"
                >
                  <Icon n="check" s={14} />
                  <span>تم</span>
                </button>
              </div>
            ))}

            {/* Low stock items */}
            {lowStock.map((item) => (
              <div key={item.id} className={styles.alertRow}>
                <div className={styles.rowInfo}>
                  <div className={styles.rowTitleGroup}>
                    <span className={`${styles.dot} ${styles.dotYellow}`} />
                    <span className={styles.itemName}>{item.name}</span>
                  </div>
                  <span className={styles.itemSub}>
                    فاضل{" "}
                    {formatQtyText(
                      item.unitMode,
                      item.currentStockBase,
                      item.packQty,
                      item.unit,
                    )}{" "}
                    بس
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.doneBtn}
                  onClick={() => {
                    setRestockVariantId(item.variantId);
                    setRestockProductObj({
                      id: item.productId,
                      name_ar: item.name,
                      category: item.category,
                      unit: item.unit,
                      sell_price_piasters: item.sellPricePiasters,
                      buy_cost_piasters: item.buyPricePiasters,
                      stock_quantity: item.currentStockBase,
                      is_custom: false,
                      variants: [
                        {
                          id: item.variantId,
                          pack_qty: item.packQty,
                          size_unit: item.packName,
                          sell_price_piasters: item.sellPricePiasters,
                          buy_cost_piasters: item.buyPricePiasters,
                          stock_quantity: item.currentStockBase,
                        },
                      ],
                    });
                  }}
                  title="إضافة بضاعة للمخزون"
                >
                  <Icon n="check" s={14} />
                  <span>تم</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Confirm Waste Modal Sheet matching Image 2 */}
      {wasteTarget && (
        <div
          className={styles.wasteModalOverlay}
          onClick={() => setWasteTarget(null)}
        >
          <div
            className={styles.wasteSheet}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.grabHandle} />
            <div className={styles.sheetHeader}>
              <h3 className={styles.sheetTitle}>تم التعامل مع الصلاحية</h3>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setWasteTarget(null)}
                aria-label="إغلاق"
              >
                <Icon n="x" s={20} />
              </button>
            </div>

            <div className={styles.sheetBody}>
              هنشيل{" "}
              <b>
                {formatQtyText(
                  wasteTarget.unitMode,
                  wasteTarget.remainingQtyBase,
                  wasteTarget.packQty,
                  wasteTarget.unit,
                )}
              </b>{" "}
              من &ldquo;{wasteTarget.name}&rdquo; من المخزون ونسجلها كفاقد (
              <b>
                {formatMoney(
                  wasteTarget.unitMode === "weight"
                    ? Math.round(
                        (wasteTarget.costPricePiasters *
                          wasteTarget.remainingQtyBase) /
                          1000,
                      )
                    : wasteTarget.costPricePiasters *
                        wasteTarget.remainingQtyBase,
                )}
              </b>
              ). لو لسه هتبيعها سيب التنبيه.
            </div>

            <div className={styles.sheetFooter}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setWasteTarget(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className={styles.confirmWasteBtn}
                onClick={handleConfirmWaste}
                disabled={isSubmittingWaste}
              >
                {isSubmittingWaste ? "جاري الحفظ..." : "شيله من المخزون"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Stock Modal when clicking 'تم' on out of stock / low stock item */}
      {restockProductObj && (
        <AddStockModal
          presetVariantId={restockVariantId}
          targetProduct={restockProductObj}
          onClose={() => {
            setRestockVariantId(null);
            setRestockProductObj(null);
          }}
          onAdded={() => {
            setRestockVariantId(null);
            setRestockProductObj(null);
            toast.show({
              msg: "تمت إضافة البضاعة للمخزون بنجاح ✓",
              kind: "ok",
            });
            void loadAlerts();
          }}
        />
      )}
    </div>
  );
}

export default AlertsView;
