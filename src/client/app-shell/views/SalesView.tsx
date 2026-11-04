"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import viewStyles from "./ViewLayout.module.css";
import styles from "./SalesView.module.css";
import { Empty, SearchBox, Icon } from "../../shared/ui";
import { formatMoney } from "../../shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { useAuth } from "../../shared/auth";
import { db } from "../../shared/db";
import type { StockInventoryItem } from "./StockView";
import type { StoreProductItem } from "./ProductsView";
import { isServiceProduct } from "./ProductsView";

export interface SaleRecord {
  id: string;
  productId: string;
  name: string;
  amountPiasters: number;
  quantity: number;
  category: string;
  unit: string;
  isCarton?: boolean;
  commissionPiasters?: number;
  timestamp: number;
}

interface DisplaySaleItem {
  id: string;
  productId: string;
  name: string;
  sellPricePiasters: number;
  unitMode: "piece" | "weight" | "service";
  packQty: number;
  currentStockBase: number;
  status: "ok" | "low" | "out";
  isService?: boolean;
  category?: string;
  brandName?: string | null;
}

const STORAGE_KEY_PREFIX = "hesba_sales_records";
const STAGED_KEY = "hesba_staged_sale_item";

function getSalesStorageKey(storeId?: string): string {
  return `${STORAGE_KEY_PREFIX}_${storeId || "default"}`;
}

function getServicesStorageKey(storeId?: string): string {
  return `hesba_sales_enabled_services_${storeId || "default"}`;
}

function formatCairoTime(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("ar-EG", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Africa/Cairo",
    });
  } catch {
    const d = new Date(ts);
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = d.getHours() >= 12 ? "م" : "ص";
    return `${h}:${m} ${ampm}`;
  }
}

function formatStockText(item: DisplaySaleItem): string {
  if (item.isService) {
    return item.brandName ? `ماكينة ${item.brandName}` : "خدمة دفع فورية";
  }

  if (item.currentStockBase <= 0) {
    return "خلصان";
  }

  if (item.unitMode === "weight") {
    if (item.currentStockBase >= 1000) {
      const kg = Math.round((item.currentStockBase / 1000) * 10) / 10;
      return `${kg} كجم`;
    }
    return `${item.currentStockBase} جرام`;
  }

  const packQty = item.packQty || 1;
  if (packQty > 1) {
    const cartons = Math.floor(item.currentStockBase / packQty);
    const pieces = item.currentStockBase % packQty;
    if (cartons > 0 && pieces > 0) {
      return `${cartons} كرتونة و ${pieces} قطعة`;
    }
    if (cartons > 0) {
      return `${cartons} كرتونة`;
    }
    return `${pieces} قطعة`;
  }

  return `${item.currentStockBase} قطعة`;
}

function loadInitialData(storeId?: string): {
  initialSales: SaleRecord[];
  initialEnabledServices: string[];
  stagedSaleItem: DisplaySaleItem | null;
} {
  let initialSales: SaleRecord[] = [];
  let initialEnabledServices: string[] = [];
  let stagedSaleItem: DisplaySaleItem | null = null;

  if (typeof window !== "undefined" || typeof localStorage !== "undefined") {
    try {
      const rawSales = localStorage.getItem(getSalesStorageKey(storeId));
      if (rawSales) {
        initialSales = JSON.parse(rawSales);
      }
    } catch {
      // Ignore
    }

    try {
      const rawServices = localStorage.getItem(getServicesStorageKey(storeId));
      if (rawServices) {
        initialEnabledServices = JSON.parse(rawServices);
      }
    } catch {
      // Ignore
    }

    try {
      const rawStaged = sessionStorage?.getItem(STAGED_KEY);
      if (rawStaged) {
        const staged = JSON.parse(rawStaged);
        if (staged && staged.name) {
          const newSale: SaleRecord = {
            id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            productId: staged.id || "manual",
            name: staged.name,
            amountPiasters: Number(staged.sellPricePiasters) || 0,
            quantity: 1,
            category: staged.category || "خدمات",
            unit: staged.unit || "service",
            timestamp: Date.now(),
          };

          initialSales = [newSale, ...initialSales];
          try {
            localStorage.setItem(
              getSalesStorageKey(storeId),
              JSON.stringify(initialSales),
            );
          } catch {
            // Ignore
          }

          if (staged.id && !initialEnabledServices.includes(staged.id)) {
            initialEnabledServices.push(staged.id);
            try {
              localStorage.setItem(
                getServicesStorageKey(storeId),
                JSON.stringify(initialEnabledServices),
              );
            } catch {
              // Ignore
            }
          }

          stagedSaleItem = {
            id: staged.id || "staged",
            productId: staged.id || "staged",
            name: staged.name,
            sellPricePiasters: Number(staged.sellPricePiasters) || 0,
            unitMode: "service",
            packQty: 1,
            currentStockBase: 999,
            status: "ok",
            isService: true,
            category: staged.category,
          };

          sessionStorage.removeItem(STAGED_KEY);
        }
      }
    } catch {
      // Ignore
    }
  }

  return { initialSales, initialEnabledServices, stagedSaleItem };
}

export function SalesView() {
  const { session } = useAuth();
  const storeId = session?.store?.id;

  const initial = useMemo(() => loadInitialData(storeId), [storeId]);
  const [sales, setSales] = useState<SaleRecord[]>(initial.initialSales);
  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [services, setServices] = useState<StoreProductItem[]>([]);
  const [enabledServiceIds] = useState<string[]>(
    initial.initialEnabledServices,
  );
  const [stagedItem] = useState<DisplaySaleItem | null>(initial.stagedSaleItem);

  const [query, setQuery] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);

  // Modals state
  const [weightModalItem, setWeightModalItem] =
    useState<DisplaySaleItem | null>(null);
  const [serviceModalItem, setServiceModalItem] =
    useState<DisplaySaleItem | null>(null);

  // Weight Modal inputs
  const [weightValue, setWeightValue] = useState("");
  const [weightUnit, setWeightUnit] = useState<"g" | "kg">("g");

  // Service Modal inputs
  const [serviceAmountEgp, setServiceAmountEgp] = useState("");

  // Toast with Undo state
  const [activeToast, setActiveToast] = useState<{
    msg: string;
    undoIds: string[];
    restoreQty?: { productId: string; qtyBase: number };
  } | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load Inventory & Products from server / local DB asynchronously
  useEffect(() => {
    let isMounted = true;
    void Promise.all([
      fetch("/api/stock?view=all")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/products?filter=all")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([stockData, prodData]) => {
      if (!isMounted) return;
      if (stockData?.inventory) {
        setInventory(stockData.inventory);
      }
      if (prodData?.products) {
        const allProds: StoreProductItem[] = prodData.products;
        setServices(allProds.filter((p) => isServiceProduct(p)));
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  // Calculate today's sales and total
  const todaySales = useMemo(() => {
    const today = new Date().toDateString();
    return sales.filter((s) => new Date(s.timestamp).toDateString() === today);
  }, [sales]);

  const todayTotalPiasters = useMemo(() => {
    return todaySales.reduce((sum, s) => sum + s.amountPiasters, 0);
  }, [todaySales]);

  // Prepare combined items for the Sales Grid
  const displayItems = useMemo<DisplaySaleItem[]>(() => {
    const list: DisplaySaleItem[] = [];

    // 1. Regular physical products present in inventory
    inventory.forEach((inv) => {
      list.push({
        id: inv.productId,
        productId: inv.productId,
        name: inv.productName,
        sellPricePiasters: inv.sellPricePiasters,
        unitMode: inv.unitMode,
        packQty: inv.packQty || 1,
        currentStockBase: inv.currentStockBase,
        status: inv.currentStockBase <= 0 ? "out" : inv.status || "ok",
        isService: false,
        category: inv.category,
      });
    });

    // 2. Services & Bills that have been added to sales
    services.forEach((srv) => {
      if (enabledServiceIds.includes(srv.id)) {
        list.push({
          id: srv.id,
          productId: srv.id,
          name: srv.name_ar,
          sellPricePiasters: srv.sell_price_piasters,
          unitMode: "service",
          packQty: 1,
          currentStockBase: 999, // Always available
          status: "ok",
          isService: true,
          category: srv.category,
          brandName: srv.brand_name,
        });
      }
    });

    if (stagedItem && !list.some((it) => it.id === stagedItem.id)) {
      list.push(stagedItem);
    }

    return list;
  }, [inventory, services, enabledServiceIds, stagedItem]);

  // Filtered by Search query
  const filteredItems = useMemo(() => {
    const q = normalizeArabic(query.trim());
    if (!q) return displayItems;
    return displayItems.filter((item) => {
      const name = normalizeArabic(item.name || "");
      const cat = normalizeArabic(item.category || "");
      return name.includes(q) || cat.includes(q);
    });
  }, [displayItems, query]);

  // Helper to persist a sale record & deduct stock
  const recordSale = useCallback(
    (params: {
      item: DisplaySaleItem;
      quantityBase: number;
      amountPiasters: number;
      label: string;
      isCarton?: boolean;
      commissionPiasters?: number;
    }) => {
      const {
        item,
        quantityBase,
        amountPiasters,
        label,
        isCarton,
        commissionPiasters,
      } = params;

      const now = Date.now();
      const rand = Math.random().toString(36).slice(2, 7);
      const newSaleId = `sale-${now}-${rand}`;
      const newRecord: SaleRecord = {
        id: newSaleId,
        productId: item.productId,
        name: item.name,
        amountPiasters,
        quantity: quantityBase,
        category: item.category || "عام",
        unit: item.unitMode,
        isCarton,
        commissionPiasters,
        timestamp: now,
      };

      // Update sales state and localStorage
      setSales((prev) => {
        const updated = [newRecord, ...prev];
        try {
          localStorage.setItem(
            getSalesStorageKey(storeId),
            JSON.stringify(updated),
          );
        } catch {
          // Ignore quota error
        }
        return updated;
      });

      // Deduct stock for physical products
      if (!item.isService) {
        setInventory((prev) =>
          prev.map((inv) =>
            inv.productId === item.productId
              ? {
                  ...inv,
                  currentStockBase: Math.max(
                    0,
                    inv.currentStockBase - quantityBase,
                  ),
                }
              : inv,
          ),
        );
      }

      // Flash animation on card
      setFlashId(item.id);
      setTimeout(() => setFlashId(null), 450);

      // Show toast with Undo
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActiveToast({
        msg: `${item.name} — ${label} — ${formatMoney(amountPiasters)}`,
        undoIds: [newSaleId],
        restoreQty: !item.isService
          ? { productId: item.productId, qtyBase: quantityBase }
          : undefined,
      });
      toastTimerRef.current = setTimeout(() => {
        setActiveToast(null);
      }, 4800);

      // Background write to Dexie for offline-first PWA resilience
      try {
        if (db?.sales && db?.sale_lines) {
          const isoNow = new Date(now).toISOString();
          void db.sales
            .add({
              id: newSaleId,
              store_id: storeId || "default",
              device_id: "local-device",
              cashier_id: null,
              total_minor: amountPiasters,
              discount_minor: 0,
              paid_minor: amountPiasters,
              payment_method: "cash",
              is_voided: false,
              voided_at: null,
              created_at: isoNow,
              updated_at: isoNow,
            })
            .catch(() => {});

          void db.sale_lines
            .add({
              id: `line-${now}`,
              sale_id: newSaleId,
              store_variant_id: item.productId,
              unit_mode: item.unitMode === "weight" ? "weight" : "piece",
              quantity_base: quantityBase,
              unit_price_minor: amountPiasters,
              total_minor: amountPiasters,
              created_at: isoNow,
            })
            .catch(() => {});
        }
      } catch {
        // Ignore
      }
    },
    [storeId],
  );

  // Undo / Revert a sale
  const handleUndo = (
    saleIds: string[],
    restore?: { productId: string; qtyBase: number },
  ) => {
    setSales((prev) => {
      const updated = prev.filter((s) => !saleIds.includes(s.id));
      try {
        localStorage.setItem(
          getSalesStorageKey(storeId),
          JSON.stringify(updated),
        );
      } catch {
        // Ignore
      }
      return updated;
    });

    if (restore) {
      setInventory((prev) =>
        prev.map((inv) =>
          inv.productId === restore.productId
            ? {
                ...inv,
                currentStockBase: inv.currentStockBase + restore.qtyBase,
              }
            : inv,
        ),
      );
    }

    setActiveToast(null);
  };

  // Tap handler for a Card
  const handleCardClick = (item: DisplaySaleItem) => {
    // 1. Service product
    if (item.isService) {
      // If service is variable (utility charging, topup, transfer)
      const name = item.name.toLowerCase();
      const cat = (item.category || "").toLowerCase();
      const isVariable =
        name.includes("كهرباء") ||
        name.includes("مياه") ||
        name.includes("غاز") ||
        name.includes("تحويل") ||
        name.includes("شحن رصيد") ||
        cat.includes("مرافق") ||
        cat.includes("تحويل");

      if (isVariable) {
        setServiceModalItem(item);
        setServiceAmountEgp("");
        return;
      }

      // Fixed card (e.g. كارت 10 ج)
      recordSale({
        item,
        quantityBase: 1,
        amountPiasters: item.sellPricePiasters || 1000,
        label: "1 كارت",
      });
      return;
    }

    // 2. Physical product out of stock
    if (item.currentStockBase <= 0) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActiveToast({
        msg: `${item.name} خلصان — ضيفه من المخزون`,
        undoIds: [],
      });
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 3000);
      return;
    }

    // 3. Weighed product
    if (item.unitMode === "weight") {
      setWeightModalItem(item);
      setWeightValue("");
      setWeightUnit("g");
      return;
    }

    // 4. Single piece sale
    recordSale({
      item,
      quantityBase: 1,
      amountPiasters: item.sellPricePiasters,
      label: "1 قطعة",
    });
  };

  // Sell full carton
  const handleSellCarton = (e: React.MouseEvent, item: DisplaySaleItem) => {
    e.stopPropagation();
    const packQty = item.packQty || 1;

    if (item.currentStockBase < packQty) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActiveToast({
        msg: `مفيش كرتونة كاملة من ${item.name} — المتاح ${item.currentStockBase} قطعة`,
        undoIds: [],
      });
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 3500);
      return;
    }

    const cartonPricePiasters = item.sellPricePiasters * packQty;
    recordSale({
      item,
      quantityBase: packQty,
      amountPiasters: cartonPricePiasters,
      label: "1 كرتونة",
      isCarton: true,
    });
  };

  // Submit Weight Sale
  const handleWeightSubmit = () => {
    if (!weightModalItem) return;
    const num = parseFloat(weightValue) || 0;
    if (num <= 0) return;

    const grams =
      weightUnit === "kg" ? Math.round(num * 1000) : Math.round(num);
    const kg = grams / 1000;

    if (grams > weightModalItem.currentStockBase) return;

    const amountPiasters = Math.round(kg * weightModalItem.sellPricePiasters);
    const label = grams >= 1000 ? `${kg} كجم` : `${grams} جرام`;

    recordSale({
      item: weightModalItem,
      quantityBase: grams,
      amountPiasters,
      label,
    });

    setWeightModalItem(null);
  };

  // Submit Service Sale
  const handleServiceSubmit = () => {
    if (!serviceModalItem) return;
    const amountEgp = parseFloat(serviceAmountEgp) || 0;
    if (amountEgp <= 0) return;

    const amountPiasters = Math.round(amountEgp * 100);
    // Commission: either from product config or standard Egyptian retail fee (e.g. 5 EGP)
    const commissionPiasters =
      serviceModalItem.sellPricePiasters > 0
        ? serviceModalItem.sellPricePiasters
        : 500; // 5 EGP default

    const totalCustomerPiasters = amountPiasters + commissionPiasters;

    recordSale({
      item: serviceModalItem,
      quantityBase: 1,
      amountPiasters: totalCustomerPiasters,
      label: `شحن ${amountEgp} ج.م`,
      commissionPiasters,
    });

    setServiceModalItem(null);
  };

  // Weight modal calculations
  const weightNum = parseFloat(weightValue) || 0;
  const weightGrams =
    weightUnit === "kg" ? Math.round(weightNum * 1000) : Math.round(weightNum);
  const weightKg = weightGrams / 1000;
  const weightAmountEgp =
    weightModalItem && weightKg > 0
      ? Math.round(weightKg * (weightModalItem.sellPricePiasters / 100) * 100) /
        100
      : 0;
  const weightExceedsStock =
    weightModalItem && weightGrams > weightModalItem.currentStockBase;

  // Service modal calculations
  const serviceAmountNum = parseFloat(serviceAmountEgp) || 0;
  const serviceCommissionEgp =
    serviceModalItem && serviceModalItem.sellPricePiasters > 0
      ? serviceModalItem.sellPricePiasters / 100
      : 5;
  const serviceTotalEgp =
    serviceAmountNum > 0 ? serviceAmountNum + serviceCommissionEgp : 0;

  return (
    <div className={viewStyles.view} data-testid="page-sales" dir="rtl">
      <div className={styles.salesContainer}>
        {/* Search Box matching Image 1 */}
        <div className={styles.searchWrapper}>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="دوّر على صنف..."
            voice={true}
          />
        </div>

        {/* Today's Sales Pill & Legend matching Image 1 */}
        <div className={styles.sBar}>
          <div className={styles.sTotal} data-testid="today-sales-pill">
            <span className={styles.sTotalLabel}>مبيعات النهارده</span>
            <b className={styles.sTotalAmount}>
              {formatMoney(todayTotalPiasters)}
            </b>
          </div>

          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <i className={`${styles.legendBox} ${styles.out}`} />
              <span>خلصان</span>
            </span>
            <span className={styles.legendItem}>
              <i className={`${styles.legendBox} ${styles.low}`} />
              <span>قرب يخلص</span>
            </span>
          </div>
        </div>

        {/* Product & Services Tiles Grid matching Image 1 */}
        {filteredItems.length === 0 ? (
          <div className={viewStyles.card}>
            <Empty
              icon="search"
              title={
                query
                  ? "مفيش صنف بالاسم ده"
                  : "لسه مفيش منتجات أو خدمات في البيع"
              }
              sub={
                query
                  ? "تأكد من كتابة اسم المنتج بشكل صحيح"
                  : "ضيف بضاعة في المخزون أو اضغط «إضافة إلى البيع» على أي خدمة من قسم المنتجات"
              }
            />
          </div>
        ) : (
          <div className={styles.tgrid}>
            {filteredItems.map((item) => {
              const isLow = item.status === "low";
              const isOut = item.status === "out";
              const isPop = flashId === item.id;
              const hasCartonBtn =
                !item.isService &&
                item.unitMode === "piece" &&
                item.packQty > 1 &&
                !isOut;

              return (
                <div
                  key={item.id}
                  className={`${styles.tile} ${isLow ? styles.low : ""} ${isOut ? styles.out : ""} ${isPop ? styles.pop : ""}`}
                >
                  <button
                    type="button"
                    className={styles.tMain}
                    onClick={() => handleCardClick(item)}
                    aria-label={`بيع ${item.name}`}
                  >
                    <span className={styles.tN}>{item.name}</span>

                    <span className={styles.tP}>
                      {item.unitMode === "weight" ? (
                        <>
                          <Icon n="scale" s={14} />
                          <span>{item.sellPricePiasters / 100} ج / كجم</span>
                        </>
                      ) : item.isService ? (
                        <span>
                          {item.sellPricePiasters > 0
                            ? `عمولة ${item.sellPricePiasters / 100} ج`
                            : "شحن فوري"}
                        </span>
                      ) : (
                        <span>{item.sellPricePiasters / 100} ج</span>
                      )}
                    </span>

                    <span className={styles.tS}>{formatStockText(item)}</span>
                  </button>

                  {/* Carton Button matching Image 1 */}
                  {hasCartonBtn && (
                    <button
                      type="button"
                      className={styles.tPack}
                      onClick={(e) => handleSellCarton(e, item)}
                      title={`بيع كرتونة ${item.packQty} قطعة`}
                      aria-label={`بيع كرتونة ${item.name}`}
                    >
                      <Icon n="box" s={16} />
                      <span>كرتونة</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Recent Sales List matching Image 3 */}
        <div className={styles.recentSection}>
          <h3 className={styles.recentTitle}>آخر البيعات</h3>
          {todaySales.length === 0 ? (
            <div
              style={{
                color: "var(--ink2)",
                fontSize: 13.5,
                padding: "10px 2px",
              }}
            >
              لسه مفيش مبيعات اتسجلت النهارده
            </div>
          ) : (
            <div className={styles.recentList}>
              {todaySales.slice(0, 8).map((sale) => (
                <div key={sale.id} className={styles.rcRow}>
                  <span className={styles.rcName}>{sale.name}</span>
                  <div className={styles.rcMeta}>
                    <span className={styles.rcTime}>
                      {formatCairoTime(sale.timestamp)}
                    </span>
                    <b className={styles.rcAmount}>
                      {formatMoney(sale.amountPiasters)}
                    </b>
                    <button
                      type="button"
                      className={styles.rcUndoBtn}
                      onClick={() =>
                        handleUndo([sale.id], {
                          productId: sale.productId,
                          qtyBase: sale.quantity,
                        })
                      }
                      title="تراجع عن هذه العملية"
                    >
                      <Icon n="undo" s={12} />
                      <span>تراجع</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Weight Modal Popup matching Image 2 */}
      {weightModalItem && (
        <>
          <div
            className={styles.wpShield}
            onClick={() => setWeightModalItem(null)}
          />
          <div className={styles.wpop} role="dialog" aria-modal="true">
            <div className={styles.wpHeader}>
              <span className={styles.wpTitle}>{weightModalItem.name}</span>
              <span className={styles.wpSubtitle}>
                {weightModalItem.sellPricePiasters / 100} ج / كجم
              </span>
            </div>

            <div className={styles.wpRow}>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                className={styles.wpInput}
                placeholder="الوزن"
                value={weightValue}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0.0-9.]/g, "");
                  setWeightValue(cleaned);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    weightNum > 0 &&
                    !weightExceedsStock
                  ) {
                    handleWeightSubmit();
                  }
                }}
              />

              <div className={styles.wpSeg}>
                <button
                  type="button"
                  className={`${styles.wpSegBtn} ${weightUnit === "g" ? styles.active : ""}`}
                  onClick={() => {
                    setWeightUnit("g");
                    setWeightValue("");
                  }}
                >
                  جرام
                </button>
                <button
                  type="button"
                  className={`${styles.wpSegBtn} ${weightUnit === "kg" ? styles.active : ""}`}
                  onClick={() => {
                    setWeightUnit("kg");
                    setWeightValue("");
                  }}
                >
                  كيلو
                </button>
              </div>
            </div>

            {/* Quick Chips matching Image 2 */}
            <div className={styles.wpChips}>
              {weightUnit === "g" ? (
                <>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("100")}
                  >
                    100
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("250")}
                  >
                    250
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("500")}
                  >
                    500
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("1000")}
                  >
                    1000
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("0.25")}
                  >
                    0.25
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("0.5")}
                  >
                    0.5
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("1")}
                  >
                    1
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("2")}
                  >
                    2
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              className={styles.wpActionBtn}
              disabled={!(weightNum > 0) || !!weightExceedsStock}
              onClick={handleWeightSubmit}
            >
              {weightExceedsStock
                ? `المتاح ${formatStockText(weightModalItem)}`
                : weightNum > 0
                  ? `بيع — ${weightAmountEgp} ج.م`
                  : "اكتب الوزن"}
            </button>
          </div>
        </>
      )}

      {/* Service Sale Modal Popup */}
      {serviceModalItem && (
        <>
          <div
            className={styles.wpShield}
            onClick={() => setServiceModalItem(null)}
          />
          <div className={styles.wpop} role="dialog" aria-modal="true">
            <div className={styles.wpHeader}>
              <span className={styles.wpTitle}>{serviceModalItem.name}</span>
              <span className={styles.wpSubtitle}>
                {serviceModalItem.brandName || "دفع إلكتروني"}
              </span>
            </div>

            <div className={styles.wpRow}>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                className={styles.wpInput}
                placeholder="المبلغ المطلوب (ج.م)"
                value={serviceAmountEgp}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9.]/g, "");
                  setServiceAmountEgp(cleaned);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && serviceAmountNum > 0) {
                    handleServiceSubmit();
                  }
                }}
              />
            </div>

            {/* Quick Chips for Services */}
            <div className={styles.wpChips}>
              <button
                type="button"
                className={styles.wpChip}
                onClick={() => setServiceAmountEgp("50")}
              >
                50
              </button>
              <button
                type="button"
                className={styles.wpChip}
                onClick={() => setServiceAmountEgp("100")}
              >
                100
              </button>
              <button
                type="button"
                className={styles.wpChip}
                onClick={() => setServiceAmountEgp("200")}
              >
                200
              </button>
              <button
                type="button"
                className={styles.wpChip}
                onClick={() => setServiceAmountEgp("500")}
              >
                500
              </button>
            </div>

            {/* Live Commission Breakdown */}
            {serviceAmountNum > 0 && (
              <div className={styles.serviceBreakdown}>
                <div className={styles.serviceBreakdownRow}>
                  <span>مبلغ الشحن / المعاملة:</span>
                  <b>{serviceAmountNum} ج.م</b>
                </div>
                <div className={styles.serviceBreakdownRow}>
                  <span>عمولة المحل:</span>
                  <b style={{ color: "var(--br, #8db68a)" }}>
                    + {serviceCommissionEgp} ج.م
                  </b>
                </div>
                <div
                  className={`${styles.serviceBreakdownRow} ${styles.total}`}
                >
                  <span>المطلوب من الزبون:</span>
                  <b>{serviceTotalEgp} ج.م</b>
                </div>
              </div>
            )}

            <button
              type="button"
              className={styles.wpActionBtn}
              disabled={!(serviceAmountNum > 0)}
              onClick={handleServiceSubmit}
            >
              {serviceAmountNum > 0
                ? `تأكيد وتسجيل العملية — ${serviceTotalEgp} ج.م`
                : "اكتب المبلغ المطلوب"}
            </button>
          </div>
        </>
      )}

      {/* Floating Bottom Toast with Undo matching Image 1 */}
      {activeToast && (
        <div className={styles.toastBar}>
          <div className={styles.toastMsg}>
            <Icon n="check" s={18} />
            <span>{activeToast.msg}</span>
          </div>
          {activeToast.undoIds.length > 0 && (
            <button
              type="button"
              className={styles.toastUndoBtn}
              onClick={() =>
                handleUndo(activeToast.undoIds, activeToast.restoreQty)
              }
            >
              <Icon n="undo" s={14} />
              <span>تراجع</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default SalesView;
