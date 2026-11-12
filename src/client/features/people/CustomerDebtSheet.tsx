"use client";

/**
 * @file CustomerDebtSheet.tsx
 * @description «ليك»: record what a customer took on credit — an amount, or (optionally) the
 * products they took, in each product's own selling unit (pieces, packs, weight).
 *
 * With products this is the SAME operation as a credit sale on the Sales screen
 * (`POST /api/sales/checkout`, `paymentMethod: "debt"`): the server prices the lines from the
 * registered prices, takes the stock (FEFO) and writes the receivable on the invoice, in one
 * transaction. Without products it is the existing debt entry
 * (`POST /api/people/:id/transactions`). No stock or ledger rule is duplicated here.
 * A retried tap reuses its `opId`, so a lost answer never records twice.
 */

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useEffect, useMemo, useState } from "react";
import { Button, Field, Icon, Modal } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import { saleLineTotalPiasters } from "@/domain/sale-pricing";
import { checkout } from "@/client/shared/api/invoices";
import { useRetryOpId } from "@/client/shared/hooks/useRetryOpId";
import type { StockInventoryItem } from "@/client/shared/store-items";
import {
  ProductLinesPicker,
  lineQuantityBase,
  type PickedLine,
} from "./ProductLinesPicker";

export function CustomerDebtSheet({
  customer,
  onClose,
  onDone,
}: {
  customer: { id: string; name: string };
  onClose: () => void;
  /** After a recorded debt: the balance and the stock are re-read from the server. */
  onDone: (message: string) => void;
}) {
  const [inventory, setInventory] = useState<StockInventoryItem[] | null>(null);
  const [lines, setLines] = useState<PickedLine[]>([]);
  const [withProducts, setWithProducts] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const op = useRetryOpId();

  useEffect(() => {
    if (!withProducts || inventory) return;
    let live = true;
    apiGet("/api/stock")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d: { inventory?: StockInventoryItem[] }) => {
        if (live) setInventory(d.inventory ?? []);
      })
      .catch(() => {
        if (live) {
          setInventory([]);
          setError("تعذر تحميل المنتجات. اتأكد من النت وجرّب تاني.");
        }
      });
    return () => {
      live = false;
    };
  }, [withProducts, inventory]);

  const byVariant = useMemo(
    () => new Map((inventory ?? []).map((i) => [i.variantId, i])),
    [inventory],
  );
  const picked = lines
    .map((l) => ({ l, item: byVariant.get(l.variantId) }))
    .filter(
      (x): x is { l: PickedLine; item: StockInventoryItem } =>
        Boolean(x.item) && lineQuantityBase(x.l, x.item!) > 0,
    );
  // An estimate from the registered prices; the server's invoice is the authority.
  const estimate = picked.reduce(
    (sum, { l, item }) =>
      sum +
      saleLineTotalPiasters(
        item.unit,
        item.sellPricePiasters,
        lineQuantityBase(l, item),
      ),
    0,
  );

  const submit = async () => {
    setError(null);
    try {
      if (withProducts) {
        if (picked.length === 0) {
          setError("اختار منتج واحد على الأقل وكميته");
          return;
        }
        for (const { l, item } of picked) {
          if (lineQuantityBase(l, item) > item.currentStockBase) {
            setError(`الكمية أكبر من الموجود من ${item.productName}`);
            return;
          }
        }
        const paid = paidNow.trim() ? parseEgpStrict(paidNow) : 0;
        if (paid === null || paid < 0) {
          setError("المدفوع دلوقتي غير صحيح");
          return;
        }
        const body = {
          lines: picked.map(({ l, item }) => ({
            variantId: item.variantId,
            quantityBase: lineQuantityBase(l, item),
          })),
          discountPiasters: 0,
          paymentMethod: "debt" as const,
          customerId: customer.id,
          paidNowPiasters: paid,
        };
        setBusy(true);
        const invoice = await checkout({ ...body, opId: op.opIdFor(body) });
        op.reset();
        onDone(
          `اتسجّل على ${customer.name} ${formatMoney(invoice.outstandingPiasters ?? invoice.totalPiasters)} والمخزون اتخصم`,
        );
        return;
      }
      const piasters = parseEgpStrict(amount);
      if (piasters === null || piasters <= 0) {
        setError("اكتب المبلغ");
        return;
      }
      const body = {
        type: "debt",
        amountPiasters: piasters,
        note: note.trim() || null,
      };
      setBusy(true);
      const res = await fetch(`/api/people/${customer.id}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, opId: op.opIdFor(body) }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message || "تعذر تسجيل المبلغ");
      }
      op.reset();
      onDone(`اتسجّل على ${customer.name} ${formatMoney(piasters)}`);
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
      title={`سجّل على ${customer.name} (ليك)`}
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
          {busy ? "بيتسجّل…" : "سجّل"}
        </Button>
      }
    >
      <div
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        data-testid="customer-debt-sheet"
      >
        {!withProducts ? (
          <>
            <Field label="المبلغ (ج.م)">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="مثال: 150"
                data-testid="debt-amount"
              />
            </Field>
            <Field label="ملاحظة (اختياري)">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
            </Field>
            <Button
              kind="soft"
              onClick={() => setWithProducts(true)}
              data-testid="debt-with-products"
            >
              <Icon n="box" s={16} />
              أخد بضاعة؟ اختار المنتجات (اختياري)
            </Button>
          </>
        ) : (
          <>
            <ProductLinesPicker
              inventory={inventory}
              lines={lines}
              onChange={setLines}
              showStock
            />
            {picked.length > 0 && (
              <div
                data-testid="debt-estimate"
                style={{ fontWeight: 800, fontSize: 15 }}
              >
                الإجمالي بسعر البيع المسجل: {formatMoney(estimate)}
              </div>
            )}
            <Field
              label="دفع دلوقتي (اختياري)"
              hint="الباقي بيتسجّل عليه في «ليك»"
            >
              <input
                inputMode="decimal"
                value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Button
              kind="ghost"
              onClick={() => {
                setWithProducts(false);
                setLines([]);
              }}
            >
              مبلغ بس من غير منتجات
            </Button>
          </>
        )}
        {error && (
          <div role="alert" style={{ color: "var(--red)", fontWeight: 700 }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
