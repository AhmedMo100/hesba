"use client";

/**
 * @file PersonDebtSheet.tsx
 * @description «سجّل على الحساب» (ADR-0036) — a MANUAL debt on a person's account: a customer
 * took something that was not rung up («ليك»), or a supplier / someone is owed for goods or
 * anything else («عليك»). Two ways:
 * - an amount, with its date and an optional note;
 * - the products: each one with its quantity, the agreed price and the line total (from the
 *   shop's list, or typed when it is not there), the date and a note. The server sums the lines.
 *
 * A manual debt is written on the account only: it is NOT a sale or a purchase invoice, it
 * moves no stock, adds no revenue and moves no money (a later collection / payment settles it).
 * A credit sale from «بيع حاجة» or a credit purchase from «دخلت بضاعة» already writes its own
 * debt — this sheet never adds a second one for it. In الكاشير الذكي, «تخصمها من المخزون؟» opens
 * the existing credit invoice instead (stock taken, one debt on the invoice).
 * A retried tap reuses its `opId`, so a lost answer never records twice.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Button, Field, Modal } from "@/client/shared/ui";
import { formatMoney, normDigits } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import { saleLineTotalPiasters } from "@/domain/sale-pricing";
import { toCairoDateString } from "@/domain/time";
import { apiGet } from "@/client/shared/api/read-cache";
import { useRetryOpId } from "@/client/shared/hooks/useRetryOpId";
import type { StockInventoryItem } from "@/client/shared/store-items";
import styles from "./PeopleView.module.css";

interface ItemRow {
  key: string;
  /** "" = typed by hand. */
  variantId: string;
  name: string;
  /** Pieces, or kilograms for weighed goods (as typed). */
  qty: string;
  /** Per piece, or per kilogram (EGP, as typed). */
  price: string;
}

const newRow = (): ItemRow => ({
  key: crypto.randomUUID(),
  variantId: "",
  name: "",
  qty: "1",
  price: "",
});

const egpText = (piasters: number) =>
  String(Number((piasters / 100).toFixed(2)));

export function PersonDebtSheet({
  person,
  side,
  canSellOnCredit = false,
  onOpenCreditInvoice,
  onClose,
  onDone,
}: {
  person: { id: string; name: string };
  /** «ليك» (a customer owes the shop) or «عليك» (the shop owes them). */
  side: "receivable" | "payable";
  /** الكاشير الذكي: offer the credit invoice (stock taken) for a customer. */
  canSellOnCredit?: boolean;
  onOpenCreditInvoice?: () => void;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<"amount" | "items">("amount");
  const [amount, setAmount] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([newRow()]);
  const [date, setDate] = useState(() => toCairoDateString(new Date()));
  const [note, setNote] = useState("");
  const [inventory, setInventory] = useState<StockInventoryItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const op = useRetryOpId();
  const today = toCairoDateString(new Date());

  useEffect(() => {
    if (mode !== "items" || inventory) return;
    let live = true;
    apiGet("/api/stock")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d: { inventory?: StockInventoryItem[] }) => {
        if (live) setInventory(d.inventory ?? []);
      })
      .catch(() => {
        if (live) setInventory([]);
      });
    return () => {
      live = false;
    };
  }, [mode, inventory]);

  const byVariant = useMemo(
    () => new Map((inventory ?? []).map((i) => [i.variantId, i])),
    [inventory],
  );

  /** A row as the server will get it, with its total; null when it is not filled yet. */
  const lineOf = (r: ItemRow) => {
    const item = r.variantId ? byVariant.get(r.variantId) : undefined;
    const unit = item?.unit ?? "piece";
    const weighed = item?.unitMode === "weight";
    const q = Number(normDigits(r.qty).trim());
    const price = parseEgpStrict(normDigits(r.price).trim());
    if (!Number.isFinite(q) || q <= 0 || price === null || price < 0)
      return null;
    const quantityBase = weighed ? Math.round(q * 1000) : Math.round(q);
    if (quantityBase <= 0 || (!weighed && !Number.isInteger(q))) return null;
    const name = item
      ? [item.productName, item.flavor].filter(Boolean).join(" ")
      : r.name.trim();
    if (!name) return null;
    return {
      body: {
        ...(item ? { variantId: item.variantId } : { name }),
        quantityBase,
        unitPricePiasters: price,
      },
      total: saleLineTotalPiasters(unit, price, quantityBase),
      weighed,
    };
  };
  const lines = rows.map(lineOf);
  const itemsTotal = lines.reduce((n, l) => n + (l?.total ?? 0), 0);

  const setRow = (key: string, patch: Partial<ItemRow>) =>
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  const submit = async () => {
    setError(null);
    if (date > today) return setError("التاريخ مينفعش يبقى بعد النهارده");
    let body: Record<string, unknown>;
    let total: number;
    if (mode === "items") {
      const filled = lines.filter(
        (l): l is NonNullable<typeof l> => l !== null,
      );
      if (filled.length === 0 || filled.length !== rows.length)
        return setError("كمّل كل منتج: الاسم والكمية والسعر");
      if (itemsTotal <= 0) return setError("الإجمالي لازم يكون أكبر من صفر");
      total = itemsTotal;
      body = {
        type: "debt",
        items: filled.map((l) => l.body),
        date,
        note: note.trim() || null,
      };
    } else {
      const piasters = parseEgpStrict(normDigits(amount).trim());
      if (piasters === null || piasters <= 0) return setError("اكتب المبلغ");
      total = piasters;
      body = {
        type: "debt",
        amountPiasters: piasters,
        date,
        note: note.trim() || null,
      };
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/people/${person.id}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, opId: op.opIdFor(body) }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message || "تعذر التسجيل");
      }
      op.reset();
      onDone(
        side === "receivable"
          ? `اتسجّل على ${person.name} ${formatMoney(total)}`
          : `اتسجّل لـ ${person.name} ${formatMoney(total)}`,
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "تعذر التسجيل. جرّب تاني.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        side === "receivable"
          ? `سجّل على ${person.name} (ليك)`
          : `سجّل لـ ${person.name} (عليك)`
      }
      onClose={busy ? () => {} : onClose}
      footer={
        <Button
          kind="primary"
          size="lg"
          wide
          busy={busy}
          disabled={busy}
          onClick={() => void submit()}
          data-testid="debt-submit"
        >
          {busy
            ? "بيتسجّل…"
            : mode === "items" && itemsTotal > 0
              ? `سجّل ${formatMoney(itemsTotal)}`
              : "سجّل"}
        </Button>
      }
    >
      <div className={styles.debtSheet} data-testid="person-debt-sheet">
        <div className={styles.chips} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "amount"}
            className={`${styles.chip} ${mode === "amount" ? styles.chipOn : ""}`}
            onClick={() => setMode("amount")}
            data-testid="debt-mode-amount"
          >
            💵 مبلغ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "items"}
            className={`${styles.chip} ${mode === "items" ? styles.chipOn : ""}`}
            onClick={() => setMode("items")}
            data-testid="debt-with-products"
          >
            📦 منتجات
          </button>
        </div>

        {mode === "amount" ? (
          <Field label="المبلغ (ج.م)">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="مثال: 150"
              data-testid="debt-amount"
            />
          </Field>
        ) : (
          <>
            {rows.map((r, i) => {
              const item = r.variantId ? byVariant.get(r.variantId) : undefined;
              const l = lines[i];
              return (
                <div
                  key={r.key}
                  className={styles.debtItem}
                  data-testid="debt-item"
                >
                  <select
                    className={styles.debtInput}
                    value={r.variantId}
                    onChange={(e) => {
                      const v = byVariant.get(e.target.value);
                      const price =
                        side === "receivable"
                          ? v?.sellPricePiasters
                          : (v?.buyPricePiasters ?? v?.sellPricePiasters);
                      setRow(r.key, {
                        variantId: e.target.value,
                        price: v && price ? egpText(price) : r.price,
                      });
                    }}
                    aria-label="المنتج"
                    data-testid="debt-item-product"
                  >
                    <option value="">
                      {inventory === null
                        ? "بنحمّل المنتجات…"
                        : "✍️ منتج مش في القايمة"}
                    </option>
                    {(inventory ?? []).map((it) => (
                      <option key={it.variantId} value={it.variantId}>
                        {[it.productName, it.flavor].filter(Boolean).join(" ")}
                      </option>
                    ))}
                  </select>
                  {!r.variantId && (
                    <input
                      className={styles.debtInput}
                      dir="auto"
                      maxLength={120}
                      value={r.name}
                      onChange={(e) => setRow(r.key, { name: e.target.value })}
                      placeholder="اسم المنتج"
                      aria-label="اسم المنتج"
                      data-testid="debt-item-name"
                    />
                  )}
                  <div className={styles.debtItemRow}>
                    <label>
                      <span>
                        {item?.unitMode === "weight" ? "كام كيلو" : "الكمية"}
                      </span>
                      <input
                        className={styles.debtInput}
                        inputMode="decimal"
                        value={r.qty}
                        onChange={(e) => setRow(r.key, { qty: e.target.value })}
                        data-testid="debt-item-qty"
                      />
                    </label>
                    <label>
                      <span>
                        {item?.unitMode === "weight"
                          ? "سعر الكيلو"
                          : "سعر الواحدة"}
                      </span>
                      <input
                        className={styles.debtInput}
                        inputMode="decimal"
                        value={r.price}
                        onChange={(e) =>
                          setRow(r.key, { price: e.target.value })
                        }
                        placeholder="0"
                        data-testid="debt-item-price"
                      />
                    </label>
                  </div>
                  <div className={styles.debtItemFoot}>
                    <b data-testid="debt-item-total">
                      {l ? formatMoney(l.total) : "—"}
                    </b>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className={styles.ghostBtn}
                        onClick={() =>
                          setRows((prev) => prev.filter((x) => x.key !== r.key))
                        }
                        aria-label="شيل المنتج ده"
                      >
                        ✕ شيله
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => setRows((prev) => [...prev, newRow()])}
              data-testid="debt-item-add"
            >
              + منتج تاني
            </button>
            <div className={styles.debtTotal} data-testid="debt-estimate">
              <span>الإجمالي</span>
              <b>{formatMoney(itemsTotal)}</b>
            </div>
          </>
        )}

        <Field label="التاريخ">
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value || today)}
            data-testid="debt-date"
          />
        </Field>
        <Field label="ملاحظة (اختياري)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            data-testid="debt-note"
          />
        </Field>
        <p className={styles.v19Note}>
          دين يدوي: بيتسجّل على الحساب بس، مش فاتورة ومش بيخصم من المخزون.
          الفواتير الآجلة من «بيع حاجة» و«دخلت بضاعة» بتتسجّل لوحدها.
        </p>
        {canSellOnCredit && onOpenCreditInvoice && (
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={onOpenCreditInvoice}
            data-testid="debt-open-invoice"
          >
            🧾 تخصمها من المخزون؟ سجّلها فاتورة بيع آجل
          </button>
        )}
        {error && (
          <div role="alert" className={styles.v19Error}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default PersonDebtSheet;
