"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Icon,
  Button,
  SearchBox,
  Modal,
  useToast,
  Empty,
} from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import type {
  StocktakeSessionSummary,
  StocktakeSessionDetails,
  StocktakeItemDTO,
  StocktakeScope,
  StocktakeDiscrepancyKind,
} from "@/schemas/stocktake";
import type { StockInventoryItem } from "@/client/shared/store-items";
import { RecordLossModal } from "./RecordLossModal";
import styles from "./Stocktake.module.css";

export interface StocktakePageProps {
  inventory: StockInventoryItem[];
  onBack: () => void;
  onStockUpdated?: () => void;
  initialSessionId?: string | null;
}

type FilterKind = "all" | "uncounted" | "shortage" | "surplus" | "matched";

export function StocktakePage({
  inventory,
  onBack,
  onStockUpdated,
  initialSessionId,
}: StocktakePageProps) {
  const toast = useToast();
  const showToast = useCallback(
    (msg: string, kind: "ok" | "err" = "ok") => toast.show({ msg, kind }),
    [toast],
  );

  const [loading, setLoading] = useState(true);
  const [historySessions, setHistorySessions] = useState<
    StocktakeSessionSummary[]
  >([]);
  const [sessionDetails, setSessionDetails] =
    useState<StocktakeSessionDetails | null>(null);

  // Form states for creating a new session
  const [selectedScope, setSelectedScope] = useState<StocktakeScope>("full");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [sessionNotes, setSessionNotes] = useState<string>("");
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Active session working states
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [classifications, setClassifications] = useState<
    Record<string, StocktakeDiscrepancyKind>
  >({});
  const [savingCounts, setSavingCounts] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Reconcile modal states
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileNotes, setReconcileNotes] = useState("");

  // History detail modal
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [historyDetails, setHistoryDetails] =
    useState<StocktakeSessionDetails | null>(null);
  const [loadingHistoryDetails, setLoadingHistoryDetails] = useState(false);

  // Waste modal
  const [wasteItem, setWasteItem] = useState<StockInventoryItem | null>(null);

  // Extract unique categories from inventory
  const categories = useMemo(() => {
    const set = new Set<string>();
    inventory.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [inventory]);

  // Load sessions from API
  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/stock/stocktake");
      if (!res.ok) throw new Error("فشل في تحميل بيانات الجرد");
      const data = await res.json();
      setHistorySessions(data.sessions || []);

      const targetSessionId = initialSessionId || data.activeSession?.id;

      if (targetSessionId) {
        const detRes = await fetch(`/api/stock/stocktake/${targetSessionId}`);
        if (detRes.ok) {
          const detData = await detRes.json();
          setSessionDetails(detData.session);

          // Populate initial counts and classifications
          const initialCounts: Record<string, number> = {};
          const initialClass: Record<string, StocktakeDiscrepancyKind> = {};
          detData.session.items.forEach((it: StocktakeItemDTO) => {
            if (it.countedQuantityBase !== null) {
              initialCounts[it.storeVariantId] = it.countedQuantityBase;
            }
            if (it.classification) {
              initialClass[it.storeVariantId] = it.classification;
            }
          });
          setCounts(initialCounts);
          setClassifications(initialClass);
        }
      } else {
        setSessionDetails(null);
      }
    } catch {
      showToast("تعذر تحميل بيانات الجرد الفعلي", "err");
    } finally {
      setLoading(false);
    }
  }, [initialSessionId, showToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of stocktake data
    void loadSessions();
  }, [loadSessions]);

  // Start new session
  const handleStartSession = async (scopeToUse = selectedScope) => {
    try {
      setSubmittingCreate(true);
      const res = await fetch("/api/stock/stocktake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: scopeToUse,
          category: scopeToUse === "category" ? selectedCategory : undefined,
          selectedVariantIds:
            scopeToUse === "selected" ? selectedVariantIds : undefined,
          notes: sessionNotes || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err?.error?.message || err.message || "فشل بدء جلسة الجرد",
        );
      }

      showToast("تم بدء جلسة الجرد بنجاح", "ok");
      await loadSessions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر بدء الجرد";
      showToast(msg, "err");
    } finally {
      setSubmittingCreate(false);
    }
  };

  // Save counts
  const handleSaveCounts = async () => {
    if (!sessionDetails) return;
    try {
      setSavingCounts(true);
      const itemsToUpdate = Object.entries(counts).map(
        ([storeVariantId, countedQuantityBase]) => ({
          storeVariantId,
          countedQuantityBase,
          classification: classifications[storeVariantId],
        }),
      );

      if (itemsToUpdate.length === 0) {
        showToast("لم تقم بإدخال أي عدّ بعد", "err");
        return;
      }

      const res = await fetch(
        `/api/stock/stocktake/${sessionDetails.id}/count`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: itemsToUpdate }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err?.error?.message || err.message || "فشل في حفظ العد",
        );
      }

      showToast("تم حفظ الأعداد بنجاح", "ok");
      await loadSessions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر حفظ الأعداد";
      showToast(msg, "err");
    } finally {
      setSavingCounts(false);
    }
  };

  // Cancel session
  const handleCancelSession = async () => {
    if (!sessionDetails) return;
    if (
      !confirm(
        "هل أنت متأكد من إلغاء جلسة الجرد الحالية؟ لن يتم تطبيق أي تعديلات على المخزون.",
      )
    ) {
      return;
    }

    try {
      const res = await fetch(
        `/api/stock/stocktake/${sessionDetails.id}/cancel`,
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err?.error?.message || err.message || "فشل في إلغاء الجرد",
        );
      }

      showToast("تم إلغاء جلسة الجرد", "ok");
      await loadSessions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر إلغاء الجرد";
      showToast(msg, "err");
    }
  };

  // Reconcile and approve session
  const handleReconcile = async () => {
    if (!sessionDetails) return;

    // Check if all items are counted
    const uncountedItems = sessionDetails.items.filter(
      (it) => counts[it.storeVariantId] === undefined,
    );

    if (uncountedItems.length > 0) {
      showToast(
        `يوجد ${uncountedItems.length} صنف لم يتم عدّهم. يجب إدخال العد لجميع الأصناف أولاً`,
        "err",
      );
      return;
    }

    try {
      setReconciling(true);

      // Save counts first to make sure server has the latest
      await handleSaveCounts();

      const itemClassifications: Record<
        string,
        { classification: StocktakeDiscrepancyKind; notes?: string }
      > = {};
      Object.entries(classifications).forEach(([variantId, kind]) => {
        itemClassifications[variantId] = { classification: kind };
      });

      const res = await fetch(
        `/api/stock/stocktake/${sessionDetails.id}/reconcile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: reconcileNotes || undefined,
            itemClassifications,
          }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err?.error?.message || err.message || "فشل اعتماد الجرد والتسوية",
        );
      }

      showToast("تم اعتماد وتسوية الجرد الفعلي بنجاح!", "ok");
      setShowReconcileModal(false);
      onStockUpdated?.();
      await loadSessions();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "تعذر اعتماد وتسوية الجرد";
      showToast(msg, "err");
    } finally {
      setReconciling(false);
    }
  };

  // View past session details
  const openHistoryDetails = async (sessionId: string) => {
    setViewingHistoryId(sessionId);
    try {
      setLoadingHistoryDetails(true);
      const res = await fetch(`/api/stock/stocktake/${sessionId}`);
      if (res.ok) {
        const d = await res.json();
        setHistoryDetails(d.session);
      }
    } catch {
      showToast("تعذر تحميل تفاصيل الجلسة", "err");
    } finally {
      setLoadingHistoryDetails(false);
    }
  };

  // Calculate live item stats and discrepancies
  const itemsWithComputedState = useMemo(() => {
    if (!sessionDetails) return [];

    return sessionDetails.items.map((it) => {
      const counted = counts[it.storeVariantId];
      const hasCount = counted !== undefined;
      const expected = it.expectedQuantityBase;
      const diff = hasCount ? counted - expected : null;
      const currentClass =
        classifications[it.storeVariantId] ||
        (diff !== null && diff < 0
          ? "damaged_or_expired"
          : "unknown_adjustment");

      return {
        ...it,
        liveCounted: counted,
        hasCount,
        liveDiff: diff,
        liveClass: currentClass,
      };
    });
  }, [sessionDetails, counts, classifications]);

  // Filter items
  const filteredItems = useMemo(() => {
    const qNorm = normalizeArabic(searchQuery.trim());
    return itemsWithComputedState.filter((it) => {
      if (qNorm) {
        const nameMatch = normalizeArabic(it.productName).includes(qNorm);
        const barMatch = it.barcode && it.barcode.includes(qNorm);
        if (!nameMatch && !barMatch) return false;
      }

      if (filter === "uncounted") return !it.hasCount;
      if (filter === "matched") return it.hasCount && it.liveDiff === 0;
      if (filter === "shortage") return it.hasCount && (it.liveDiff ?? 0) < 0;
      if (filter === "surplus") return it.hasCount && (it.liveDiff ?? 0) > 0;
      return true;
    });
  }, [itemsWithComputedState, searchQuery, filter]);

  // Overall session summary metrics
  const sessionMetrics = useMemo(() => {
    let matched = 0;
    let shortage = 0;
    let surplus = 0;
    let uncounted = 0;

    itemsWithComputedState.forEach((it) => {
      if (!it.hasCount) {
        uncounted++;
      } else if (it.liveDiff === 0) {
        matched++;
      } else if ((it.liveDiff ?? 0) < 0) {
        shortage++;
      } else {
        surplus++;
      }
    });

    return {
      total: itemsWithComputedState.length,
      counted: itemsWithComputedState.length - uncounted,
      matched,
      shortage,
      surplus,
      uncounted,
    };
  }, [itemsWithComputedState]);

  if (loading) {
    return (
      <div className={styles.container} dir="rtl">
        <div
          style={{
            textAlign: "center",
            padding: "40px 0",
            color: "var(--muted)",
          }}
        >
          جاري تحميل بيانات الجرد الفعلي…
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container} dir="rtl">
      {/* ─── Top Header with Back Navigation ─── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "var(--ink, #ffffff)",
            fontSize: "15px",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            cursor: "pointer",
            padding: "8px 0",
          }}
        >
          <Icon n="left" s={18} />
          <span>رجوع للجرد والمخزون</span>
        </button>
        {sessionDetails && (
          <span className={styles.bannerProgress}>
            {sessionMetrics.counted} من {sessionMetrics.total} صنف تم عدّه
          </span>
        )}
      </div>

      {/* ─── Active Session Screen ─── */}
      {sessionDetails && sessionDetails.status === "in_progress" ? (
        <>
          {/* Header & Stats Card */}
          <div className={styles.sessionHeader}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <h3 className={styles.cardTitle}>
                  <Icon n="history" s={20} />
                  <span>الجرد الفعلي الحالي</span>
                </h3>
                <span className={styles.cardSubtitle}>
                  {sessionDetails.scope === "full"
                    ? "جرد المحل بالكامل"
                    : sessionDetails.scope === "category"
                      ? `جرد قسم: ${sessionDetails.category}`
                      : "جرد أصناف محددة"}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <Button
                  kind="danger"
                  size="sm"
                  onClick={handleCancelSession}
                  title="إلغاء جلسة الجرد"
                >
                  إلغاء الجلسة
                </Button>
                <Button
                  kind="ghost"
                  size="sm"
                  onClick={handleSaveCounts}
                  disabled={savingCounts}
                  title="حفظ ما تم عدّه"
                >
                  {savingCounts ? "جاري الحفظ…" : "حفظ العد"}
                </Button>
              </div>
            </div>

            {/* Stats Row */}
            <div className={styles.sessionStats}>
              <div className={styles.statBox}>
                <small>تم عدّها</small>
                <b>
                  {sessionMetrics.counted} / {sessionMetrics.total}
                </b>
              </div>
              <div className={`${styles.statBox} ${styles.matched}`}>
                <small>مطابق</small>
                <b>{sessionMetrics.matched}</b>
              </div>
              <div className={`${styles.statBox} ${styles.shortage}`}>
                <small>عجز</small>
                <b>{sessionMetrics.shortage}</b>
              </div>
              <div className={`${styles.statBox} ${styles.surplus}`}>
                <small>زيادة</small>
                <b>{sessionMetrics.surplus}</b>
              </div>
              <div className={styles.statBox}>
                <small>لم يُعد بعد</small>
                <b>{sessionMetrics.uncounted}</b>
              </div>
              <div className={styles.statBox}>
                <small>فارق التكلفة</small>
                <b>{formatMoney(sessionDetails.netCostPiasters)}</b>
              </div>
            </div>

            {/* Filter Chips & Search */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                marginTop: "6px",
              }}
            >
              <div className={styles.filterChips} role="tablist">
                <button
                  type="button"
                  className={`${styles.chip} ${filter === "all" ? styles.chipActive : ""}`}
                  onClick={() => setFilter("all")}
                >
                  الكل ({sessionMetrics.total})
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${filter === "uncounted" ? styles.chipActive : ""}`}
                  onClick={() => setFilter("uncounted")}
                >
                  لم يُعد ({sessionMetrics.uncounted})
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${filter === "shortage" ? styles.chipActive : ""}`}
                  onClick={() => setFilter("shortage")}
                >
                  عجز ({sessionMetrics.shortage})
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${filter === "surplus" ? styles.chipActive : ""}`}
                  onClick={() => setFilter("surplus")}
                >
                  زيادة ({sessionMetrics.surplus})
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${filter === "matched" ? styles.chipActive : ""}`}
                  onClick={() => setFilter("matched")}
                >
                  مطابق ({sessionMetrics.matched})
                </button>
              </div>

              <SearchBox
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="ابحث بالاسم أو الباركود…"
              />
            </div>
          </div>

          {/* Items List */}
          <div className={styles.itemList}>
            {filteredItems.length === 0 ? (
              <Empty
                icon="search"
                title="لا توجد أصناف مطابقة"
                sub="جرّب تغيير كلمة البحث أو الفلتر"
              />
            ) : (
              filteredItems.map((item) => {
                const diff = item.liveDiff;
                const isShortage = diff !== null && diff < 0;
                const isSurplus = diff !== null && diff > 0;
                const isMatched = diff !== null && diff === 0;
                const isWeight = item.unit === "kg" || item.unit === "gram";
                const unitLabel = isWeight ? "جم" : "قطعة";
                const totalMoves =
                  item.movementsSinceSnapshot.sales +
                  item.movementsSinceSnapshot.purchases +
                  item.movementsSinceSnapshot.returns +
                  item.movementsSinceSnapshot.waste +
                  item.movementsSinceSnapshot.adjustments;

                return (
                  <div
                    key={item.storeVariantId}
                    className={`${styles.itemCard} ${
                      isShortage
                        ? styles.hasDiscrepancy
                        : isSurplus
                          ? styles.isSurplus
                          : isMatched
                            ? styles.isMatched
                            : ""
                    }`}
                  >
                    <div className={styles.itemTop}>
                      <div>
                        <div className={styles.itemName}>
                          {item.productName}
                        </div>
                        <div className={styles.itemCategory}>
                          {item.category || "عام"}{" "}
                          {item.barcode ? `· ${item.barcode}` : ""}
                        </div>
                      </div>

                      <div className={styles.itemBadges}>
                        {item.liveDiff === null ? (
                          <span
                            className={`${styles.badge} ${styles.badgeUncounted}`}
                          >
                            لم يُعد
                          </span>
                        ) : isMatched ? (
                          <span
                            className={`${styles.badge} ${styles.badgeMatched}`}
                          >
                            مطابق
                          </span>
                        ) : isShortage ? (
                          <span
                            className={`${styles.badge} ${styles.badgeShortage}`}
                          >
                            عجز {Math.abs(item.liveDiff)} {unitLabel}
                          </span>
                        ) : (
                          <span
                            className={`${styles.badge} ${styles.badgeSurplus}`}
                          >
                            زيادة {item.liveDiff} {unitLabel}
                          </span>
                        )}

                        {totalMoves !== 0 && (
                          <span
                            className={`${styles.badge} ${styles.badgeWarning}`}
                            title="حدثت حركات بيع أو استلام أثناء الجرد وتم أخذها في الحسبان تلقائياً"
                          >
                            <Icon n="alert" s={12} />
                            حركات جارية
                          </span>
                        )}
                      </div>
                    </div>

                    <div className={styles.itemRow}>
                      <div className={styles.expectedStock}>
                        <small className={styles.expectedLabel}>
                          الرصيد الدفتري المتوقع:
                        </small>
                        <b className={styles.expectedValue}>
                          {item.expectedQuantityBase} {unitLabel}
                        </b>
                      </div>

                      {/* Stepper / Input */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <button
                          type="button"
                          className={styles.counterBtn}
                          onClick={() => {
                            const cur =
                              counts[item.storeVariantId] ??
                              item.expectedQuantityBase;
                            const next = Math.max(0, cur - 1);
                            setCounts((prev) => ({
                              ...prev,
                              [item.storeVariantId]: next,
                            }));
                          }}
                        >
                          −
                        </button>

                        <input
                          type="number"
                          min="0"
                          className={styles.counterInput}
                          placeholder="العد الفعلي"
                          value={counts[item.storeVariantId] ?? ""}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            if (val === "") {
                              const copy = { ...counts };
                              delete copy[item.storeVariantId];
                              setCounts(copy);
                            } else {
                              const num = parseInt(val, 10);
                              if (!isNaN(num) && num >= 0) {
                                setCounts((prev) => ({
                                  ...prev,
                                  [item.storeVariantId]: num,
                                }));
                              }
                            }
                          }}
                        />

                        <button
                          type="button"
                          className={styles.counterBtn}
                          onClick={() => {
                            const cur =
                              counts[item.storeVariantId] ??
                              item.expectedQuantityBase;
                            setCounts((prev) => ({
                              ...prev,
                              [item.storeVariantId]: cur + 1,
                            }));
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Discrepancy Reason for Shortages */}
                    {isShortage && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          marginTop: "6px",
                          padding: "10px",
                          background: "var(--surface, #1e221d)",
                          borderRadius: "10px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              color: "var(--red, #e63946)",
                              fontWeight: 600,
                            }}
                          >
                            سبب العجز:
                          </span>
                          <button
                            type="button"
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--gold, #d4a373)",
                              fontSize: "12px",
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                            onClick={() => {
                              const invItem = inventory.find(
                                (i) => i.variantId === item.storeVariantId,
                              );
                              if (invItem) setWasteItem(invItem);
                            }}
                          >
                            تسجيل هالك / تالف مفصل
                          </button>
                        </div>
                        <select
                          className={styles.select}
                          value={item.liveClass}
                          onChange={(e) => {
                            const val = e.target
                              .value as StocktakeDiscrepancyKind;
                            setClassifications((prev) => ({
                              ...prev,
                              [item.storeVariantId]: val,
                            }));
                          }}
                        >
                          <option value="damaged_or_expired">
                            بضاعة تالفة أو منتهية الصلاحية (تسجيل فاقد)
                          </option>
                          <option value="unrecorded_sales">
                            مبيعات لم يتم تسجيلها على السيستم
                          </option>
                          <option value="unknown_adjustment">
                            فارق غير محدد (تسوية جرد)
                          </option>
                        </select>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Action Footer */}
          <div
            style={{
              position: "sticky",
              bottom: "16px",
              display: "flex",
              gap: "10px",
              background: "var(--card, #171b16)",
              padding: "12px 16px",
              borderRadius: "16px",
              border: "1px solid var(--edge, rgba(255,255,255,0.12))",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              zIndex: 10,
            }}
          >
            <Button
              kind="primary"
              size="lg"
              style={{ width: "100%" }}
              onClick={() => setShowReconcileModal(true)}
              disabled={sessionMetrics.uncounted > 0}
            >
              <Icon n="check" s={18} />
              <span>
                {sessionMetrics.uncounted > 0
                  ? `باقي ${sessionMetrics.uncounted} صنف لم يتم عدّهم`
                  : "مراجعة واعتماد الجرد"}
              </span>
            </Button>
          </div>
        </>
      ) : (
        /* ─── Setup Screen (No Active Session) ─── */
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>
            <Icon n="boxes" s={20} />
            <span>بدء جلسة جرد فعلي جديدة</span>
          </h3>
          <p className={styles.cardSubtitle}>
            اختر نطاق الجرد. سيتم أخذ لقطة فورية للأرصدة الدفترية مع احتساب أي
            مبيعات أو حركات تتم أثناء العد بدقة كاملة.
          </p>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>نطاق الجرد</label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "8px",
              }}
            >
              <button
                type="button"
                className={`${styles.chip} ${selectedScope === "full" ? styles.chipActive : ""}`}
                style={{ textAlign: "center", padding: "12px 6px" }}
                onClick={() => setSelectedScope("full")}
              >
                جرد المحل بالكامل
              </button>
              <button
                type="button"
                className={`${styles.chip} ${selectedScope === "category" ? styles.chipActive : ""}`}
                style={{ textAlign: "center", padding: "12px 6px" }}
                onClick={() => setSelectedScope("category")}
              >
                جرد قسم معين
              </button>
              <button
                type="button"
                className={`${styles.chip} ${selectedScope === "selected" ? styles.chipActive : ""}`}
                style={{ textAlign: "center", padding: "12px 6px" }}
                onClick={() => setSelectedScope("selected")}
              >
                منتجات محددة
              </button>
            </div>
          </div>

          {selectedScope === "category" && (
            <div className={styles.fieldGroup}>
              <label className={styles.label}>اختر القسم</label>
              <select
                className={styles.select}
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="">-- اختر القسم المراد جرده --</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedScope === "selected" && (
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                الأصناف المراد جردها ({selectedVariantIds.length} محددة)
              </label>
              <div
                style={{
                  maxHeight: "180px",
                  overflowY: "auto",
                  border: "1px solid var(--edge, rgba(255,255,255,0.12))",
                  borderRadius: "12px",
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
                        padding: "6px",
                        borderRadius: "8px",
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
            </div>
          )}

          <div className={styles.fieldGroup}>
            <label className={styles.label}>ملاحظات الجرد (اختياري)</label>
            <textarea
              className={styles.textarea}
              placeholder="مثال: جرد نهاية الشهر، جرد دوري للألبان…"
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
            />
          </div>

          <Button
            kind="primary"
            size="lg"
            style={{ width: "100%" }}
            onClick={() => handleStartSession()}
            disabled={
              submittingCreate ||
              (selectedScope === "category" && !selectedCategory) ||
              (selectedScope === "selected" && selectedVariantIds.length === 0)
            }
          >
            <Icon n="plus" s={18} />
            <span>{submittingCreate ? "جاري البدء…" : "ابدأ الجرد الآن"}</span>
          </Button>

          {/* Historical Sessions Section */}
          {historySessions.length > 0 && (
            <div style={{ marginTop: "24px" }}>
              <h4
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  marginBottom: "10px",
                }}
              >
                📜 سجل جلسات الجرد السابقة
              </h4>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                {historySessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    style={{
                      background: "var(--surface, #1e221d)",
                      border: "1px solid var(--edge, rgba(255,255,255,0.08))",
                      borderRadius: "12px",
                      padding: "12px",
                      textAlign: "right",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "inherit",
                    }}
                    onClick={() => openHistoryDetails(s.id)}
                  >
                    <div>
                      <b style={{ fontSize: "14px", display: "block" }}>
                        {s.scope === "full"
                          ? "جرد كامل للمحل"
                          : s.scope === "category"
                            ? `جرد قسم: ${s.category}`
                            : "جرد أصناف محددة"}
                      </b>
                      <small
                        style={{ color: "var(--muted)", fontSize: "12px" }}
                      >
                        {new Date(s.createdAt).toLocaleDateString("ar-EG", {
                          dateStyle: "medium",
                        })}
                      </small>
                    </div>

                    <div style={{ textAlign: "left" }}>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "6px",
                          background:
                            s.status === "reconciled"
                              ? "rgba(46,196,182,0.15)"
                              : "rgba(230,57,70,0.15)",
                          color:
                            s.status === "reconciled"
                              ? "var(--green, #2ec4b6)"
                              : "var(--red, #e63946)",
                        }}
                      >
                        {s.status === "reconciled" ? "معتمد ومسوّى" : "ملغي"}
                      </span>
                      {s.status === "reconciled" && (
                        <div
                          style={{
                            fontSize: "12px",
                            color: "var(--muted)",
                            marginTop: "4px",
                          }}
                        >
                          صافي: {formatMoney(s.netCostPiasters)}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Reconcile Confirmation Modal ─── */}
      {showReconcileModal && (
        <Modal
          title="مراجعة واعتماد الجرد الفعلي"
          onClose={() => setShowReconcileModal(false)}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              padding: "8px 0",
            }}
            dir="rtl"
          >
            <p style={{ fontSize: "14px", color: "var(--muted)", margin: 0 }}>
              سيتم اعتماد الأعداد المدخلة وتسوية المخزون فورياً بدون إنشاء
              مبيعات وهمية أو السماح بأرصدة سالبة:
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
                background: "var(--surface, #1e221d)",
                padding: "12px",
                borderRadius: "12px",
              }}
            >
              <div>
                <small style={{ color: "var(--muted)", fontSize: "12px" }}>
                  أصناف متطابقة تماماً
                </small>
                <b
                  style={{
                    display: "block",
                    color: "var(--green, #2ec4b6)",
                    fontSize: "16px",
                  }}
                >
                  {sessionMetrics.matched} صنف
                </b>
              </div>
              <div>
                <small style={{ color: "var(--muted)", fontSize: "12px" }}>
                  أصناف بها عجز (نقص)
                </small>
                <b
                  style={{
                    display: "block",
                    color: "var(--red, #e63946)",
                    fontSize: "16px",
                  }}
                >
                  {sessionMetrics.shortage} صنف
                </b>
              </div>
              <div>
                <small style={{ color: "var(--muted)", fontSize: "12px" }}>
                  أصناف بها زيادة
                </small>
                <b
                  style={{
                    display: "block",
                    color: "#4cc9f0",
                    fontSize: "16px",
                  }}
                >
                  {sessionMetrics.surplus} صنف
                </b>
              </div>
              <div>
                <small style={{ color: "var(--muted)", fontSize: "12px" }}>
                  فارق التكلفة الصافي
                </small>
                <b style={{ display: "block", fontSize: "16px" }}>
                  {formatMoney(sessionDetails?.netCostPiasters || 0)}
                </b>
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>ملاحظات الاعتماد (اختياري)</label>
              <input
                type="text"
                className={styles.input}
                placeholder="ملاحظات الاعتماد النهائي…"
                value={reconcileNotes}
                onChange={(e) => setReconcileNotes(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <Button
                kind="ghost"
                size="md"
                onClick={() => setShowReconcileModal(false)}
                disabled={reconciling}
              >
                رجوع
              </Button>
              <Button
                kind="primary"
                size="md"
                style={{ width: "100%" }}
                onClick={handleReconcile}
                disabled={reconciling}
              >
                {reconciling
                  ? "جاري الاعتماد والتسوية…"
                  : "تأكيد واعتماد التسوية"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── History Session Details Modal ─── */}
      {viewingHistoryId && (
        <Modal
          title="تفاصيل جلسة الجرد السابقة"
          onClose={() => {
            setViewingHistoryId(null);
            setHistoryDetails(null);
          }}
        >
          {loadingHistoryDetails || !historyDetails ? (
            <div
              style={{
                textAlign: "center",
                padding: "20px",
                color: "var(--muted)",
              }}
            >
              جاري تحميل التفاصيل…
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
              dir="rtl"
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "8px",
                  background: "var(--surface, #1e221d)",
                  padding: "10px",
                  borderRadius: "12px",
                  textAlign: "center",
                }}
              >
                <div>
                  <small style={{ color: "var(--muted)", fontSize: "11px" }}>
                    الحالة
                  </small>
                  <b style={{ display: "block", fontSize: "13px" }}>
                    {historyDetails.status === "reconciled"
                      ? "معتمد ومسوّى"
                      : "ملغي"}
                  </b>
                </div>
                <div>
                  <small style={{ color: "var(--muted)", fontSize: "11px" }}>
                    تاريخ الجرد
                  </small>
                  <b style={{ display: "block", fontSize: "13px" }}>
                    {new Date(historyDetails.createdAt).toLocaleDateString(
                      "ar-EG",
                    )}
                  </b>
                </div>
                <div>
                  <small style={{ color: "var(--muted)", fontSize: "11px" }}>
                    صافي الفارق
                  </small>
                  <b style={{ display: "block", fontSize: "13px" }}>
                    {formatMoney(historyDetails.netCostPiasters)}
                  </b>
                </div>
              </div>

              <div
                style={{
                  maxHeight: "300px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                {historyDetails.items.map((it) => (
                  <div
                    key={it.storeVariantId}
                    style={{
                      background: "var(--surface, #1e221d)",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "13px",
                    }}
                  >
                    <div>
                      <b>{it.productName}</b>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                        متوقع: {it.expectedQuantityBase} · فعلي:{" "}
                        {it.countedQuantityBase ?? "لم يُعد"}
                      </div>
                    </div>
                    <div>
                      {it.discrepancyQuantityBase !== null &&
                      it.discrepancyQuantityBase !== 0 ? (
                        <span
                          style={{
                            color:
                              it.discrepancyQuantityBase < 0
                                ? "var(--red, #e63946)"
                                : "#4cc9f0",
                            fontWeight: 700,
                          }}
                        >
                          {it.discrepancyQuantityBase < 0
                            ? `عجز ${it.discrepancyQuantityBase}`
                            : `زيادة +${it.discrepancyQuantityBase}`}
                        </span>
                      ) : (
                        <span style={{ color: "var(--green, #2ec4b6)" }}>
                          مطابق
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ─── Record Loss Modal ─── */}
      {wasteItem && (
        <RecordLossModal
          item={wasteItem}
          onClose={() => setWasteItem(null)}
          onSaved={() => {
            setWasteItem(null);
            void loadSessions();
            onStockUpdated?.();
          }}
        />
      )}
    </div>
  );
}

export default StocktakePage;
