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

interface PhysicalStocktakeSheetProps {
  inventory: StockInventoryItem[];
  onStockUpdated?: () => void;
}

type FilterKind = "all" | "uncounted" | "shortage" | "surplus" | "matched";

export function PhysicalStocktakeSheet({
  inventory,
  onStockUpdated,
}: PhysicalStocktakeSheetProps) {
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

      if (data.activeSession) {
        // Load active session details
        const detRes = await fetch(
          `/api/stock/stocktake/${data.activeSession.id}`,
        );
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
  }, [showToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of stocktake data
    void loadSessions();
  }, [loadSessions]);

  // Start new session
  const handleStartSession = async () => {
    try {
      setSubmittingCreate(true);
      const res = await fetch("/api/stock/stocktake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: selectedScope,
          category: selectedScope === "category" ? selectedCategory : undefined,
          selectedVariantIds:
            selectedScope === "selected" ? selectedVariantIds : undefined,
          notes: sessionNotes || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "فشل بدء جلسة الجرد");
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
        throw new Error(err.message || "فشل في حفظ العد");
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
        throw new Error(err.message || "فشل في إلغاء الجرد");
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
        throw new Error(err.message || "فشل اعتماد الجرد والتسوية");
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
      <div className={styles.container}>
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

  // ─────────────── ACTIVE SESSION IN PROGRESS ───────────────
  if (sessionDetails && sessionDetails.status === "in_progress") {
    return (
      <div className={styles.container} data-testid="active-stocktake-session">
        {/* Session Header Card */}
        <div className={styles.sessionHeader}>
          <div className={styles.itemTop}>
            <div>
              <h3 className={styles.cardTitle}>
                <Icon n="boxes" s={18} />
                <span>
                  جلسة جرد جارية (
                  {sessionDetails.scope === "full"
                    ? "المحل بالكامل"
                    : sessionDetails.scope === "category"
                      ? `قسم ${sessionDetails.category}`
                      : "أصناف محددة"}
                  )
                </span>
              </h3>
              <p className={styles.cardSubtitle}>
                بدأت{" "}
                {new Date(sessionDetails.createdAt).toLocaleDateString(
                  "ar-EG",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "numeric",
                    month: "short",
                  },
                )}
              </p>
            </div>
            <span className={styles.bannerProgress}>
              تم عدّ {sessionMetrics.counted} من {sessionMetrics.total}
            </span>
          </div>

          <div className={styles.sessionStats}>
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
          </div>

          {/* Quick Filter Chips */}
          <div className={styles.filterChips}>
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

          {/* Search Box */}
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="ابحث بالاسم أو الباركود داخل الجرد..."
          />
        </div>

        {/* Items List */}
        <div className={styles.itemList}>
          {filteredItems.length === 0 ? (
            <Empty
              icon="search"
              title="مفيش أصناف مطابقة للبحث أو التصفية"
              sub="جرب تغيير الفلتر أو كلمة البحث"
            />
          ) : (
            filteredItems.map((it) => {
              const diff = it.liveDiff;
              const isShortage = diff !== null && diff < 0;
              const isSurplus = diff !== null && diff > 0;
              const isMatched = diff === 0;

              return (
                <div
                  key={it.id}
                  className={`${styles.itemCard} ${isShortage ? styles.itemCardHasDiscrepancy : ""} ${isSurplus ? styles.isSurplus : ""} ${isMatched ? styles.isMatched : ""}`}
                  data-testid="stocktake-item-card"
                >
                  <div className={styles.itemTop}>
                    <div>
                      <div className={styles.itemName}>{it.productName}</div>
                      <div className={styles.itemCategory}>
                        {it.category} {it.barcode ? `· ${it.barcode}` : ""}
                      </div>
                    </div>
                    <div className={styles.itemBadges}>
                      {!it.hasCount ? (
                        <span
                          className={`${styles.badge} ${styles.badgeUncounted}`}
                        >
                          لم يُعد
                        </span>
                      ) : isMatched ? (
                        <span
                          className={`${styles.badge} ${styles.badgeMatched}`}
                        >
                          مطابق ✓
                        </span>
                      ) : isShortage ? (
                        <span
                          className={`${styles.badge} ${styles.badgeShortage}`}
                        >
                          عجز {Math.abs(diff)} {it.unit}
                        </span>
                      ) : (
                        <span
                          className={`${styles.badge} ${styles.badgeSurplus}`}
                        >
                          زيادة +{diff} {it.unit}
                        </span>
                      )}

                      {it.movementsAfterCount && (
                        <span
                          className={`${styles.badge} ${styles.badgeWarning}`}
                        >
                          ⚠️ حركة بعد العد
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Movements notification if movements occurred during stocktake */}
                  {(it.movementsSinceSnapshot.sales > 0 ||
                    it.movementsSinceSnapshot.waste > 0 ||
                    it.movementsSinceSnapshot.purchases > 0) && (
                    <div style={{ fontSize: "11px", color: "var(--gold)" }}>
                      📌 حدثت حركات أثناء الجرد:
                      {it.movementsSinceSnapshot.sales > 0 &&
                        ` مبيعات (${it.movementsSinceSnapshot.sales})`}
                      {it.movementsSinceSnapshot.waste > 0 &&
                        ` هالك (${it.movementsSinceSnapshot.waste})`}
                      {it.movementsSinceSnapshot.purchases > 0 &&
                        ` وارد (${it.movementsSinceSnapshot.purchases})`}
                    </div>
                  )}

                  {/* Counter row */}
                  <div className={styles.itemRow}>
                    <div className={styles.expectedStock}>
                      <small>المتوقع بالسيستم</small>
                      <b>
                        {it.expectedQuantityBase} {it.unit}
                      </b>
                    </div>

                    <div className={styles.counter}>
                      <button
                        type="button"
                        className={styles.counterBtn}
                        onClick={() => {
                          const cur =
                            counts[it.storeVariantId] ??
                            it.expectedQuantityBase;
                          if (cur > 0) {
                            setCounts((prev) => ({
                              ...prev,
                              [it.storeVariantId]: cur - 1,
                            }));
                          }
                        }}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="0"
                        className={styles.counterInput}
                        value={counts[it.storeVariantId] ?? ""}
                        placeholder="العدد"
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          if (val === "") {
                            setCounts((prev) => {
                              const next = { ...prev };
                              delete next[it.storeVariantId];
                              return next;
                            });
                          } else {
                            const parsed = parseInt(val, 10);
                            if (!isNaN(parsed) && parsed >= 0) {
                              setCounts((prev) => ({
                                ...prev,
                                [it.storeVariantId]: parsed,
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
                            counts[it.storeVariantId] ??
                            it.expectedQuantityBase;
                          setCounts((prev) => ({
                            ...prev,
                            [it.storeVariantId]: cur + 1,
                          }));
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Discrepancy Classification selector when shortage occurs */}
                  {isShortage && (
                    <div className={styles.classificationSection}>
                      <span className={styles.classificationLabel}>
                        تصنيف العجز ({Math.abs(diff)} {it.unit}):
                      </span>
                      <select
                        className={styles.select}
                        value={it.liveClass}
                        onChange={(e) => {
                          const val = e.target
                            .value as StocktakeDiscrepancyKind;
                          setClassifications((prev) => ({
                            ...prev,
                            [it.storeVariantId]: val,
                          }));
                        }}
                      >
                        <option value="damaged_or_expired">
                          بضاعة تالفة / منتهية الصلاحية (تسجيل هالك)
                        </option>
                        <option value="unrecorded_sales">
                          مبيعات غير مسجلة (تسوية عجز دون تزوير فواتير)
                        </option>
                        <option value="unknown_adjustment">
                          تسوية عجز أخرى / غير محدد
                        </option>
                      </select>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: "4px",
                        }}
                      >
                        <span className={styles.discrepancyMoney}>
                          القيمة التقديرية:{" "}
                          {it.snapshotCostPiasters
                            ? formatMoney(
                                Math.abs(diff) * it.snapshotCostPiasters,
                              )
                            : "غير محدد التكلفة"}
                        </span>
                        <Button
                          kind="ghost"
                          size="sm"
                          onClick={() => {
                            const invItem = inventory.find(
                              (i) => i.variantId === it.storeVariantId,
                            );
                            if (invItem) setWasteItem(invItem);
                          }}
                        >
                          سجّل هالك فوراً
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Actions Bar */}
        <div className={styles.actionsBar}>
          <Button
            kind="soft"
            style={{ flex: 1 }}
            disabled={savingCounts}
            onClick={handleSaveCounts}
          >
            {savingCounts ? "جاري الحفظ…" : "حفظ العد"}
          </Button>
          <Button
            kind="primary"
            style={{ flex: 2 }}
            onClick={() => setShowReconcileModal(true)}
          >
            مراجعة واعتماد الجرد
          </Button>
          <Button
            kind="danger"
            size="sm"
            onClick={handleCancelSession}
            title="إلغاء جلسة الجرد"
          >
            إلغاء
          </Button>
        </div>

        {/* Reconcile Modal */}
        {showReconcileModal && (
          <Modal
            title="مراجعة واعتماد الجرد الفعلي"
            onClose={() => setShowReconcileModal(false)}
          >
            <div className={styles.reconcileBox} dir="rtl">
              <p style={{ fontSize: "13px", color: "var(--muted)", margin: 0 }}>
                تأكد من مراجعة كافة الفروقات. عند الضغط على اعتماد، سيتم تعديل
                كميات المخزون وتسجيل سجلات الهالك تلقائياً ومنع أي تلاعب.
              </p>

              <div className={styles.reconcileLine}>
                <span>إجمالي الأصناف</span>
                <b>{sessionMetrics.total} صنف</b>
              </div>
              <div className={styles.reconcileLine}>
                <span>أصناف تم عدّها</span>
                <b>{sessionMetrics.counted} صنف</b>
              </div>
              {sessionMetrics.uncounted > 0 && (
                <div
                  className={styles.reconcileLine}
                  style={{ color: "var(--red)" }}
                >
                  <span>أصناف لم تُعد بعد</span>
                  <b>{sessionMetrics.uncounted} صنف ⚠️</b>
                </div>
              )}
              <div className={styles.reconcileLine}>
                <span>أصناف مطابقة</span>
                <b style={{ color: "var(--green)" }}>
                  {sessionMetrics.matched} صنف
                </b>
              </div>
              <div className={styles.reconcileLine}>
                <span>أصناف بها عجز</span>
                <b style={{ color: "var(--red)" }}>
                  {sessionMetrics.shortage} صنف
                </b>
              </div>
              <div className={styles.reconcileLine}>
                <span>أصناف بها زيادة</span>
                <b style={{ color: "#4cc9f0" }}>{sessionMetrics.surplus} صنف</b>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  ملاحظات الاعتماد (اختياري):
                </label>
                <input
                  type="text"
                  className={styles.input}
                  value={reconcileNotes}
                  onChange={(e) => setReconcileNotes(e.target.value)}
                  placeholder="مثال: جرد نهاية الشهر، تسوية عجز البسكويت..."
                />
              </div>

              <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                <Button
                  kind="primary"
                  style={{ flex: 1 }}
                  disabled={reconciling || sessionMetrics.uncounted > 0}
                  onClick={handleReconcile}
                >
                  {reconciling
                    ? "جاري الاعتماد والتسوية…"
                    : "تأكيد واعتماد التسوية نهائياً"}
                </Button>
                <Button
                  kind="soft"
                  onClick={() => setShowReconcileModal(false)}
                >
                  رجوع
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {/* Record Loss Modal */}
        {wasteItem && (
          <RecordLossModal
            item={wasteItem}
            presetReason="expired"
            onClose={() => setWasteItem(null)}
            onSaved={() => {
              setWasteItem(null);
              showToast("تم تسجيل الهالك بنجاح", "ok");
              void loadSessions();
            }}
          />
        )}
      </div>
    );
  }

  // ─────────────── NO ACTIVE SESSION (SHOW START FORM & HISTORY) ───────────────
  return (
    <div className={styles.container} data-testid="stocktake-setup">
      {/* Create Session Card */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <Icon n="boxes" s={18} />
          <span>بدء جرد فعلي جديد</span>
        </h3>
        <p className={styles.cardSubtitle}>
          سيتم حفظ لقطة مخزون ثابتة لجميع الأصناف، مع احتساب أي مبيعات أو حركات
          واردة أثناء العدّ تلقائياً.
        </p>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>نطاق الجرد:</label>
          <select
            className={styles.select}
            value={selectedScope}
            onChange={(e) => setSelectedScope(e.target.value as StocktakeScope)}
          >
            <option value="full">المحل بالكامل (جميع المنتجات)</option>
            <option value="category">قسم معين فقط</option>
            <option value="selected">أصناف مختارة بالاسم</option>
          </select>
        </div>

        {selectedScope === "category" && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>اختر القسم للجرد:</label>
            <select
              className={styles.select}
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="">-- اختر القسم --</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedScope === "selected" && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>اختر الأصناف المراد جردها:</label>
            <div
              style={{
                maxHeight: "180px",
                overflowY: "auto",
                border: "1px solid var(--edge)",
                borderRadius: "10px",
                padding: "8px",
              }}
            >
              {inventory.map((inv) => (
                <label
                  key={inv.variantId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "4px 0",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedVariantIds.includes(inv.variantId)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedVariantIds((prev) => [
                          ...prev,
                          inv.variantId,
                        ]);
                      } else {
                        setSelectedVariantIds((prev) =>
                          prev.filter((id) => id !== inv.variantId),
                        );
                      }
                    }}
                  />
                  <span style={{ fontSize: "13px" }}>{inv.productName}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className={styles.fieldGroup}>
          <label className={styles.label}>ملاحظات الجرد (اختياري):</label>
          <input
            type="text"
            className={styles.input}
            placeholder="مثال: جرد دوري أسبوعي..."
            value={sessionNotes}
            onChange={(e) => setSessionNotes(e.target.value)}
          />
        </div>

        <Button
          kind="primary"
          size="lg"
          disabled={
            submittingCreate ||
            (selectedScope === "category" && !selectedCategory) ||
            (selectedScope === "selected" && selectedVariantIds.length === 0)
          }
          onClick={handleStartSession}
        >
          {submittingCreate ? "جاري بدء الجرد…" : "بدء جلسة الجرد الآن"}
        </Button>
      </div>

      {/* Stocktake History */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <Icon n="history" s={18} />
          <span>سجل عمليات الجرد السابقة ({historySessions.length})</span>
        </h3>

        {historySessions.length === 0 ? (
          <Empty
            icon="boxes"
            title="لا توجد عمليات جرد سابقة"
            sub="ابدأ أول جلسة جرد لمطابقة المخزون الفعلي مع السيستم"
          />
        ) : (
          <div className={styles.historyList}>
            {historySessions.map((s) => {
              const isReconciled = s.status === "reconciled";
              const isCancelled = s.status === "cancelled";

              return (
                <div
                  key={s.id}
                  className={styles.historyCard}
                  onClick={() => openHistoryDetails(s.id)}
                  data-testid="stocktake-history-card"
                >
                  <div className={styles.historyTop}>
                    <div className={styles.historyDate}>
                      {new Date(s.createdAt).toLocaleDateString("ar-EG", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </div>
                    <span
                      className={`${styles.badge} ${isReconciled ? styles.badgeMatched : isCancelled ? styles.badgeShortage : styles.badgeUncounted}`}
                    >
                      {isReconciled
                        ? "معتمد ومسوّى"
                        : isCancelled
                          ? "ملغي"
                          : "قيد التنفيذ"}
                    </span>
                  </div>

                  <div className={styles.historyStats}>
                    <span>الأصناف: {s.totalProducts}</span>
                    <span>عجز: {s.shortageCount}</span>
                    <span>زيادة: {s.surplusCount}</span>
                    {s.netCostPiasters !== 0 && (
                      <span
                        style={{
                          color:
                            s.netCostPiasters < 0 ? "var(--red)" : "#4cc9f0",
                          fontWeight: 700,
                        }}
                      >
                        الفرق: {formatMoney(s.netCostPiasters)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Historical Session Detail Modal */}
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
                padding: "20px",
                textAlign: "center",
                color: "var(--muted)",
              }}
            >
              جاري تحميل التفاصيل…
            </div>
          ) : (
            <div className={styles.reconcileBox} dir="rtl">
              <div className={styles.reconcileLine}>
                <span>الحالة</span>
                <b>
                  {historyDetails.status === "reconciled"
                    ? "معتمد ومسوّى ✓"
                    : historyDetails.status === "cancelled"
                      ? "ملغى"
                      : "قيد التنفيذ"}
                </b>
              </div>
              <div className={styles.reconcileLine}>
                <span>تاريخ الجرد</span>
                <b>
                  {new Date(historyDetails.createdAt).toLocaleDateString(
                    "ar-EG",
                    {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                </b>
              </div>
              <div className={styles.reconcileLine}>
                <span>إجمالي الأصناف</span>
                <b>{historyDetails.totalProducts} صنف</b>
              </div>
              <div className={styles.reconcileLine}>
                <span>أصناف مطابقة</span>
                <b style={{ color: "var(--green)" }}>
                  {historyDetails.matchedCount} صنف
                </b>
              </div>
              <div className={styles.reconcileLine}>
                <span>أصناف بها عجز</span>
                <b style={{ color: "var(--red)" }}>
                  {historyDetails.shortageCount} صنف
                </b>
              </div>
              <div className={styles.reconcileLine}>
                <span>أصناف بها زيادة</span>
                <b style={{ color: "#4cc9f0" }}>
                  {historyDetails.surplusCount} صنف
                </b>
              </div>
              <div className={`${styles.reconcileLine} ${styles.total}`}>
                <span>صافي الفرق المالي</span>
                <b
                  style={{
                    color:
                      historyDetails.netCostPiasters < 0
                        ? "var(--red)"
                        : "var(--ink)",
                  }}
                >
                  {formatMoney(historyDetails.netCostPiasters)}
                </b>
              </div>

              {historyDetails.notes && (
                <div
                  style={{
                    fontSize: "13px",
                    color: "var(--muted)",
                    marginTop: "6px",
                  }}
                >
                  <b>ملاحظات:</b> {historyDetails.notes}
                </div>
              )}

              <Button
                kind="soft"
                style={{ marginTop: "12px" }}
                onClick={() => {
                  setViewingHistoryId(null);
                  setHistoryDetails(null);
                }}
              >
                إغلاق
              </Button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
