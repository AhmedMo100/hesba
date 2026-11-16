"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useEffect, useMemo } from "react";
import { SearchBox, Icon, Empty } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import {
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import { normalizeArabic } from "@/domain/normalize";
import type { StockInventoryItem } from "@/client/shared/store-items";
import { formatQtyText } from "./HomeView";
import styles from "./HomeView.module.css";

export function InventoryView() {
  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [machines, setMachines] = useState<PosMachine[] | null>(null);
  const [people, setPeople] = useState<{
    owedToMe: number | null;
    iOwe: number | null;
  }>({ owedToMe: null, iOwe: null });

  useEffect(() => {
    let ignore = false;
    void fetchStoreMachines().then((list) => {
      if (!ignore) setMachines(list);
    });
    const sectionTotal = (section: string) =>
      apiGet(`/api/people?section=${section}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { total_piasters?: number } | null) =>
          typeof d?.total_piasters === "number" ? d.total_piasters : null,
        )
        .catch(() => null);
    void Promise.all([
      sectionTotal("owedToMe"),
      sectionTotal("iOwe"),
      sectionTotal("suppliers"),
    ]).then(([owed, iOwe, sup]) => {
      if (ignore) return;
      setPeople({
        owedToMe: owed,
        iOwe: iOwe === null && sup === null ? null : (iOwe ?? 0) + (sup ?? 0),
      });
    });
    return () => {
      ignore = true;
    };
  }, []);

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
  const outCount = inventory.filter((i) => i.status === "out").length;
  const lowCount = inventory.filter((i) => i.status === "low").length;
  const machinesTotal = (machines ?? []).reduce(
    (sum, m) => sum + (m.currentBalancePiasters || 0),
    0,
  );
  const liquidation =
    totalSellPiasters +
    machinesTotal +
    (people.owedToMe ?? 0) -
    (people.iOwe ?? 0);
  const show = (v: number | null) => (v === null ? "—" : formatMoney(v));

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
      <div className={styles.note}>
        الجرد بيتحسب لوحده. ده إجمالي اللي عندك دلوقتي.
      </div>

      <h3 className={styles.sech}>🧃 البضاعة</h3>
      <div className={styles.sumbox}>
        <div className={styles.line}>
          <span>عدد المنتجات</span>
          <b>{inventory.length}</b>
        </div>
        <div className={styles.line}>
          <span>خلصانين</span>
          <b>{outCount}</b>
        </div>
        <div className={styles.line}>
          <span>قربوا يخلصوا</span>
          <b>{lowCount}</b>
        </div>
        <div className={styles.line}>
          <span>قيمتها بسعر الشراء</span>
          <b>{formatMoney(totalCostPiasters)}</b>
        </div>
        <div className={styles.line}>
          <span>قيمتها بسعر البيع</span>
          <b>{formatMoney(totalSellPiasters)}</b>
        </div>
      </div>

      <h3 className={styles.sech}>💳 الماكينات والمحافظ</h3>
      <div className={styles.sumbox}>
        {(machines ?? []).map((m) => (
          <div key={m.id} className={styles.line}>
            <span>{m.name}</span>
            <b>{formatMoney(m.currentBalancePiasters || 0)}</b>
          </div>
        ))}
        <div className={styles.line}>
          <b>الإجمالي</b>
          <b>{machines === null ? "—" : formatMoney(machinesTotal)}</b>
        </div>
      </div>

      <h3 className={styles.sech}>👥 الناس</h3>
      <div className={styles.sumbox}>
        <div className={styles.line}>
          <span>ليك عند الناس</span>
          <b>{show(people.owedToMe)}</b>
        </div>
        <div className={styles.line}>
          <span>عليك للناس</span>
          <b>{show(people.iOwe)}</b>
        </div>
      </div>

      <h3 className={styles.sech}>🧮 لو صفّيت دلوقتي</h3>
      <div className={styles.sumbox}>
        <div className={styles.line}>
          <span>البضاعة بسعر البيع</span>
          <b>{formatMoney(totalSellPiasters)}</b>
        </div>
        <div className={styles.line}>
          <span>الماكينات والمحافظ</span>
          <b>{machines === null ? "—" : formatMoney(machinesTotal)}</b>
        </div>
        <div className={styles.line}>
          <span>ليك عند الناس</span>
          <b>{show(people.owedToMe)}</b>
        </div>
        <div className={styles.line}>
          <span>عليك للناس</span>
          <b>{people.iOwe === null ? "—" : `−${formatMoney(people.iOwe)}`}</b>
        </div>
        <div className={styles.line}>
          <b>هيبقى معاك (من غير فلوس الدرج)</b>
          <b className={styles.goodText}>{formatMoney(liquidation)}</b>
        </div>
      </div>

      <h3 className={styles.sech}>📋 الأصناف</h3>
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
