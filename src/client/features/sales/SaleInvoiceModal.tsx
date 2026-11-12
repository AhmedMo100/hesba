"use client";

/**
 * @file SaleInvoiceModal.tsx
 * @description One sale as an invoice (QA-31): its lines, discount and returns; returning some
 * of it; and, for a credit sale, collecting from the customer. Every figure comes from the
 * server (`GET /api/sales/:id`); a return or a payment is shown done only after the server
 * recorded it, and a retried tap reuses its `opId`.
 */
import { unitWord } from "@/client/shared/unit-labels";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Input, Modal } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import {
  getSaleInvoice,
  paySaleInvoice,
  returnSaleLines,
  type SaleInvoice,
} from "@/client/shared/api/invoices";
import styles from "./CartSheet.module.css";

const isWeighed = (unit: string) => unit === "kg" || unit === "g";

/** A base quantity (grams / units) shown in the product's unit: 500 g of a kg product → 0.5 كجم. */
function showQty(base: number, unit: string): string {
  if (isWeighed(unit)) {
    return `${(base / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} كجم`;
  }
  return `${base} ${unitWord(unit)}`;
}

/** What the owner typed, in the product's unit, as base units; null when not a number. */
function toBase(typed: string, unit: string): number | null {
  const n = Number(
    typed
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace("٫", "."),
  );
  if (!Number.isFinite(n) || n <= 0) return null;
  if (isWeighed(unit)) return Math.round(n * 1000);
  return Number.isInteger(n) ? n : null;
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
  // Typed in the product's own unit: kilograms for weighed goods, units otherwise.
  const [qty, setQty] = useState<Record<string, string>>({});
  // Lines whose returned goods are damaged (recorded as a loss, not put back on sale).
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const [collect, setCollect] = useState("");
  const [busy, setBusy] = useState<"return" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returnOp = useRef(crypto.randomUUID());
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

  const submitReturn = async () => {
    if (!invoice) return;
    const lines: Array<{
      saleLineId: string;
      quantityBase: number;
      condition: "sellable" | "damaged";
    }> = [];
    for (const l of invoice.lines) {
      const typed = (qty[l.id] ?? "").trim();
      if (!typed) continue;
      const base = toBase(typed, l.unit);
      const left = l.quantityBase - l.returnedQuantityBase;
      if (base === null || base <= 0) {
        setError(t("invoice.invalidAmount"));
        return;
      }
      if (base > left) {
        setError(
          `«${l.name}»: الكمية المرتجعة أكبر من الباقي (${showQty(left, l.unit)})`,
        );
        return;
      }
      lines.push({
        saleLineId: l.id,
        quantityBase: base,
        condition: damaged[l.id] ? "damaged" : "sellable",
      });
    }
    if (lines.length === 0) {
      setError(t("invoice.nothingToReturn"));
      return;
    }
    setBusy("return");
    setError(null);
    try {
      const before = invoice.returnedPiasters;
      const next = await returnSaleLines(saleId, returnOp.current, lines);
      returnOp.current = crypto.randomUUID();
      setInvoice(next);
      setQty({});
      setDamaged({});
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

  return (
    <Modal title={t("invoice.invoiceTitle")} onClose={onClose}>
      <div
        data-testid="sale-invoice"
        className={styles.sheet}
        style={{ border: 0, padding: 0 }}
      >
        {loadError ? (
          <div className={styles.card}>
            <p className={styles.error}>{t("invoice.loadFailed")}</p>
            <Button kind="ghost" onClick={load}>
              {t("invoice.retry")}
            </Button>
          </div>
        ) : !invoice ? (
          <>
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </>
        ) : (
          <>
            {invoice.voided && (
              <p className={styles.error}>{t("invoice.voidedNote")}</p>
            )}
            <ul className={styles.lines}>
              {invoice.lines.map((l) => {
                const left = l.quantityBase - l.returnedQuantityBase;
                return (
                  <li
                    key={l.id}
                    className={styles.line}
                    data-testid="invoice-line"
                  >
                    <span className={styles.name}>
                      {l.name} × {showQty(l.quantityBase, l.unit)}
                      {l.returnedQuantityBase > 0 && (
                        <small className={styles.badge}>
                          {t("invoice.returned")}{" "}
                          {showQty(l.returnedQuantityBase, l.unit)}
                        </small>
                      )}
                    </span>
                    <div className={styles.qty}>
                      {l.returnable && left > 0 && !invoice.voided ? (
                        <>
                          <input
                            type="text"
                            inputMode={
                              isWeighed(l.unit) ? "decimal" : "numeric"
                            }
                            aria-label={`${t("invoice.returnQty")} ${l.name} (${isWeighed(l.unit) ? "كيلو" : unitWord(l.unit)})`}
                            placeholder={
                              isWeighed(l.unit) ? "كجم" : unitWord(l.unit)
                            }
                            data-testid="invoice-return-qty"
                            value={qty[l.id] ?? ""}
                            onChange={(e) =>
                              setQty((q) => ({ ...q, [l.id]: e.target.value }))
                            }
                          />
                          <label className={styles.damaged}>
                            <input
                              type="checkbox"
                              data-testid="invoice-return-damaged"
                              checked={!!damaged[l.id]}
                              onChange={(e) =>
                                setDamaged((d) => ({
                                  ...d,
                                  [l.id]: e.target.checked,
                                }))
                              }
                            />
                            <span>تالف</span>
                          </label>
                        </>
                      ) : null}
                    </div>
                    <span className={styles.amount}>
                      {formatMoney(l.totalPiasters)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className={styles.totals}>
              {invoice.discountPiasters > 0 && (
                <span>
                  {t("invoice.discount")}:{" "}
                  <b>{formatMoney(invoice.discountPiasters)}</b>
                </span>
              )}
              <span>
                {t("invoice.total")}:{" "}
                <b>{formatMoney(invoice.totalPiasters)}</b>
              </span>
              {invoice.returnedPiasters > 0 && (
                <span>
                  {t("invoice.returned")}:{" "}
                  <b data-testid="invoice-returned">
                    {formatMoney(invoice.returnedPiasters)}
                  </b>
                </span>
              )}
            </div>
            {!invoice.voided &&
              invoice.lines.some(
                (l) => l.returnable && l.quantityBase > l.returnedQuantityBase,
              ) && (
                <Button
                  kind="ghost"
                  loading={busy === "return"}
                  disabled={busy !== null}
                  data-testid="invoice-return-submit"
                  onClick={() => void submitReturn()}
                >
                  {t("invoice.returnSubmit")}
                </Button>
              )}
            {invoice.paymentMethod === "debt" && !invoice.voided && (
              <div className={styles.card}>
                <span>
                  {invoice.customerName} — {t("invoice.outstanding")}:{" "}
                  <b data-testid="invoice-outstanding">
                    {formatMoney(invoice.outstandingPiasters)}
                  </b>
                </span>
                {invoice.outstandingPiasters > 0 && (
                  <div className={styles.row}>
                    <Field label={t("invoice.collect")} grow>
                      <Input
                        inputMode="decimal"
                        value={collect}
                        data-testid="invoice-collect-amount"
                        onChange={(e) => setCollect(e.target.value)}
                      />
                    </Field>
                    <Button
                      loading={busy === "pay"}
                      disabled={busy !== null}
                      data-testid="invoice-collect-submit"
                      onClick={() => void submitPayment()}
                    >
                      {t("invoice.collect")}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {error && (
              <p
                className={styles.error}
                role="alert"
                data-testid="invoice-error"
              >
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
