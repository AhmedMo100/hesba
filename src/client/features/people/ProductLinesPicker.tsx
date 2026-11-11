"use client";

/**
 * @file ProductLinesPicker.tsx
 * @description Pick products and quantities in each product's OWN selling unit (from the
 * Products screen): weight in kilograms, packed goods in packs + loose units, the rest in
 * units. The quantity becomes integer base units (grams / pieces) with the domain rules.
 */

import React, { useMemo, useState } from "react";
import { Field, Icon } from "@/client/shared/ui";
import { normalizeArabic } from "@/domain/normalize";
import { kilogramsToGrams, packsToPieces } from "@/domain/units";
import { packWord, unitWord } from "@/client/shared/unit-labels";
import type { StockInventoryItem } from "@/client/shared/store-items";

export interface PickedLine {
  key: string;
  variantId: string;
  /** Weighed goods: kilograms as typed. */
  kg: string;
  packs: string;
  units: string;
}

const toNum = (v: string) => {
  const n = Number(
    v.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))),
  );
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The line's quantity in base units (grams or pieces); 0 when nothing valid is typed. */
export function lineQuantityBase(
  line: PickedLine,
  item: Pick<StockInventoryItem, "unitMode" | "packQty">,
): number {
  if (item.unitMode === "weight") {
    const kg = toNum(line.kg);
    return kg > 0 ? kilogramsToGrams(kg) : 0;
  }
  const pack = Math.max(1, item.packQty || 1);
  const packs = Math.floor(toNum(line.packs));
  const units = Math.floor(toNum(line.units));
  return (pack > 1 ? packsToPieces(packs, pack) : 0) + units;
}

export function ProductLinesPicker({
  inventory,
  lines,
  onChange,
  showStock = false,
}: {
  /** null while loading. */
  inventory: StockInventoryItem[] | null;
  lines: PickedLine[];
  onChange: (lines: PickedLine[]) => void;
  showStock?: boolean;
}) {
  const [q, setQ] = useState("");
  const byVariant = useMemo(
    () => new Map((inventory ?? []).map((i) => [i.variantId, i])),
    [inventory],
  );
  const matches = useMemo(() => {
    const nq = normalizeArabic(q.trim());
    if (!nq || !inventory) return [];
    return inventory
      .filter(
        (i) =>
          !lines.some((l) => l.variantId === i.variantId) &&
          normalizeArabic(`${i.productName} ${i.flavor ?? ""}`).includes(nq),
      )
      .slice(0, 6);
  }, [q, inventory, lines]);

  const update = (key: string, patch: Partial<PickedLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="المنتجات">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={inventory ? "دوّر على المنتج" : "بيحمّل المنتجات…"}
          disabled={!inventory}
          data-testid="lines-search"
        />
      </Field>
      {matches.length > 0 && (
        <div
          role="listbox"
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
        >
          {matches.map((i) => (
            <button
              type="button"
              role="option"
              aria-selected={false}
              key={i.variantId}
              data-testid={`lines-option-${i.variantId}`}
              onClick={() => {
                onChange([
                  ...lines,
                  {
                    key: crypto.randomUUID(),
                    variantId: i.variantId,
                    kg: i.unitMode === "weight" ? "1" : "",
                    packs: "",
                    units: i.unitMode === "weight" ? "" : "1",
                  },
                ]);
                setQ("");
              }}
              style={{
                display: "flex",
                justifyContent: "space-between",
                minHeight: 44,
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--sf)",
                color: "var(--ink)",
                fontWeight: 700,
              }}
            >
              <span>
                {i.productName} {i.flavor ? `(${i.flavor})` : ""}
              </span>
              {showStock && (
                <small style={{ color: "var(--ink2)" }}>
                  {i.unitMode === "weight"
                    ? `${(i.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`
                    : `${i.currentStockBase} ${unitWord(i.unit)}`}
                </small>
              )}
            </button>
          ))}
        </div>
      )}

      {lines.map((l) => {
        const item = byVariant.get(l.variantId);
        if (!item) return null;
        const weight = item.unitMode === "weight";
        const pack = Math.max(1, item.packQty || 1);
        const uw = unitWord(item.unit);
        const pw = packWord(item.packName, pack);
        return (
          <div
            key={l.key}
            data-testid={`lines-row-${item.variantId}`}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: 10,
              borderRadius: 14,
              background: "var(--sf2)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <b>
                {item.productName} {item.flavor ? `(${item.flavor})` : ""}
              </b>
              <button
                type="button"
                aria-label={`شيل ${item.productName}`}
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  border: 0,
                  background: "none",
                  color: "var(--ink2)",
                }}
              >
                <Icon n="x" s={16} />
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: !weight && pack > 1 ? "1fr 1fr" : "1fr",
                gap: 8,
              }}
            >
              {weight ? (
                <Field label="الوزن (كيلو)">
                  <input
                    inputMode="decimal"
                    value={l.kg}
                    onChange={(e) => update(l.key, { kg: e.target.value })}
                    data-testid="lines-kg"
                  />
                </Field>
              ) : (
                <>
                  {pack > 1 && (
                    <Field label={`${pw} (${pack} ${uw})`}>
                      <input
                        inputMode="numeric"
                        value={l.packs}
                        onChange={(e) =>
                          update(l.key, { packs: e.target.value })
                        }
                        data-testid="lines-packs"
                      />
                    </Field>
                  )}
                  <Field label={pack > 1 ? `${uw} زيادة` : `عدد (${uw})`}>
                    <input
                      inputMode="numeric"
                      value={l.units}
                      onChange={(e) => update(l.key, { units: e.target.value })}
                      data-testid="lines-units"
                    />
                  </Field>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
