"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Chip,
  Chips,
  Empty,
  SearchBox,
  Modal,
  Icon,
  PeriodFilter,
  ListSkeleton,
  useToast,
} from "@/client/shared/ui";
import {
  cairoDateRange,
  inCairoRange,
  type DatePreset,
} from "@/domain/date-range";
import { toCairoDateString } from "@/domain/time";
import { isServiceProduct as isServiceProductRule } from "@/domain/sale-pricing";
import { formatMoney } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { AddStockModal, type StockProductOption } from "./AddStockModal";
import { RecordLossModal } from "./RecordLossModal";
import { ArchiveStockModal } from "./ArchiveStockModal";
import {
  type PosMachine,
  getStoredMachines,
  fetchStoreMachines,
} from "@/client/shared/api/machines";
import { useAuth } from "@/client/shared/auth";
import { MachineTopupModal } from "./MachineTopupModal";
import {
  type StoreProductItem,
  type StockInventoryItem,
  isServiceProduct,
} from "@/client/shared/store-items";
import styles from "./StockView.module.css";

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

const STOCK_HISTORY_PERIODS: ReadonlyArray<readonly [DatePreset, string]> = [
  ["today", "اليوم"],
  ["yesterday", "امبارح"],
  ["week", "الأسبوع"],
  ["month", "الشهر"],
  ["year", "السنة"],
  ["custom", "فترة مخصصة"],
];

/**
 * Stock lists goods on the shelf only. Services (transfers, top-ups, bills, cards) have no
 * stock: they are sold from the Sales screen against a POS machine's balance; the machines and
 * their balances stay here.
 */
function physicalOnly(
  items: StockInventoryItem[] | undefined,
): StockInventoryItem[] {
  return (items ?? []).filter(
    (i) =>
      !isServiceProductRule({
        category: i.category ?? null,
        unit: i.unit ?? null,
      }),
  );
}

export function StockView() {
  const toast = useToast();
  const [tab, setTab] = useState<"qty" | "log">("qty");
  const [filter, setFilter] = useState<"all" | "low" | "out" | "nearExpiry">(
    "all",
  );
  const [period, setPeriod] = useState<DatePreset>("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [activeItemAction, setActiveItemAction] =
    useState<StockInventoryItem | null>(null);
  const [lossTarget, setLossTarget] = useState<{
    item: StockInventoryItem;
    reason?: "expired" | "damaged" | "missing" | "other";
    batchId?: string | null;
  } | null>(null);
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

  const { session } = useAuth();
  const storeId = session?.store?.id;

  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [storeProducts, setStoreProducts] = useState<StoreProductItem[]>([]);
  const [movements, setMovements] = useState<StockMovementItem[]>([]);
  const [machines, setMachines] = useState<PosMachine[]>(() => {
    return getStoredMachines(storeId);
  });
  const [topupMachine, setTopupMachine] = useState<PosMachine | null>(null);
  const [topupInitialMode, setTopupInitialMode] = useState<"topup" | "adjust">(
    "topup",
  );

  // Listen for pos machine updates across tabs and views & fetch from DB
  useEffect(() => {
    let isMounted = true;
    // Wait for the signed-in shop: running first without it and again with it loaded
    // everything twice (QA-32 request audit), and the local caches are keyed by shop.
    if (storeId) {
      void fetchStoreMachines(storeId).then((remote) => {
        if (isMounted && remote) {
          setMachines(remote);
        }
      });
    }

    const handleMachinesUpdate = () => {
      setMachines(getStoredMachines(storeId));
    };
    if (typeof window !== "undefined") {
      window.addEventListener("hesba_machines_updated", handleMachinesUpdate);
      return () => {
        isMounted = false;
        window.removeEventListener(
          "hesba_machines_updated",
          handleMachinesUpdate,
        );
      };
    }
  }, [storeId]);

  const loadData = useCallback(async () => {
    try {
      const [stockRes, prodRes] = await Promise.all([
        apiGet("/api/stock?view=all"),
        apiGet("/api/products?filter=all").catch(() => null),
      ]);
      if (!stockRes.ok) throw new Error("فشل تحميل بيانات المخزون");
      const data = await stockRes.json();
      setInventory(physicalOnly(data.inventory));
      setMovements(data.movements || []);

      if (prodRes && prodRes.ok) {
        const prodData = await prodRes.json();
        setStoreProducts(prodData.products || []);
      }
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
        const [stockRes, prodRes] = await Promise.all([
          apiGet("/api/stock?view=all"),
          apiGet("/api/products?filter=all").catch(() => null),
        ]);
        if (!stockRes.ok) throw new Error("فشل تحميل بيانات المخزون");
        const data = await stockRes.json();
        if (!ignore) {
          setInventory(physicalOnly(data.inventory));
          setMovements(data.movements || []);
        }
        if (!ignore && prodRes && prodRes.ok) {
          const prodData = await prodRes.json();
          setStoreProducts(prodData.products || []);
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

  // Physical inventory valuation at cost
  const physicalValuationPiasters = useMemo(() => {
    return inventory.reduce((sum, item) => {
      if (item.currentStockBase <= 0) return sum;
      if (
        item.category === "كروت شحن" ||
        item.category === "خدمات مرافق" ||
        item.productName.includes("كارت شحن")
      ) {
        return sum;
      }
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

  // Provider balances across all POS machines
  const totalProviderBalancesPiasters = useMemo(() => {
    return machines.reduce(
      (sum, m) => sum + (m.currentBalancePiasters || 0),
      0,
    );
  }, [machines]);

  // Total working capital (physical goods + scratch cards + provider balances)
  const totalWorkingCapitalPiasters =
    physicalValuationPiasters + totalProviderBalancesPiasters;

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

  // Options for AddStockModal dropdown - includes ALL products from Products page + inventory
  const productOptions: StockProductOption[] = useMemo(() => {
    const invMap = new Map<string, StockInventoryItem>();
    inventory.forEach((i) => {
      invMap.set(i.variantId, i);
      invMap.set(i.productId, i);
    });

    const options: StockProductOption[] = [];
    const seenIds = new Set<string>();

    // 1. Physical products present in the store's Products list
    storeProducts
      .filter((p) => !isServiceProduct(p))
      .forEach((p) => {
        const v = p.variants?.[0];
        const vId = v?.id || p.id;
        seenIds.add(vId);
        seenIds.add(p.id);

        const invItem = invMap.get(vId) || invMap.get(p.id);
        const isWeight =
          p.unit === "weight" ||
          p.unit === "kg" ||
          p.unit === "g" ||
          invItem?.unitMode === "weight";

        options.push({
          variantId: vId,
          productId: p.id,
          productName: p.name_ar,
          flavor: v?.flavor || invItem?.flavor,
          unitMode: isWeight ? "weight" : "piece",
          packQty: v?.pack_qty || invItem?.packQty || 12,
          currentStockBase:
            invItem?.currentStockBase ?? (p.stock_quantity || 0),
          buyCostPiasters:
            invItem?.buyPricePiasters ||
            p.buy_cost_piasters ||
            v?.buy_cost_piasters,
          unit: p.unit,
          category: p.category,
        });
      });

    // 2. Any additional items that were in inventory directly
    inventory.forEach((i) => {
      if (!seenIds.has(i.variantId) && !seenIds.has(i.productId)) {
        options.push({
          variantId: i.variantId,
          productId: i.productId,
          productName: i.productName,
          flavor: i.flavor,
          unitMode: i.unitMode,
          packQty: i.packQty,
          currentStockBase: i.currentStockBase,
          buyCostPiasters: i.buyPricePiasters,
          unit: i.unit || (i.unitMode === "weight" ? "kg" : "piece"),
          category: i.category,
        });
      }
    });

    return options;
  }, [inventory, storeProducts]);

  const historyRange = useMemo(
    () =>
      cairoDateRange(
        { preset: period, from: customFrom, to: customTo },
        nowTimestamp,
      ),
    [period, customFrom, customTo, nowTimestamp],
  );

  // Tab 2 movements filtered by selected period (additions / purchases log)
  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      // Show additions (purchases) in the additions log
      if (m.type !== "purchase" && m.quantityBase <= 0) return false;
      // A sale undo puts sold stock back; it is not a purchase or an addition (ADR-0022).
      if (m.type === "sale_void") return false;

      // Cairo calendar days (the shop's business day), not the device's clock.
      return inCairoRange(m.createdAt, historyRange);
    });
  }, [movements, historyRange]);

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
          <Icon n="plus" s={18} />
          <span>إضافة بضاعة للمخزون</span>
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
          <Chips>
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              الكل
            </Chip>
            <Chip active={filter === "low"} onClick={() => setFilter("low")}>
              قرب يخلص ({counts.low})
            </Chip>
            <Chip active={filter === "out"} onClick={() => setFilter("out")}>
              خلصان ({counts.out})
            </Chip>
            {counts.nearExpiry > 0 && (
              <Chip
                active={filter === "nearExpiry"}
                onClick={() => setFilter("nearExpiry")}
              >
                صلاحية قريبة ({counts.nearExpiry})
              </Chip>
            )}
          </Chips>

          {loading ? (
            <ListSkeleton label="بيحمّل المخزون…" />
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
                  // The card opens its actions (edit, add stock, clear, remove); no separate
                  // edit button.
                  role="button"
                  tabIndex={0}
                  aria-label={item.productName}
                  onClick={() => setActiveItemAction(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveItemAction(item);
                    }
                  }}
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

          {/* POS Machines & Providers Section */}
          <div
            className={styles.machinesSection}
            data-testid="stock-pos-machines-section"
          >
            <div className={styles.machinesSectionHeader}>
              <div className={styles.machinesSectionTitle}>
                <Icon n="store" s={18} />
                <span>أرصدة ماكينات الدفع ومقدمي الخدمة</span>
              </div>
              <span className={styles.machinesBadge}>
                {machines.length} ماكينات
              </span>
            </div>

            <div className={styles.machinesList}>
              {machines.length === 0 ? (
                <div
                  style={{
                    padding: "20px 16px",
                    textAlign: "center",
                    color: "var(--color-text-secondary, #666)",
                    fontSize: "0.88rem",
                    backgroundColor: "var(--color-bg-subtle, #f9fafb)",
                    borderRadius: "10px",
                    border: "1px dashed var(--color-border, #e5e7eb)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Icon n="store" s={24} />
                  <span>لا توجد ماكينات دفع مسجلة لهذا المتجر</span>
                  <span
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--color-text-tertiary, #999)",
                    }}
                  >
                    يمكنك إضافة ماكينات الدفع المخصصة لمتجرك من قسم الفواتير
                    والشحن في صفحة المنتجات
                  </span>
                </div>
              ) : (
                machines.map((m) => (
                  <div key={m.id} className={styles.machineCard}>
                    <div className={styles.machineCardInfo}>
                      <div className={styles.machineCardTitleRow}>
                        <span className={styles.machineName}>{m.name}</span>
                        <span className={styles.machineProviderBadge}>
                          {m.provider}
                        </span>
                      </div>
                      {m.terminalId && (
                        <span className={styles.machineMeta}>
                          معرف: {m.terminalId}
                        </span>
                      )}
                    </div>

                    <div className={styles.machineCardActions}>
                      <div className={styles.machineBalanceCol}>
                        <span className={styles.machineBalanceLabel}>
                          الرصيد المتاح
                        </span>
                        <b className={styles.machineBalanceValue}>
                          {formatMoney(m.currentBalancePiasters || 0)}
                        </b>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        <button
                          type="button"
                          className={styles.machineTopupBtn}
                          onClick={() => {
                            setTopupInitialMode("topup");
                            setTopupMachine(m);
                          }}
                        >
                          <Icon n="plus" s={14} />
                          <span>شحن</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTopupInitialMode("adjust");
                            setTopupMachine(m);
                          }}
                          title="تعديل وتصحيح الرصيد"
                          style={{
                            background: "var(--sf)",
                            border: "1.5px solid var(--line)",
                            borderRadius: 8,
                            padding: "6px 9px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            color: "var(--ink2)",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Icon n="edit" s={13} />
                          <span>تعديل</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Tab 2: Additions Log matching Image 5 */
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PeriodFilter<DatePreset>
            options={STOCK_HISTORY_PERIODS}
            value={period}
            onChange={setPeriod}
            customKey="custom"
            from={customFrom}
            to={customTo}
            onRangeChange={(f, t) => {
              setCustomFrom(f);
              setCustomTo(t);
            }}
            max={toCairoDateString(nowTimestamp)}
          />

          {/* Summary Row matching Image 5 */}
          <div className={styles.summaryRow}>
            <span>{movementSummary.count} إضافة</span>
            {movementSummary.totalPiasters > 0 && (
              <b>{formatMoney(movementSummary.totalPiasters)}</b>
            )}
          </div>

          {loading ? (
            <ListSkeleton label="بيحمّل سجل الإضافات…" />
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

      {/* Stock Valuation Summary Card at the very bottom of the page */}
      <div
        className={styles.valuationSummaryCard}
        data-testid="stock-valuation-card"
      >
        <div className={styles.valCardHeader}>
          <div className={styles.valCardTitle}>
            <div className={styles.valCardIcon}>
              <Icon n="wallet" s={18} />
            </div>
            <div>
              <h3>تقييم إجمالي البضاعة ورؤوس الأموال</h3>
              <p className={styles.valCardSubtitle}>
                مجموع القيمة المالية للمخزون الفعلي وأرصدة التشغيل بالمحل
              </p>
            </div>
          </div>
          <span className={styles.valTimestamp}>
            حُسبت في:{" "}
            {new Date(nowTimestamp).toLocaleTimeString("ar-EG", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        {/* Hero Total Banner */}
        <div className={styles.valHeroCard}>
          <div className={styles.valHeroInner}>
            <span className={styles.valTotalLabel}>
              إجمالي رأس المال والأرصدة:
            </span>
            <div className={styles.valHeroAmount}>
              <b className={styles.valTotalValue}>
                {formatMoney(totalWorkingCapitalPiasters)}
              </b>
              <span className={styles.valHeroCurrency}>ج.م</span>
            </div>
          </div>
        </div>

        {/* 3-Cards Breakdown Grid */}
        <div className={styles.valBreakdownGrid}>
          <div className={styles.valItemCard}>
            <div className={styles.valItemHeader}>
              <span className={styles.valItemEmoji}>📦</span>
              <span className={styles.valRowLabel}>
                قيمة بضاعة المخزون المادي (بسعر الشراء):
              </span>
            </div>
            <div className={styles.valItemValue}>
              <b className={styles.valRowValue}>
                {formatMoney(physicalValuationPiasters)}
              </b>
              <span className={styles.valCurrencySmall}>ج.م</span>
            </div>
            <span className={styles.valItemHint}>
              وفقاً لتكلفة الشراء المسجلة بالدفعات
            </span>
          </div>

          <div className={styles.valItemCard}>
            <div className={styles.valItemHeader}>
              <span className={styles.valItemEmoji}>📱</span>
              <span className={styles.valRowLabel}>
                أرصدة ماكينات الدفع ومقدمي الخدمة (أموال تشغيل):
              </span>
            </div>
            <div className={styles.valItemValue}>
              <b className={styles.valRowValue}>
                {formatMoney(totalProviderBalancesPiasters)}
              </b>
              <span className={styles.valCurrencySmall}>ج.م</span>
            </div>
            <span className={styles.valItemHint}>
              أرصدة ماكينات الكاشير والتحصيل
            </span>
          </div>
        </div>

        <p className={styles.valDisclaimer}>
          * الحساب تقديري بناءً على أسعار الشراء المسجلة بالدفعات وأرصدة
          الماكينات المحدثة، ومفصول تماماً بين البضاعة المادية وأرصدة الخدمات.
        </p>
      </div>

      {/* Machine Topup / Adjust Modal */}
      {topupMachine && (
        <MachineTopupModal
          machine={topupMachine}
          storeId={storeId}
          initialMode={topupInitialMode}
          onClose={() => setTopupMachine(null)}
          onSuccess={() => {
            setMachines(getStoredMachines(storeId));
          }}
        />
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

            {/* 2. Add Stock */}
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
                  // The product's own selling unit (bag, can, kg…), not a piece/weight guess.
                  unit:
                    itm.unit || (itm.unitMode === "weight" ? "kg" : "piece"),
                  sell_price_piasters: itm.sellPricePiasters,
                  buy_cost_piasters: itm.buyPricePiasters,
                  is_custom: itm.isCustom ?? false,
                  variants: [
                    {
                      id: itm.variantId,
                      flavor: itm.flavor,
                      pack_qty: itm.packQty,
                      size_unit: itm.packName ?? undefined,
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

            {/* 2. Damaged / lost goods (no free quantity editing, P4) */}
            <button
              type="button"
              className={styles.actionItemBtn}
              data-testid="stock-action-loss"
              onClick={() => {
                const itm = activeItemAction;
                setActiveItemAction(null);
                setLossTarget({ item: itm });
              }}
            >
              <span style={{ fontSize: 16 }}>⚠️</span>
              <span>سجّل تالف / فاقد</span>
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

      {/* Damaged / lost goods */}
      {lossTarget && (
        <RecordLossModal
          item={lossTarget.item}
          presetReason={lossTarget.reason}
          presetBatchId={lossTarget.batchId}
          onClose={() => setLossTarget(null)}
          onSaved={(message) => {
            setLossTarget(null);
            toast.show({ msg: message, kind: "ok" });
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
          onOpenEditQuantity={() => {
            const itm = archivingItem;
            setArchivingItem(null);
            setLossTarget({ item: itm, reason: "missing" });
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
