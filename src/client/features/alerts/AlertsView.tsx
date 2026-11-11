"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, Icon, Seg, useToast } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import type { StoreProductItem } from "@/client/shared/store-items";
import { AddStockModal } from "../stock/AddStockModal";
import { EditPromoModal } from "./EditPromoModal";
import type {
  StockAlertItem,
  ExpiryAlertItem,
  SuggestedPromotion,
} from "@/domain/alerts";
import type { PublishedPromotion } from "@/schemas/promotion";
import {
  fetchStoreMachines,
  getStoredMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import { useAuth } from "@/client/shared/auth";
import { MachineTopupModal } from "../stock/MachineTopupModal";
import styles from "./AlertsView.module.css";
import { dedupedGet } from "@/client/shared/api/dedupe";

export function AlertsView() {
  const { session } = useAuth();
  const storeId = session?.store?.id;

  const [tab, setTab] = useState<"all" | "stock" | "exp">("all");
  const [loading, setLoading] = useState(true);
  const [outOfStock, setOutOfStock] = useState<StockAlertItem[]>([]);
  const [lowStock, setLowStock] = useState<StockAlertItem[]>([]);
  const [expired, setExpired] = useState<ExpiryAlertItem[]>([]);
  const [nearExpiry, setNearExpiry] = useState<ExpiryAlertItem[]>([]);
  const [suggestedPromos, setSuggestedPromos] = useState<SuggestedPromotion[]>(
    [],
  );
  const [publishedPromotions, setPublishedPromotions] = useState<
    PublishedPromotion[]
  >([]);
  const [allProducts, setAllProducts] = useState<StoreProductItem[]>([]);
  const [machines, setMachines] = useState<PosMachine[]>([]);
  const [topupMachine, setTopupMachine] = useState<PosMachine | null>(null);

  const toast = useToast();
  const [wasteTarget, setWasteTarget] = useState<ExpiryAlertItem | null>(null);
  const [restockProductObj, setRestockProductObj] =
    useState<StoreProductItem | null>(null);
  const [isSubmittingWaste, setIsSubmittingWaste] = useState(false);

  // Edit / Custom Promo state
  const [editingPromo, setEditingPromo] = useState<SuggestedPromotion | null>(
    null,
  );

  const loadAlerts = useCallback(async () => {
    try {
      const res = await dedupedGet("/api/alerts");
      if (res.ok) {
        const data = await res.json();
        setOutOfStock(data.outOfStock || []);
        setLowStock(data.lowStock || []);
        setExpired(data.expired || []);
        setNearExpiry(data.nearExpiry || []);
        setSuggestedPromos(data.suggestedPromotions || []);
        if (typeof window !== "undefined") {
          // Carries the count, so the shell's badge needs no second request (QA-28).
          window.dispatchEvent(
            new CustomEvent("hesba_alerts_updated", {
              detail: { totalAlerts: data.totalAlerts },
            }),
          );
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
          dedupedGet("/api/alerts"),
          fetch("/api/products?filter=all&scope=store"),
        ]);

        if (alertsRes.ok && !ignore) {
          const data = await alertsRes.json();
          setOutOfStock(data.outOfStock || []);
          setLowStock(data.lowStock || []);
          setExpired(data.expired || []);
          setNearExpiry(data.nearExpiry || []);
          setSuggestedPromos(data.suggestedPromotions || []);
          if (typeof window !== "undefined") {
            // Carries the count, so the shell's badge needs no second request (QA-28).
            window.dispatchEvent(
              new CustomEvent("hesba_alerts_updated", {
                detail: { totalAlerts: data.totalAlerts },
              }),
            );
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

  // Load published promotions
  const loadPromotions = useCallback(() => {
    dedupedGet("/api/promotions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.promotions && Array.isArray(data.promotions)) {
          setPublishedPromotions(data.promotions);
        }
      })
      .catch(() => {});
  }, []);

  // Load POS Machines to monitor low balance (< 200 EGP)
  const loadMachines = useCallback(() => {
    void fetchStoreMachines(storeId).then((m) => {
      if (m && Array.isArray(m)) {
        setMachines(m);
      }
    });
  }, [storeId]);

  useEffect(() => {
    // Wait for the signed-in shop: running first without it and again with it loaded
    // everything twice (QA-32 request audit), and the local caches are keyed by shop.
    if (!storeId) return;
    loadPromotions();
    loadMachines();

    // The event means the machines cache was just updated (fetchStoreMachines saves it and
    // dispatches the event), so read the cache. Fetching again here re-dispatched the event
    // and looped forever (QA-28, the same fix as SalesView's UE-20).
    const onMachinesUpdated = () => setMachines(getStoredMachines(storeId));
    window.addEventListener("hesba_promotions_updated", loadPromotions);
    window.addEventListener("hesba_machines_updated", onMachinesUpdated);
    return () => {
      window.removeEventListener("hesba_promotions_updated", loadPromotions);
      window.removeEventListener("hesba_machines_updated", onMachinesUpdated);
    };
  }, [loadPromotions, loadMachines, storeId]);

  // Machines with balance less than 200 EGP (20,000 piasters)
  const lowMachines = useMemo(() => {
    return machines.filter(
      (m) => m.status === "active" && (m.currentBalancePiasters || 0) < 20000,
    );
  }, [machines]);

  // All promotions (both published and suggested)
  const allPromos = useMemo((): Array<
    SuggestedPromotion & { isPublished: boolean }
  > => {
    const pubIds = new Set(publishedPromotions.map((p) => p.id));
    const pending = suggestedPromos.filter((p) => !pubIds.has(p.id));
    return [
      ...publishedPromotions.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description || "",
        type: (p.type || "bundle") as "bundle" | "single_discount",
        items: p.items,
        originalPricePiasters: p.originalPricePiasters,
        promoPricePiasters: p.promoPricePiasters,
        savingsPiasters: p.savingsPiasters,
        expiryDaysMin: p.expiryDaysMin ?? 7,
        isPublished: true,
      })),
      ...pending.map((p) => ({ ...p, isPublished: false })),
    ];
  }, [suggestedPromos, publishedPromotions]);

  const totalStockAlerts =
    outOfStock.length + lowStock.length + lowMachines.length;
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

      const json = (await res.json().catch(() => null)) as {
        promotion?: PublishedPromotion;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.promotion) {
        // The server's reason (e.g. the price is not below the original), QA-20.
        throw new Error(json?.error?.message || "تعذر نشر العرض");
      }
      // Keep the offer as the server priced it, not the client's copy.
      const saved = json.promotion;

      setPublishedPromotions((prev) => {
        const idx = prev.findIndex((p) => p.id === saved.id);
        if (idx >= 0) {
          const u = [...prev];
          u[idx] = saved;
          return u;
        }
        return [...prev, saved];
      });
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

      {/* Stock Depletion Section (نفاد المخزون — خلصان خالص + قرب يخلص + الماكينات المنخفضة) */}
      {showStock && (stockAlertsList.length > 0 || lowMachines.length > 0) && (
        <section>
          <h2 className={styles.secTitle}>نفاد المخزون والماكينات</h2>
          <div className={styles.listCard}>
            {/* Products Low / Out of Stock */}
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

            {/* POS Machines with Balance < 200 EGP */}
            {lowMachines.map((m) => {
              const balPiasters = m.currentBalancePiasters || 0;
              const isOut = balPiasters <= 0;
              return (
                <div key={m.id} className={styles.lrow}>
                  <div className={styles.rowInfo}>
                    <div className={styles.rowTitleGroup}>
                      <span
                        className={`${styles.dot} ${
                          isOut ? styles.dotRed : styles.dotYellow
                        }`}
                      />
                      <span className={styles.itemName}>
                        {m.name} (ماكينة دفع)
                      </span>
                    </div>
                    <span className={styles.itemSub}>
                      {isOut
                        ? "رصيد منتهي (0 ج.م)"
                        : `فاضل ${(balPiasters / 100).toFixed(1)} ج.م بس (أقل من 200 ج.م)`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.doneBtn}
                    onClick={() => setTopupMachine(m)}
                    title="شحن رصيد الماكينة"
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
          {allPromos.length === 0 ? (
            <div className={styles.emptyPromoCard}>
              <div className={styles.emptyPromoTitle}>
                لا توجد عروض مقترحة حالياً
              </div>
              <p className={styles.emptyPromoSub}>
                يمكنك تجهيز عرض تخفيض أو بكج لأي منتج واختيار نسبة الخصم بنفسك
                ونشره فوراً في شاشة البيع.
              </p>
              <button
                type="button"
                className={styles.createCustomPromoBtn}
                onClick={handleStartCreateCustomPromo}
              >
                <Icon n="plus" s={14} />
                <span>إنشاء عرض مخصص</span>
              </button>
            </div>
          ) : (
            <>
              <div className={styles.promoBar}>
                <div className={styles.promoSectionTitle}>
                  <Icon n="sparkle" s={16} />
                  <span>عروض وتخفيضات الصلاحية ({allPromos.length})</span>
                </div>
                <button
                  type="button"
                  className={styles.createCustomPromoBtn}
                  onClick={handleStartCreateCustomPromo}
                >
                  <Icon n="plus" s={14} />
                  <span>إنشاء عرض مخصص</span>
                </button>
              </div>

              <div className={styles.promoCardsList}>
                {allPromos.map((promo) => (
                  <div key={promo.id} className={styles.promoCard}>
                    <div className={styles.promoCardTop}>
                      <h4 className={styles.promoTitle}>{promo.title}</h4>
                      {promo.isPublished ? (
                        <span className={styles.publishedTag}>
                          <Icon n="check" s={12} />
                          <span>منشور في البيع</span>
                        </span>
                      ) : (
                        <span className={styles.savingsTag}>
                          وفّر {formatMoney(promo.savingsPiasters)}
                        </span>
                      )}
                    </div>

                    <p className={styles.promoItemsText}>
                      {promo.items
                        .map(
                          (it) =>
                            `${it.productName} (${
                              it.unit === "weight"
                                ? `${
                                    it.quantityBase >= 1000
                                      ? it.quantityBase / 1000
                                      : it.quantityBase
                                  } كجم`
                                : `${it.quantityBase} ${it.unit}`
                            })`,
                        )
                        .join(" · ")}
                    </p>

                    <div className={styles.promoCardFooter}>
                      <div className={styles.promoPricing}>
                        <span className={styles.promoOldPrice}>
                          {formatMoney(promo.originalPricePiasters)}
                        </span>
                        <b className={styles.promoNewPrice}>
                          {formatMoney(promo.promoPricePiasters)}
                        </b>
                      </div>

                      <div className={styles.promoActions}>
                        {promo.isPublished ? (
                          <>
                            <button
                              type="button"
                              className={styles.editPromoBtn}
                              onClick={() => setEditingPromo(promo)}
                              title="تعديل تفاصيل العرض"
                            >
                              <Icon n="edit" s={14} />
                              <span>تعديل</span>
                            </button>
                            <button
                              type="button"
                              className={styles.deletePromoBtn}
                              onClick={async () => {
                                await fetch(
                                  `/api/promotions?id=${encodeURIComponent(promo.id)}`,
                                  { method: "DELETE" },
                                );
                                setPublishedPromotions((prev) =>
                                  prev.filter((p) => p.id !== promo.id),
                                );
                                window.dispatchEvent(
                                  new CustomEvent("hesba_promotions_updated"),
                                );
                                toast.show({
                                  msg: "تم حذف العرض من البيع",
                                  kind: "ok",
                                });
                              }}
                              title="حذف العرض من البيع"
                            >
                              <Icon n="trash" s={14} />
                              <span>حذف</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={styles.approvePromoBtn}
                              onClick={() => void handleApprovePromotion(promo)}
                            >
                              <Icon n="check" s={15} />
                              <span>نشر في البيع</span>
                            </button>
                            <button
                              type="button"
                              className={styles.editPromoBtn}
                              onClick={() => setEditingPromo(promo)}
                              title="تعديل تفاصيل العرض"
                            >
                              <Icon n="edit" s={14} />
                              <span>تعديل</span>
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
                                      (e) =>
                                        e.productId === firstItem.productId,
                                    ) ||
                                    nearExpiry.find(
                                      (e) =>
                                        e.productId === firstItem.productId,
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
                                title="تسجيل كتالف"
                              >
                                <Icon n="trash" s={14} />
                                <span>تالف</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
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
          onDelete={async (promoId) => {
            setSuggestedPromos((prev) => prev.filter((p) => p.id !== promoId));
            await fetch(`/api/promotions?id=${encodeURIComponent(promoId)}`, {
              method: "DELETE",
            }).catch(() => {});
            setEditingPromo(null);
            window.dispatchEvent(new CustomEvent("hesba_promotions_updated"));
            toast.show({ msg: "تم حذف العرض بنجاح", kind: "ok" });
          }}
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
              من &quot;{wasteTarget.name}&quot; من المخزون ونسجلها كفاقد
              {wasteTarget.costPricePiasters !== null &&
                ` (${formatMoney(
                  Math.round(
                    (wasteTarget.remainingQtyBase /
                      (wasteTarget.unitMode === "weight" ? 1000 : 1)) *
                      wasteTarget.costPricePiasters,
                  ),
                )})`}
              . لو لسه هتبيعها سيب التنبيه.
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

      {/* POS Machine Topup / Recharge Modal */}
      {topupMachine && (
        <MachineTopupModal
          machine={topupMachine}
          storeId={storeId}
          onClose={() => setTopupMachine(null)}
          onSuccess={(updated) => {
            setTopupMachine(null);
            setMachines((prev) =>
              prev.map((m) => (m.id === updated.id ? updated : m)),
            );
            toast.show({
              msg: `تم شحن رصيد «${updated.name}» بنجاح ✓`,
              kind: "ok",
            });
          }}
        />
      )}
    </div>
  );
}

export default AlertsView;
