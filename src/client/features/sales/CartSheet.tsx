"use client";

/**
 * @file CartSheet.tsx
 * @description The cart (QA-31): several products sold as ONE invoice, with a discount, a
 * payment method and — for a credit sale (آجل) — the customer. The cart is only a draft: the
 * amounts shown are an estimate from the registered prices; the server prices, checks the
 * stock and records the invoice (`POST /api/sales/checkout`). Success is shown only from the
 * server's answer, and a retried tap reuses the same `opId` (no duplicate invoice).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, Input, Seg } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import { saleLineTotalPiasters } from "@/domain/sale-pricing";
import {
  checkout,
  type PaymentMethod,
  type SaleInvoice,
} from "@/client/shared/api/invoices";
import styles from "./CartSheet.module.css";

export interface CartLine {
  variantId: string;
  name: string;
  unit: string;
  /** Pieces, or grams for a weighed product. */
  quantityBase: number;
  sellPricePiasters: number;
  stockBase: number;
}

interface Customer {
  id: string;
  name: string;
}

const isWeighed = (unit: string) => unit === "kg" || unit === "g";

export function CartSheet({
  lines,
  onChange,
  onDone,
}: {
  lines: CartLine[];
  onChange: (lines: CartLine[]) => void;
  onDone: (invoice: SaleInvoice) => void;
}) {
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [customerId, setCustomerId] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One opId per draft: a retried tap after a lost answer is the same invoice.
  const opId = useRef<string>(crypto.randomUUID());

  // The customers list is needed only for a credit sale, and loaded once.
  useEffect(() => {
    if (method !== "debt" || customers !== null) return;
    let alive = true;
    fetch("/api/people?section=owedToMe")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { people?: Array<{ id: string; name: string }> } | null) => {
        if (alive)
          setCustomers(
            (data?.people ?? []).map((p) => ({ id: p.id, name: p.name })),
          );
      })
      .catch(() => alive && setCustomers([]));
    return () => {
      alive = false;
    };
  }, [method, customers]);

  // Any change to the draft is a new invoice (a new opId).
  const draftKey = JSON.stringify([
    lines,
    discount,
    method,
    customerId,
    paidNow,
  ]);
  useEffect(() => {
    opId.current = crypto.randomUUID();
  }, [draftKey]);

  const subtotal = useMemo(
    () =>
      lines.reduce(
        (s, l) =>
          s +
          saleLineTotalPiasters(l.unit, l.sellPricePiasters, l.quantityBase),
        0,
      ),
    [lines],
  );
  const discountPiasters =
    discount.trim() === "" ? 0 : parseEgpStrict(discount);
  const paidPiasters = paidNow.trim() === "" ? 0 : parseEgpStrict(paidNow);
  const total = discountPiasters === null ? null : subtotal - discountPiasters;

  const setQty = (variantId: string, quantityBase: number) =>
    onChange(
      lines
        .map((l) => (l.variantId === variantId ? { ...l, quantityBase } : l))
        .filter((l) => l.quantityBase > 0),
    );

  const submit = async () => {
    setError(null);
    if (discountPiasters === null || paidPiasters === null) {
      setError(t("invoice.invalidAmount"));
      return;
    }
    setBusy(true);
    try {
      const invoice = await checkout({
        opId: opId.current,
        lines: lines.map((l) => ({
          variantId: l.variantId,
          quantityBase: l.quantityBase,
        })),
        discountPiasters,
        paymentMethod: method,
        customerId: method === "debt" ? customerId || null : null,
        paidNowPiasters: method === "debt" ? paidPiasters : 0,
      });
      setDiscount("");
      setPaidNow("");
      opId.current = crypto.randomUUID();
      onDone(invoice);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("invoice.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={styles.sheet}
      data-testid="cart-sheet"
      aria-label={t("invoice.cartTitle")}
    >
      <div className={styles.head}>
        <b>{t("invoice.cartTitle")}</b>
        {lines.length > 0 && (
          <button
            type="button"
            className={styles.link}
            onClick={() => onChange([])}
          >
            {t("invoice.clear")}
          </button>
        )}
      </div>

      {lines.length === 0 ? (
        <p className={styles.empty}>{t("invoice.cartEmpty")}</p>
      ) : (
        <ul className={styles.lines}>
          {lines.map((l) => {
            const step = isWeighed(l.unit) ? 250 : 1;
            return (
              <li
                key={l.variantId}
                className={styles.line}
                data-testid="cart-line"
              >
                <span className={styles.name}>{l.name}</span>
                <div className={styles.qty}>
                  <button
                    type="button"
                    aria-label={`${t("invoice.remove")} ${l.name}`}
                    onClick={() => setQty(l.variantId, l.quantityBase - step)}
                  >
                    −
                  </button>
                  <span data-testid="cart-line-qty">
                    {isWeighed(l.unit)
                      ? `${l.quantityBase / 1000} كجم`
                      : l.quantityBase}
                  </span>
                  <button
                    type="button"
                    aria-label={`+ ${l.name}`}
                    disabled={l.quantityBase + step > l.stockBase}
                    onClick={() => setQty(l.variantId, l.quantityBase + step)}
                  >
                    +
                  </button>
                </div>
                <span className={styles.amount}>
                  {formatMoney(
                    saleLineTotalPiasters(
                      l.unit,
                      l.sellPricePiasters,
                      l.quantityBase,
                    ),
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {lines.length > 0 && (
        <>
          <div className={styles.row}>
            <Field label={t("invoice.discount")} grow>
              <Input
                inputMode="decimal"
                value={discount}
                data-testid="cart-discount"
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>
          <Field label={t("invoice.payment")} div>
            <Seg<PaymentMethod>
              value={method}
              onChange={setMethod}
              size="sm"
              options={[
                ["cash", t("invoice.cash")],
                ["wallet", t("invoice.wallet")],
                ["card", t("invoice.card")],
                ["debt", t("invoice.debt")],
              ]}
            />
          </Field>
          {method === "debt" && (
            <div className={styles.row}>
              <Field label={t("invoice.customer")} grow>
                {customers === null ? (
                  <span className={styles.muted}>{t("invoice.loading")}</span>
                ) : customers.length === 0 ? (
                  <span className={styles.muted}>
                    {t("invoice.noCustomers")}
                  </span>
                ) : (
                  <select
                    className={styles.select}
                    value={customerId}
                    data-testid="cart-customer"
                    onChange={(e) => setCustomerId(e.target.value)}
                  >
                    <option value="">{t("invoice.chooseCustomer")}</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t("invoice.paidNow")} grow>
                <Input
                  inputMode="decimal"
                  value={paidNow}
                  data-testid="cart-paid-now"
                  onChange={(e) => setPaidNow(e.target.value)}
                  placeholder="0"
                />
              </Field>
            </div>
          )}
          <div className={styles.totals}>
            <span>
              {t("invoice.subtotal")}: <b>{formatMoney(subtotal)}</b>
            </span>
            <span>
              {t("invoice.total")}:{" "}
              <b data-testid="cart-total">
                {total === null ? "—" : formatMoney(total)}
              </b>
            </span>
          </div>
          {error && (
            <p className={styles.error} role="alert" data-testid="cart-error">
              {error}
            </p>
          )}
          <Button
            wide
            loading={busy}
            data-testid="cart-checkout"
            disabled={method === "debt" && !customerId}
            onClick={() => void submit()}
          >
            {t("invoice.checkout")}
          </Button>
        </>
      )}
    </section>
  );
}
