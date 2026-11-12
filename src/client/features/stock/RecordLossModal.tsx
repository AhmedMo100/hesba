"use client";

/**
 * @file RecordLossModal.tsx
 * @description «سجّل تالف / فاقد»: goods that left stock without a sale (expired, damaged,
 * missing, other). The owner picks the batch (or «الأقدم صلاحية الأول»), the quantity in the
 * product's own unit, the reason and an optional note. The server (`action: "waste"`) takes it
 * from the batch, records the movement and the loss at the batch's recorded cost.
 * This replaces free editing of the quantity in the Stock screen.
 */

import React, { useMemo, useState } from "react";
import { Button, Chip, Chips, Field, Modal } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { useRetryOpId } from "@/client/shared/hooks/useRetryOpId";
import type { StockInventoryItem } from "@/client/shared/store-items";
import { packWord, unitWord } from "@/client/shared/unit-labels";
import {
  quantityBaseFromInput,
  type QuantityInput,
} from "@/client/shared/quantity-input";
import { getDaysUntilExpiry } from "@/domain/alerts";
import {
  OWNER_WASTE_REASONS,
  WASTE_REASON_LABELS,
  type WasteReason,
} from "@/schemas/inventory";

function formatQty(base: number, item: StockInventoryItem): string {
  if (item.unitMode === "weight") {
    return `${(base / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} كجم`;
  }
  return `${base} ${unitWord(item.unit)}`;
}

export function batchLabel(
  b: StockInventoryItem["batches"][number],
  item: StockInventoryItem,
  now: Date = new Date(),
): string {
  const qty = formatQty(b.remainingQty, item);
  if (!b.expiryDate) return `${qty} · من غير صلاحية`;
  const days = getDaysUntilExpiry(b.expiryDate, now);
  const date = new Date(b.expiryDate).toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "long",
    timeZone: "Africa/Cairo",
  });
  if (days < 0) return `${qty} · منتهية ${date}`;
  if (days === 0) return `${qty} · بتنتهي النهارده`;
  return `${qty} · بتنتهي ${date} (بعد ${days} يوم)`;
}

export function RecordLossModal({
  item,
  presetBatchId,
  presetReason,
  onClose,
  onSaved,
}: {
  item: StockInventoryItem;
  presetBatchId?: string | null;
  presetReason?: WasteReason;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const batches = useMemo(
    () =>
      item.batches
        .filter((b) => b.remainingQty > 0)
        .sort((a, b) =>
          (a.expiryDate ?? "9999").localeCompare(b.expiryDate ?? "9999"),
        ),
    [item.batches],
  );
  const [batchId, setBatchId] = useState<string>(presetBatchId ?? "");
  const [reason, setReason] = useState<WasteReason>(presetReason ?? "damaged");
  const [qty, setQty] = useState<QuantityInput>({
    kg: "",
    packs: "",
    units: "",
  });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const op = useRetryOpId();

  const weight = item.unitMode === "weight";
  const pack = Math.max(1, item.packQty || 1);
  const uw = unitWord(item.unit);
  const pw = packWord(item.packName, pack);
  const chosen = batches.find((b) => b.id === batchId);
  const limit = chosen
    ? chosen.remainingQty
    : Math.max(0, item.currentStockBase);
  const base = quantityBaseFromInput(qty, item);
  const unitCost = chosen?.costPricePiasters ?? null;
  const estimate =
    unitCost !== null && base > 0
      ? Math.round((weight ? base / 1000 : base) * unitCost)
      : null;

  const submit = async () => {
    setError(null);
    if (base <= 0) {
      setError("اكتب الكمية");
      return;
    }
    if (base > limit) {
      setError(`الكمية أكبر من الموجود (${formatQty(limit, item)})`);
      return;
    }
    if (reason === "other" && !note.trim()) {
      setError("اكتب السبب في الملاحظة");
      return;
    }
    const body = {
      action: "waste",
      storeVariantId: item.variantId,
      quantityBase: base,
      batchId: batchId || null,
      reason,
      note: note.trim() || null,
    };
    setBusy(true);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, opId: op.opIdFor(body) }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message || "تعذر تسجيل التالف");
      }
      op.reset();
      onSaved(
        `اتسجّل ${formatQty(base, item)} ${WASTE_REASON_LABELS[reason]} من ${item.productName}`,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل التالف");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`تالف / فاقد: ${item.productName}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <Button
          kind="danger"
          size="lg"
          wide
          busy={busy}
          disabled={busy}
          onClick={() => void submit()}
          data-testid="loss-submit"
        >
          {busy ? "بيتسجّل…" : "سجّل"}
        </Button>
      }
    >
      <div
        data-testid="record-loss"
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div
          role="group"
          aria-label="السبب"
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)" }}>
            السبب
          </span>
          <Chips tight>
            {OWNER_WASTE_REASONS.map((r) => (
              <Chip
                key={r}
                active={reason === r}
                onClick={() => setReason(r)}
                data-testid={`loss-reason-${r}`}
              >
                {WASTE_REASON_LABELS[r]}
              </Chip>
            ))}
          </Chips>
        </div>

        <Field
          label="من أنهي دفعة؟"
          hint="كل دفعة بصلاحيتها؛ التلقائي بياخد الأقدم صلاحية الأول"
        >
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            data-testid="loss-batch"
          >
            <option value="">الأقدم صلاحية الأول (تلقائي)</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {batchLabel(b, item)}
              </option>
            ))}
          </select>
        </Field>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: !weight && pack > 1 ? "1fr 1fr" : "1fr",
            gap: 10,
          }}
        >
          {weight ? (
            <Field label="الكمية (كيلو)">
              <input
                inputMode="decimal"
                value={qty.kg}
                onChange={(e) => setQty({ ...qty, kg: e.target.value })}
                placeholder="مثال: 0.5"
                data-testid="loss-kg"
              />
            </Field>
          ) : (
            <>
              {pack > 1 && (
                <Field label={`${pw} (${pack} ${uw})`}>
                  <input
                    inputMode="numeric"
                    value={qty.packs}
                    onChange={(e) => setQty({ ...qty, packs: e.target.value })}
                    data-testid="loss-packs"
                  />
                </Field>
              )}
              <Field label={pack > 1 ? `${uw} زيادة` : `العدد (${uw})`}>
                <input
                  inputMode="numeric"
                  value={qty.units}
                  onChange={(e) => setQty({ ...qty, units: e.target.value })}
                  data-testid="loss-units"
                />
              </Field>
            </>
          )}
        </div>

        <Field label="ملاحظة (اختياري)">
          <input
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: الكرتونة وقعت واتكسرت"
          />
        </Field>

        {base > 0 && (
          <div style={{ fontSize: 14, color: "var(--ink2)" }}>
            هيتخصم {formatQty(base, item)} من المخزون
            {estimate !== null
              ? ` · خسارة تقريبية ${formatMoney(estimate)}`
              : ""}
          </div>
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
