"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useEffect, useMemo } from "react";
import { SearchBox, Icon, Empty } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import type { StockInventoryItem } from "@/client/shared/store-items";
import { formatQtyText } from "./HomeView";
import styles from "./HomeView.module.css";

export function InventoryView() {
  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let ignore = false;
    const fetchData = async () => {
      try {
        const stockRes = await apiGet("/api/stock").catch(() => null);
        if (stockRes && stockRes.ok && !ignore) {
          const sData = await stockRes.json();
          if (sData?.inventory && Array.isArray(sData.inventory)) {
            setInventory(sData.inventory);
          }
        }
      } catch {}
    };
    void fetchData();
    const handleUpdates = () => void fetchData();
    window.addEventListener("hesba_stock_updated", handleUpdates);
    window.addEventListener("hesba_sales_config_updated", handleUpdates);
    return () => {
      ignore = true;
      window.removeEventListener("hesba_stock_updated", handleUpdates);
      window.removeEventListener("hesba_sales_config_updated", handleUpdates);
    };
  }, []);

  const inventoryRows = useMemo(() => {
    return inventory.map((item) => {
      const factor = item.unitMode === "weight" ? 1000 : 1;
      const q = item.currentStockBase / factor;
      const buyPrice = item.buyPricePiasters || 0;
      const sellPrice = item.sellPricePiasters || 0;
      return {
        ...item,
        costPiasters: Math.round(q * buyPrice),
        valPiasters: Math.round(q * sellPrice),
      };
    });
  }, [inventory]);

  const filteredInventory = useMemo(() => {
    const qNorm = normalizeArabic(query.trim());
    if (!qNorm) return inventoryRows;
    return inventoryRows.filter((item) =>
      normalizeArabic(item.productName).includes(qNorm),
    );
  }, [inventoryRows, query]);

  const totalCostPiasters = useMemo(
    () => inventoryRows.reduce((sum, item) => sum + item.costPiasters, 0),
    [inventoryRows],
  );
  const totalSellPiasters = useMemo(
    () => inventoryRows.reduce((sum, item) => sum + item.valPiasters, 0),
    [inventoryRows],
  );
  const expectedProfitPiasters = totalSellPiasters - totalCostPiasters;

  const todayDateLabel = useMemo(() => {
    return new Intl.DateTimeFormat("ar-EG", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());
  }, []);

  const exportToExcel = () => {
    const headers = [
      "المنتج",
      "القسم",
      "الكمية",
      "قيمة الشراء (ج.م)",
      "قيمة البيع (ج.م)",
    ];
    const rowsCsv = filteredInventory.map((item) => {
      const qText =
        item.currentStockBase <= 0
          ? "خلصان"
          : formatQtyText(
              item.unitMode,
              item.currentStockBase,
              item.packQty,
              item.unit,
              item.packName || undefined,
            );
      return [
        `"${item.productName.replace(/"/g, '""')}"`,
        `"${(item.category || "متفرقات").replace(/"/g, '""')}"`,
        `"${qText.replace(/"/g, '""')}"`,
        (item.costPiasters / 100).toFixed(2),
        (item.valPiasters / 100).toFixed(2),
      ].join(",");
    });
    const csvContent = "﻿" + [headers.join(","), ...rowsCsv].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `jard-${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={styles.page} data-testid="page-inventory" dir="rtl">
      <div className={styles.kpis}>
        <div className={`${styles.kpi} ${styles.kpiBig}`}>
          <small>قيمة المخزون بسعر الشراء — جرد {todayDateLabel}</small>
          <b>{formatMoney(totalCostPiasters)}</b>
          <em>
            بسعر البيع {formatMoney(totalSellPiasters)} · ربح متوقع{" "}
            {formatMoney(expectedProfitPiasters)}
          </em>
        </div>
        <div className={styles.kpi}>
          <small>عدد الأصناف</small>
          <b>{inventory.length}</b>
        </div>
        <div className={`${styles.kpi} ${styles.kpiNeg}`}>
          <small>خلصان</small>
          <b>{inventory.filter((i) => i.status === "out").length}</b>
        </div>
        <div className={styles.kpi}>
          <small>قرب يخلص</small>
          <b>{inventory.filter((i) => i.status === "low").length}</b>
        </div>
      </div>

      <div className={styles.invBar}>
        <div className={styles.invSearch}>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="دوّر في الجرد"
          />
        </div>
        <button
          type="button"
          className={styles.exportBtn}
          onClick={exportToExcel}
          title="تصدير بيانات الجرد إلى Excel"
        >
          <Icon n="download" s={15} />
          <span>تصدير Excel</span>
        </button>
      </div>

      <div className={styles.tblCard}>
        <div className={styles.tblW}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>المنتج</th>
                <th>الكمية</th>
                <th>قيمة الشراء</th>
                <th>قيمة البيع</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{ textAlign: "center", padding: "24px" }}
                  >
                    <Empty
                      icon="search"
                      title="مفيش أصناف مطابقة"
                      sub="تأكد من كتابة اسم المنتج بشكل صحيح"
                    />
                  </td>
                </tr>
              ) : (
                filteredInventory.map((item) => {
                  const isOut = item.status === "out";
                  const isLow = item.status === "low";
                  return (
                    <tr key={item.productId}>
                      <td>
                        <span
                          className={`${styles.dot} ${
                            isOut
                              ? styles.dotRed
                              : isLow
                                ? styles.dotYellow
                                : styles.dotGreen
                          }`}
                        />
                        <span>{item.productName}</span>
                      </td>
                      <td>
                        {isOut ? (
                          <span className={styles.tagOut}>خلصان</span>
                        ) : (
                          formatQtyText(
                            item.unitMode,
                            item.currentStockBase,
                            item.packQty,
                            item.unit,
                            item.packName || undefined,
                          )
                        )}
                      </td>
                      <td>
                        {((item.costPiasters || 0) / 100).toLocaleString(
                          "en-US",
                          { maximumFractionDigits: 2 },
                        )}
                      </td>
                      <td>
                        {((item.valPiasters || 0) / 100).toLocaleString(
                          "en-US",
                          { maximumFractionDigits: 2 },
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredInventory.length > 0 && (
              <tfoot>
                <tr>
                  <td>الإجمالي</td>
                  <td />
                  <td>
                    {(totalCostPiasters / 100).toLocaleString("en-US", {
                      maximumFractionDigits: 1,
                    })}
                  </td>
                  <td>
                    {(totalSellPiasters / 100).toLocaleString("en-US", {
                      maximumFractionDigits: 1,
                    })}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

export default InventoryView;
