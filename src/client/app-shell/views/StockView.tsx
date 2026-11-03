"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, SearchBox, Modal } from "../../shared/ui";
import { formatMoney } from "../../shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { AddStockModal, type StockProductOption } from "./AddStockModal";
import { ClearStockModal } from "./ClearStockModal";
import { ArchiveStockModal } from "./ArchiveStockModal";
import type { StoreProductItem } from "./ProductsView";
import styles from "./StockView.module.css";

export interface StockInventoryItem {
  variantId: string;
  productId: string;
  productName: string;
  category?: string;
  brandName?: string;
  isCustom?: boolean;
  flavor?: string | null;
  unitMode: "piece" | "weight";
  packQty: number;
  sellPricePiasters: number;
  buyPricePiasters?: number;
  currentStockBase: number;
  status: "ok" | "low" | "out";
  hasNearExpiry: boolean;
  batches: Array<{
    id: string;
    batchCode?: string | null;
    receivedQty: number;
    remainingQty: number;
    costPricePiasters: number;
    expiryDate?: string | null;
    isNearExpiry: boolean;
    receivedAt: string;
  }>;
}

export interface StockMovementItem {
  id: string;
  batchId?: string | null;
  variantId: string;
  productName: string;
  flavor?: string | null;
  packQty?: number;
  unitMode?: "piece" | "weight";
  type: string;
  quantityBase: number;
  costPricePiasters?: number | null;
  costTotalMinor?: number | null;
  supplierName?: string | null;
  balanceAfterBase?: number | null;
  negative: boolean;
  batchCode?: string | null;
  expiryDate?: string | null;
  createdAt: string;
}

function getDateGroupLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return "النهارده";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return "أمس";

  return d.toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatArabicTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("ar-EG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatArabicExpiry(dateStr?: string | null): string {
  if (!dateStr) return "بدون تاريخ صلاحية";
  const d = new Date(dateStr);
  return `صلاحية ${d.toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;
}

function formatInventoryStock(item: StockInventoryItem): string {
  if (item.currentStockBase <= 0) return "خلصان";
  if (item.unitMode === "weight") {
    return `${(item.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
  }
  const pack = item.packQty || 1;
  if (pack > 1) {
    const cartons = Math.floor(item.currentStockBase / pack);
    const pieces = item.currentStockBase % pack;
    if (cartons > 0 && pieces > 0) {
      return `${cartons} كرتونة و ${pieces} قطعة`;
    }
    if (cartons > 0 && pieces === 0) {
      return `${cartons} كرتونة`;
    }
    return `${pieces} قطعة`;
  }
  return `${item.currentStockBase} قطعة`;
}

function formatMovementQty(m: StockMovementItem): string {
  if (m.unitMode === "weight") {
    const kg = m.quantityBase / 1000;
    return `${m.quantityBase > 0 ? "+" : ""}${kg.toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
  }
  const pack = m.packQty || 1;
  if (pack > 1) {
    const cartons = Math.floor(Math.abs(m.quantityBase) / pack);
    const pieces = Math.abs(m.quantityBase) % pack;
    const sign = m.quantityBase > 0 ? "+" : "-";
    if (cartons > 0 && pieces === 0) {
      return `${sign} ${cartons} كرتونة`;
    }
    if (cartons > 0 && pieces > 0) {
      return `${sign} ${cartons} كرتونة و ${pieces} قطعة`;
    }
    return `${sign} ${pieces} قطعة`;
  }
  return `${m.quantityBase > 0 ? "+" : ""}${m.quantityBase} قطعة`;
}

export function StockView() {
  const [tab, setTab] = useState<"qty" | "log">("qty");
  const [filter, setFilter] = useState<"all" | "low" | "out" | "nearExpiry">(
    "all",
  );
  const [period, setPeriod] = useState<
    "day" | "week" | "month" | "year" | "custom"
  >("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [activeItemAction, setActiveItemAction] =
    useState<StockInventoryItem | null>(null);
  const [clearingItem, setClearingItem] = useState<StockInventoryItem | null>(
    null,
  );
  const [archivingItem, setArchivingItem] = useState<StockInventoryItem | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [selectedStockProduct, setSelectedStockProduct] =
    useState<StoreProductItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voidingBatchId, setVoidingBatchId] = useState<string | null>(null);
  const [nowTimestamp] = useState(() => Date.now());

  const [delBatch, setDelBatch] = useState<StockMovementItem | null>(null);

  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovementItem[]>([]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/stock?view=all");
      if (!res.ok) throw new Error("فشل تحميل بيانات المخزون");
      const data = await res.json();
      setInventory(data.inventory || []);
      setMovements(data.movements || []);
    } catch (err: unknown) {
      console.error("Failed to load stock data:", err);
      setError("تعذر تحميل المخزون، برجاء التحقق من الاتصال");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const fetchStock = async () => {
      try {
        const res = await fetch("/api/stock?view=all");
        if (!res.ok) throw new Error("فشل تحميل بيانات المخزون");
        const data = await res.json();
        if (!ignore) {
          setInventory(data.inventory || []);
          setMovements(data.movements || []);
        }
      } catch (err: unknown) {
        console.error("Failed to load stock data:", err);
        if (!ignore) {
          setError("تعذر تحميل المخزون، برجاء التحقق من الاتصال");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };
    void fetchStock();
    return () => {
      ignore = true;
    };
  }, []);

  // Total valuation of current stocked items
  const totalValuationPiasters = useMemo(() => {
    return inventory.reduce((sum, item) => {
      if (item.currentStockBase <= 0) return sum;
      const unitCost =
        item.buyPricePiasters && item.buyPricePiasters > 0
          ? item.buyPricePiasters
          : item.batches?.[0]?.costPricePiasters || 0;
      if (item.unitMode === "weight") {
        return sum + Math.round((item.currentStockBase / 1000) * unitCost);
      }
      return sum + item.currentStockBase * unitCost;
    }, 0);
  }, [inventory]);

  // Counts for filter chips
  const counts = useMemo(() => {
    const out = inventory.filter((i) => i.currentStockBase <= 0).length;
    const low = inventory.filter(
      (i) => i.status === "low" && i.currentStockBase > 0,
    ).length;
    const nearExpiry = inventory.filter(
      (i) => i.hasNearExpiry && i.currentStockBase > 0,
    ).length;
    return { out, low, nearExpiry, total: inventory.length };
  }, [inventory]);

  // Filtered inventory for Tab 1
  const filteredInventory = useMemo(() => {
    const normQ = normalizeArabic(query.trim());
    return inventory.filter((item) => {
      // Search filter
      if (normQ) {
        const normName = normalizeArabic(item.productName || "");
        const normFlavor = normalizeArabic(item.flavor || "");
        const normCat = normalizeArabic(item.category || "");
        if (
          !normName.includes(normQ) &&
          !normFlavor.includes(normQ) &&
          !normCat.includes(normQ)
        ) {
          return false;
        }
      }

      // Status filter
      if (filter === "out") return item.currentStockBase <= 0;
      if (filter === "low")
        return item.status === "low" && item.currentStockBase > 0;
      if (filter === "nearExpiry")
        return item.hasNearExpiry && item.currentStockBase > 0;
      return true;
    });
  }, [inventory, query, filter]);

  // Options for AddStockModal dropdown
  const productOptions: StockProductOption[] = useMemo(() => {
    return inventory.map((i) => ({
      variantId: i.variantId,
      productId: i.productId,
      productName: i.productName,
      flavor: i.flavor,
      unitMode: i.unitMode,
      packQty: i.packQty,
      currentStockBase: i.currentStockBase,
      buyCostPiasters: i.buyPricePiasters,
    }));
  }, [inventory]);

  // Tab 2 movements filtered by selected period (additions / purchases log)
  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      // Show additions (purchases) in the additions log
      if (m.type !== "purchase" && m.quantityBase <= 0) return false;

      const mTime = new Date(m.createdAt).getTime();

      if (period === "day") {
        const now = new Date(nowTimestamp);
        const dayStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
          0,
        ).getTime();
        const dayEnd = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          23,
          59,
          59,
          999,
        ).getTime();
        return mTime >= dayStart && mTime <= dayEnd;
      }
      if (period === "week") return nowTimestamp - mTime <= 7 * 86400000;
      if (period === "month") return nowTimestamp - mTime <= 30 * 86400000;
      if (period === "year") {
        return (
          new Date(m.createdAt).getFullYear() ===
          new Date(nowTimestamp).getFullYear()
        );
      }
      if (period === "custom") {
        let matches = true;
        if (customFrom) {
          const fromTime = new Date(`${customFrom}T00:00:00`).getTime();
          if (!isNaN(fromTime) && mTime < fromTime) matches = false;
        }
        if (customTo) {
          const toTime = new Date(`${customTo}T23:59:59.999`).getTime();
          if (!isNaN(toTime) && mTime > toTime) matches = false;
        }
        return matches;
      }
      return true;
    });
  }, [movements, period, nowTimestamp, customFrom, customTo]);

  // Tab 2 summary total cost and additions count
  const movementSummary = useMemo(() => {
    const count = filteredMovements.length;
    const totalPiasters = filteredMovements.reduce((sum, m) => {
      return sum + (m.costTotalMinor || m.costPricePiasters || 0);
    }, 0);
    return { count, totalPiasters };
  }, [filteredMovements]);

  // Tab 2 grouped by date
  const groupedMovements = useMemo(() => {
    const groups: Array<{ label: string; items: StockMovementItem[] }> = [];
    filteredMovements.forEach((m) => {
      const label = getDateGroupLabel(m.createdAt);
      let g = groups.find((item) => item.label === label);
      if (!g) {
        g = { label, items: [] };
        groups.push(g);
      }
      g.items.push(m);
    });
    return groups;
  }, [filteredMovements]);

  // Void / Revert a batch addition
  const handleVoidBatch = async (batchId?: string | null) => {
    if (!batchId) return;
    const confirmed = window.confirm(
      "هل أنت متأكد من حذف هذه الإضافة والتراجع عن كميتها في المخزون؟",
    );
    if (!confirmed) return;

    setVoidingBatchId(batchId);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", batchId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "فشل التراجع عن الإضافة");
      }
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setVoidingBatchId(null);
    }
  };

  return (
    <div className={styles.view} data-testid="page-stock">
      {/* Header */}
      <div className={styles.phead}>
        <div className={styles.pheadTitle}>
          <h1>المخزون</h1>
          <p>الكميات الحالية وسجل اللي دخل</p>
          {totalValuationPiasters > 0 && (
            <div className={styles.stockValuationRow}>
              <span className={styles.stockValueBadge}>
                قيمة المخزون: {formatMoney(totalValuationPiasters)}
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            setSelectedStockProduct(null);
            setIsAdding(true);
          }}
          data-testid="add-stock-btn"
        >
          <span>+</span>
          <span>إضافة</span>
        </button>
      </div>

      {/* Tabs Segmented Control */}
      <div className={styles.tabsBar}>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "qty" ? styles.active : ""}`}
          onClick={() => setTab("qty")}
        >
          الكميات
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "log" ? styles.active : ""}`}
          onClick={() => setTab("log")}
        >
          سجل الإضافات
        </button>
      </div>

      {error && (
        <div
          style={{
            color: "var(--red, #cf3c3c)",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      )}

      {tab === "qty" ? (
        /* Tab 1: Current Quantities */
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Search box with mic icon matching Image 1 */}
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="دوّر في المخزون"
          />

          {/* Status Filter Chips matching Image 1 */}
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${filter === "all" ? styles.active : ""}`}
              onClick={() => setFilter("all")}
            >
              الكل
            </button>
            <button
              type="button"
              className={`${styles.chip} ${filter === "low" ? styles.active : ""}`}
              onClick={() => setFilter("low")}
            >
              قرب يخلص ({counts.low})
            </button>
            <button
              type="button"
              className={`${styles.chip} ${filter === "out" ? styles.active : ""}`}
              onClick={() => setFilter("out")}
            >
              خلصان ({counts.out})
            </button>
            {counts.nearExpiry > 0 && (
              <button
                type="button"
                className={`${styles.chip} ${filter === "nearExpiry" ? styles.active : ""}`}
                onClick={() => setFilter("nearExpiry")}
              >
                صلاحية قريبة ({counts.nearExpiry})
              </button>
            )}
          </div>

          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 0",
                color: "var(--ink2)",
              }}
            >
              جارٍ تحميل المخزون...
            </div>
          ) : filteredInventory.length === 0 ? (
            <div style={{ padding: "30px 10px" }}>
              <Empty
                icon="layers"
                title={query ? "مفيش نتائج تطابق البحث" : "المخزون فاضي"}
                sub="اضغط على زرار الإضافة لتسجيل أول بضاعة دخلت المحل"
              />
            </div>
          ) : (
            <div className={styles.stockList}>
              {filteredInventory.map((item) => (
                <div
                  className={styles.stockItem}
                  key={item.variantId}
                  data-testid={`stock-row-${item.variantId}`}
                  onClick={() => setActiveItemAction(item)}
                >
                  <div className={styles.stockItemRight}>
                    <div
                      className={`${styles.dot} ${
                        item.status === "out"
                          ? styles.out
                          : item.status === "low"
                            ? styles.low
                            : styles.ok
                      }`}
                    />
                    <div className={styles.stockItemInfo}>
                      <b>
                        {item.productName}{" "}
                        {item.flavor ? `(${item.flavor})` : ""}
                      </b>
                      {item.unitMode !== "weight" && item.packQty > 1 && (
                        <small>الكرتونة {item.packQty} قطعة</small>
                      )}
                    </div>
                  </div>

                  <div className={styles.stockItemLeft}>
                    {item.hasNearExpiry && item.currentStockBase > 0 && (
                      <span className={styles.warnBadge}>صلاحية قريبة</span>
                    )}
                    {item.currentStockBase <= 0 ? (
                      <span className={styles.outBadge}>خلصان</span>
                    ) : (
                      <span className={styles.stockQtyText}>
                        {formatInventoryStock(item)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Tab 2: Additions Log matching Image 5 */
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Period Filter Chips matching Image 5 */}
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${period === "week" ? styles.active : ""}`}
              onClick={() => setPeriod("week")}
            >
              الأسبوع
            </button>
            <button
              type="button"
              className={`${styles.chip} ${period === "month" ? styles.active : ""}`}
              onClick={() => setPeriod("month")}
            >
              الشهر
            </button>
            <button
              type="button"
              className={`${styles.chip} ${period === "year" ? styles.active : ""}`}
              onClick={() => setPeriod("year")}
            >
              السنة
            </button>
            <button
              type="button"
              className={`${styles.chip} ${period === "custom" ? styles.active : ""}`}
              onClick={() => setPeriod("custom")}
            >
              يوم/فترة
            </button>
          </div>

          {/* Custom Date Range Picker */}
          {period === "custom" && (
            <div className={styles.dateRangeRow}>
              <div className={styles.dateInputGroup}>
                <label>من تاريخ:</label>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className={styles.dateInputGroup}>
                <label>إلى تاريخ:</label>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Summary Row matching Image 5 */}
          <div className={styles.summaryRow}>
            <span>{movementSummary.count} إضافة</span>
            {movementSummary.totalPiasters > 0 && (
              <b>{formatMoney(movementSummary.totalPiasters)}</b>
            )}
          </div>

          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 0",
                color: "var(--ink2)",
              }}
            >
              جارٍ تحميل سجل الإضافات...
            </div>
          ) : groupedMovements.length === 0 ? (
            <div style={{ padding: "30px 10px" }}>
              <Empty
                icon="truck"
                title="مفيش إضافات في الفترة دي"
                sub="اضغط على زرار الإضافة لتسجيل بضاعة دخلت"
              />
            </div>
          ) : (
            groupedMovements.map((group) => (
              <div key={group.label}>
                <div className={styles.dateGroupHeader}>{group.label}</div>
                {group.items.map((m) => {
                  return (
                    <div className={styles.batchCard} key={m.id}>
                      <div className={styles.batchCardRight}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            width: "100%",
                          }}
                        >
                          <b>
                            {m.productName} {m.flavor ? `(${m.flavor})` : ""}
                          </b>
                          <span className={styles.batchQty}>
                            + {formatMovementQty(m).replace(/^\+?\s*/, "")}
                          </span>
                        </div>
                        <div className={styles.batchMeta}>
                          <span>{formatArabicTime(m.createdAt)}</span>
                          {(m.costTotalMinor || m.costPricePiasters) && (
                            <span>
                              {formatMoney(
                                m.costTotalMinor || m.costPricePiasters || 0,
                              )}
                            </span>
                          )}
                          {m.supplierName && <span>{m.supplierName}</span>}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 4,
                          }}
                        >
                          {m.expiryDate ? (
                            <div className={styles.batchExpiry}>
                              {formatArabicExpiry(m.expiryDate)}
                            </div>
                          ) : (
                            <span />
                          )}
                          {m.type === "purchase" && m.batchId && (
                            <button
                              type="button"
                              className={styles.batchDeleteBtn}
                              disabled={voidingBatchId === m.batchId}
                              onClick={() => setDelBatch(m)}
                            >
                              حذف
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}

      {/* Item Action Sheet Modal */}
      {activeItemAction && (
        <Modal
          title={`${activeItemAction.productName} ${activeItemAction.flavor ? `(${activeItemAction.flavor})` : ""}`}
          onClose={() => setActiveItemAction(null)}
        >
          <div className={styles.actionCard}>
            <div
              style={{
                padding: "4px 0 10px",
                color: "var(--ink2)",
                fontSize: 13.5,
              }}
            >
              الرصيد بالمخزن حالياً:{" "}
              <b style={{ color: "var(--ink)" }}>
                {formatInventoryStock(activeItemAction)}
              </b>
            </div>

            {/* 1. Add Stock */}
            <button
              type="button"
              className={styles.actionItemBtn}
              onClick={() => {
                const itm = activeItemAction;
                setActiveItemAction(null);
                setSelectedStockProduct({
                  id: itm.productId,
                  name_ar: itm.productName,
                  category: itm.category || "المخزون",
                  unit: itm.unitMode === "weight" ? "kg" : "piece",
                  sell_price_piasters: itm.sellPricePiasters,
                  buy_cost_piasters: itm.buyPricePiasters,
                  is_custom: itm.isCustom ?? false,
                  variants: [
                    {
                      id: itm.variantId,
                      flavor: itm.flavor,
                      pack_qty: itm.packQty,
                      sell_price_piasters: itm.sellPricePiasters,
                      buy_cost_piasters: itm.buyPricePiasters,
                    },
                  ],
                });
                setIsAdding(true);
              }}
            >
              <span style={{ fontSize: 18, color: "var(--br, #5a7d5a)" }}>
                +
              </span>
              <span>إضافة بضاعة جديدة للمخزون</span>
            </button>

            {/* 2. Clear Stock */}
            <button
              type="button"
              className={styles.actionItemBtn}
              onClick={() => {
                const itm = activeItemAction;
                setActiveItemAction(null);
                setClearingItem(itm);
              }}
            >
              <span style={{ fontSize: 16 }}>0️⃣</span>
              <span>تصفير المخزون (تحويل الرصيد لـ 0)</span>
            </button>

            {/* 3. Archive from active inventory */}
            <button
              type="button"
              className={`${styles.actionItemBtn} ${styles.danger}`}
              onClick={() => {
                const itm = activeItemAction;
                setActiveItemAction(null);
                setArchivingItem(itm);
              }}
            >
              <span style={{ fontSize: 16 }}>📦</span>
              <span>إزالة من قائمة المخزون النشطة</span>
            </button>

            <button
              type="button"
              className={styles.actionItemBtn}
              style={{
                justifyContent: "center",
                background: "transparent",
                border: "none",
                marginTop: 4,
              }}
              onClick={() => setActiveItemAction(null)}
            >
              إلغاء
            </button>
          </div>
        </Modal>
      )}

      {/* Delete Batch Confirmation Dialog matching Demo & Image 5 */}
      {delBatch && (
        <Modal title="حذف الإضافة" onClose={() => setDelBatch(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--ink2)" }}>
              الكمية اللي لسه متباعتش منها هتتشال من المخزون.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => setDelBatch(null)}
                style={{
                  padding: "8px 16px",
                  background: "var(--sf2)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  cursor: "pointer",
                  color: "var(--ink)",
                  fontWeight: 600,
                }}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const batchId = delBatch.batchId;
                  setDelBatch(null);
                  if (batchId) {
                    await handleVoidBatch(batchId);
                  }
                }}
                style={{
                  padding: "8px 16px",
                  background: "var(--red, #cf3c3c)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                احذف الإضافة
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Clear Stock Modal */}
      {clearingItem && (
        <ClearStockModal
          item={clearingItem}
          onClose={() => setClearingItem(null)}
          onCleared={() => {
            setClearingItem(null);
            void loadData();
          }}
        />
      )}

      {/* Archive Stock Modal */}
      {archivingItem && (
        <ArchiveStockModal
          item={archivingItem}
          onClose={() => setArchivingItem(null)}
          onArchived={() => {
            setArchivingItem(null);
            void loadData();
          }}
          onOpenClearStock={() => {
            const itm = archivingItem;
            setArchivingItem(null);
            setClearingItem(itm);
          }}
        />
      )}

      {/* Add Stock Modal */}
      {isAdding && (
        <AddStockModal
          options={productOptions}
          targetProduct={selectedStockProduct}
          onClose={() => {
            setIsAdding(false);
            setSelectedStockProduct(null);
          }}
          onAdded={() => {
            setIsAdding(false);
            setSelectedStockProduct(null);
            void loadData();
          }}
        />
      )}
    </div>
  );
}

export default StockView;
