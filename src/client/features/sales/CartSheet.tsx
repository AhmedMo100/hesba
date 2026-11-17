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
import { normalizeArabic } from "@/domain/normalize";
import {
  loadCreditCustomers,
  phoneKey,
  resolveCreditCustomer,
} from "./CreditCustomerForm";
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

/**
 * An offer in the invoice: shown and removed as ONE line. Its items are added to the
 * checkout lines only when the invoice is sent, and its saving becomes invoice discount —
 * so an offer's items are never counted twice.
 */
export interface CartOffer {
  promoId: string;
  title: string;
  /** The offer's price, and its items at today's prices (the saving is the difference). */
  pricePiasters: number;
  regularPiasters: number;
  items: Array<{ variantId: string; quantityBase: number }>;
  qty: number;
}

/** The checkout lines: the products plus every offer's items, one line per product. */
export function mergeCheckoutLines(
  lines: ReadonlyArray<Pick<CartLine, "variantId" | "quantityBase">>,
  offers: readonly CartOffer[],
): Array<{ variantId: string; quantityBase: number }> {
  const merged = new Map<string, number>();
  for (const l of lines) {
    merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.quantityBase);
  }
  for (const o of offers) {
    for (const it of o.items) {
      merged.set(
        it.variantId,
        (merged.get(it.variantId) ?? 0) + it.quantityBase * o.qty,
      );
    }
  }
  return [...merged.entries()].map(([variantId, quantityBase]) => ({
    variantId,
    quantityBase,
  }));
}

/** What the offers in an invoice save, in piasters. */
export function offersSaving(offers: readonly CartOffer[]): number {
  return offers.reduce(
    (s, o) => s + Math.max(0, o.regularPiasters - o.pricePiasters) * o.qty,
    0,
  );
}

/** The customer of a credit sale, chosen once per invoice. */
export interface CreditCustomer {
  id: string;
  name: string;
  phone: string | null;
}

const isWeighed = (unit: string) => unit === "kg" || unit === "g";

/** The invoice draft besides its lines; kept by the screen, so closing the sheet keeps it. */
export interface CartDraft {
  discount: string;
  method: PaymentMethod;
  customerId: string;
  paidNow: string;
  /** Credit sale: who owes the invoice, typed just before it is confirmed. */
  customerName: string;
  customerPhone: string;
  /** Credit sale: where the paid-now money went (ADR-0031). */
  paidNowFrom?: "cash" | "wallet";
}

export const EMPTY_CART_DRAFT: CartDraft = {
  discount: "",
  method: "cash",
  customerId: "",
  paidNow: "",
  customerName: "",
  customerPhone: "",
};

/** The draft a checkout `opId` belongs to; the screen keeps it across sheet openings. */
export interface CartOpId {
  key: string;
  id: string;
}

export function CartSheet({
  lines,
  onChange,
  offers = [],
  onOffersChange,
  onDone,
  draft,
  onDraftChange,
  opIdRef,
  creditCustomer = null,
  creditMode = false,
  onCancelCredit,
}: {
  lines: CartLine[];
  onChange: (lines: CartLine[]) => void;
  offers?: CartOffer[];
  onOffersChange?: (offers: CartOffer[]) => void;
  /** `customer`: who owes a credit invoice (null for an invoice paid now). */
  onDone: (invoice: SaleInvoice, customer: CreditCustomer | null) => void;
  draft: CartDraft;
  onDraftChange: (draft: CartDraft) => void;
  /** The same draft retried (after a lost answer) reuses its opId: no duplicate invoice. */
  opIdRef: React.MutableRefObject<CartOpId | null>;
  /**
   * A credit sale (آجل): the customer chosen once for the whole invoice. The invoice is
   * recorded as `debt` on this customer (one invoice, one receivable). Without it the sheet is
   * a normal invoice paid now (cash, wallet or card).
   */
  creditCustomer?: CreditCustomer | null;
  /**
   * A credit sale whose customer is asked here, after the items and before the invoice is
   * confirmed: name required, phone optional.
   */
  creditMode?: boolean;
  /** Leave the credit sale (the items stay in a normal invoice draft). */
  onCancelCredit?: () => void;
}) {
  const { discount, paidNow, customerName, customerPhone } = draft;
  const isCredit = creditMode || creditCustomer !== null;
  const askCustomer = creditMode && creditCustomer === null;
  // A credit invoice is always `debt` on its customer; a normal one is never `debt`.
  const method: PaymentMethod = isCredit
    ? "debt"
    : draft.method === "debt"
      ? "cash"
      : draft.method;
  const set = (patch: Partial<CartDraft>) =>
    onDraftChange({ ...draft, ...patch });
  const setDiscount = (v: string) => set({ discount: v });
  const setMethod = (v: PaymentMethod) => set({ method: v });
  const setPaidNow = (v: string) => set({ paidNow: v });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Credit: the shop's customers, to match what is typed (no second record for one person).
  const [customers, setCustomers] = useState<CreditCustomer[]>([]);
  const resolvedRef = useRef<{ key: string; customer: CreditCustomer } | null>(
    null,
  );
  useEffect(() => {
    if (!askCustomer) return;
    let alive = true;
    loadCreditCustomers()
      .then((list) => alive && setCustomers(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [askCustomer]);
  const typedKey = phoneKey(customerPhone);
  const matches = useMemo(() => {
    if (!askCustomer) return [];
    const q = normalizeArabic(customerName.trim());
    if (!q && typedKey.length < 3) return [];
    return customers
      .filter(
        (c) =>
          (q && normalizeArabic(c.name).includes(q)) ||
          (typedKey.length >= 3 && phoneKey(c.phone).includes(typedKey)),
      )
      .filter(
        (c) => normalizeArabic(c.name) !== q || phoneKey(c.phone) !== typedKey,
      )
      .slice(0, 4);
  }, [askCustomer, customers, customerName, typedKey]);

  const draftKeyFor = (customerId: string) =>
    JSON.stringify([lines, offers, discount, method, customerId, paidNow]);
  const opIdFor = (key: string): string => {
    if (opIdRef.current?.key !== key) {
      opIdRef.current = { key, id: crypto.randomUUID() };
    }
    return opIdRef.current.id;
  };

  const subtotal = useMemo(
    () =>
      lines.reduce(
        (s, l) =>
          s +
          saleLineTotalPiasters(l.unit, l.sellPricePiasters, l.quantityBase),
        0,
      ) + offers.reduce((s, o) => s + o.regularPiasters * o.qty, 0),
    [lines, offers],
  );
  const offerSaving = offersSaving(offers);
  const manualDiscount = discount.trim() === "" ? 0 : parseEgpStrict(discount);
  const discountPiasters =
    manualDiscount === null ? null : manualDiscount + offerSaving;
  const isEmpty = lines.length === 0 && offers.length === 0;
  const setOfferQty = (promoId: string, qty: number) =>
    onOffersChange?.(
      offers
        .map((o) => (o.promoId === promoId ? { ...o, qty } : o))
        .filter((o) => o.qty > 0),
    );
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
    if (askCustomer && !customerName.trim()) {
      setError(t("credit.nameRequired"));
      return;
    }
    setBusy(true);
    try {
      let customer: CreditCustomer | null = creditCustomer;
      if (askCustomer) {
        const who = `${normalizeArabic(customerName.trim())}|${typedKey}`;
        if (resolvedRef.current?.key === who) {
          customer = resolvedRef.current.customer;
        } else {
          customer = await resolveCreditCustomer(
            customerName,
            customerPhone,
            customers,
          );
          resolvedRef.current = { key: who, customer };
          const found = customer;
          setCustomers((prev) =>
            prev.some((c) => c.id === found.id) ? prev : [...prev, found],
          );
        }
      }
      const customerId = customer?.id ?? "";
      const invoice = await checkout({
        opId: opIdFor(draftKeyFor(customerId)),
        lines: mergeCheckoutLines(lines, offers),
        discountPiasters,
        paymentMethod: method,
        customerId: method === "debt" ? customerId || null : null,
        paidNowPiasters: method === "debt" ? paidPiasters : 0,
        ...(method === "debt" && paidPiasters > 0
          ? { paidFrom: draft.paidNowFrom ?? "cash" }
          : {}),
      });
      opIdRef.current = null;
      onDone(invoice, isCredit ? customer : null);
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
      {creditCustomer && (
        <div className={styles.head} data-testid="credit-customer">
          <span>
            {t("credit.customerLabel")}: <b>{creditCustomer.name}</b>
            {creditCustomer.phone ? (
              <span dir="ltr"> · {creditCustomer.phone}</span>
            ) : null}
          </span>
          {onCancelCredit && (
            <button
              type="button"
              className={styles.link}
              data-testid="credit-cancel"
              onClick={onCancelCredit}
            >
              {t("credit.cancel")}
            </button>
          )}
        </div>
      )}
      <div className={styles.head}>
        <b>{t("invoice.cartTitle")}</b>
        {!isEmpty && (
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              onChange([]);
              onOffersChange?.([]);
            }}
          >
            {t("invoice.clear")}
          </button>
        )}
      </div>

      {offers.length > 0 && (
        <ul className={styles.lines} data-testid="cart-offers">
          {offers.map((o) => (
            <li
              key={o.promoId}
              className={`${styles.line} ${styles.offerLine}`}
              data-testid="cart-offer"
            >
              <span className={styles.name}>🎁 {o.title}</span>
              <div className={styles.qty}>
                <button
                  type="button"
                  aria-label={`${t("invoice.remove")} ${o.title}`}
                  onClick={() => setOfferQty(o.promoId, o.qty - 1)}
                >
                  −
                </button>
                <span>{o.qty}</span>
                <button
                  type="button"
                  aria-label={`+ ${o.title}`}
                  onClick={() => setOfferQty(o.promoId, o.qty + 1)}
                >
                  +
                </button>
              </div>
              <span className={styles.amount}>
                {formatMoney(o.pricePiasters * o.qty)}
              </span>
              <button
                type="button"
                className={styles.removeOffer}
                aria-label={`شيل العرض ${o.title}`}
                data-testid="cart-offer-remove"
                onClick={() => setOfferQty(o.promoId, 0)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {isEmpty ? (
        <p className={styles.empty}>{t("invoice.cartEmpty")}</p>
      ) : lines.length === 0 ? null : (
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

      {!isEmpty && (
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
          {askCustomer && (
            <div className={styles.credBox} data-testid="credit-form">
              <div className={styles.credTitle}>{t("credit.whoTitle")}</div>
              <Field label={t("credit.name")}>
                <Input
                  value={customerName}
                  dir="auto"
                  autoComplete="off"
                  data-testid="credit-name"
                  placeholder={t("credit.namePlaceholder")}
                  onChange={(e) => set({ customerName: e.target.value })}
                />
              </Field>
              <Field label={t("credit.phoneOptional")}>
                <Input
                  value={customerPhone}
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  autoComplete="off"
                  data-testid="credit-phone"
                  onChange={(e) => set({ customerPhone: e.target.value })}
                />
              </Field>
              {matches.length > 0 && (
                <div className={styles.matchChips}>
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={styles.matchChip}
                      data-testid="credit-match"
                      onClick={() =>
                        set({
                          customerName: c.name,
                          customerPhone: c.phone ?? "",
                        })
                      }
                    >
                      {c.name}
                      {c.phone ? <span dir="ltr"> · {c.phone}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {isCredit ? (
            <Field label={t("invoice.paidNow")}>
              <Input
                inputMode="decimal"
                value={paidNow}
                data-testid="cart-paid-now"
                onChange={(e) => setPaidNow(e.target.value)}
                placeholder="0"
              />
              {(paidPiasters ?? 0) > 0 && (
                <div className={styles.matchChips}>
                  {(
                    [
                      ["cash", "💵 دخلت الدرج"],
                      ["wallet", "📱 على محفظة"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`${styles.matchChip} ${(draft.paidNowFrom ?? "cash") === k ? styles.matchChipOn : ""}`}
                      onClick={() => set({ paidNowFrom: k })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          ) : (
            <Field label={t("invoice.payment")} div>
              <Seg<PaymentMethod>
                value={method}
                onChange={setMethod}
                size="sm"
                options={[
                  ["cash", t("invoice.cash")],
                  ["wallet", t("invoice.wallet")],
                  ["card", t("invoice.card")],
                ]}
              />
            </Field>
          )}
          <div className={styles.totals}>
            <span>
              {t("invoice.subtotal")}: <b>{formatMoney(subtotal)}</b>
            </span>
            {offerSaving > 0 && (
              <span data-testid="cart-offer-saving">
                توفير العروض: <b>−{formatMoney(offerSaving)}</b>
              </span>
            )}
            <span>
              {t("invoice.total")}:{" "}
              <b data-testid="cart-total">
                {total === null ? "—" : formatMoney(total)}
              </b>
            </span>
            {isCredit && total !== null && paidPiasters !== null && (
              <span data-testid="cart-credit-rest">
                {t("credit.restOnCredit")}:{" "}
                <b>{formatMoney(Math.max(0, total - paidPiasters))}</b>
              </span>
            )}
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
            disabled={
              isEmpty ||
              (askCustomer ? !customerName.trim() : isCredit && !creditCustomer)
            }
            onClick={() => void submit()}
          >
            {isCredit ? t("credit.submit") : t("invoice.checkout")}
          </Button>
        </>
      )}
    </section>
  );
}
