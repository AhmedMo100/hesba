"use client";

/**
 * @file ProductScannerSheet.tsx
 * @description «اسكان المنتجات بالذكاء الاصطناعي» (ADR-0030): take or pick several photos,
 * review / remove them, press «تم», then confirm what was recognized — each line matched to a
 * real product of the shop (price, stock and unit from the server), with uncertain matches left
 * for the user to choose, manual search for anything unclear, quantities and removal. Confirmed
 * lines go into the existing Sales cart (normal or credit sale); nothing is sold here.
 *
 * Offline the photos stay in this sheet and manual search keeps working; nothing is sent and no
 * credit is used.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, Modal } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { useRetryOpId } from "@/client/shared/hooks/useRetryOpId";
import { normalizeArabic } from "@/domain/normalize";
import {
  getScannerQuota,
  scanProducts,
  ScannerApiError,
  type ScanLineView,
  type ScanResultView,
  type ScannerQuotaView,
} from "@/client/shared/api/scanner";
import { preparePhoto, type PreparedPhoto } from "./scan-images";
import styles from "./ProductScannerSheet.module.css";

/** A shop product the user can pick by hand (from the Sales screen's own list). */
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

interface Choice {
  variantId: string | null;
  /** In the product's unit: pieces, or kg (decimal) for weighed products. */
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
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [phase, setPhase] = useState<"capture" | "processing" | "review">(
    "capture",
  );
  const [result, setResult] = useState<ScanResultView | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [quota, setQuota] = useState<ScannerQuotaView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const op = useRetryOpId();

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

  const maxImages = quota?.maxImages ?? 6;
  const blocked =
    quota &&
    (!quota.enabled || (quota.remainingToday <= 0 && quota.bonusCredits <= 0));
  const blockedMessage = !quota
    ? null
    : !quota.enabled
      ? "خدمة اسكان المنتجات غير متاحة حاليًا."
      : quota.remainingThisMonth <= 0 && quota.bonusCredits <= 0
        ? "لقد وصلت إلى الحد الشهري المسموح لاستخدام اسكان المنتجات."
        : "لقد وصلت إلى الحد اليومي المسموح لاستخدام اسكان المنتجات. يمكنك الاستمرار في البحث عن المنتجات وإضافتها يدويًا.";

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const room = maxImages - photos.length;
    if (room <= 0) {
      setError(`أقصى عدد ${maxImages} صور في الاسكان الواحد`);
      return;
    }
    setPreparing(true);
    const next: PreparedPhoto[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      try {
        next.push(await preparePhoto(f));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "مقدرناش نفتح الصورة");
      }
    }
    if (files.length > room)
      setError(`اتضاف ${room} بس — أقصى عدد ${maxImages} صور`);
    setPhotos((p) => [...p, ...next]);
    setPreparing(false);
  };

  const startChoices = (r: ScanResultView) => {
    const c: Record<string, Choice> = {};
    for (const l of r.lines) {
      const top = l.candidates[0];
      const unit = top?.unit ?? "piece";
      c[l.key] = {
        // Only a confident match is pre-selected; anything else waits for the user.
        variantId: l.status === "matched" ? (top?.variantId ?? null) : null,
        qty: weighed(unit) ? "1" : String(l.quantity),
        removed:
          l.status === "unmatched" && l.candidates.length === 0 ? false : false,
        search: "",
      };
    }
    setChoices(c);
  };

  const process = async () => {
    if (photos.length === 0) {
      setError("صوّر منتج واحد على الأقل");
      return;
    }
    setError(null);
    setPhase("processing");
    const payload = photos.map((p) => p.id);
    try {
      const r = await scanProducts(
        op.opIdFor(payload),
        photos.map((p) => p.base64),
      );
      op.reset();
      setResult(r);
      setQuota(r.quota);
      startChoices(r);
      setPhase("review");
    } catch (e: unknown) {
      setPhase("capture");
      setError(
        e instanceof Error ? e.message : "حصل خطأ في الاسكان، جرّب تاني",
      );
    }
  };

  const productOf = (variantId: string | null, line?: ScanLineView) => {
    if (!variantId) return null;
    const fromScan = line?.candidates.find((c) => c.variantId === variantId);
    if (fromScan) return fromScan;
    return catalog.find((c) => c.variantId === variantId) ?? null;
  };

  const confirmed = useMemo(() => {
    if (!result) return [] as ConfirmedScanLine[];
    const merged = new Map<string, ConfirmedScanLine>();
    for (const line of result.lines) {
      const ch = choices[line.key];
      if (!ch || ch.removed) continue;
      const p = productOf(ch.variantId, line);
      if (!p || !ch.variantId) continue;
      const q = toBase(ch.qty, p.unit);
      if (q <= 0) continue;
      // The same product chosen on two lines is one cart line (no accidental double add).
      const prev = merged.get(ch.variantId);
      merged.set(ch.variantId, {
        variantId: ch.variantId,
        name: p.name,
        unit: p.unit,
        sellPricePiasters: p.sellPricePiasters,
        stockBase: p.stockBase,
        quantityBase: (prev?.quantityBase ?? 0) + q,
      });
    }
    return [...merged.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, choices, catalog]);

  const pendingChoice = result
    ? result.lines.filter((l) => {
        const ch = choices[l.key];
        return ch && !ch.removed && !ch.variantId;
      }).length
    : 0;
  const overStock = confirmed.filter((l) => l.quantityBase > l.stockBase);

  const setChoice = (key: string, patch: Partial<Choice>) =>
    setChoices((c) => ({ ...c, [key]: { ...c[key]!, ...patch } }));

  const footer =
    phase === "review" ? (
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
      <Button
        kind="primary"
        size="lg"
        wide
        busy={phase === "processing"}
        disabled={
          phase === "processing" ||
          preparing ||
          photos.length === 0 ||
          !!blocked
        }
        onClick={() => void process()}
        data-testid="scan-process"
      >
        {phase === "processing"
          ? "بنتعرف على المنتجات…"
          : `تم (${photos.length} صورة)`}
      </Button>
    );

  const close = () => {
    if (phase === "processing") return;
    if (
      photos.length > 0 &&
      phase === "capture" &&
      !window.confirm("الصور اللي صورتها هتتمسح. متأكد؟")
    ) {
      return;
    }
    onClose();
  };

  return (
    <Modal
      title="اسكان المنتجات بالذكاء الاصطناعي"
      onClose={close}
      footer={footer}
    >
      <div className={styles.wrap} data-testid="product-scanner">
        {quota && (
          <p className={styles.quota} data-testid="scan-quota">
            {quota.enabled && quota.remainingToday > 0
              ? `متبقي لك ${quota.remainingToday} عمليات اسكان اليوم`
              : quota.enabled && quota.bonusCredits > 0
                ? `متبقي لك ${quota.bonusCredits} عملية اسكان إضافية`
                : null}
          </p>
        )}
        {blocked && blockedMessage && (
          <div
            className={styles.notice}
            role="alert"
            data-testid="scan-blocked"
          >
            {blockedMessage}
          </div>
        )}
        {error && (
          <div className={styles.error} role="alert" data-testid="scan-error">
            {error}
          </div>
        )}

        {phase !== "review" && (
          <>
            <p className={styles.hint}>
              صوّر المنتجات بوضوح (ممكن أكتر من منتج في الصورة، ولحد {maxImages}{" "}
              صور). بنبعت الصور بس — من غير أسعار ولا بيانات محلك — ومش بنحفظها.
            </p>
            <div className={styles.thumbs} data-testid="scan-photos">
              {photos.map((p, i) => (
                <figure key={p.id} className={styles.thumb}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt={`صورة ${i + 1}`} />
                  <button
                    type="button"
                    className={styles.thumbX}
                    aria-label={`شيل صورة ${i + 1}`}
                    onClick={() =>
                      setPhotos((ps) => ps.filter((x) => x.id !== p.id))
                    }
                    disabled={phase === "processing"}
                  >
                    <Icon n="x" s={16} />
                  </button>
                  <figcaption>{i + 1}</figcaption>
                </figure>
              ))}
            </div>
            <div className={styles.actions}>
              <Button
                kind="ghost"
                icon="plus"
                onClick={() => cameraRef.current?.click()}
                disabled={phase === "processing" || photos.length >= maxImages}
                data-testid="scan-camera"
              >
                {photos.length ? "صوّر تاني" : "افتح الكاميرا"}
              </Button>
              <Button
                kind="ghost"
                icon="layers"
                onClick={() => galleryRef.current?.click()}
                disabled={phase === "processing" || photos.length >= maxImages}
                data-testid="scan-gallery"
              >
                من الصور
              </Button>
            </div>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              data-testid="scan-camera-input"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              data-testid="scan-file-input"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        )}

        {phase === "review" && result && (
          <>
            {result.provider === "mock" && (
              <div className={styles.notice} data-testid="scan-mock">
                وضع تجريبي: السيرفر مش متوصل بنموذج تعرّف حقيقي، والنتيجة دي
                ثابتة للتجربة.
              </div>
            )}
            {result.lines.length === 0 && (
              <p className={styles.hint}>
                مقدرناش نتعرف على أي منتج. صوّر تاني أو دوّر بإيدك.
              </p>
            )}
            <ul className={styles.lines}>
              {result.lines.map((line) => {
                const ch = choices[line.key];
                if (!ch) return null;
                const chosen = productOf(ch.variantId, line);
                const unit =
                  chosen?.unit ?? line.candidates[0]?.unit ?? "piece";
                const base = toBase(ch.qty, unit);
                const q = normalizeArabic(ch.search);
                const found = q
                  ? catalog
                      .filter((c) => normalizeArabic(c.name).includes(q))
                      .slice(0, 5)
                  : [];
                return (
                  <li
                    key={line.key}
                    className={`${styles.line} ${ch.removed ? styles.removed : ""}`}
                    data-testid={`scan-line-${line.key}`}
                    data-status={line.status}
                  >
                    <div className={styles.lineHead}>
                      <span
                        className={`${styles.badge} ${styles[line.status]}`}
                      >
                        {STATUS_LABEL[line.status]}
                      </span>
                      <b className={styles.seen}>{line.description}</b>
                      <button
                        type="button"
                        className={styles.remove}
                        onClick={() =>
                          setChoice(line.key, { removed: !ch.removed })
                        }
                        data-testid="scan-remove"
                        aria-label={ch.removed ? "رجّع الصنف" : "شيل الصنف"}
                      >
                        <Icon n={ch.removed ? "undo" : "trash"} s={18} />
                      </button>
                    </div>
                    <p className={styles.meta}>
                      {line.imageIndexes.length > 1
                        ? `ظهر في الصور ${line.imageIndexes.map((i) => i + 1).join(" و")} — راجع العدد`
                        : `في صورة ${line.imageIndexes[0]! + 1}`}
                      {` · ثقة ${Math.round(line.confidence * 100)}%`}
                    </p>

                    {!ch.removed && (
                      <>
                        {line.status === "unmatched" && !ch.variantId && (
                          <p className={styles.warn}>
                            لم نتمكن من تحديد المنتج بدقة
                          </p>
                        )}
                        {line.candidates.length > 0 && (
                          <div
                            role="radiogroup"
                            aria-label="المنتج"
                            className={styles.cands}
                          >
                            {line.candidates.map((c) => (
                              <label key={c.variantId} className={styles.cand}>
                                <input
                                  type="radio"
                                  name={`cand-${line.key}`}
                                  checked={ch.variantId === c.variantId}
                                  onChange={() =>
                                    setChoice(line.key, {
                                      variantId: c.variantId,
                                    })
                                  }
                                  data-testid="scan-candidate"
                                />
                                <span className={styles.candName}>
                                  {c.name}
                                </span>
                                <span className={styles.candMeta}>
                                  {formatMoney(c.sellPricePiasters)} · متاح{" "}
                                  {stockLabel(c.stockBase, c.unit)}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                        {chosen &&
                          !line.candidates.some(
                            (c) => c.variantId === ch.variantId,
                          ) && (
                            <p className={styles.picked}>
                              اخترت: <b>{chosen.name}</b> —{" "}
                              {formatMoney(chosen.sellPricePiasters)}
                            </p>
                          )}
                        <input
                          className={styles.search}
                          value={ch.search}
                          onChange={(e) =>
                            setChoice(line.key, { search: e.target.value })
                          }
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
                                    setChoice(line.key, {
                                      variantId: p.variantId,
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
                            <span>
                              {weighed(unit) ? "الكمية (كيلو)" : "العدد"}
                            </span>
                            <input
                              inputMode={weighed(unit) ? "decimal" : "numeric"}
                              value={ch.qty}
                              onChange={(e) =>
                                setChoice(line.key, { qty: e.target.value })
                              }
                              data-testid="scan-qty"
                            />
                          </label>
                        )}
                        {chosen && base > chosen.stockBase && (
                          <p className={styles.warn} role="alert">
                            المتاح {stockLabel(chosen.stockBase, chosen.unit)}{" "}
                            بس
                          </p>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <Button
              kind="ghost"
              icon="refresh"
              onClick={() => {
                setPhase("capture");
                setResult(null);
                setPhotos([]);
              }}
              data-testid="scan-again"
            >
              اسكان جديد
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
