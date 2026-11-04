"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import viewStyles from "./ViewLayout.module.css";
import styles from "./SalesView.module.css";
import { Empty, SearchBox, Icon } from "../../shared/ui";
import { t, formatMoney } from "../../shared/i18n";
import { db } from "../../shared/db";

export interface SaleRecord {
  id: string;
  productId: string;
  name: string;
  amountPiasters: number;
  quantity: number;
  category: string;
  unit: string;
  timestamp: number;
}

const STORAGE_KEY = "hesba_sales_records";
const STAGED_KEY = "hesba_staged_sale_item";

function getCategoryIcon(name: string, category: string): string {
  if (name.includes("كهرباء")) return "⚡";
  if (name.includes("مياه") || name.includes("ميه")) return "💧";
  if (name.includes("غاز")) return "🔥";
  if (name.includes("نت") || category.includes("إنترنت")) return "🌐";
  if (name.includes("كارت") || category.includes("كروت")) return "📱";
  if (category.includes("تحويل") || category.includes("محافظ")) return "💸";
  if (category.includes("مرافق")) return "🔌";
  return "🛒";
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return "الآن";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return "منذ دقيقة";
  if (diffMin === 2) return "منذ دقيقتين";
  if (diffMin < 11) return `منذ ${diffMin} دقائق`;
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours === 1) return "منذ ساعة";
  if (diffHours === 2) return "منذ ساعتين";
  if (diffHours < 11) return `منذ ${diffHours} ساعات`;
  return `منذ ${diffHours} ساعة`;
}

function loadInitialSales(): {
  sales: SaleRecord[];
  msg: string | null;
  justAddedId: string | null;
} {
  let sales: SaleRecord[] = [];
  let msg: string | null = null;
  let justAddedId: string | null = null;

  if (typeof window !== "undefined" || typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        sales = JSON.parse(raw);
      }
    } catch {
      // Storage fallback
    }

    try {
      const rawStaged = sessionStorage.getItem(STAGED_KEY);
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
            unit: staged.unit || "piece",
            timestamp: Date.now(),
          };

          sales = [newSale, ...sales];
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sales));
          } catch {
            // Ignore quota errors
          }

          justAddedId = newSale.id;
          msg = `تم تسجيل عملية البيع: ${newSale.name} بنجاح ✓`;
          sessionStorage.removeItem(STAGED_KEY);

          // Background sync to Dexie
          try {
            if (db?.sales && db?.sale_lines) {
              const saleId = crypto.randomUUID
                ? crypto.randomUUID()
                : newSale.id;
              const lineId = crypto.randomUUID
                ? crypto.randomUUID()
                : `line-${Date.now()}`;
              void db.sales
                .add({
                  id: saleId,
                  store_id: "default",
                  device_id: "local-device",
                  cashier_id: null,
                  total_minor: newSale.amountPiasters,
                  discount_minor: 0,
                  paid_minor: newSale.amountPiasters,
                  payment_method: "cash",
                  is_voided: false,
                  voided_at: null,
                  created_at: new Date(newSale.timestamp).toISOString(),
                  updated_at: new Date(newSale.timestamp).toISOString(),
                })
                .catch(() => {});

              void db.sale_lines
                .add({
                  id: lineId,
                  sale_id: saleId,
                  store_variant_id: staged.id || "default",
                  unit_mode: staged.unit === "weight" ? "weight" : "piece",
                  quantity_base: 1,
                  unit_price_minor: newSale.amountPiasters,
                  total_minor: newSale.amountPiasters,
                  created_at: new Date(newSale.timestamp).toISOString(),
                })
                .catch(() => {});
            }
          } catch {
            // Background Dexie catch
          }
        }
      }
    } catch {
      // Ignore parse error
    }
  }

  return { sales, msg, justAddedId };
}

export function SalesView() {
  const initial = useMemo(() => loadInitialSales(), []);
  const [sales, setSales] = useState<SaleRecord[]>(initial.sales);
  const [query, setQuery] = useState("");
  const [notificationMsg, setNotificationMsg] = useState<string | null>(
    initial.msg,
  );
  const [justAddedId, setJustAddedId] = useState<string | null>(
    initial.justAddedId,
  );

  // Focus event ingestion if user navigated back
  const checkStagedSaleItem = useCallback(() => {
    if (typeof window === "undefined" && typeof sessionStorage === "undefined")
      return;
    try {
      const rawStaged = sessionStorage.getItem(STAGED_KEY);
      if (!rawStaged) return;

      const staged = JSON.parse(rawStaged);
      if (staged && staged.name) {
        const newSale: SaleRecord = {
          id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          productId: staged.id || "manual",
          name: staged.name,
          amountPiasters: Number(staged.sellPricePiasters) || 0,
          quantity: 1,
          category: staged.category || "خدمات",
          unit: staged.unit || "piece",
          timestamp: Date.now(),
        };

        setSales((prev) => {
          const next = [newSale, ...prev];
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            // Ignore quota errors
          }
          return next;
        });

        setJustAddedId(newSale.id);
        setNotificationMsg(`تم تسجيل عملية البيع: ${newSale.name} بنجاح ✓`);
        sessionStorage.removeItem(STAGED_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    const handleFocus = () => checkStagedSaleItem();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [checkStagedSaleItem]);

  // Calculate today's sales
  const todaySales = useMemo(() => {
    const today = new Date().toDateString();
    return sales.filter((s) => new Date(s.timestamp).toDateString() === today);
  }, [sales]);

  const todayTotalPiasters = useMemo(() => {
    return todaySales.reduce((sum, s) => sum + s.amountPiasters, 0);
  }, [todaySales]);

  // Filtered sales list
  const filteredSales = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q),
    );
  }, [sales, query]);

  // Undo / Delete a sale
  const handleUndoSale = (id: string, name: string) => {
    if (
      typeof window !== "undefined" &&
      window.confirm(`هل تريد التراجع عن بيع "${name}"؟`)
    ) {
      setSales((prev) => {
        const next = prev.filter((s) => s.id !== id);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore storage errors
        }
        return next;
      });
      setNotificationMsg(`تم إلغاء عملية البيع: ${name}`);
    }
  };

  return (
    <div className={viewStyles.view} data-testid="page-sales">
      <div className={viewStyles.phead}>
        <div>
          <h1>{t("pages.sales.title")}</h1>
        </div>
      </div>

      <div className={styles.salesContainer}>
        {/* Summary Bar */}
        <div className={styles.summaryBar}>
          <div className={styles.summaryTotalCol}>
            <span className={styles.summaryLabel}>مبيعات النهارده</span>
            <b className={styles.summaryAmount}>
              {formatMoney(todayTotalPiasters)}
            </b>
          </div>
          <div className={styles.summaryMetaCol}>
            <span className={styles.summaryBadge}>
              {todaySales.length === 0
                ? "لا توجد عمليات بعد"
                : `${todaySales.length} ${todaySales.length === 1 ? "عملية" : "عمليات"}`}
            </span>
          </div>
        </div>

        {/* Notification Banner when newly added */}
        {notificationMsg && (
          <div className={styles.stagedBanner}>
            <div className={styles.stagedBannerText}>
              <Icon n="check" s={18} />
              <span>{notificationMsg}</span>
            </div>
            <button
              type="button"
              className={styles.dismissBtn}
              onClick={() => setNotificationMsg(null)}
              aria-label="إغلاق التنبيه"
            >
              <Icon n="x" s={14} />
            </button>
          </div>
        )}

        {/* Search Box */}
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={t("pages.sales.searchPlaceholder")}
        />

        {/* Sales List */}
        {filteredSales.length === 0 ? (
          <div className={viewStyles.card}>
            <Empty
              icon="cart"
              title={
                query
                  ? "لا توجد نتائج مطابقة لبحثك"
                  : "لسه مفيش مبيعات اتسجلت النهارده"
              }
              sub={
                query
                  ? "جرب البحث باسم منتج أو خدمة أخرى"
                  : "اضغط على «إضافة إلى البيع» من شاشة المنتجات أو الخدمات لتسجيل أول عملية بيع"
              }
            />
          </div>
        ) : (
          <div className={styles.recentSection}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>آخر المبيعات المسجلة</h3>
              <small style={{ color: "var(--ink2)", fontSize: 12 }}>
                {filteredSales.length} مسجلة
              </small>
            </div>

            <div className={styles.salesList}>
              {filteredSales.map((s) => {
                const isJustAdded = s.id === justAddedId;
                const iconSymbol = getCategoryIcon(s.name, s.category);

                return (
                  <div
                    key={s.id}
                    className={`${styles.saleCard} ${isJustAdded ? styles.justAdded : ""}`}
                  >
                    <div className={styles.saleInfo}>
                      <div className={styles.saleIcon}>{iconSymbol}</div>
                      <div className={styles.saleDetails}>
                        <span className={styles.saleName}>{s.name}</span>
                        <div className={styles.saleSub}>
                          <span>{s.category}</span>
                          <span>•</span>
                          <span>{formatRelativeTime(s.timestamp)}</span>
                        </div>
                      </div>
                    </div>

                    <div className={styles.saleMeta}>
                      <div className={styles.saleAmountCol}>
                        <b className={styles.salePrice}>
                          {formatMoney(s.amountPiasters)}
                        </b>
                      </div>
                      <button
                        type="button"
                        className={styles.undoBtn}
                        onClick={() => handleUndoSale(s.id, s.name)}
                        title="تراجع عن هذه العملية"
                      >
                        <Icon n="trash" s={13} />
                        <span>تراجع</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SalesView;
