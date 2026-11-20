"use client";

/**
 * @file StockEntrySheet.tsx
 * @description «دخلت بضاعة» for one product (V19 buy sheet): the quantity in the product's
 * real selling units (packs + loose units, a weight, a bag's contents), the buy price per
 * unit, the total, this batch's own expiry, and how it was paid: the drawer, one of the
 * shop's machines / wallets (its balance goes down), or on credit to a supplier (one purchase
 * invoice, one payable). Shared by the Stock, Alerts and Products screens.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, useToast } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { apiGet } from "@/client/shared/api/read-cache";
import {
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import { unitCostFromTotal } from "@/domain/stock/batch-cost";
import type { StockInventoryItem } from "@/client/shared/store-items";
import {
  entryShape,
  entryTotals,
  piastersOf,
  priceText,
  registeredPrices,
  registeredSellText,
  sellPriceWord,
  withAl,
  type StockProductOption,
} from "./stock-entry.logic";
import { productEmoji } from "@/client/shared/product-emoji";
import styles from "./StockView.module.css";

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
}

/** «cash» (the drawer), «credit» (a supplier), or a machine / wallet id. */
type Pay = "cash" | "credit" | `m:${string}`;

const isUuid = (val?: string | null): val is string =>
  Boolean(
    val &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val),
  );

const ymd = (d: Date) => d.toISOString().split("T")[0]!;

const EXPIRY_PRESETS = [
  { label: "بعد أسبوع", value: "week" },
  { label: "بعد شهر", value: "1m" },
  { label: "بعد 3 شهور", value: "3m" },
  { label: "بعد سنة", value: "1y" },
  { label: "من غير صلاحية", value: "none" },
];

export function formatOptionStock(opt?: StockProductOption): string {
  if (!opt) return "—";
  if (opt.currentStockBase <= 0) return "خلصان (0)";
  const shape = entryShape(opt);
  if (shape.kind === "weight") {
    return `${(opt.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كيلو`;
  }
  if (shape.pack) {
    const packs = Math.floor(opt.currentStockBase / shape.pack.qty);
    const rest = opt.currentStockBase % shape.pack.qty;
    if (packs > 0 && rest > 0)
      return `${packs} ${shape.pack.one} و ${rest} ${shape.one}`;
    if (packs > 0) return `${packs} ${shape.pack.one}`;
  }
  return `${opt.currentStockBase} ${shape.one}`;
}

export interface StockEntrySheetProps {
  option: StockProductOption;
  /** The product's batches now (shown so the new one is clearly a separate batch). */
  batches?: StockInventoryItem["batches"];
  onClose: () => void;
  /** Recorded: the screen reloads its data. */
  onSaved: () => void;
}

export function StockEntrySheet({
  option,
  batches: givenBatches,
  onClose,
  onSaved,
}: StockEntrySheetProps) {
  const toast = useToast();
  // The batches now: given by the screen, or read from the stock list (cached).
  const [loadedBatches, setLoadedBatches] = useState<
    StockInventoryItem["batches"]
  >([]);
  useEffect(() => {
    if (givenBatches) return;
    let alive = true;
    apiGet("/api/stock")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { inventory?: StockInventoryItem[] } | null) => {
        const row = d?.inventory?.find(
          (i) =>
            i.variantId === option.variantId ||
            i.productId === option.productId,
        );
        if (alive && row) setLoadedBatches(row.batches ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [givenBatches, option.variantId, option.productId]);
  const batches = givenBatches ?? loadedBatches;
  const shape = useMemo(() => entryShape(option), [option]);
  const isWeight = shape.kind === "weight";
  const pack = shape.kind === "count" ? shape.pack : null;

  const initial = registeredPrices(
    shape,
    option.buyCostPiasters,
    "kg",
    option.unit,
  );
  const initialSell = registeredSellText(option.sellPricePiasters);
  const [packs, setPacks] = useState(pack ? "1" : "");
  const [units, setUnits] = useState(pack ? "" : isWeight ? "" : "1");
  const [weight, setWeight] = useState(isWeight ? "1" : "");
  const [weightUnit, setWeightUnit] = useState<"kg" | "g">("kg");
  const [unitPrice, setUnitPrice] = useState(initial.unitPrice);
  const [packPrice, setPackPrice] = useState(initial.packPrice);
  // The registered sell price, shown and editable; saved with the batch when changed.
  const [sellPrice, setSellPrice] = useState(initialSell);
  const [production, setProduction] = useState("");

  const [expiry, setExpiry] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);

  const [pay, setPay] = useState<Pay>("cash");
  const [machines, setMachines] = useState<PosMachine[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [paidNowFrom, setPaidNowFrom] = useState<"cash" | `m:${string}`>(
    "cash",
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One operation id per attempt: a retry after a lost answer is recorded once (ADR-0020).
  const opRef = useRef<{ key: string; id: string } | null>(null);
  const variantRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchStoreMachines().then((list) => {
      if (alive) setMachines(list.filter((m) => m.status !== "inactive"));
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (pay !== "credit" || suppliers !== null) return;
    let alive = true;
    apiGet("/api/people?section=suppliers")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            people?: Array<{ id: string; name: string; phone: string | null }>;
          } | null,
        ) => {
          if (!alive) return;
          const list = (d?.people ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            phone: p.phone ?? null,
          }));
          setSuppliers(list);
          if (list[0]) setSupplierId((cur) => cur || list[0]!.id);
        },
      )
      .catch(() => alive && setSuppliers([]));
    return () => {
      alive = false;
    };
  }, [pay, suppliers]);

  const totals = entryTotals(shape, {
    packs,
    units,
    weight,
    weightUnit,
    unitPrice,
    packPrice,
  });
  const total = totals.totalPiasters;
  const paidNowPiasters = Math.min(
    total,
    Math.max(0, Math.round((parseFloat(paidNow) || 0) * 100)),
  );
  const productUnit = option.unit || (isWeight ? "kg" : "piece");
  /** The registered prices to save with the batch: only those the owner changed. */
  const priceChanges = (): {
    sellPricePiasters?: number;
    buyPricePiasters?: number;
  } => {
    const out: { sellPricePiasters?: number; buyPricePiasters?: number } = {};
    const sell = piastersOf(sellPrice);
    if (sell !== null && sellPrice !== initialSell)
      out.sellPricePiasters = sell;
    const buyEdited =
      unitPrice !== initial.unitPrice || packPrice !== initial.packPrice;
    if (buyEdited && total > 0 && totals.baseQty > 0) {
      const perUnit = unitCostFromTotal(total, totals.baseQty, productUnit);
      if (perUnit !== null) out.buyPricePiasters = Number(perUnit);
    }
    return out;
  };
  const machineOf = (p: string) =>
    p.startsWith("m:") ? machines.find((m) => `m:${m.id}` === p) : undefined;
  const payMachine = machineOf(pay);
  const paidNowMachine = machineOf(paidNowFrom);

  // ─── Prices: a pack and a unit stay in step ───
  const onUnitPrice = (v: string) => {
    setUnitPrice(v);
    if (pack) {
      const n = parseFloat(v);
      setPackPrice(n > 0 ? priceText(n * pack.qty) : "");
    }
  };
  const onPackPrice = (v: string) => {
    setPackPrice(v);
    if (pack) {
      const n = parseFloat(v);
      setUnitPrice(n > 0 ? priceText(n / pack.qty) : "");
    }
  };
  const onWeightUnit = (u: "kg" | "g") => {
    if (u === weightUnit) return;
    const w = parseFloat(weight);
    const p = parseFloat(unitPrice);
    setWeight(w > 0 ? priceText(u === "g" ? w * 1000 : w / 1000) : weight);
    setUnitPrice(p > 0 ? priceText(u === "g" ? p / 1000 : p * 1000) : "");
    setWeightUnit(u);
  };

  const applyPreset = (value: string) => {
    setPreset(value);
    if (value === "none") {
      setNoExpiry(true);
      setExpiry("");
      return;
    }
    setNoExpiry(false);
    const d = new Date();
    if (value === "week") d.setDate(d.getDate() + 7);
    else
      d.setMonth(d.getMonth() + ({ "1m": 1, "3m": 3, "1y": 12 }[value] ?? 0));
    setExpiry(ymd(d));
  };

  // ─── Saving ───

  /** The variant to stock: a catalog product picked here becomes the shop's first. */
  const ensureVariant = async (): Promise<string> => {
    if (isUuid(option.variantId)) return option.variantId;
    if (variantRef.current) return variantRef.current;
    const unit = productUnit;
    const derived =
      total > 0 && totals.baseQty > 0
        ? unitCostFromTotal(total, totals.baseQty, unit)
        : null;
    const buyCost =
      derived !== null ? Number(derived) : (option.buyCostPiasters ?? 0);
    // The sell price typed here (or the catalog's), never the buy price or zero.
    const sell = piastersOf(sellPrice) ?? option.sellPricePiasters ?? 0;
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nameAr: option.productName,
        category: option.category || "المخزون",
        unit,
        sellPricePiasters: sell,
        buyCostPiasters: buyCost,
        variants: [
          {
            flavor: option.flavor ?? null,
            packQty: Math.max(1, option.packQty || 1),
            sellPricePiasters: sell,
            costPricePiasters: buyCost,
          },
        ],
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        json.error?.message || "تعذر تجهيز المنتج للإضافة للمخزون",
      );
    }
    const id = json.data?.variants?.[0]?.id || json.product?.variants?.[0]?.id;
    if (!id) throw new Error("تعذر تحديد الصنف في المخزون");
    variantRef.current = id;
    return id;
  };

  /** The chosen supplier, or a new one created once (a retry reuses it). */
  const ensureSupplier = async (): Promise<Supplier> => {
    const chosen = (suppliers ?? []).find((x) => x.id === supplierId);
    if (chosen) return chosen;
    const name = newSupplierName.trim();
    if (!name) throw new Error("اختار المورد أو اكتب اسم مورد جديد");
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        phone: newSupplierPhone.trim() || undefined,
        section: "suppliers",
        amountEgp: "0",
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      person?: { id: string; name: string; phone: string | null };
      error?: { message?: string };
    } | null;
    if (!res.ok || !json?.person) {
      throw new Error(json?.error?.message || "تعذر تسجيل المورد");
    }
    const created = {
      id: json.person.id,
      name: json.person.name,
      phone: json.person.phone ?? null,
    };
    setSuppliers((prev) => [...(prev ?? []), created]);
    setSupplierId(created.id);
    return created;
  };

  const validate = (): string | null => {
    if (totals.baseQty <= 0) {
      return isWeight
        ? "اكتب الوزن اللي دخل"
        : `اكتب عدد ${shape.kind === "count" ? shape.plural : "القطع"} اللي دخلت`;
    }
    if (!noExpiry && !expiry) return "اختار تاريخ الصلاحية أو «من غير صلاحية»";
    if (!noExpiry && production && expiry && expiry < production)
      return "نهاية الصلاحية لازم تكون بعد بدايتها";
    if (piastersOf(sellPrice) === null)
      return `اكتب سعر بيع ${sellPriceWord(shape, productUnit)}`;
    if (pay === "credit" && total <= 0)
      return "اكتب سعر الشراء عشان نعرف المبلغ الآجل";
    if (payMachine && total <= 0)
      return "اكتب سعر الشراء عشان نخصمه من رصيد الماكينة";
    if (payMachine && payMachine.currentBalancePiasters < total)
      return `رصيد ${payMachine.name} مش كفاية (${formatMoney(payMachine.currentBalancePiasters)})`;
    if (
      pay === "credit" &&
      paidNowMachine &&
      paidNowPiasters > paidNowMachine.currentBalancePiasters
    )
      return `رصيد ${paidNowMachine.name} مش كفاية (${formatMoney(paidNowMachine.currentBalancePiasters)})`;
    if (
      pay === "credit" &&
      !(suppliers ?? []).some((x) => x.id === supplierId) &&
      !newSupplierName.trim()
    )
      return "اختار المورد أو اكتب اسم مورد جديد";
    return null;
  };

  const submit = async () => {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const variantId = await ensureVariant();
      const expiryDate = noExpiry ? null : expiry || null;
      const productionDate = noExpiry ? null : production || null;
      // A product created just now already has the typed prices.
      const prices = isUuid(option.variantId) ? priceChanges() : {};
      if (pay === "credit") {
        // آجل لمورد: one supplier purchase — the batch and the payable in one transaction.
        const supplier = await ensureSupplier();
        const body = {
          supplierId: supplier.id,
          lines: [
            {
              storeVariantId: variantId,
              quantityBase: totals.baseQty,
              totalCostPiasters: total,
              expiryDate,
              productionDate,
              ...prices,
            },
          ],
          paidNowPiasters,
          ...(paidNowPiasters > 0
            ? paidNowMachine
              ? { paidFrom: "wallet", paidFromMachineId: paidNowMachine.id }
              : { paidFrom: "cash" }
            : {}),
        };
        const key = JSON.stringify(body);
        if (opRef.current?.key !== key)
          opRef.current = { key, id: crypto.randomUUID() };
        const res = await fetch("/api/purchases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opId: opRef.current.id, ...body }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message || "فشل تسجيل فاتورة المورد");
        }
        toast.show({
          msg: `اتسجلت الدخلة ✅ — ${formatMoney(total - paidNowPiasters)} آجل لـ ${supplier.name}`,
          kind: "ok",
        });
      } else {
        const body = {
          action: "add",
          storeVariantId: variantId,
          quantityBase: totals.baseQty,
          costTotalPiasters: total,
          expiryDate,
          productionDate,
          ...prices,
          batchCode: null,
          ...(payMachine
            ? { paidFrom: "wallet", paidFromMachineId: payMachine.id }
            : { paidFrom: "cash" }),
        };
        const key = JSON.stringify(body);
        if (opRef.current?.key !== key)
          opRef.current = { key, id: crypto.randomUUID() };
        const res = await fetch("/api/stock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, opId: opRef.current.id }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message || "فشل تسجيل البضاعة");
        }
        toast.show({
          msg: payMachine
            ? `اتسجلت الدخلة ✅ — اتخصم ${formatMoney(total)} من ${payMachine.name}`
            : `اتسجلت الدخلة ✅ — ${option.productName}`,
          kind: "ok",
        });
      }
      opRef.current = null;
      window.dispatchEvent(new CustomEvent("hesba_stock_updated"));
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "حصلت مشكلة، جرّب تاني");
    } finally {
      setSubmitting(false);
    }
  };

  const liveBatches = batches.filter((b) => b.remainingQty > 0);
  const unitLabel = shape.kind === "count" ? shape.one : "";
  const weightWord = weightUnit === "kg" ? "الكيلو" : "الجرام";

  return (
    <Modal
      title={`${productEmoji({ name: option.productName, category: option.category, unit: option.unit, weighed: isWeight })} ${option.productName}`}
      onClose={onClose}
    >
      <div className={styles.sheetBody} data-testid="stock-entry">
        <p className={styles.note}>المتاح: {formatOptionStock(option)}</p>

        {/* ─── Quantity, in the product's own units ─── */}
        {isWeight ? (
          <div className={styles.two}>
            <div>
              <div className={styles.lbl} data-testid="stock-qty-label">
                الوزن اللي دخل
              </div>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                className={styles.input}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder={weightUnit === "kg" ? "مثلاً: 5.5" : "مثلاً: 750"}
                data-testid="stock-weight"
              />
            </div>
            <div>
              <div className={styles.lbl}>بالـ</div>
              <div className={styles.chips} style={{ margin: 0 }}>
                {(["kg", "g"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={`${styles.chip} ${weightUnit === u ? styles.chipOn : ""}`}
                    onClick={() => onWeightUnit(u)}
                    data-testid={`stock-weight-${u}`}
                  >
                    {u === "kg" ? "كيلو" : "جرام"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : pack ? (
          <>
            <div className={styles.two}>
              <div>
                <div className={styles.lbl} data-testid="stock-qty-label">
                  عدد {pack.plural}
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  className={styles.input}
                  value={packs}
                  onChange={(e) => setPacks(e.target.value)}
                  placeholder={`مثلاً: 3`}
                  data-testid="stock-packs"
                />
              </div>
              <div>
                <div className={styles.lbl}>
                  {shape.kind === "count"
                    ? shape.plural.replace(/^ال/, "")
                    : ""}{" "}
                  زيادة
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  className={styles.input}
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  placeholder="0"
                  data-testid="stock-qty"
                />
              </div>
            </div>
            <p className={styles.note} data-testid="stock-pack-relation">
              {withAl(pack.one)} = {pack.qty} {unitLabel}
            </p>
          </>
        ) : (
          <>
            <div className={styles.lbl} data-testid="stock-qty-label">
              عدد {shape.kind === "count" ? shape.plural : ""}
            </div>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              className={styles.input}
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder={`مثلاً: 12`}
              data-testid="stock-qty"
            />
          </>
        )}
        {shape.kind === "count" && shape.content && (
          <p className={styles.note} data-testid="stock-content">
            {shape.content.unit === "piece"
              ? `${withAl(shape.one)} فيه ${shape.content.amount} قطعة`
              : `وزن ${withAl(shape.one)} ${shape.content.amount} ${shape.content.unit === "kg" ? "كيلو" : "جرام"}`}
            {totals.contentText &&
              ` · ${shape.content.unit === "piece" ? "إجمالي القطع" : "إجمالي الوزن"}: ${totals.contentText}`}
          </p>
        )}

        {/* ─── Buy price per unit ─── */}
        {pack ? (
          <div className={styles.two}>
            <div>
              <div className={styles.lbl} data-testid="stock-cost-label">
                سعر شراء {withAl(pack.one)}
              </div>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                className={styles.input}
                value={packPrice}
                onChange={(e) => onPackPrice(e.target.value)}
                placeholder="0"
                data-testid="stock-pack-cost"
              />
            </div>
            <div>
              <div className={styles.lbl}>سعر شراء {withAl(unitLabel)}</div>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                className={styles.input}
                value={unitPrice}
                onChange={(e) => onUnitPrice(e.target.value)}
                placeholder="0"
                data-testid="stock-unit-cost"
              />
            </div>
          </div>
        ) : (
          <>
            <div className={styles.lbl} data-testid="stock-cost-label">
              سعر شراء {isWeight ? weightWord : withAl(unitLabel)}
            </div>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              className={styles.input}
              value={unitPrice}
              onChange={(e) => onUnitPrice(e.target.value)}
              placeholder="0"
              data-testid="stock-unit-cost"
            />
          </>
        )}

        {/* ─── Sell price: the registered one, editable ─── */}
        <div className={styles.lbl} data-testid="stock-sell-label">
          سعر بيع {sellPriceWord(shape, productUnit)}
        </div>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          className={styles.input}
          value={sellPrice}
          onChange={(e) => setSellPrice(e.target.value)}
          placeholder="0"
          data-testid="stock-sell-price"
        />
        {pack && piastersOf(sellPrice) !== null && (
          <p className={styles.note} data-testid="stock-pack-sell">
            {withAl(pack.one)} بـ{" "}
            {formatMoney(piastersOf(sellPrice)! * pack.qty)}
          </p>
        )}

        <div className={styles.sumbox}>
          <div className={styles.line}>
            <span>الكمية كلها</span>
            <b data-testid="stock-qty-text">
              {totals.qtyText}
              {pack && totals.baseQty > 0 && (
                <small className={styles.muted}>
                  {" "}
                  (= {totals.baseQty} {unitLabel})
                </small>
              )}
            </b>
          </div>
          <div className={styles.line}>
            <span>تكلفة الكمية كلها</span>
            <b data-testid="stock-total">
              {total > 0 ? formatMoney(total) : "—"}
            </b>
          </div>
        </div>

        {/* ─── This batch's own expiry ─── */}
        {liveBatches.length > 0 && (
          <div className={styles.sumbox} data-testid="stock-batches">
            <div className={styles.lbl}>الدفعات اللي عندك دلوقتي</div>
            {liveBatches.map((b) => (
              <div key={b.id} className={styles.line}>
                <span>
                  {b.expiryDate
                    ? b.productionDate
                      ? `${b.productionDate.slice(0, 10)} ← ${b.expiryDate.slice(0, 10)}`
                      : `تنتهي ${b.expiryDate.slice(0, 10)}`
                    : "من غير صلاحية"}
                </span>
                <b>
                  {isWeight
                    ? `${b.remainingQty / 1000} كيلو`
                    : `${b.remainingQty} ${unitLabel}`}
                </b>
              </div>
            ))}
            <div className={styles.note}>
              الكمية الجديدة هتتسجل دفعة لوحدها بصلاحيتها، ومش هتغيّر صلاحية
              اللي قبلها.
            </div>
          </div>
        )}
        <div className={styles.lbl}>تاريخ صلاحية الدفعة دي</div>
        <div className={styles.chips}>
          {EXPIRY_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`${styles.chip} ${preset === p.value ? styles.chipOn : ""}`}
              onClick={() => applyPreset(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {!noExpiry && (
          <div className={styles.two}>
            <div>
              <div className={styles.lbl}>بداية الصلاحية (الإنتاج)</div>
              <input
                type="date"
                className={styles.input}
                value={production}
                max={
                  expiry && expiry < ymd(new Date()) ? expiry : ymd(new Date())
                }
                onChange={(e) => setProduction(e.target.value)}
                data-testid="stock-production"
              />
            </div>
            <div>
              <div className={styles.lbl}>نهاية الصلاحية</div>
              <input
                type="date"
                className={styles.input}
                value={expiry}
                min={production || undefined}
                onChange={(e) => {
                  setExpiry(e.target.value);
                  setPreset(null);
                }}
                data-testid="stock-expiry"
              />
            </div>
          </div>
        )}

        {/* ─── Paid how (V19 payChips + «آجل لمورد») ─── */}
        <div className={styles.lbl}>الدفع إزاي؟</div>
        <div className={styles.chips} data-testid="stock-pay">
          <button
            type="button"
            className={`${styles.chip} ${pay === "cash" ? styles.chipOn : ""}`}
            data-testid="stock-pay-paid"
            onClick={() => setPay("cash")}
          >
            💵 كاش
          </button>
          {machines.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.chip} ${pay === `m:${m.id}` ? styles.chipOn : ""}`}
              data-testid="stock-pay-machine"
              onClick={() => setPay(`m:${m.id}`)}
            >
              💳 {m.name}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.chip} ${pay === "credit" ? styles.chipOn : ""}`}
            data-testid="stock-pay-credit"
            onClick={() => setPay("credit")}
          >
            📒 آجل لمورد
          </button>
        </div>
        {payMachine && (
          <p className={styles.note} data-testid="stock-machine-balance">
            رصيد {payMachine.name} دلوقتي{" "}
            {formatMoney(payMachine.currentBalancePiasters)}
            {total > 0 &&
              ` · بعد الدفع ${formatMoney(payMachine.currentBalancePiasters - total)}`}
          </p>
        )}

        {pay === "credit" && (
          <div data-testid="stock-supplier">
            <div className={styles.lbl}>المورد</div>
            <div className={styles.chips}>
              {(suppliers ?? []).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={`${styles.chip} ${supplierId === x.id ? styles.chipOn : ""}`}
                  onClick={() => setSupplierId(x.id)}
                >
                  {x.name}
                </button>
              ))}
              <button
                type="button"
                className={`${styles.chip} ${supplierId === "" ? styles.chipOn : ""}`}
                data-testid="stock-new-supplier"
                onClick={() => setSupplierId("")}
              >
                + مورد جديد
              </button>
            </div>
            {supplierId === "" && (
              <>
                <input
                  className={styles.input}
                  placeholder="اسم المورد"
                  dir="auto"
                  value={newSupplierName}
                  data-testid="stock-supplier-name"
                  onChange={(e) => setNewSupplierName(e.target.value)}
                />
                <input
                  className={styles.input}
                  type="tel"
                  dir="ltr"
                  placeholder="رقم المورد (اختياري)"
                  value={newSupplierPhone}
                  onChange={(e) => setNewSupplierPhone(e.target.value)}
                />
              </>
            )}
            <div className={styles.lbl}>دفعت للمورد دلوقتي (اختياري)</div>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="0"
              value={paidNow}
              data-testid="stock-paid-now"
              onChange={(e) => setPaidNow(e.target.value)}
            />
            {paidNowPiasters > 0 && (
              <div className={styles.chips}>
                <button
                  type="button"
                  className={`${styles.chip} ${paidNowFrom === "cash" ? styles.chipOn : ""}`}
                  onClick={() => setPaidNowFrom("cash")}
                >
                  💵 كاش
                </button>
                {machines.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`${styles.chip} ${paidNowFrom === `m:${m.id}` ? styles.chipOn : ""}`}
                    onClick={() => setPaidNowFrom(`m:${m.id}`)}
                  >
                    💳 {m.name}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.sumbox}>
              <div className={styles.line}>
                <span>الباقي عليك للمورد</span>
                <b data-testid="stock-credit-rest">
                  {formatMoney(Math.max(0, total - paidNowPiasters))}
                </b>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        <button
          type="button"
          className={styles.confirmBtn}
          disabled={submitting}
          onClick={() => void submit()}
          data-testid="stock-confirm"
        >
          {submitting ? "بيتسجّل…" : "سجّل الدخلة ✅"}
        </button>
      </div>
    </Modal>
  );
}

export default StockEntrySheet;
