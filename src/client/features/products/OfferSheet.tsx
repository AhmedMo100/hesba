"use client";

/**
 * @file OfferSheet.tsx
 * @description V19 offerSheet — add or edit an offer from «بضاعتي»: its name, its type
 * (خصم % · اشترِ واخد هدية · سعر ثابت للمجموعة), its products with their quantities, and what
 * the customer saves. The offer is stored as products plus one final price (`POST
 * /api/promotions`, which re-prices every product on the server and refuses a price that is
 * not below the original), so every type ends as that price: a percentage off the paid
 * products, the paid products only (the gift is free), or the fixed price typed here.
 */

import React, { useMemo, useState } from "react";
import { Modal } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import type { StoreProductItem } from "@/client/shared/store-items";
import type { PublishedPromotion } from "@/schemas/promotion";
import f from "./ProductFormModal.module.css";
import o from "./OfferSheet.module.css";

type OfferType = "pct" | "gift" | "bundle";

interface Row {
  productId: string;
  /** Pieces, or kilos for a weighed product. */
  qty: string;
  gift: boolean;
}

const WEIGHED = new Set(["kg", "g", "weight"]);
const isWeighed = (p?: StoreProductItem) => Boolean(p && WEIGHED.has(p.unit));
const priceOf = (p: StoreProductItem) =>
  p.variants?.[0]?.sell_price_piasters || p.sell_price_piasters || 0;

/** A row's value at the regular price, in piasters. */
function rowValue(p: StoreProductItem | undefined, qty: string): number {
  if (!p) return 0;
  const q = Number.parseFloat(qty) || 0;
  if (q <= 0) return 0;
  // A `kg` product's price is per kilo; a `g` product's per gram (qty typed in kilos).
  const per = p.unit === "g" ? priceOf(p) * 1000 : priceOf(p);
  return Math.round(q * per);
}

/** A new offer's id (the server keeps it; re-posting it replaces the offer). */
const newOfferId = () =>
  `offer_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const nowMs = () => new Date().getTime();

const baseQty = (p: StoreProductItem, qty: string) => {
  const q = Number.parseFloat(qty) || 0;
  return isWeighed(p) ? Math.round(q * 1000) : Math.round(q);
};

export interface OfferSheetProps {
  /** The offer to edit; absent for a new one. */
  offer?: PublishedPromotion | null;
  products: StoreProductItem[];
  onClose: () => void;
  onSave: (promo: PublishedPromotion) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export function OfferSheet({
  offer,
  products,
  onClose,
  onSave,
  onDelete,
}: OfferSheetProps) {
  const items = useMemo(
    () => products.filter((p) => p.kind !== "sandwich"),
    [products],
  );
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);

  const [name, setName] = useState(offer?.title ?? "");
  // A saved offer is its final price: it opens as «سعر ثابت» with that price.
  const [type, setType] = useState<OfferType>(offer ? "bundle" : "pct");
  const [pct, setPct] = useState("10");
  const [price, setPrice] = useState(
    offer ? String(offer.promoPricePiasters / 100) : "",
  );
  const [rows, setRows] = useState<Row[]>(() =>
    offer
      ? offer.items.map((it) => {
          const p = byId.get(it.productId);
          return {
            productId: it.productId,
            qty: String(
              p && isWeighed(p) ? it.quantityBase / 1000 : it.quantityBase,
            ),
            gift: false,
          };
        })
      : [{ productId: "", qty: "1", gift: false }],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const all = rows.reduce(
    (s, r) => s + rowValue(byId.get(r.productId), r.qty),
    0,
  );
  const paid = rows
    .filter((r) => !r.gift)
    .reduce((s, r) => s + rowValue(byId.get(r.productId), r.qty), 0);
  const offerPrice =
    type === "pct"
      ? Math.round(paid * (1 - (Number.parseFloat(pct) || 0) / 100))
      : type === "gift"
        ? paid
        : Math.round((Number.parseFloat(price) || 0) * 100);
  const save = Math.max(0, all - offerPrice);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    setError(null);
    const chosen = rows.filter(
      (r) => r.productId && (Number.parseFloat(r.qty) || 0) > 0,
    );
    if (!name.trim()) return setError("اكتب اسم العرض");
    if (chosen.length === 0) return setError("ضيف منتج واحد على الأقل");
    if (
      type === "gift" &&
      (!chosen.some((r) => !r.gift) || !chosen.some((r) => r.gift))
    )
      return setError("حدد منتج بيتدفع ومنتج هدية");
    if (type === "pct") {
      const n = Number.parseFloat(pct);
      if (!(n > 0 && n < 100)) return setError("نسبة الخصم من 1 لحد 99%");
    }
    if (!(offerPrice > 0)) return setError("سعر العرض لازم يكون أكبر من صفر");
    if (offerPrice >= all)
      return setError("سعر العرض لازم يكون أقل من سعرهم منفردين");

    const lines = chosen.map((r) => {
      const p = byId.get(r.productId)!;
      return {
        productId: p.id,
        variantId: p.variants?.[0]?.id ?? p.id,
        productName: p.name_ar,
        quantityBase: baseQty(p, r.qty),
        unit: p.unit || "piece",
        regularPricePiasters: priceOf(p),
      };
    });
    setBusy(true);
    try {
      await onSave({
        id: offer?.id ?? newOfferId(),
        title: name.trim(),
        description: offer?.description ?? "",
        type: lines.length === 1 ? "single_discount" : "bundle",
        items: lines,
        originalPricePiasters: all,
        promoPricePiasters: offerPrice,
        savingsPiasters: save,
        createdAt: offer?.createdAt ?? nowMs(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "مقدرناش نحفظ العرض");
    } finally {
      setBusy(false);
    }
  };

  const chip = (
    on: boolean,
    label: string,
    onClick: () => void,
    id?: string,
  ) => (
    <button
      type="button"
      className={`${f.chip} ${on ? f.chipOn : ""}`}
      onClick={onClick}
      aria-pressed={on}
      data-testid={id}
    >
      {label}
    </button>
  );

  return (
    <Modal title="🎁 عرض" onClose={onClose}>
      <div className={f.form} data-testid="offer-form" dir="rtl">
        <label className={f.lbl} htmlFor="offer-name">
          اسم العرض
        </label>
        <input
          id="offer-name"
          className={f.input}
          dir="auto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="offer-name"
        />

        <div className={f.lbl}>نوع العرض</div>
        <div className={f.chips}>
          {chip(
            type === "pct",
            "خصم %",
            () => setType("pct"),
            "offer-type-pct",
          )}
          {chip(
            type === "gift",
            "اشترِ واخد هدية",
            () => setType("gift"),
            "offer-type-gift",
          )}
          {chip(
            type === "bundle",
            "سعر ثابت للمجموعة",
            () => setType("bundle"),
            "offer-type-bundle",
          )}
        </div>
        {type === "pct" && (
          <>
            <label className={f.lbl} htmlFor="offer-pct">
              نسبة الخصم %
            </label>
            <input
              id="offer-pct"
              className={f.input}
              type="number"
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              data-testid="offer-pct"
            />
          </>
        )}
        {type === "bundle" && (
          <>
            <label className={f.lbl} htmlFor="offer-price">
              سعر العرض كله
            </label>
            <input
              id="offer-price"
              className={f.input}
              type="number"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              data-testid="offer-price"
            />
          </>
        )}

        <div className={f.lbl}>المنتجات</div>
        {rows.map((r, i) => {
          const p = byId.get(r.productId);
          return (
            <div key={i} className={o.swrow} data-testid="offer-row">
              <select
                className={f.select}
                value={r.productId}
                onChange={(e) => setRow(i, { productId: e.target.value })}
                data-testid="offer-product"
              >
                <option value="">اختار منتج</option>
                {items.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name_ar}
                  </option>
                ))}
              </select>
              <div className={f.two}>
                <input
                  className={f.input}
                  type="number"
                  inputMode="decimal"
                  value={r.qty}
                  onChange={(e) => setRow(i, { qty: e.target.value })}
                  aria-label={isWeighed(p) ? "الكمية بالكيلو" : "العدد"}
                  data-testid="offer-qty"
                />
                {chip(
                  type === "gift" && r.gift,
                  type === "gift" ? (r.gift ? "🎁 هدية" : "💰 بيتدفع") : "عادي",
                  () => type === "gift" && setRow(i, { gift: !r.gift }),
                  "offer-gift",
                )}
              </div>
              <button
                type="button"
                className={o.x}
                onClick={() =>
                  setRows((prev) => prev.filter((_, k) => k !== i))
                }
              >
                ✕ امسح
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={`${f.btn} ${f.ghost}`}
          onClick={() =>
            setRows((prev) => [
              ...prev,
              { productId: "", qty: "1", gift: false },
            ])
          }
          data-testid="offer-add-product"
        >
          + منتج
        </button>

        <div className={f.sumbox}>
          <div className={o.line}>
            <span>سعرهم منفردين</span>
            <b data-testid="offer-all">{formatMoney(all)}</b>
          </div>
          <div className={o.line}>
            <span>سعر العرض</span>
            <b data-testid="offer-final">{formatMoney(offerPrice)}</b>
          </div>
          <div className={o.line}>
            <span>الوفر للعميل</span>
            <b data-testid="offer-save">{formatMoney(save)}</b>
          </div>
        </div>

        {error && (
          <div className={f.errBox} role="alert" data-testid="offer-error">
            {error}
          </div>
        )}
        <button
          type="button"
          className={f.btn}
          disabled={busy}
          onClick={() => void submit()}
          data-testid="offer-save-btn"
        >
          {busy ? "بيتحفظ…" : "حفظ العرض ✅"}
        </button>
        {offer && onDelete && (
          <button
            type="button"
            className={`${f.btn} ${f.danger}`}
            disabled={busy}
            onClick={() => {
              if (window.confirm(`تمسح «${offer.title}»؟`))
                void onDelete(offer.id);
            }}
            data-testid="offer-delete"
          >
            🗑️ امسح
          </button>
        )}
      </div>
    </Modal>
  );
}

export default OfferSheet;
