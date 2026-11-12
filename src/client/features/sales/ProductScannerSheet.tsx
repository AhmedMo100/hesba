"use client";

/**
 * @file ProductScannerSheet.tsx
 * @description Live AI product scanner (ADR-0030): the camera runs continuously, frames are
 * analyzed automatically when the scene changes, recognized products accumulate in a list, and
 * the user finishes when done. Supports cash and credit sale modes. Uncertain matches are shown
 * for manual completion; nothing is sold here — confirmed lines go into the existing Sales cart.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Icon, Modal } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import {
  getScannerQuota,
  scanProducts,
  ScannerApiError,
  type ScanLineView,
  type ScanResultView,
  type ScannerQuotaView,
} from "@/client/shared/api/scanner";
import { hasSceneChanged, prepareFrame } from "./scan-images";
import styles from "./ProductScannerSheet.module.css";

export interface ScannerCatalogItem {
  variantId: string;
  name: string;
  unit: string;
  sellPricePiasters: number;
  stockBase: number;
}

export interface ConfirmedScanLine {
  variantId: string;
  name: string;
  unit: string;
  sellPricePiasters: number;
  stockBase: number;
  quantityBase: number;
}

interface AccItem {
  key: string;
  description: string;
  confidence: number;
  status: "matched" | "uncertain" | "unmatched";
  candidates: ScanLineView["candidates"];
  selectedVariantId: string | null;
  qty: string;
  removed: boolean;
  search: string;
}

const weighed = (unit: string) => unit === "kg" || unit === "g";

function stockLabel(base: number, unit: string): string {
  return weighed(unit)
    ? `${(base / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} كجم`
    : `${base}`;
}

function toBase(qty: string, unit: string): number {
  const n = Number(qty.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return weighed(unit) ? Math.round(n * 1000) : Math.floor(n);
}

const STATUS_LABEL: Record<ScanLineView["status"], string> = {
  matched: "متأكدين",
  uncertain: "محتاج تأكيدك",
  unmatched: "مش واضح",
};

const SCAN_INTERVAL_MS = 3000;
const SCAN_INITIAL_DELAY_MS = 1500;

export function ProductScannerSheet({
  catalog,
  creditCustomerName,
  onClose,
  onConfirm,
}: {
  catalog: ScannerCatalogItem[];
  creditCustomerName?: string | null;
  onClose: () => void;
  onConfirm: (lines: ConfirmedScanLine[]) => void;
}) {
  const [saleMode, setSaleMode] = useState<"cash" | "credit">(
    creditCustomerName ? "credit" : "cash",
  );
  const [phase, setPhase] = useState<"mode" | "scanning" | "review">("mode");
  const [accumulated, setAccumulated] = useState<AccItem[]>([]);
  const [quota, setQuota] = useState<ScannerQuotaView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [lastRecognized, setLastRecognized] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prevFrameRef = useRef<{ current: Uint8ClampedArray | null }>({
    current: null,
  });
  const processingRef = useRef(false);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const aliveRef = useRef(true);

  // Load quota on mount
  useEffect(() => {
    let alive = true;
    getScannerQuota()
      .then((q) => alive && setQuota(q))
      .catch(
        (e: unknown) =>
          alive &&
          e instanceof ScannerApiError &&
          e.status !== 0 &&
          setError(e.message),
      );
    return () => {
      alive = false;
    };
  }, []);

  const blocked =
    quota &&
    (!quota.enabled || (quota.remainingToday <= 0 && quota.bonusCredits <= 0));
  const blockedMessage = !quota
    ? null
    : !quota.enabled
      ? "خدمة اسكان المنتجات غير متاحة حاليًا."
      : quota.remainingThisMonth <= 0 && quota.bonusCredits <= 0
        ? "لقد وصلت إلى الحد الشهري المسموح لاستخدام اسكان المنتجات."
        : quota.remainingToday <= 0 && quota.bonusCredits <= 0
          ? "لقد وصلت إلى الحد اليومي المسموح لاستخدام اسكان المنتجات."
          : null;

  // Camera management
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("المتصفح ده مش بيدعم الكاميرا");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
        }
      });
    } catch (e: unknown) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError") {
        setCameraError(
          "محتاجين إذن الكاميرا. فعّل الكاميرا من إعدادات المتصفح وجرّب تاني.",
        );
      } else if (name === "NotFoundError" || name === "NotReadableError") {
        setCameraError("مفيش كاميرا متاحة أو الكاميرا مشغولة.");
      } else {
        setCameraError("مقدرناش نفتح الكاميرا. جرّب تاني.");
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, []);

  // Stop camera when leaving scanning phase
  useEffect(() => {
    if (phase !== "scanning") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing camera with phase
      stopCamera();
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    }
  }, [phase, stopCamera]);

  // Add a recognized scan line to the accumulated list (deduplicating by variant)
  const addRecognized = useCallback((line: ScanLineView) => {
    setAccumulated((prev) => {
      const top = line.candidates[0];
      if (line.status === "matched" && top) {
        const existing = prev.find(
          (p) => p.selectedVariantId === top.variantId && !p.removed,
        );
        if (existing) {
          // Same product already accumulated — bump quantity
          return prev.map((p) =>
            p.key === existing.key
              ? {
                  ...p,
                  qty: weighed(top.unit)
                    ? String(
                        (toBase(p.qty, top.unit) +
                          toBase(String(line.quantity), top.unit)) /
                          1000,
                      )
                    : String(
                        toBase(p.qty, top.unit) +
                          toBase(String(line.quantity), top.unit),
                      ),
                }
              : p,
          );
        }
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return [
        ...prev,
        {
          key,
          description: line.description,
          confidence: line.confidence,
          status: line.status,
          candidates: line.candidates,
          selectedVariantId:
            line.status === "matched" ? (top?.variantId ?? null) : null,
          qty: top && weighed(top.unit) ? "1" : String(line.quantity),
          removed: false,
          search: "",
        },
      ];
    });
    setLastRecognized(line.description);
    setTimeout(() => setLastRecognized(null), 2500);
  }, []);

  // Auto-scanning loop
  useEffect(() => {
    if (phase !== "scanning" || !cameraActive || blocked) return;
    let alive = true;

    const tick = async () => {
      if (!alive || processingRef.current) {
        if (alive) scanTimerRef.current = setTimeout(tick, 1000);
        return;
      }
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        if (alive) scanTimerRef.current = setTimeout(tick, 500);
        return;
      }
      if (!hasSceneChanged(video, prevFrameRef.current)) {
        if (alive) scanTimerRef.current = setTimeout(tick, 800);
        return;
      }

      processingRef.current = true;
      setIsProcessing(true);
      setError(null);

      try {
        const frame = prepareFrame(video);
        const opId = crypto.randomUUID();
        const result: ScanResultView = await scanProducts(opId, [frame.base64]);
        setQuota(result.quota);
        setScanCount((c) => c + 1);
        for (const line of result.lines) {
          addRecognized(line);
        }
      } catch (e: unknown) {
        if (e instanceof ScannerApiError) {
          const cat = e.category ?? "";
          if (
            ["shop_daily", "shop_monthly", "feature_disabled"].includes(cat)
          ) {
            setError(e.message);
            processingRef.current = false;
            setIsProcessing(false);
            return; // Stop scanning — quota exhausted
          }
          // Transient error — continue after delay
        }
      } finally {
        processingRef.current = false;
        setIsProcessing(false);
      }
      if (alive) scanTimerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
    };

    scanTimerRef.current = setTimeout(tick, SCAN_INITIAL_DELAY_MS);
    return () => {
      alive = false;
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cameraActive, blocked]);

  // Resolve a product by variantId (from scan candidates or the full catalog)
  const productOf = (variantId: string | null, item?: AccItem) => {
    if (!variantId) return null;
    const fromScan = item?.candidates.find((c) => c.variantId === variantId);
    if (fromScan) return fromScan;
    return catalog.find((c) => c.variantId === variantId) ?? null;
  };

  // Build confirmed lines (merging duplicates)
  const confirmed = useMemo(() => {
    const merged = new Map<string, ConfirmedScanLine>();
    for (const item of accumulated) {
      if (item.removed || !item.selectedVariantId) continue;
      const p = productOf(item.selectedVariantId, item);
      if (!p) continue;
      const q = toBase(item.qty, p.unit);
      if (q <= 0) continue;
      const prev = merged.get(item.selectedVariantId);
      merged.set(item.selectedVariantId, {
        variantId: item.selectedVariantId,
        name: p.name,
        unit: p.unit,
        sellPricePiasters: p.sellPricePiasters,
        stockBase: p.stockBase,
        quantityBase: (prev?.quantityBase ?? 0) + q,
      });
    }
    return [...merged.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accumulated, catalog]);

  const pendingChoice = accumulated.filter(
    (a) => !a.removed && !a.selectedVariantId,
  ).length;
  const overStock = confirmed.filter((l) => l.quantityBase > l.stockBase);

  const setChoice = (key: string, patch: Partial<AccItem>) =>
    setAccumulated((prev) =>
      prev.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    );

  const startScanning = (mode: "cash" | "credit") => {
    setSaleMode(mode);
    setPhase("scanning");
    void startCamera();
  };

  const finishScanning = () => {
    stopCamera();
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    setPhase("review");
  };

  const close = () => {
    if (
      accumulated.length > 0 &&
      phase !== "mode" &&
      !window.confirm("الأصناف اللي اتعرف عليها هتتمسح. متأكد؟")
    ) {
      return;
    }
    stopCamera();
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    onClose();
  };

  // ──── Mode selection ────
  const modeView = (
    <div className={styles.modeSelect} data-testid="scan-mode-select">
      <p className={styles.modeHint}>اختر نوع البيع</p>
      {blocked && blockedMessage && (
        <div className={styles.notice} role="alert" data-testid="scan-blocked">
          {blockedMessage}
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <div className={styles.modeButtons}>
        <button
          type="button"
          className={styles.modeBtn}
          onClick={() => startScanning("cash")}
          disabled={!!blocked}
          data-testid="scan-mode-cash"
        >
          <Icon n="wallet" s={28} />
          <span>نقدي</span>
        </button>
        <button
          type="button"
          className={styles.modeBtn}
          onClick={() => {
            if (!creditCustomerName) {
              setError("اختر العميل من صفحة البيع أولاً");
              return;
            }
            startScanning("credit");
          }}
          disabled={!!blocked}
          data-testid="scan-mode-credit"
        >
          <Icon n="users" s={28} />
          <span>آجل</span>
          {creditCustomerName && (
            <small className={styles.modeCust}>{creditCustomerName}</small>
          )}
        </button>
      </div>
      {quota && quota.enabled && (
        <p className={styles.quota} data-testid="scan-quota">
          {quota.remainingToday > 0
            ? `متبقي لك ${quota.remainingToday} عمليات اسكان اليوم`
            : quota.bonusCredits > 0
              ? `متبقي لك ${quota.bonusCredits} عملية اسكان إضافية`
              : null}
        </p>
      )}
      <p className={styles.hint}>
        صوّب الكاميرا على المنتجات — بنتعرّف عليها تلقائيًا. بنبعت الصور بس — من
        غير أسعار ولا بيانات محلك — ومش بنحفظها.
      </p>
    </div>
  );

  // ──── Accumulated products list (shared between scanning & review) ────
  const itemsList = (
    <ul className={styles.lines}>
      {accumulated.map((item) => {
        if (item.removed) return null;
        const chosen = productOf(item.selectedVariantId, item);
        const unit = chosen?.unit ?? item.candidates[0]?.unit ?? "piece";
        const base = toBase(item.qty, unit);
        const q = normalizeArabic(item.search);
        const found = q
          ? catalog
              .filter((c) => normalizeArabic(c.name).includes(q))
              .slice(0, 5)
          : [];

        return (
          <li
            key={item.key}
            className={styles.line}
            data-testid={`scan-line-${item.key}`}
            data-status={item.status}
          >
            <div className={styles.lineHead}>
              <span className={`${styles.badge} ${styles[item.status]}`}>
                {STATUS_LABEL[item.status]}
              </span>
              <b className={styles.seen}>{item.description}</b>
              <button
                type="button"
                className={styles.remove}
                onClick={() => setChoice(item.key, { removed: true })}
                data-testid="scan-remove"
                aria-label="شيل الصنف"
              >
                <Icon n="trash" s={18} />
              </button>
            </div>
            <p className={styles.meta}>
              ثقة {Math.round(item.confidence * 100)}%
            </p>

            {item.status === "unmatched" && !item.selectedVariantId && (
              <p className={styles.warn}>
                لم نتمكن من تحديد المنتج بدقة — دوّر عليه بإيدك
              </p>
            )}
            {item.candidates.length > 0 && (
              <div
                role="radiogroup"
                aria-label="المنتج"
                className={styles.cands}
              >
                {item.candidates.map((c) => (
                  <label key={c.variantId} className={styles.cand}>
                    <input
                      type="radio"
                      name={`cand-${item.key}`}
                      checked={item.selectedVariantId === c.variantId}
                      onChange={() =>
                        setChoice(item.key, { selectedVariantId: c.variantId })
                      }
                      data-testid="scan-candidate"
                    />
                    <span className={styles.candName}>{c.name}</span>
                    <span className={styles.candMeta}>
                      {formatMoney(c.sellPricePiasters)} · متاح{" "}
                      {stockLabel(c.stockBase, c.unit)}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {chosen &&
              !item.candidates.some(
                (c) => c.variantId === item.selectedVariantId,
              ) && (
                <p className={styles.picked}>
                  اخترت: <b>{chosen.name}</b> —{" "}
                  {formatMoney(chosen.sellPricePiasters)}
                </p>
              )}
            <input
              className={styles.search}
              value={item.search}
              onChange={(e) => setChoice(item.key, { search: e.target.value })}
              placeholder="مش ده؟ دوّر على المنتج الصح"
              aria-label="دوّر على المنتج"
              data-testid="scan-search"
            />
            {found.length > 0 && (
              <ul className={styles.found}>
                {found.map((p) => (
                  <li key={p.variantId}>
                    <button
                      type="button"
                      onClick={() =>
                        setChoice(item.key, {
                          selectedVariantId: p.variantId,
                          search: "",
                        })
                      }
                      data-testid="scan-search-option"
                    >
                      {p.name} · {formatMoney(p.sellPricePiasters)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {chosen && (
              <label className={styles.qty}>
                <span>{weighed(unit) ? "الكمية (كيلو)" : "العدد"}</span>
                <input
                  inputMode={weighed(unit) ? "decimal" : "numeric"}
                  value={item.qty}
                  onChange={(e) => setChoice(item.key, { qty: e.target.value })}
                  data-testid="scan-qty"
                />
              </label>
            )}
            {chosen && base > chosen.stockBase && (
              <p className={styles.warn} role="alert">
                المتاح {stockLabel(chosen.stockBase, chosen.unit)} بس
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );

  // ──── Scanning view ────
  const scanningView = (
    <div className={styles.wrap} data-testid="product-scanner">
      <div className={styles.scanHeader}>
        <span className={styles.modeBadge}>
          {saleMode === "credit" ? `آجل — ${creditCustomerName}` : "نقدي"}
        </span>
        {quota && quota.enabled && quota.remainingToday > 0 && (
          <span className={styles.quotaBadge}>
            متبقي {quota.remainingToday}
          </span>
        )}
      </div>

      {cameraError && (
        <div
          className={styles.error}
          role="alert"
          data-testid="scan-camera-error"
        >
          {cameraError}
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert" data-testid="scan-error">
          {error}
        </div>
      )}

      {cameraActive && (
        <div className={styles.viewfinder} data-testid="scan-viewfinder">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={styles.video}
          />
          <div className={styles.scanOverlay}>
            {isProcessing && (
              <span className={styles.scanPulse} data-testid="scan-processing">
                بنتعرف…
              </span>
            )}
            {lastRecognized && !isProcessing && (
              <span className={styles.scanFound}>✓ {lastRecognized}</span>
            )}
          </div>
        </div>
      )}
      {!cameraActive && !cameraError && (
        <div className={styles.actions}>
          <Button
            kind="ghost"
            icon="camera"
            onClick={() => void startCamera()}
            data-testid="scan-camera"
          >
            افتح الكاميرا
          </Button>
        </div>
      )}

      {accumulated.filter((a) => !a.removed).length > 0 && (
        <>
          <p className={styles.hint}>
            {accumulated.filter((a) => !a.removed).length} صنف تم التعرف عليه
            {scanCount > 0 && ` · ${scanCount} عملية اسكان`}
          </p>
          {itemsList}
        </>
      )}
    </div>
  );

  // ──── Review view ────
  const reviewView = (
    <div className={styles.wrap} data-testid="product-scanner">
      <div className={styles.scanHeader}>
        <span className={styles.modeBadge}>
          {saleMode === "credit" ? `آجل — ${creditCustomerName}` : "نقدي"}
        </span>
      </div>

      {accumulated.filter((a) => !a.removed).length === 0 ? (
        <p className={styles.hint}>
          مقدرناش نتعرف على أي منتج. ارجع للاسكان أو دوّر بإيدك.
        </p>
      ) : (
        <>
          <p className={styles.hint}>راجع الأصناف وعدّل اللي محتاج تعديل</p>
          {itemsList}
        </>
      )}
      <Button
        kind="ghost"
        icon="camera"
        onClick={() => {
          setPhase("scanning");
          prevFrameRef.current = { current: null };
          void startCamera();
        }}
        data-testid="scan-again"
      >
        ارجع للاسكان
      </Button>
    </div>
  );

  // ──── Footer ────
  const footer =
    phase === "mode" ? null : phase === "review" ? (
      <div className={styles.footer}>
        {pendingChoice > 0 && (
          <p className={styles.hint} role="status">
            {pendingChoice} صنف محتاج تختاره أو تشيله
          </p>
        )}
        <Button
          kind="primary"
          size="lg"
          wide
          disabled={
            confirmed.length === 0 || pendingChoice > 0 || overStock.length > 0
          }
          onClick={() => onConfirm(confirmed)}
          data-testid="scan-confirm"
        >
          {creditCustomerName
            ? `ضيف ${confirmed.length} صنف لفاتورة ${creditCustomerName}`
            : `ضيف ${confirmed.length} صنف للفاتورة`}
        </Button>
      </div>
    ) : (
      <div className={styles.footer}>
        <Button
          kind="primary"
          size="lg"
          wide
          disabled={accumulated.filter((a) => !a.removed).length === 0}
          onClick={finishScanning}
          data-testid="scan-finish"
        >
          إنهاء الاسكان ({accumulated.filter((a) => !a.removed).length} صنف)
        </Button>
      </div>
    );

  return (
    <Modal
      title="اسكان المنتجات بالذكاء الاصطناعي"
      onClose={close}
      footer={footer}
    >
      {phase === "mode"
        ? modeView
        : phase === "scanning"
          ? scanningView
          : reviewView}
    </Modal>
  );
}
