"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { SearchBox, Icon, Empty, Seg } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { stockValuePiasters } from "@/domain/stock/stock-value";
import { ExportSheet } from "./ExportSheet";
import { StocktakePage } from "@/client/features/stock/StocktakePage";
import {
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import { normalizeArabic } from "@/domain/normalize";
import type { StockInventoryItem } from "@/client/shared/store-items";
import type { StocktakeScope } from "@/schemas/stocktake";
import { Modal, Button } from "@/client/shared/ui";
import { formatQtyText } from "./HomeView";
import styles from "./HomeView.module.css";

export function InventoryView() {
  const [tab, setTab] = useState<"overview" | "stocktake">("overview");
  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [machines, setMachines] = useState<PosMachine[] | null>(null);
  const [people, setPeople] = useState<{
    owedToMe: number | null;
    iOwe: number | null;
  }>({ owedToMe: null, iOwe: null });

  // Active stocktaking session tracking
  const [activeSession, setActiveSession] = useState<{
    id: string;
    totalProducts: number;
    countedProducts: number;
    scope: string;
  } | null>(null);
  const [showScopeModal, setShowScopeModal] = useState(false);
  const [selectedScope, setSelectedScope] = useState<StocktakeScope>("full");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [startingSession, setStartingSession] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const fetchStocktakeStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/stock/stocktake");
      if (res.ok) {
        const data = await res.json();
        setActiveSession(data.activeSession || null);
      }
    } catch {}
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const stockRes = await apiGet("/api/stock").catch(() => null);
      if (stockRes && stockRes.ok) {
        const sData = await stockRes.json();
        if (sData?.inventory && Array.isArray(sData.inventory)) {
          setInventory(sData.inventory);
        }
      }
      await fetchStocktakeStatus();
    } catch {}
  }, [fetchStocktakeStatus]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of inventory
    void fetchData();
    const handleUpdates = () => void fetchData();
    window.addEventListener("hesba_stock_updated", handleUpdates);
    window.addEventListener("hesba_sales_config_updated", handleUpdates);
    return () => {
      window.removeEventListener("hesba_stock_updated", handleUpdates);
      window.removeEventListener("hesba_sales_config_updated", handleUpdates);
    };
  }, [fetchData]);

  const inventoryRows = useMemo(() => {
    // Exact, as a sale prices it (the export uses the same rule).
    return inventory.map((item) => {
      const unit = item.unit || (item.unitMode === "weight" ? "kg" : "piece");
      return {
        ...item,
        costPiasters: stockValuePiasters(
          unit,
          item.currentStockBase,
          item.buyPricePiasters,
        ),
        valPiasters: stockValuePiasters(
          unit,
          item.currentStockBase,
          item.sellPricePiasters,
        ),
      };
    });
  }, [inventory]);

  // Every item, the ones that ran out or are running low first.
  const filteredInventory = useMemo(() => {
    const qNorm = normalizeArabic(query.trim());
    const rank = { out: 0, low: 1, ok: 2 } as const;
    return inventoryRows
      .filter(
        (item) => !qNorm || normalizeArabic(item.productName).includes(qNorm),
      )
      .sort(
        (a, b) =>
          rank[a.status] - rank[b.status] ||
          a.productName.localeCompare(b.productName, "ar"),
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

  const categories = useMemo(() => {
    const set = new Set<string>();
    inventory.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [inventory]);

  const handleStartStocktake = async () => {
    setStartError(null);
    try {
      setStartingSession(true);
      const res = await fetch("/api/stock/stocktake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: selectedScope,
          category: selectedScope === "category" ? selectedCategory : undefined,
          selectedVariantIds:
            selectedScope === "selected" ? selectedVariantIds : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err?.error?.message || err.message || "فشل بدء جلسة الجرد",
        );
      }

      setShowScopeModal(false);
      await fetchData();
      setTab("stocktake");
    } catch (err: unknown) {
      setStartError(err instanceof Error ? err.message : "تعذر بدء الجرد");
    } finally {
      setStartingSession(false);
    }
  };

  return (
    <div className={styles.page} data-testid="page-inventory" dir="rtl">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          marginBottom: "14px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 200px" }}>
          <Seg
            value={tab}
            onChange={setTab}
            options={[
              ["overview", "الجرد", "boxes"],
              ["stocktake", "الجرد الفعلي", "history"],
            ]}
          />
        </div>
        <button
          type="button"
          className={styles.miniDark}
          style={{
            padding: "10px 16px",
            borderRadius: "14px",
            fontWeight: 700,
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: activeSession
              ? "var(--green, #2ec4b6)"
              : "var(--card, #171b16)",
            color: activeSession ? "#0f1715" : "var(--ink, #ffffff)",
            border: "1px solid var(--edge, rgba(255,255,255,0.12))",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          onClick={() => {
            if (activeSession) {
              setTab("stocktake");
            } else {
              setShowScopeModal(true);
            }
          }}
          data-testid="start-stocktake-btn"
        >
          <Icon n={activeSession ? "history" : "plus"} s={16} />
          <span>{activeSession ? "كمّل الجرد السابق" : "ابدأ جرد جديد"}</span>
          {activeSession && (
            <span
              style={{
                fontSize: "11px",
                background: "rgba(0,0,0,0.2)",
                padding: "2px 6px",
                borderRadius: "8px",
                marginInlineStart: "4px",
              }}
            >
              {activeSession.countedProducts}/{activeSession.totalProducts}
            </span>
          )}
        </button>
      </div>

      {activeSession && tab === "overview" && (
        <div
          style={{
            background: "rgba(46, 196, 182, 0.12)",
            border: "1px solid var(--green, #2ec4b6)",
            borderRadius: "14px",
            padding: "12px 14px",
            marginBottom: "14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px",
            cursor: "pointer",
          }}
          onClick={() => setTab("stocktake")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Icon n="history" s={20} />
            <div>
              <b
                style={{
                  fontSize: "14px",
                  display: "block",
                  color: "var(--green, #2ec4b6)",
                }}
              >
                جلسة جرد فعلي شغالة حالياً
              </b>
              <small
                style={{ fontSize: "12px", color: "var(--muted, #8e948c)" }}
              >
                تم عدّ {activeSession.countedProducts} من إجمالي{" "}
                {activeSession.totalProducts} صنف
              </small>
            </div>
          </div>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--green, #2ec4b6)",
              whiteSpace: "nowrap",
            }}
          >
            كمّل الجرد ←
          </span>
        </div>
      )}

      {tab === "stocktake" ? (
        <StocktakePage
          inventory={inventory}
          onBack={() => setTab("overview")}
          onStockUpdated={fetchData}
          initialSessionId={activeSession?.id}
        />
      ) : (
        <>
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
              <b>
                {people.iOwe === null ? "—" : `−${formatMoney(people.iOwe)}`}
              </b>
            </div>
            <div className={styles.line}>
              <b>هيبقى معاك (من غير فلوس الدرج)</b>
              <b className={styles.goodText}>{formatMoney(liquidation)}</b>
            </div>
          </div>

          {/* الأصناف: every item at once (no filter tabs) — its stock first and large, its value
          at buy and sell prices under the name, then the totals. */}
          <section className={styles.itemsCard} data-testid="inventory-items">
            <div className={styles.itemsHead}>
              <h3>📋 الأصناف</h3>
              <span className={styles.itemsCount}>{inventory.length} صنف</span>
            </div>
            {(outCount > 0 || lowCount > 0) && (
              <p className={styles.itemsHint}>
                {outCount > 0 && (
                  <span className={styles.tagOut}>{outCount} خلصان</span>
                )}
                {lowCount > 0 && (
                  <span className={styles.tagLow}>{lowCount} قرب يخلص</span>
                )}
              </p>
            )}

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
                onClick={() => setExporting(true)}
                title="تصدير الجرد ومشاركته"
                data-testid="inventory-export"
              >
                <Icon n="download" s={15} />
                <span>تصدير ومشاركة</span>
              </button>
            </div>

            {filteredInventory.length === 0 ? (
              <Empty
                icon="search"
                title="مفيش أصناف مطابقة"
                sub="تأكد من كتابة اسم المنتج بشكل صحيح"
              />
            ) : (
              <div className={styles.invList}>
                {filteredInventory.map((item) => {
                  const isOut = item.status === "out";
                  const isLow = item.status === "low";
                  return (
                    <div
                      key={item.variantId}
                      className={`${styles.invRow} ${isOut ? styles.invRowOut : isLow ? styles.invRowLow : ""}`}
                      data-testid="inventory-row"
                    >
                      <div className={styles.invMain}>
                        <b className={styles.invName}>{item.productName}</b>
                        <small className={styles.invMoney}>
                          بالشراء {formatMoney(item.costPiasters)} · بالبيع{" "}
                          {formatMoney(item.valPiasters)}
                        </small>
                      </div>
                      <div className={styles.invQty}>
                        <b>
                          {isOut
                            ? "0"
                            : formatQtyText(
                                item.unitMode,
                                item.currentStockBase,
                                item.packQty,
                                item.unit,
                                item.packName || undefined,
                              )}
                        </b>
                        {isOut ? (
                          <span className={styles.tagOut}>خلصان</span>
                        ) : isLow ? (
                          <span className={styles.tagLow}>قرب يخلص</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
      {exporting && (
        <ExportSheet
          title="تصدير الجرد"
          url="/api/stock/export"
          fallbackName="جرد حسبة"
          onClose={() => setExporting(false)}
        />
      )}

      {showScopeModal && (
        <Modal title="ابدأ جرد جديد" onClose={() => setShowScopeModal(false)}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              padding: "6px 0",
            }}
            dir="rtl"
          >
            <p
              style={{
                fontSize: "13px",
                color: "var(--muted, #8e948c)",
                margin: 0,
              }}
            >
              اختر نطاق الجرد للبدء في عدّ الأصناف:
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: "8px",
              }}
            >
              <button
                type="button"
                style={{
                  background:
                    selectedScope === "full"
                      ? "rgba(46, 196, 182, 0.15)"
                      : "var(--surface, #1e221d)",
                  border: `1px solid ${
                    selectedScope === "full"
                      ? "var(--green, #2ec4b6)"
                      : "var(--edge, rgba(255,255,255,0.12))"
                  }`,
                  color: "var(--ink, #ffffff)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  textAlign: "right",
                  cursor: "pointer",
                }}
                onClick={() => setSelectedScope("full")}
              >
                <b style={{ fontSize: "14px", display: "block" }}>
                  1. جرد المحل بالكامل
                </b>
                <small
                  style={{ fontSize: "12px", color: "var(--muted, #8e948c)" }}
                >
                  عدّ كافة الأصناف والأقسام المتاحة في المحل ({inventory.length}{" "}
                  صنف)
                </small>
              </button>

              <button
                type="button"
                style={{
                  background:
                    selectedScope === "category"
                      ? "rgba(46, 196, 182, 0.15)"
                      : "var(--surface, #1e221d)",
                  border: `1px solid ${
                    selectedScope === "category"
                      ? "var(--green, #2ec4b6)"
                      : "var(--edge, rgba(255,255,255,0.12))"
                  }`,
                  color: "var(--ink, #ffffff)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  textAlign: "right",
                  cursor: "pointer",
                }}
                onClick={() => setSelectedScope("category")}
              >
                <b style={{ fontSize: "14px", display: "block" }}>
                  2. جرد قسم معين
                </b>
                <small
                  style={{ fontSize: "12px", color: "var(--muted, #8e948c)" }}
                >
                  اختيار قسم محدد مثل الألبان أو المشروبات لجرده فقط
                </small>
              </button>

              {selectedScope === "category" && (
                <div style={{ marginTop: "4px" }}>
                  <select
                    style={{
                      width: "100%",
                      background: "var(--surface, #1e221d)",
                      border: "1px solid var(--edge, rgba(255,255,255,0.12))",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "var(--ink, #ffffff)",
                      fontSize: "14px",
                    }}
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                  >
                    <option value="">-- اختر القسم --</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="button"
                style={{
                  background:
                    selectedScope === "selected"
                      ? "rgba(46, 196, 182, 0.15)"
                      : "var(--surface, #1e221d)",
                  border: `1px solid ${
                    selectedScope === "selected"
                      ? "var(--green, #2ec4b6)"
                      : "var(--edge, rgba(255,255,255,0.12))"
                  }`,
                  color: "var(--ink, #ffffff)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  textAlign: "right",
                  cursor: "pointer",
                }}
                onClick={() => setSelectedScope("selected")}
              >
                <b style={{ fontSize: "14px", display: "block" }}>
                  3. جرد منتجات محددة
                </b>
                <small
                  style={{ fontSize: "12px", color: "var(--muted, #8e948c)" }}
                >
                  تحديد أصناف بالاسم لعمل جرد فوري لها
                </small>
              </button>

              {selectedScope === "selected" && (
                <div
                  style={{
                    maxHeight: "150px",
                    overflowY: "auto",
                    border: "1px solid var(--edge, rgba(255,255,255,0.12))",
                    borderRadius: "10px",
                    padding: "8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  {inventory.map((i) => {
                    const checked = selectedVariantIds.includes(i.variantId);
                    return (
                      <label
                        key={i.variantId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          fontSize: "13px",
                          padding: "4px 8px",
                          borderRadius: "6px",
                          background: checked
                            ? "rgba(46,196,182,0.1)"
                            : "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedVariantIds((prev) => [
                                ...prev,
                                i.variantId,
                              ]);
                            } else {
                              setSelectedVariantIds((prev) =>
                                prev.filter((id) => id !== i.variantId),
                              );
                            }
                          }}
                        />
                        <span>{i.productName}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {startError && (
              <div
                style={{
                  color: "var(--red, #e63946)",
                  fontSize: "13px",
                  background: "rgba(230, 57, 70, 0.1)",
                  padding: "8px 12px",
                  borderRadius: "8px",
                }}
              >
                {startError}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <Button
                kind="ghost"
                size="md"
                onClick={() => setShowScopeModal(false)}
                disabled={startingSession}
              >
                إلغاء
              </Button>
              <Button
                kind="primary"
                size="md"
                style={{ width: "100%" }}
                onClick={handleStartStocktake}
                disabled={
                  startingSession ||
                  (selectedScope === "category" && !selectedCategory) ||
                  (selectedScope === "selected" &&
                    selectedVariantIds.length === 0)
                }
              >
                {startingSession ? "جاري البدء…" : "بدء الجرد الآن"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default InventoryView;
