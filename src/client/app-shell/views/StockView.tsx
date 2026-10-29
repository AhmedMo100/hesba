"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, SearchBox, Button, Seg } from "../../shared/ui";
import { t, formatMoney } from "../../shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { AddStockModal, type StockProductOption } from "./AddStockModal";
import styles from "./StockView.module.css";

export interface StockInventoryItem {
  variantId: string;
  productId: string;
  productName: string;
  flavor?: string | null;
  unitMode: "piece" | "weight";
  packQty: number;
  sellPricePiasters: number;
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
  variantId: string;
  productName: string;
  type: string;
  quantityBase: number;
  costPricePiasters?: number | null;
  balanceAfterBase?: number | null;
  negative: boolean;
  batchCode?: string | null;
  expiryDate?: string | null;
  createdAt: string;
}

export function StockView() {
  const [tab, setTab] = useState<"qty" | "log">("qty");
  const [filter, setFilter] = useState<"all" | "low" | "out" | "expiry">("all");
  const [query, setQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    fetch("/api/stock?view=all")
      .then((res) => {
        if (!res.ok) throw new Error("فشل تحميل بيانات المخزون");
        return res.json();
      })
      .then((data) => {
        if (!ignore) {
          setInventory(data.inventory || []);
          setMovements(data.movements || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Failed to load stock data:", err);
          setError("تعذر تحميل المخزون، برجاء التحقق من الاتصال");
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const counts = useMemo(() => {
    const out = inventory.filter((i) => i.currentStockBase <= 0).length;
    const low = inventory.filter(
      (i) => i.status === "low" || i.status === "out",
    ).length;
    const expiry = inventory.filter((i) => i.hasNearExpiry).length;
    return { out, low, expiry };
  }, [inventory]);

  const filteredInventory = useMemo(() => {
    const normQ = normalizeArabic(query.trim());
    return inventory.filter((item) => {
      if (normQ) {
        const normName = normalizeArabic(item.productName || "");
        const normFlavor = normalizeArabic(item.flavor || "");
        if (!normName.includes(normQ) && !normFlavor.includes(normQ)) {
          return false;
        }
      }

      if (filter === "out") return item.currentStockBase <= 0;
      if (filter === "low")
        return item.status === "low" || item.status === "out";
      if (filter === "expiry") return item.hasNearExpiry;
      return true;
    });
  }, [inventory, query, filter]);

  const productOptions: StockProductOption[] = useMemo(() => {
    return inventory.map((i) => ({
      variantId: i.variantId,
      productId: i.productId,
      productName: i.productName,
      flavor: i.flavor,
      unitMode: i.unitMode,
      packQty: i.packQty,
      currentStockBase: i.currentStockBase,
    }));
  }, [inventory]);

  const formatQuantity = (item: StockInventoryItem) => {
    if (item.currentStockBase <= 0) return "خلصان";
    if (item.unitMode === "weight") {
      return `${(item.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
    }
    return `${item.currentStockBase} قطعة`;
  };

  return (
    <div className={styles.view} data-testid="page-stock">
      {/* Header */}
      <div className={styles.phead}>
        <div>
          <h1>{t("pages.stock.title")}</h1>
          <p>الكميات الحالية وسجل اللي دخل</p>
        </div>
        <div className={styles.pact}>
          <Button
            kind="primary"
            icon="plus"
            onClick={() => setIsAdding(true)}
            data-testid="add-stock-btn"
          >
            {t("pages.stock.addGoods")}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Seg
        value={tab}
        onChange={(v) => setTab(v as "qty" | "log")}
        options={[
          ["qty", "الكميات الحالية", "layers"],
          ["log", "سجل الإضافات", "list"],
        ]}
      />

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
      ) : tab === "qty" ? (
        <div className={styles.col}>
          {/* Search box */}
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="دوّر في المخزون… اكتب اسم المنتج"
          />

          {/* Filter Chips */}
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${filter === "all" ? styles.active : ""}`}
              onClick={() => setFilter("all")}
            >
              الكل ({inventory.length})
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
            <button
              type="button"
              className={`${styles.chip} ${filter === "expiry" ? styles.active : ""}`}
              onClick={() => setFilter("expiry")}
            >
              صلاحية قريبة ({counts.expiry})
            </button>
          </div>

          {/* Stock list */}
          {filteredInventory.length === 0 ? (
            <div className={styles.lrow}>
              <Empty
                icon="layers"
                title={query ? "مفيش نتائج تطابق البحث" : "المخزون فاضي"}
                sub="اضغط على زرار الإضافة لتسجيل أول بضاعة دخلت المحل"
                action={
                  <Button
                    kind="primary"
                    icon="plus"
                    onClick={() => setIsAdding(true)}
                  >
                    إضافة بضاعة
                  </Button>
                }
              />
            </div>
          ) : (
            <div className={styles.list}>
              {filteredInventory.map((item) => (
                <div
                  className={styles.lrow}
                  key={item.variantId}
                  data-testid={`stock-row-${item.variantId}`}
                >
                  <div className={styles.lrowLeft}>
                    <div
                      className={`${styles.dot} ${
                        item.status === "out"
                          ? styles.out
                          : item.status === "low"
                            ? styles.low
                            : ""
                      }`}
                    />
                    <div className={styles.lrn}>
                      <b>
                        {item.productName}{" "}
                        {item.flavor ? `(${item.flavor})` : ""}
                      </b>
                      {item.unitMode !== "weight" && item.packQty > 1 && (
                        <small>الكرتونة {item.packQty} قطعة</small>
                      )}
                    </div>
                  </div>

                  <div className={styles.lrq}>
                    {item.currentStockBase <= 0 ? (
                      <span className={`${styles.badge} ${styles.out}`}>
                        خلصان
                      </span>
                    ) : (
                      <b>{formatQuantity(item)}</b>
                    )}
                    {item.hasNearExpiry && (
                      <span className={`${styles.badge} ${styles.warn}`}>
                        صلاحية قريبة
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Log tab */
        <div className={styles.col}>
          <div className={styles.sumline}>
            <span>{movements.length} حركة مسجلة</span>
          </div>

          {movements.length === 0 ? (
            <div className={styles.lrow}>
              <Empty
                icon="truck"
                title="مفيش حركات مخزون مسجلة"
                sub="سجل البضاعة اللي دخلت أو خرجت من المحل"
              />
            </div>
          ) : (
            <div className={styles.list}>
              {movements.map((m) => (
                <div className={styles.lgi} key={m.id}>
                  <div className={styles.lgTop}>
                    <b>{m.productName}</b>
                    <span
                      className={styles.lgq}
                      style={{
                        color:
                          m.quantityBase > 0
                            ? "var(--ok, #108e5c)"
                            : "var(--red, #cf3c3c)",
                      }}
                    >
                      {m.quantityBase > 0
                        ? `+${m.quantityBase}`
                        : m.quantityBase}
                    </span>
                  </div>
                  <div className={styles.lgMeta}>
                    <span>
                      نوع الحركة:{" "}
                      {m.type === "purchase"
                        ? "شراء"
                        : m.type === "sale"
                          ? "بيع"
                          : "هالك/تالف"}
                    </span>
                    {m.costPricePiasters ? (
                      <span>{formatMoney(m.costPricePiasters)}</span>
                    ) : null}
                    {m.batchCode && <span>تشغيلة: {m.batchCode}</span>}
                    {m.expiryDate && (
                      <span>
                        صلاحية:{" "}
                        {new Date(m.expiryDate).toLocaleDateString("ar-EG")}
                      </span>
                    )}
                    <span>
                      {new Date(m.createdAt).toLocaleDateString("ar-EG")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Stock Modal */}
      {isAdding && (
        <AddStockModal
          options={productOptions}
          onClose={() => setIsAdding(false)}
          onAdded={() => {
            setIsAdding(false);
            void loadData();
          }}
        />
      )}
    </div>
  );
}

export default StockView;
