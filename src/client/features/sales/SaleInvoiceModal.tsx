"use client";

/**
 * @file SaleInvoiceModal.tsx
 * @description One sale's details (V19 sheet): the invoice (number, time, how it was paid, the
 * customer, its state), every line with what was sold, returned and is left, its unit price and
 * total, and a partial return typed in the unit the product is sold in (pieces or cartons,
 * jars, bags, kilos or grams) with its value shown before confirming. For a credit sale: what
 * the customer still owes, and collecting from it. Every figure comes from the server
 * (`GET /api/sales/:id`); a return or a payment is shown done only after the server recorded
 * it, and a retried tap reuses its `opId`.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import { returnValue } from "@/domain/sale-return";
import {
  getSaleInvoice,
  paySaleInvoice,
  returnSaleLines,
  type SaleInvoice,
} from "@/client/shared/api/invoices";
import { invoiceNumberOf } from "@/schemas/sale";
import {
  describeBase,
  returnBase,
  saleShape,
  type SaleUnit,
  type WeightUnit,
} from "./sale-quantity";
import type { DisplaySaleItem } from "./sales.logic";
import styles from "./SalesView.module.css";

type Line = SaleInvoice["lines"][number];

const PAY_LABEL: Record<string, string> = {
  cash: "💵 كاش",
  wallet: "📱 محفظة",
  card: "💳 كارت",
  debt: "📒 آجل",
};

/** The line as the sell sheet reads a product (its unit, pack and contents). */
function lineShape(l: Line) {
  const weighed = l.unit === "kg" || l.unit === "g";
  const item: DisplaySaleItem = {
    id: l.id,
    variantId: l.variantId ?? undefined,
    productId: l.id,
    name: l.name,
    sellPricePiasters: l.unitPricePiasters,
    unitMode: weighed ? "weight" : "piece",
    packQty: l.packQty || 1,
    currentStockBase: 0,
    status: "ok",
    unit: l.unit,
    packName: l.packName,
    sizeValue: l.sizeValue,
    sizeUnit: l.packName,
  };
  return saleShape(item);
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  }).format(new Date(iso));

interface Draft {
  qty: string;
  unit: SaleUnit;
  weightUnit: WeightUnit;
}

export function SaleInvoiceModal({
  saleId,
  onClose,
  onChanged,
}: {
  saleId: string;
  onClose: () => void;
  /** Called after a return or a payment, so the screen re-reads sales and stock. */
  onChanged: (message: string) => void;
}) {
  const [invoice, setInvoice] = useState<SaleInvoice | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [collect, setCollect] = useState("");
  const [busy, setBusy] = useState<"return" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returnOp = useRef<{ key: string; id: string } | null>(null);
  const payOp = useRef(crypto.randomUUID());

  const load = useCallback(() => {
    getSaleInvoice(saleId)
      .then((next) => {
        setLoadError(false);
        setInvoice(next);
      })
      .catch(() => setLoadError(true));
  }, [saleId]);
  useEffect(load, [load]);

  const draftOf = (id: string): Draft =>
    drafts[id] ?? { qty: "", unit: "base", weightUnit: "kg" };
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftOf(id), ...patch } }));

  /** Each typed return, read in its line's unit: the base quantity and its value. */
  const planned = (invoice?.lines ?? []).map((l) => {
    const d = draftOf(l.id);
    if (!d.qty.trim()) return { line: l, base: 0, value: 0, error: null };
    const shape = lineShape(l);
    const r = returnBase(shape, d.qty, d.unit, d.weightUnit);
    if ("error" in r) return { line: l, base: 0, value: 0, error: r.error };
    const left = l.quantityBase - l.returnedQuantityBase;
    if (r.base > left) {
      return {
        line: l,
        base: 0,
        value: 0,
        error: `أكتر من الباقي (${describeBase(shape, left)})`,
      };
    }
    return {
      line: l,
      base: r.base,
      value: Number(
        returnValue(
          BigInt(l.totalPiasters),
          l.quantityBase,
          l.returnedQuantityBase,
          r.base,
        ),
      ),
      error: null,
    };
  });
  const toReturn = planned.filter((p) => p.base > 0);
  const returnTotal = toReturn.reduce((s, p) => s + p.value, 0);
  const typedError = planned.find((p) => p.error)?.error ?? null;

  const submitReturn = async () => {
    if (!invoice) return;
    if (typedError) {
      setError(typedError);
      return;
    }
    if (toReturn.length === 0) {
      setError(t("invoice.nothingToReturn"));
      return;
    }
    const lines = toReturn.map((p) => ({
      saleLineId: p.line.id,
      quantityBase: p.base,
      condition: "sellable" as const,
    }));
    // The same return retried (lost answer, double tap) keeps its opId: recorded once.
    const key = JSON.stringify(lines);
    if (returnOp.current?.key !== key) {
      returnOp.current = { key, id: crypto.randomUUID() };
    }
    setBusy("return");
    setError(null);
    try {
      const before = invoice.returnedPiasters;
      const next = await returnSaleLines(saleId, returnOp.current.id, lines);
      returnOp.current = null;
      setInvoice(next);
      setDrafts({});
      onChanged(
        t("invoice.returnDone", {
          amount: formatMoney(next.returnedPiasters - before),
        }),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("invoice.loadFailed"));
    } finally {
      setBusy(null);
    }
  };

  const submitPayment = async () => {
    const amount = parseEgpStrict(collect);
    if (amount === null || amount <= 0) {
      setError(t("invoice.invalidAmount"));
      return;
    }
    setBusy("pay");
    setError(null);
    try {
      const next = await paySaleInvoice(saleId, payOp.current, amount);
      payOp.current = crypto.randomUUID();
      setInvoice(next);
      setCollect("");
      onChanged(t("invoice.collectDone"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("invoice.loadFailed"));
    } finally {
      setBusy(null);
    }
  };

  const status = !invoice
    ? ""
    : invoice.voided
      ? "اتلغت"
      : invoice.lines.every(
            (l) => !l.returnable || l.returnedQuantityBase >= l.quantityBase,
          ) && invoice.returnedPiasters > 0
        ? "اترجعت كلها"
        : invoice.returnedPiasters > 0
          ? "عليها مرتجع"
          : invoice.paymentMethod === "debt" && invoice.outstandingPiasters > 0
            ? "آجل — لسه عليها فلوس"
            : "مدفوعة";

  return (
    <Modal title={`🧾 فاتورة ${invoiceNumberOf(saleId)}`} onClose={onClose}>
      <div className={styles.sellSheet} data-testid="sale-invoice">
        {loadError ? (
          <>
            <p className={styles.note} role="alert">
              {t("invoice.loadFailed")}
            </p>
            <button type="button" className={styles.ghostBtn} onClick={load}>
              {t("invoice.retry")}
            </button>
          </>
        ) : !invoice ? (
          <p className={styles.note}>بتحمّل…</p>
        ) : (
          <>
            <div className={styles.sumbox}>
              <div className={styles.line}>
                <span>الوقت</span>
                <b>{when(invoice.createdAt)}</b>
              </div>
              <div className={styles.line}>
                <span>الدفع</span>
                <b data-testid="invoice-payment">
                  {PAY_LABEL[invoice.paymentMethod] ?? invoice.paymentMethod}
                </b>
              </div>
              {invoice.customerName && (
                <div className={styles.line}>
                  <span>العميل</span>
                  <b data-testid="invoice-customer">{invoice.customerName}</b>
                </div>
              )}
              <div className={styles.line}>
                <span>الحالة</span>
                <b data-testid="invoice-status">{status}</b>
              </div>
            </div>

            <div className={styles.lbl}>الأصناف</div>
            {invoice.lines.map((l) => {
              const shape = lineShape(l);
              const left = l.quantityBase - l.returnedQuantityBase;
              const d = draftOf(l.id);
              const plan = planned.find((p) => p.line.id === l.id);
              const canReturn = l.returnable && left > 0 && !invoice.voided;
              const pack = shape.kind === "count" ? shape.pack : null;
              return (
                <div
                  key={l.id}
                  className={styles.retRow}
                  data-testid="invoice-line"
                >
                  <div className={styles.line}>
                    <b>{l.name}</b>
                    <b>{formatMoney(l.totalPiasters)}</b>
                  </div>
                  <div className={styles.retFacts}>
                    <span data-testid="invoice-line-sold">
                      اتباع: {describeBase(shape, l.quantityBase)}
                    </span>
                    <span>
                      سعر{" "}
                      {shape.kind === "weight"
                        ? "الكيلو"
                        : shape.one.startsWith("ال")
                          ? shape.one
                          : `ال${shape.one}`}
                      :{" "}
                      {formatMoney(
                        l.unit === "g"
                          ? l.unitPricePiasters * 1000
                          : l.unitPricePiasters,
                      )}
                    </span>
                    {l.returnedQuantityBase > 0 && (
                      <span data-testid="invoice-line-returned">
                        اترجع: {describeBase(shape, l.returnedQuantityBase)} ·{" "}
                        {formatMoney(l.returnedPiasters)}
                      </span>
                    )}
                    <span data-testid="invoice-line-left">
                      الباقي: {describeBase(shape, left)}
                    </span>
                  </div>
                  {canReturn && (
                    <>
                      {pack && (
                        <div className={styles.chips}>
                          {(["base", "pack"] as const).map((u) => (
                            <button
                              key={u}
                              type="button"
                              className={`${styles.chip} ${d.unit === u ? styles.chipOn : ""}`}
                              onClick={() => setDraft(l.id, { unit: u })}
                              data-testid={`invoice-return-unit-${u}`}
                            >
                              {u === "pack"
                                ? `${pack.one} (${pack.qty})`
                                : shape.kind === "count"
                                  ? shape.one
                                  : ""}
                            </button>
                          ))}
                        </div>
                      )}
                      {shape.kind === "weight" && (
                        <div className={styles.chips}>
                          {(["kg", "g"] as const).map((u) => (
                            <button
                              key={u}
                              type="button"
                              className={`${styles.chip} ${d.weightUnit === u ? styles.chipOn : ""}`}
                              onClick={() => setDraft(l.id, { weightUnit: u })}
                              data-testid={`invoice-return-${u}`}
                            >
                              {u === "kg" ? "كيلو" : "جرام"}
                            </button>
                          ))}
                        </div>
                      )}
                      <label className={styles.lbl} htmlFor={`ret-${l.id}`}>
                        ترجع كام{" "}
                        {shape.kind === "weight"
                          ? d.weightUnit === "kg"
                            ? "كيلو"
                            : "جرام"
                          : d.unit === "pack" && pack
                            ? pack.one
                            : shape.one}
                        ؟
                      </label>
                      <input
                        id={`ret-${l.id}`}
                        className={styles.v19Input}
                        type="text"
                        inputMode={
                          shape.kind === "weight" && d.weightUnit === "kg"
                            ? "decimal"
                            : "numeric"
                        }
                        placeholder={`لحد ${describeBase(shape, left)}`}
                        value={d.qty}
                        onChange={(e) =>
                          setDraft(l.id, { qty: e.target.value })
                        }
                        data-testid="invoice-return-qty"
                      />
                      {plan?.error ? (
                        <p className={styles.retError}>{plan.error}</p>
                      ) : plan && plan.base > 0 ? (
                        <p
                          className={styles.note}
                          data-testid="invoice-return-preview"
                        >
                          مرتجع {describeBase(shape, plan.base)} ← بـ{" "}
                          {formatMoney(plan.value)}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}

            <div className={styles.sumbox}>
              {invoice.discountPiasters > 0 && (
                <div className={styles.line}>
                  <span>{t("invoice.discount")}</span>
                  <b>{formatMoney(invoice.discountPiasters)}</b>
                </div>
              )}
              <div className={styles.line}>
                <span>إجمالي الفاتورة</span>
                <b data-testid="invoice-total">
                  {formatMoney(invoice.totalPiasters)}
                </b>
              </div>
              {invoice.returnedPiasters > 0 && (
                <div className={styles.line}>
                  <span>إجمالي المرتجع</span>
                  <b data-testid="invoice-returned">
                    {formatMoney(invoice.returnedPiasters)}
                  </b>
                </div>
              )}
              <div className={styles.line}>
                <span>الصافي بعد المرتجع</span>
                <b data-testid="invoice-net">
                  {formatMoney(
                    invoice.totalPiasters - invoice.returnedPiasters,
                  )}
                </b>
              </div>
              {invoice.paymentMethod === "debt" && !invoice.voided && (
                <div className={styles.line}>
                  <span>الباقي على {invoice.customerName ?? "العميل"}</span>
                  <b data-testid="invoice-outstanding">
                    {formatMoney(invoice.outstandingPiasters)}
                  </b>
                </div>
              )}
            </div>

            {error && (
              <p
                className={styles.retError}
                role="alert"
                data-testid="invoice-error"
              >
                {error}
              </p>
            )}

            {!invoice.voided &&
              invoice.lines.some(
                (l) => l.returnable && l.quantityBase > l.returnedQuantityBase,
              ) && (
                <button
                  type="button"
                  className={styles.v19Btn}
                  disabled={busy !== null || toReturn.length === 0}
                  onClick={() => void submitReturn()}
                  data-testid="invoice-return-submit"
                >
                  {busy === "return"
                    ? "بيتسجّل…"
                    : returnTotal > 0
                      ? `سجّل المرتجع (${formatMoney(returnTotal)})`
                      : "سجّل المرتجع"}
                </button>
              )}

            {invoice.paymentMethod === "debt" &&
              !invoice.voided &&
              invoice.outstandingPiasters > 0 && (
                <>
                  <label className={styles.lbl} htmlFor="invoice-collect">
                    {t("invoice.collect")}
                  </label>
                  <input
                    id="invoice-collect"
                    className={styles.v19Input}
                    inputMode="decimal"
                    placeholder="0"
                    value={collect}
                    data-testid="invoice-collect-amount"
                    onChange={(e) => setCollect(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    disabled={busy !== null}
                    data-testid="invoice-collect-submit"
                    onClick={() => void submitPayment()}
                  >
                    {busy === "pay" ? "بيتسجّل…" : "استلمت الفلوس ✅"}
                  </button>
                </>
              )}
          </>
        )}
      </div>
    </Modal>
  );
}
