"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Icon, Modal, PageTitle, useToast } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import {
  isServiceProduct,
  type StoreProductItem,
} from "@/client/shared/store-items";
import { MachineFormSheet } from "./MachineFormSheet";
import {
  describeCommission,
  legacyCommissionRule,
  type ServiceCommissionRule,
} from "@/domain/service-commission";
import { ServiceFormModal } from "../products/ServiceFormModal";
import { StockEntrySheet } from "../stock/StockEntrySheet";
import { optionFromProduct } from "../stock/stock-entry.logic";
import type { StockAlertItem, ExpiryAlertItem } from "@/domain/alerts";
import {
  fetchStoreMachines,
  getServiceLinkedMachineIds,
  getStoredMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import { useAuth } from "@/client/shared/auth";
import { unitWord as unitWordOf } from "@/client/shared/unit-labels";
import { MachineTopupModal } from "../stock/MachineTopupModal";
import { RecordLossModal } from "../stock/RecordLossModal";
import type { StockInventoryItem } from "@/client/shared/store-items";
import {
  WASTE_REASON_LABELS,
  WASTE_SOURCE_LABELS,
  type WasteReason,
  type WasteSource,
} from "@/schemas/inventory";
import styles from "./AlertsView.module.css";

/** One row of «سجل التالف» (`GET /api/stock?view=waste`). */
interface WasteRow {
  id: string;
  productName: string;
  quantityBase: number;
  quantityText: string;
  reason: string;
  note: string | null;
  costPiasters: number;
  source: string | null;
  createdByName: string | null;
  createdAt: string;
}

const wasteDay = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export function AlertsView({
  mode = "machines",
  onNavigate,
}: {
  /** "machines": wallets & machines (V19). "alerts": the stand-alone alerts page (V17). */
  mode?: "machines" | "alerts";
  onNavigate?: (route: "stock") => void;
} = {}) {
  const { session } = useAuth();
  const storeId = session?.store?.id;

  const [tab, setTab] = useState<"stock" | "exp" | "waste">("stock");
  // «التالف» (ADR-0037): the log of what was recorded as damaged, and the form to record more.
  const [wasteLog, setWasteLog] = useState<WasteRow[] | null>(null);
  const [wasteError, setWasteError] = useState<string | null>(null);
  const [stockItems, setStockItems] = useState<StockInventoryItem[]>([]);
  const [lossOpen, setLossOpen] = useState(false);
  const loadWaste = useCallback(() => {
    fetch("/api/stock?view=waste", { credentials: "same-origin" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok)
          throw new Error(j?.error?.message || "مقدرناش نجيب سجل التالف");
        setWasteLog((j?.waste ?? []) as WasteRow[]);
        setWasteError(null);
      })
      .catch((e: unknown) =>
        setWasteError(
          e instanceof Error ? e.message : "مقدرناش نجيب سجل التالف",
        ),
      );
    apiGet("/api/stock")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.inventory)) setStockItems(d.inventory);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (mode === "alerts") loadWaste();
  }, [mode, loadWaste]);
  const [loading, setLoading] = useState(true);
  const [outOfStock, setOutOfStock] = useState<StockAlertItem[]>([]);
  const [lowStock, setLowStock] = useState<StockAlertItem[]>([]);
  const [expired, setExpired] = useState<ExpiryAlertItem[]>([]);
  const [nearExpiry, setNearExpiry] = useState<ExpiryAlertItem[]>([]);
  const [allProducts, setAllProducts] = useState<StoreProductItem[]>([]);
  const [machines, setMachines] = useState<PosMachine[]>([]);
  const [topupMachine, setTopupMachine] = useState<PosMachine | null>(null);
  // V19 machines page: a machine's sheet, the machines manager, the service form.
  const [sheetMachineId, setSheetMachineId] = useState<string | null>(null);
  const [machineForm, setMachineForm] = useState<{
    machine: PosMachine | null;
  } | null>(null);
  const [deletingMachine, setDeletingMachine] = useState(false);
  const [serviceForm, setServiceForm] = useState<{
    product: StoreProductItem | null;
  } | null>(null);
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  // Each service's commission rule (fixed / percent / tiers), from the sales settings.
  const [commissions, setCommissions] = useState<
    Record<string, ServiceCommissionRule>
  >({});
  const loadCommissions = useCallback(() => {
    apiGet("/api/sales/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCommissions(d?.config?.serviceCommissions ?? {}))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (mode === "machines") loadCommissions();
  }, [mode, loadCommissions]);

  const toast = useToast();
  const [wasteTarget, setWasteTarget] = useState<ExpiryAlertItem | null>(null);
  const [restockProductObj, setRestockProductObj] =
    useState<StoreProductItem | null>(null);
  const [isSubmittingWaste, setIsSubmittingWaste] = useState(false);

  const loadAlerts = useCallback(async () => {
    try {
      const res = await apiGet("/api/alerts");
      if (res.ok) {
        const data = await res.json();
        setOutOfStock(data.outOfStock || []);
        setLowStock(data.lowStock || []);
        setExpired(data.expired || []);
        setNearExpiry(data.nearExpiry || []);
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
          apiGet("/api/alerts"),
          apiGet("/api/products?filter=all&scope=store"),
        ]);

        if (alertsRes.ok && !ignore) {
          const data = await alertsRes.json();
          setOutOfStock(data.outOfStock || []);
          setLowStock(data.lowStock || []);
          setExpired(data.expired || []);
          setNearExpiry(data.nearExpiry || []);
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

  const reloadProducts = useCallback(() => {
    apiGet("/api/products?filter=all&scope=store")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.products && Array.isArray(d.products))
          setAllProducts(d.products);
      })
      .catch(() => undefined);
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
    loadMachines();

    // The event means the machines cache was just updated (fetchStoreMachines saves it and
    // dispatches the event), so read the cache. Fetching again here re-dispatched the event
    // and looped forever (QA-28, the same fix as SalesView's UE-20).
    const onMachinesUpdated = () => setMachines(getStoredMachines(storeId));
    window.addEventListener("hesba_machines_updated", onMachinesUpdated);
    return () => {
      window.removeEventListener("hesba_machines_updated", onMachinesUpdated);
    };
  }, [loadMachines, storeId]);

  // Machines with balance less than 200 EGP (20,000 piasters)
  const lowMachines = useMemo(() => {
    return machines.filter(
      (m) => m.status === "active" && (m.currentBalancePiasters || 0) < 20000,
    );
  }, [machines]);

  const totalStockAlerts =
    outOfStock.length + lowStock.length + lowMachines.length;
  const totalExpiryAlerts = expired.length + nearExpiry.length;

  const showStock = tab === "stock";
  const showExp = tab === "exp";

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

    const unitWord = unitWordOf(unit);

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
          source: "alerts",
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

  /** V19 machDel: only an empty machine is removed (its history stays on the server). */
  const deleteMachine = async (m: PosMachine) => {
    if ((m.currentBalancePiasters || 0) > 0) {
      toast.show({ msg: "الرصيد لازم يبقى صفر قبل المسح", kind: "err" });
      return;
    }
    if (!window.confirm(`تمسح «${m.name}»؟`)) return;
    setDeletingMachine(true);
    try {
      const res = await fetch(`/api/machines?id=${encodeURIComponent(m.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message || "مقدرناش نمسح الماكينة");
      }
      setMachines((prev) => prev.filter((x) => x.id !== m.id));
      setSheetMachineId(null);
      toast.show({ msg: "اتمسحت", kind: "ok" });
    } catch (err) {
      toast.show({
        msg: err instanceof Error ? err.message : "مقدرناش نمسح الماكينة",
        kind: "err",
      });
    } finally {
      setDeletingMachine(false);
    }
  };

  return (
    <div
      className={styles.page}
      data-testid={mode === "alerts" ? "page-notifications" : "page-alerts"}
      dir="rtl"
    >
      {mode === "machines" && (
        <>
          {/* V19: wallets & machines with their balances, then the services */}
          <div className={styles.two}>
            <button
              type="button"
              className={styles.btn}
              data-testid="machines-add"
              onClick={() => setMachineForm({ machine: null })}
            >
              + ماكينة / محفظة
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              data-testid="service-add"
              onClick={() => setServiceForm({ product: null })}
            >
              + خدمة
            </button>
          </div>
          <div className={styles.mgrid}>
            {machines.map((m) => (
              <button
                key={m.id}
                type="button"
                className={styles.mcard}
                data-testid="machine-card"
                onClick={() => setSheetMachineId(m.id)}
              >
                <span aria-hidden="true">💳</span>
                <b>{m.name}</b>
                <big>{formatMoney(m.currentBalancePiasters || 0)}</big>
              </button>
            ))}
          </div>
          {machines.length === 0 && (
            <div className={styles.note}>لسه مفيش ماكينات أو محافظ</div>
          )}

          <h3 className={styles.sech}>⚡ الخدمات</h3>
          <div className={styles.chips}>
            {[
              ["all", "الكل"] as const,
              ...machines.map((m) => [m.id, m.name] as const),
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`${styles.chip} ${serviceFilter === k ? styles.chipOn : ""}`}
                onClick={() => setServiceFilter(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {(() => {
            const services = allProducts
              .filter((p) => isServiceProduct(p))
              .map((p) => ({
                p,
                linked: machines.filter((m) =>
                  getServiceLinkedMachineIds(p.id, storeId).includes(m.id),
                ),
              }))
              .filter(
                ({ linked }) =>
                  serviceFilter === "all" ||
                  linked.some((m) => m.id === serviceFilter),
              );
            if (services.length === 0) {
              return <div className={styles.note}>مفيش خدمات</div>;
            }
            return services.map(({ p, linked }) => (
              <button
                key={p.id}
                type="button"
                className={styles.row}
                onClick={() => setServiceForm({ product: p })}
                data-testid="service-row"
              >
                <span className={styles.rowEm} aria-hidden="true">
                  ⚡
                </span>
                <span className={styles.rowT}>
                  <b>{p.name_ar}</b>
                  <small>
                    عمولة{" "}
                    {describeCommission(
                      commissions[p.id] ??
                        legacyCommissionRule(p.sell_price_piasters || 0),
                    )}{" "}
                    · من: {linked.map((m) => m.name).join("، ") || "مش مربوطة"}
                  </small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ));
          })()}
        </>
      )}

      {mode === "alerts" && (
        <>
          {/* V17 alerts form, as a page: نفاد / صلاحية */}
          <PageTitle>إيه اللي محتاج تاخد بالك منه؟</PageTitle>
          <div className={styles.tabsFill} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "stock"}
              className={`${styles.tab} ${tab === "stock" ? styles.tabOn : ""}`}
              onClick={() => setTab("stock")}
              data-testid="alerts-tab-stock"
            >
              نفاد ({totalStockAlerts})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "exp"}
              className={`${styles.tab} ${tab === "exp" ? styles.tabOn : ""}`}
              onClick={() => setTab("exp")}
              data-testid="alerts-tab-exp"
            >
              صلاحية ({totalExpiryAlerts})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "waste"}
              className={`${styles.tab} ${tab === "waste" ? styles.tabOn : ""}`}
              onClick={() => setTab("waste")}
              data-testid="alerts-tab-waste"
            >
              التالف ({wasteLog?.length ?? 0})
            </button>
          </div>

          {tab === "waste" && (
            <>
              <button
                type="button"
                className={styles.wasteAdd}
                onClick={() => setLossOpen(true)}
                data-testid="waste-add"
              >
                + سجّل منتج تالف
              </button>
              {wasteError && (
                <div className={styles.note} role="alert">
                  {wasteError}{" "}
                  <button
                    type="button"
                    className={styles.mini}
                    onClick={loadWaste}
                  >
                    جرّب تاني
                  </button>
                </div>
              )}
              {!wasteLog && !wasteError && (
                <div className={styles.note}>بنحمّل…</div>
              )}
              {wasteLog && wasteLog.length === 0 && (
                <div className={styles.note} data-testid="waste-empty">
                  لسه مفيش تالف متسجّل.
                </div>
              )}
              {(wasteLog ?? []).map((w) => (
                <div
                  key={w.id}
                  className={styles.rowItem}
                  data-testid="waste-row"
                >
                  <span className={styles.rowEm} aria-hidden="true">
                    🗑️
                  </span>
                  <span className={styles.rowT} style={{ flex: 1 }}>
                    <b>{w.productName}</b>
                    <span>
                      {w.quantityText} ·{" "}
                      {WASTE_REASON_LABELS[w.reason as WasteReason] ?? w.reason}
                      {w.note ? ` · ${w.note}` : ""}
                    </span>
                    <small className={styles.wasteMeta}>
                      {wasteDay(w.createdAt)}
                      {w.source
                        ? ` · من ${WASTE_SOURCE_LABELS[w.source as WasteSource] ?? w.source}`
                        : ""}
                      {w.createdByName ? ` · ${w.createdByName}` : ""}
                    </small>
                  </span>
                  <b className={styles.wasteCost} data-testid="waste-cost">
                    {w.costPiasters > 0
                      ? `−${formatMoney(w.costPiasters)}`
                      : "التكلفة مش معروفة"}
                  </b>
                </div>
              ))}
            </>
          )}

          {showStock &&
            !loading &&
            stockAlertsList.length === 0 &&
            lowMachines.length === 0 && (
              <div className={styles.note}>كل حاجة متوفرة ✅</div>
            )}
          {showStock &&
            stockAlertsList.map((item) => (
              <div
                key={item.id}
                className={styles.rowItem}
                data-testid="alert-stock-row"
              >
                <span className={styles.rowEm} aria-hidden="true">
                  {item.unitMode === "weight" ? "⚖️" : "📦"}
                </span>
                <div className={styles.rowT}>
                  <b>{item.name}</b>
                  <span>
                    {item.lv === "out"
                      ? "خلصان خالص"
                      : `المتاح: ${formatQtyText(
                          item.unitMode,
                          item.currentStockBase,
                          item.packQty,
                          item.unit,
                        )}`}
                  </span>
                </div>
                <button
                  type="button"
                  className={`${styles.mini} ${styles.miniDark}`}
                  onClick={() =>
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
                    })
                  }
                >
                  + دخلت
                </button>
              </div>
            ))}
          {showStock &&
            lowMachines.map((m) => {
              const bal = m.currentBalancePiasters || 0;
              return (
                <div key={m.id} className={styles.rowItem}>
                  <span className={styles.rowEm} aria-hidden="true">
                    💳
                  </span>
                  <div className={styles.rowT}>
                    <b>{m.name}</b>
                    <span>
                      {bal <= 0
                        ? "الرصيد خلص"
                        : `فاضل ${formatMoney(bal)} بس (أقل من 200 ج)`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`${styles.mini} ${styles.miniDark}`}
                    onClick={() => {
                      setTopupMachine(m);
                    }}
                  >
                    + رصيد
                  </button>
                </div>
              );
            })}
          {showStock && onNavigate && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => onNavigate("stock")}
            >
              📦 دخلت بضاعة
            </button>
          )}

          {showExp && !loading && expiryAlertsList.length === 0 && (
            <div className={styles.note}>مفيش دفعات قربت على الصلاحية ✅</div>
          )}
          {showExp &&
            expiryAlertsList.map((item) => {
              const d = item.daysUntilExpiry;
              const text = item.isExpired
                ? "صلاحية الدفعة دي خلصت ⛔"
                : d === 0
                  ? "الدفعة دي بتخلص صلاحيتها النهارده ⚠️"
                  : `باقي ${d} يوم على صلاحية الدفعة دي ⚠️`;
              return (
                <div
                  key={item.id}
                  className={`${styles.rowItem} ${styles.rowWrap}`}
                  data-testid="alert-expiry-row"
                >
                  <span className={styles.rowEm} aria-hidden="true">
                    {item.unitMode === "weight" ? "⚖️" : "📦"}
                  </span>
                  <div className={styles.rowT}>
                    <b>
                      {item.name} ·{" "}
                      {formatQtyText(
                        item.unitMode,
                        item.remainingQtyBase,
                        item.packQty,
                        item.unit,
                      )}
                    </b>
                    <span>{text}</span>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={`${styles.mini} ${styles.miniRed}`}
                      onClick={() => setWasteTarget(item)}
                    >
                      🗑️ سجّل كتالف
                    </button>
                  </div>
                </div>
              );
            })}
        </>
      )}

      {/* Offers are made in «بضاعتي» and show in the sale at once — not here. */}
      {mode === "alerts" && tab === "exp" && (
        <div className={styles.note}>
          عايز تعمل عرض على حاجة قربت تخلص صلاحيتها؟ اعمله من «بضاعتي».
        </div>
      )}

      {lossOpen && (
        <RecordLossModal
          items={stockItems}
          source="alerts"
          onClose={() => setLossOpen(false)}
          onSaved={(message) => {
            setLossOpen(false);
            toast.show({ msg: message, kind: "ok" });
            loadWaste();
            void loadAlerts();
          }}
        />
      )}

      {/* Restock Modal */}
      {restockProductObj && (
        <StockEntrySheet
          option={optionFromProduct(restockProductObj)}
          onClose={() => {
            setRestockProductObj(null);
          }}
          onSaved={() => {
            setRestockProductObj(null);
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

      {/* V19 machine sheet: its balance, top up, correct, manage */}
      {(() => {
        const m = machines.find((x) => x.id === sheetMachineId);
        if (!m) return null;
        return (
          <Modal title={`💳 ${m.name}`} onClose={() => setSheetMachineId(null)}>
            <div className={styles.bigBox}>
              <small>الرصيد دلوقتي</small>
              <b>{formatMoney(m.currentBalancePiasters || 0)}</b>
            </div>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                setSheetMachineId(null);
                setTopupMachine(m);
              }}
            >
              ➕ حط رصيد
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              data-testid="machine-rename"
              onClick={() => {
                setSheetMachineId(null);
                setMachineForm({ machine: m });
              }}
            >
              ✏️ عدّل الاسم
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnRed}`}
              data-testid="machine-delete"
              disabled={deletingMachine}
              onClick={() => void deleteMachine(m)}
            >
              🗑️ امسح
            </button>
          </Modal>
        );
      })()}

      {machineForm && (
        <MachineFormSheet
          machine={machineForm.machine}
          storeId={storeId}
          onClose={() => setMachineForm(null)}
          onSaved={(list, message) => {
            setMachineForm(null);
            setMachines(list);
            toast.show({ msg: message, kind: "ok" });
          }}
        />
      )}

      {serviceForm && (
        <ServiceFormModal
          product={serviceForm.product}
          existingServices={allProducts.filter((p) => isServiceProduct(p))}
          onClose={() => setServiceForm(null)}
          onSaved={() => {
            setServiceForm(null);
            reloadProducts();
            loadCommissions();
          }}
          onDeleted={() => {
            setServiceForm(null);
            reloadProducts();
          }}
        />
      )}

      {/* POS Machine Topup / Recharge Modal */}
      {topupMachine && (
        <MachineTopupModal
          machine={topupMachine}
          initialMode="topup"
          topupOnly
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
