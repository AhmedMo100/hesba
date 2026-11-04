"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, Icon, Seg, useToast } from "../../shared/ui";
import { formatMoney } from "../../shared/i18n";
import type { StoreProductItem } from "./ProductsView";
import { AddStockModal } from "./AddStockModal";
import { EditPromoModal } from "./EditPromoModal";
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
  const [allProducts, setAllProducts] = useState<StoreProductItem[]>([]);

  const toast = useToast();
  const [wasteTarget, setWasteTarget] = useState<ExpiryAlertItem | null>(null);
  const [restockProductObj, setRestockProductObj] =
    useState<StoreProductItem | null>(null);
  const [isSubmittingWaste, setIsSubmittingWaste] = useState(false);

  // Edit / Custom Promo state
  const [editingPromo, setEditingPromo] = useState<SuggestedPromotion | null>(
    null,
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
        const [alertsRes, productsRes] = await Promise.all([
          fetch("/api/alerts"),
          fetch("/api/products?filter=all"),
        ]);

        if (alertsRes.ok && !ignore) {
          const data = await alertsRes.json();
          setOutOfStock(data.outOfStock || []);
          setLowStock(data.lowStock || []);
          setExpired(data.expired || []);
          setNearExpiry(data.nearExpiry || []);
          setSuggestedPromos(data.suggestedPromotions || []);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("hesba_alerts_updated"));
          }
        }

        if (productsRes.ok && !ignore) {
          const pData = await productsRes.json();
          if (pData?.products && Array.isArray(pData.products)) {
            setAllProducts(pData.products);
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

  // Stock Depletion List: contains both completely out AND low stock
  const stockAlertsList = useMemo(() => {
    return [
      ...outOfStock.map((x) => ({ ...x, lv: "out" as const })),
      ...lowStock.map((x) => ({ ...x, lv: "low" as const })),
    ];
  }, [outOfStock, lowStock]);

  // Expiry List
  const expiryAlertsList = useMemo(() => {
    return [
      ...expired.map((x) => ({ ...x, isExpired: true })),
      ...nearExpiry.map((x) => ({ ...x, isExpired: false })),
    ];
  }, [expired, nearExpiry]);

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

  const formatExpirySubtitle = (item: ExpiryAlertItem) => {
    const qtyStr = formatQtyText(
      item.unitMode,
      item.remainingQtyBase,
      item.packQty,
      item.unit,
    );

    if (item.isExpired) {
      const days = Math.abs(item.daysUntilExpiry);
      return `انتهت من ${days} يوم · ${qtyStr}`;
    }
    if (item.daysUntilExpiry === 0) {
      return `بتنتهي النهارده · ${qtyStr}`;
    }
    return `بتنتهي بعد ${item.daysUntilExpiry} يوم · ${qtyStr}`;
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

  // Save edited or custom promotion
  const handleSaveEditedPromo = async (promo: SuggestedPromotion) => {
    await handleApprovePromotion(promo);
  };

  const handleStartCreateCustomPromo = () => {
    const firstExp = nearExpiry[0] || expired[0];
    const initialItem = firstExp
      ? {
          productId: firstExp.productId,
          variantId: firstExp.variantId,
          productName: firstExp.name,
          quantityBase: firstExp.unitMode === "weight" ? 1000 : 1,
          unit: firstExp.unit,
          regularPricePiasters: firstExp.sellPricePiasters,
        }
      : {
          productId: allProducts[0]?.id || "p1",
          variantId: allProducts[0]?.variants?.[0]?.id || "v1",
          productName: allProducts[0]?.name_ar || "منتج",
          quantityBase: 1,
          unit: "قطعة",
          regularPricePiasters: allProducts[0]?.sell_price_piasters || 1000,
        };

    const origPrice = initialItem.regularPricePiasters;
    const promoPrice = Math.max(100, Math.round(origPrice * 0.8));

    setEditingPromo({
      id: `custom_promo_${Date.now()}`,
      title: `عرض توفير: ${initialItem.productName}`,
      description: "عرض مخصص لتنشيط وتصفية حركة البيع",
      type: "single_discount",
      items: [initialItem],
      originalPricePiasters: origPrice,
      promoPricePiasters: promoPrice,
      savingsPiasters: origPrice - promoPrice,
      expiryDaysMin: 7,
    });
  };

  const visiblePromos = useMemo(() => {
    return suggestedPromos.filter((p) => !publishedPromoIds.has(p.id));
  }, [suggestedPromos, publishedPromoIds]);

  return (
    <div className={styles.page} data-testid="page-alerts" dir="rtl">
      {/* Seg tabs control matching demo */}
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          ["all", `الكل (${totalAlerts})`],
          ["stock", `نفاد (${totalStockAlerts})`],
          ["exp", `صلاحية (${totalExpiryAlerts})`],
        ]}
      />

      {/* Empty State */}
      {!loading && totalAlerts === 0 && (
        <Empty
          icon="check"
          title="مفيش تنبيهات"
          sub="المخزون والصلاحيات تمام وكل حاجة مظبوطة"
        />
      )}

      {/* Stock Depletion Section (نفاد المخزون — خلصان خالص + قرب يخلص) */}
      {showStock && stockAlertsList.length > 0 && (
        <section>
          <h2 className={styles.secTitle}>نفاد المخزون</h2>
          <div className={styles.listCard}>
            {stockAlertsList.map((item) => (
              <div key={item.id} className={styles.lrow}>
                <div className={styles.rowInfo}>
                  <div className={styles.rowTitleGroup}>
                    <span
                      className={`${styles.dot} ${
                        item.lv === "out" ? styles.dotRed : styles.dotYellow
                      }`}
                    />
                    <span className={styles.itemName}>{item.name}</span>
                  </div>
                  <span className={styles.itemSub}>
                    {item.lv === "out"
                      ? "خلصان خالص"
                      : `فاضل ${formatQtyText(
                          item.unitMode,
                          item.currentStockBase,
                          item.packQty,
                          item.unit,
                        )} بس`}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.doneBtn}
                  onClick={() => {
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

      {/* Expiry Section (الصلاحية) */}
      {showExp && expiryAlertsList.length > 0 && (
        <section>
          <h2 className={styles.secTitle}>الصلاحية</h2>
          <div className={styles.listCard}>
            {expiryAlertsList.map((item) => (
              <div key={item.id} className={styles.lrow}>
                <div className={styles.rowInfo}>
                  <div className={styles.rowTitleGroup}>
                    <span
                      className={`${styles.dot} ${
                        item.isExpired ? styles.dotRed : styles.dotYellow
                      }`}
                    />
                    <span className={styles.itemName}>{item.name}</span>
                  </div>
                  <span className={styles.itemSub}>
                    {formatExpirySubtitle(item)}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.doneBtn}
                  onClick={() => setWasteTarget(item)}
                  title="التعامل مع الصلاحية"
                >
                  <Icon n="check" s={14} />
                  <span>تم</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Promotional Clearance Offers: ONLY visible in the Expiry Tab! */}
      {tab === "exp" && (
        <section className={styles.promoSection}>
          <div className={styles.promoSectionTop}>
            <h3 className={styles.promoSectionTitle}>
              <Icon n="sparkle" s={16} />
              <span>عروض وتخفيضات تصفية الصلاحية ({visiblePromos.length})</span>
            </h3>
            <button
              type="button"
              className={styles.createCustomPromoBtn}
              onClick={handleStartCreateCustomPromo}
            >
              <Icon n="plus" s={14} />
              <span>إنشاء عرض مخصص</span>
            </button>
          </div>

          {visiblePromos.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "12px",
                color: "var(--ink2)",
              }}
            >
              لا توجد عروض مقترحة حالياً، يمكنك إنشاء عرض مخصص بالضغط على الزر
              أعلاه.
            </div>
          ) : (
            <div className={styles.promoCardsList}>
              {visiblePromos.map((promo) => (
                <div key={promo.id} className={styles.promoCard}>
                  <div className={styles.promoTitleRow}>
                    <div>
                      <h4 className={styles.promoTitle}>{promo.title}</h4>
                      {promo.description && (
                        <p className={styles.promoDesc}>{promo.description}</p>
                      )}
                    </div>
                    <span className={styles.savingsTag}>
                      وفّر {formatMoney(promo.savingsPiasters)}
                    </span>
                  </div>

                  {/* Bundled Items pills */}
                  <div className={styles.promoItemsList}>
                    {promo.items.map((it) => (
                      <span
                        key={`${it.productId}_${it.variantId}`}
                        className={styles.promoItemChip}
                      >
                        <Icon n="box" s={12} />
                        <span>
                          {it.productName} (
                          {it.unit === "weight"
                            ? `${it.quantityBase >= 1000 ? it.quantityBase / 1000 : it.quantityBase} كجم`
                            : `${it.quantityBase} ${it.unit}`}
                          )
                        </span>
                      </span>
                    ))}
                  </div>

                  {/* Pricing line */}
                  <div className={styles.promoPriceBar}>
                    <div>
                      <span>السعر الأصلي: </span>
                      <span className={styles.promoOldPrice}>
                        {formatMoney(promo.originalPricePiasters)}
                      </span>
                    </div>
                    <div>
                      <span>سعر العرض: </span>
                      <b className={styles.promoNewPrice}>
                        {formatMoney(promo.promoPricePiasters)}
                      </b>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className={styles.promoActionsRow}>
                    <button
                      type="button"
                      className={styles.approvePromoBtn}
                      onClick={() => void handleApprovePromotion(promo)}
                    >
                      <Icon n="check" s={15} />
                      <span>موافقة ونشر في البيع</span>
                    </button>

                    <button
                      type="button"
                      className={styles.editPromoBtn}
                      onClick={() => setEditingPromo(promo)}
                      title="تعديل تفاصيل العرض"
                    >
                      <Icon n="edit" s={14} />
                      <span>تعديل العرض</span>
                    </button>

                    {promo.items.length > 0 && (
                      <button
                        type="button"
                        className={styles.wastePromoBtn}
                        onClick={() => {
                          const firstItem = promo.items[0];
                          if (!firstItem) return;
                          const targetExp =
                            expired.find(
                              (e) => e.productId === firstItem.productId,
                            ) ||
                            nearExpiry.find(
                              (e) => e.productId === firstItem.productId,
                            );
                          if (targetExp) {
                            setWasteTarget(targetExp);
                          } else {
                            toast.show({
                              msg: "الصنف ليس لديه باتش منتهي للتسجيل",
                              kind: "err",
                            });
                          }
                        }}
                      >
                        <Icon n="trash" s={14} />
                        <span>تسجيل كتالف</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Edit or Custom Promo Modal */}
      {editingPromo && (
        <EditPromoModal
          initialPromo={editingPromo}
          allProducts={allProducts}
          onClose={() => setEditingPromo(null)}
          onSaveAndPublish={handleSaveEditedPromo}
        />
      )}

      {/* Restock Modal */}
      {restockProductObj && (
        <AddStockModal
          targetProduct={restockProductObj}
          onClose={() => {
            setRestockProductObj(null);
          }}
          onAdded={() => {
            setRestockProductObj(null);
            toast.show({
              msg: "تمت إضافة البضاعة للمخزون بنجاح ✓",
              kind: "ok",
            });
            void loadAlerts();
          }}
        />
      )}

      {/* Waste Confirmation Modal matching Screenshot 2 */}
      {wasteTarget && (
        <div
          className={styles.wasteModalOverlay}
          onClick={() => !isSubmittingWaste && setWasteTarget(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.wasteSheet}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.grabHandle} />
            <div className={styles.sheetHeader}>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setWasteTarget(null)}
                aria-label="إغلاق"
                disabled={isSubmittingWaste}
              >
                <Icon n="x" s={18} />
              </button>
              <h3 className={styles.sheetTitle}>تم التعامل مع الصلاحية</h3>
            </div>

            <div className={styles.sheetBody}>
              هنشيل{" "}
              {formatQtyText(
                wasteTarget.unitMode,
                wasteTarget.remainingQtyBase,
                wasteTarget.packQty,
                wasteTarget.unit,
              )}{" "}
              من &quot;{wasteTarget.name}&quot; من المخزون ونسجلها كفاقد (
              {formatMoney(
                Math.round(
                  (wasteTarget.remainingQtyBase /
                    (wasteTarget.unitMode === "weight" ? 1000 : 1)) *
                    wasteTarget.costPricePiasters,
                ),
              )}
              ). لو لسه هتبيعها سيب التنبيه.
            </div>

            <div className={styles.sheetFooter}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setWasteTarget(null)}
                disabled={isSubmittingWaste}
              >
                إلغاء
              </button>
              <button
                type="button"
                className={styles.confirmWasteBtn}
                onClick={handleConfirmWaste}
                disabled={isSubmittingWaste}
              >
                {isSubmittingWaste ? "جاري التسجيل..." : "شيله من المخزون"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AlertsView;
