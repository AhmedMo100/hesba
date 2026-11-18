/**
 * @file stock-entry.logic.ts
 * @description What the «دخلت بضاعة» quantity form asks for, from how the product is really
 * sold (its unit, its pack, a bag's contents), and the quantity and total it records. Pure.
 *
 * The product model: one selling unit (`piece`, `علبة`, `برطمان`, `bag`, `كرتونة`, `kg`/`g`
 * or a word the owner typed), an optional pack of `packQty` units (`sizeUnit` = its word), and
 * for a bag its contents (`sizeValue` pieces or grams). Stock is counted in the selling unit
 * (grams for weighed goods); a buy price is per selling unit (per kg for weighed goods).
 */

import type {
  StockInventoryItem,
  StoreProductItem,
} from "@/client/shared/store-items";
import {
  packPluralWord,
  packWord,
  unitPluralWord,
  unitWord,
} from "@/client/shared/unit-labels";

export type StockSellingMethod =
  "piece" | "can" | "jar" | "bag" | "carton" | "weight" | string;

export function resolveSellingMethod(u?: string): StockSellingMethod {
  const val = (u || "").toLowerCase();
  if (val === "weight" || val === "kg" || val === "g") return "weight";
  if (val === "can" || val === "علبة") return "can";
  if (val === "jar" || val === "برطمان") return "jar";
  if (val === "bag" || val === "كيس") return "bag";
  if (val === "carton" || val === "كرتونة") return "carton";
  if (val === "piece" || val === "قطعة" || val === "unit") return "piece";
  if (val) return val;
  return "piece";
}

/** A product as the stock-in form sees it. */
export interface StockProductOption {
  variantId: string;
  productId: string;
  productName: string;
  flavor?: string | null;
  unitMode: "piece" | "weight";
  packQty: number;
  currentStockBase: number;
  /** Registered buy price per selling unit (per kg for weighed goods). */
  buyCostPiasters?: number;
  unit?: string;
  category?: string;
  /** The product's pack word (كرتونة / كيس / دستة), when it is sold in packs too. */
  packName?: string | null;
  /** A bag's contents: how many pieces / grams one unit holds. */
  sizeValue?: number | null;
  sizeUnit?: string | null;
  /** Optional shop barcode (ADR-0031). */
  barcode?: string | null;
}

const WEIGHT_UNITS = new Set(["weight", "kg", "g"]);

/** The stock-in option for a shop product (with its stock row, when it has one). */
export function optionFromProduct(
  p: StoreProductItem,
  inv?: StockInventoryItem,
): StockProductOption {
  const v = p.variants?.[0];
  const isWeight = WEIGHT_UNITS.has(p.unit) || inv?.unitMode === "weight";
  const packQty = Math.max(1, v?.pack_qty ?? inv?.packQty ?? 1);
  return {
    variantId: inv?.variantId || v?.id || `temp_${p.id}`,
    productId: p.id,
    productName: p.name_ar,
    flavor: v?.flavor || inv?.flavor,
    unitMode: isWeight ? "weight" : "piece",
    packQty,
    currentStockBase:
      inv?.currentStockBase ?? v?.stock_quantity ?? p.stock_quantity ?? 0,
    buyCostPiasters:
      inv?.buyPricePiasters ||
      v?.buy_cost_piasters ||
      p.buy_cost_piasters ||
      undefined,
    unit: p.unit,
    category: p.category,
    packName: packQty > 1 ? (inv?.packName ?? v?.size_unit ?? null) : null,
    sizeValue: v?.size_value ?? null,
    sizeUnit: v?.size_unit ?? null,
    barcode: v?.barcode ?? p.barcode ?? inv?.barcode ?? null,
  };
}

/** The stock-in option for a stock row alone (no product row loaded). */
export function optionFromInventory(i: StockInventoryItem): StockProductOption {
  return {
    variantId: i.variantId,
    productId: i.productId,
    productName: i.productName,
    flavor: i.flavor,
    unitMode: i.unitMode,
    packQty: Math.max(1, i.packQty || 1),
    currentStockBase: i.currentStockBase,
    buyCostPiasters: i.buyPricePiasters,
    unit: i.unit || (i.unitMode === "weight" ? "kg" : "piece"),
    category: i.category,
    packName: i.packName ?? null,
    barcode: i.barcode ?? null,
  };
}

const CARD_CATEGORIES = new Set(["كروت شحن", "كروت مرافق"]);

/** The fields the form shows for this product. */
export type EntryShape =
  | { kind: "weight" }
  | {
      kind: "count";
      /** «برطمان», «قطعة», «كارت» … and «البرطمانات» for «عدد …». */
      one: string;
      plural: string;
      /** Sold in packs too: count packs and loose units. */
      pack: { qty: number; one: string; plural: string } | null;
      /** What one unit holds (a bag of 10 pieces / of 500 g). */
      content: { amount: number; unit: "piece" | "g" | "kg" } | null;
    };

export function entryShape(opt: StockProductOption): EntryShape {
  const method = resolveSellingMethod(opt.unit);
  if (method === "weight" || opt.unitMode === "weight")
    return { kind: "weight" };
  const isCard = CARD_CATEGORIES.has(opt.category ?? "");
  const one = isCard ? "كارت" : unitWord(opt.unit);
  const plural = isCard ? "الكروت" : unitPluralWord(opt.unit);
  const packQty = Math.max(1, Math.floor(opt.packQty || 1));
  const pack =
    method !== "carton" && packQty > 1
      ? (() => {
          const word = packWord(opt.packName, packQty);
          return { qty: packQty, one: word, plural: packPluralWord(word) };
        })()
      : null;
  const sizeUnit = (opt.sizeUnit ?? "").toLowerCase();
  const amount = Number(opt.sizeValue ?? 0);
  const content =
    method === "bag" &&
    amount > 0 &&
    (sizeUnit === "piece" || sizeUnit === "g" || sizeUnit === "kg")
      ? { amount, unit: sizeUnit as "piece" | "g" | "kg" }
      : null;
  return { kind: "count", one, plural, pack, content };
}

/** «ال» + word, without doubling it (الكيس, not الالكيس). */
export const withAl = (word: string) =>
  word.startsWith("ال") ? word : `ال${word}`;

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface EntryInput {
  /** Packs (count products with a pack). */
  packs: string;
  /** Units: all of them, or the loose ones next to packs. */
  units: string;
  /** Weighed goods: the weight in `weightUnit`. */
  weight: string;
  weightUnit: "kg" | "g";
  /** Buy price of one unit (of one kg / one gram for weighed goods, per `weightUnit`). */
  unitPrice: string;
  /** Buy price of one pack. */
  packPrice: string;
}

export interface EntryTotals {
  /** Stock quantity in base units (grams for weighed goods). */
  baseQty: number;
  /** What the whole quantity cost, in piasters (0 = no price entered). */
  totalPiasters: number;
  /** «2 كرتونة و 3 قطعة» / «5.5 كيلو». */
  qtyText: string;
  /** A bag's total contents: «50 قطعة» / «2.5 كيلو». */
  contentText: string | null;
}

export function entryTotals(shape: EntryShape, input: EntryInput): EntryTotals {
  if (shape.kind === "weight") {
    const w = num(input.weight);
    const grams = Math.round(input.weightUnit === "kg" ? w * 1000 : w);
    const total = Math.round(w * num(input.unitPrice) * 100);
    return {
      baseQty: grams,
      totalPiasters: total,
      qtyText: grams > 0 ? `${fmt(grams / 1000)} كيلو` : "—",
      contentText: null,
    };
  }
  const packs = shape.pack ? Math.floor(num(input.packs)) : 0;
  const units = Math.floor(num(input.units));
  const baseQty = packs * (shape.pack?.qty ?? 1) + units;
  const total = Math.round(
    (packs * num(input.packPrice) + units * num(input.unitPrice)) * 100,
  );
  const parts: string[] = [];
  if (packs > 0) parts.push(`${packs} ${shape.pack!.one}`);
  if (units > 0) parts.push(`${units} ${shape.one}`);
  let contentText: string | null = null;
  if (shape.content && baseQty > 0) {
    const all = shape.content.amount * baseQty;
    contentText =
      shape.content.unit === "piece"
        ? `${fmt(all)} قطعة`
        : shape.content.unit === "kg"
          ? `${fmt(all)} كيلو`
          : all >= 1000
            ? `${fmt(all / 1000)} كيلو`
            : `${fmt(all)} جرام`;
  }
  return {
    baseQty,
    totalPiasters: total,
    qtyText: parts.length ? parts.join(" و ") : "—",
    contentText,
  };
}

/** The registered unit price (EGP) for the chosen weight unit / unit, as the input shows it. */
export function registeredPrices(
  shape: EntryShape,
  buyCostPiasters: number | undefined,
  weightUnit: "kg" | "g" = "kg",
): { unitPrice: string; packPrice: string } {
  const per = (buyCostPiasters ?? 0) / 100;
  if (!(per > 0)) return { unitPrice: "", packPrice: "" };
  if (shape.kind === "weight") {
    return {
      unitPrice: priceText(weightUnit === "kg" ? per : per / 1000),
      packPrice: "",
    };
  }
  return {
    unitPrice: priceText(per),
    packPrice: shape.pack ? priceText(per * shape.pack.qty) : "",
  };
}

/** A price for an input: up to 2 decimals (4 for a gram), no trailing zeros. */
export function priceText(n: number): string {
  if (!(n > 0)) return "";
  const digits = n < 0.1 ? 4 : 2;
  return String(Number(n.toFixed(digits)));
}
