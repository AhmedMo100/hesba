"use client";

import React, { useState, useMemo } from "react";
import { Modal, Button, Field } from "../../shared/ui";
import { formatMoney } from "../../shared/i18n";
import type { StoreProductItem } from "./ProductsView";

export interface StockProductOption {
  variantId: string;
  productId: string;
  productName: string;
  flavor?: string | null;
  unitMode: "piece" | "weight";
  packQty: number;
  currentStockBase: number;
}

export interface AddStockModalProps {
  options?: StockProductOption[];
  presetVariantId?: string | null;
  targetProduct?: StoreProductItem | null;
  onClose: () => void;
  onAdded: () => void;
}

export function AddStockModal({
  options = [],
  presetVariantId,
  targetProduct,
  onClose,
  onAdded,
}: AddStockModalProps) {
  const initialOption: StockProductOption | undefined = useMemo(() => {
    if (targetProduct) {
      const primaryVar = targetProduct.variants?.[0];
      const isWeight =
        targetProduct.unit === "weight" ||
        targetProduct.unit === "kg" ||
        targetProduct.unit === "g";
      return {
        variantId: primaryVar?.id || `temp_${targetProduct.id}`,
        productId: targetProduct.id,
        productName: targetProduct.name_ar,
        flavor: primaryVar?.flavor,
        unitMode: isWeight ? "weight" : "piece",
        packQty: primaryVar?.pack_qty || 1,
        currentStockBase: targetProduct.stock_quantity || 0,
      };
    }
    return undefined;
  }, [targetProduct]);

  const activeOptions = useMemo(() => {
    if (initialOption) return [initialOption];
    return options;
  }, [initialOption, options]);

  const [selectedVariantId, setSelectedVariantId] = useState(
    presetVariantId ||
      initialOption?.variantId ||
      (options[0]?.variantId ?? ""),
  );
  const [cartons, setCartons] = useState(
    initialOption && initialOption.packQty > 1 ? "1" : "",
  );
  const [pieces, setPieces] = useState(
    initialOption && initialOption.packQty <= 1 ? "1" : "",
  );
  const [weightUnit, setWeightUnit] = useState<"kg" | "g">(
    targetProduct?.unit === "g" ? "g" : "kg",
  );
  const [weightInput, setWeightInput] = useState(
    initialOption?.unitMode === "weight" ? "1" : "",
  );
  const [costEgp, setCostEgp] = useState(
    targetProduct?.buy_cost_piasters
      ? (targetProduct.buy_cost_piasters / 100).toString()
      : "",
  );
  const [expiry, setExpiry] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [batchCode, setBatchCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedOption = useMemo(
    () =>
      activeOptions.find((o) => o.variantId === selectedVariantId) ||
      initialOption,
    [activeOptions, selectedVariantId, initialOption],
  );

  // Compute total base quantity
  const totalBaseQty = useMemo(() => {
    if (!selectedOption) return 0;
    if (selectedOption.unitMode === "weight") {
      const wNum = parseFloat(weightInput) || 0;
      return weightUnit === "kg" ? Math.round(wNum * 1000) : Math.round(wNum);
    } else {
      const cartonsNum = parseInt(cartons, 10) || 0;
      const piecesNum = parseInt(pieces, 10) || 0;
      const packQty = selectedOption.packQty || 1;
      return cartonsNum * packQty + piecesNum;
    }
  }, [selectedOption, weightUnit, weightInput, cartons, pieces]);

  // Compute unit cost in piasters
  const unitCostEgp = useMemo(() => {
    const costNum = parseFloat(costEgp) || 0;
    if (costNum <= 0 || totalBaseQty <= 0) return 0;
    if (selectedOption?.unitMode === "weight") {
      if (weightUnit === "kg") {
        return (costNum / totalBaseQty) * 1000;
      }
      return costNum / totalBaseQty;
    }
    return costNum / totalBaseQty;
  }, [costEgp, totalBaseQty, selectedOption, weightUnit]);

  const addDaysToToday = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0]!;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!selectedVariantId && !targetProduct) {
      newErrors.product = "اختر المنتج أولاً";
    }

    if (totalBaseQty <= 0) {
      newErrors.qty =
        selectedOption?.unitMode === "weight"
          ? "اكتب وزن البضاعة التي دخلت"
          : "اكتب الكمية التي دخلت";
    }

    const costNum = parseFloat(costEgp);
    if (isNaN(costNum) || costNum < 0) {
      newErrors.cost = "اكتب إجمالي سعر الشراء";
    }

    if (!noExpiry && !expiry) {
      newErrors.expiry = 'اختر تاريخ الصلاحية أو اضغط "مفيش صلاحية"';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const costPiasters = Math.round(costNum * 100);
      let targetVariantId = selectedVariantId;

      // If adding a global catalog product that has no storeVariant row yet, upsert storeProduct first
      if (
        targetProduct &&
        (targetProduct.id.startsWith("gp_") ||
          targetVariantId.startsWith("temp_"))
      ) {
        const calculatedBuyCost =
          costPiasters > 0 && totalBaseQty > 0
            ? Math.round(costPiasters / totalBaseQty)
            : (targetProduct.buy_cost_piasters ?? 0);

        const prodRes = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nameAr: targetProduct.name_ar,
            category: targetProduct.category,
            unit: targetProduct.unit,
            sellPricePiasters: targetProduct.sell_price_piasters,
            buyCostPiasters: calculatedBuyCost,
            globalProductId:
              targetProduct.global_product_id ||
              targetProduct.id.replace("gp_", ""),
            variants: [
              {
                flavor: targetProduct.variants?.[0]?.flavor ?? null,
                sizeValue: targetProduct.variants?.[0]?.size_value ?? null,
                sizeUnit: targetProduct.variants?.[0]?.size_unit ?? null,
                packQty: targetProduct.variants?.[0]?.pack_qty ?? 1,
                sellPricePiasters:
                  targetProduct.variants?.[0]?.sell_price_piasters ??
                  targetProduct.sell_price_piasters,
                costPricePiasters: calculatedBuyCost,
                globalVariantId:
                  targetProduct.variants?.[0]?.global_variant_id ??
                  targetProduct.variants?.[0]?.id,
              },
            ],
          }),
        });

        if (!prodRes.ok) {
          const prodErr = await prodRes.json().catch(() => ({}));
          throw new Error(
            prodErr.error?.message || "تعذر تجهيز المنتج للإضافة للمخزون",
          );
        }

        const prodData = await prodRes.json();
        targetVariantId = prodData.product?.variants?.[0]?.id;
      }

      const payload = {
        action: "add",
        storeVariantId: targetVariantId,
        quantityBase: totalBaseQty,
        costPricePiasters: costPiasters,
        expiryDate: noExpiry ? null : expiry || null,
        batchCode: batchCode.trim() || null,
      };

      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "فشل تسجيل البضاعة في المخزون");
      }

      onAdded();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
      setErrors({ submit: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const quickExpiryChips = [
    { label: "بعد شهر", days: 30 },
    { label: "بعد 3 شهور", days: 90 },
    { label: "بعد 6 شهور", days: 180 },
    { label: "بعد سنة", days: 365 },
  ];

  return (
    <Modal
      title={
        targetProduct
          ? `إضافة للمخزون: ${targetProduct.name_ar}`
          : "إضافة للمخزون"
      }
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose} disabled={isSubmitting}>
            إلغاء
          </Button>
          <Button
            kind="primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
            loading={isSubmitting}
          >
            تأكيد الإضافة للمخزون ✓
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {errors.submit && (
          <div
            style={{
              color: "var(--red, #cf3c3c)",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {errors.submit}
          </div>
        )}

        {targetProduct ? (
          <div
            style={{
              padding: "10px 14px",
              background: "var(--sf2)",
              borderRadius: 12,
              border: "1px solid var(--line)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <b
                style={{ display: "block", fontSize: 14, color: "var(--ink)" }}
              >
                {targetProduct.name_ar}
              </b>
              <small style={{ color: "var(--ink2)", fontSize: 12 }}>
                {targetProduct.category}
              </small>
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--ok)",
                background: "color-mix(in srgb, var(--ok) 12%, transparent)",
                padding: "2px 8px",
                borderRadius: 6,
              }}
            >
              إضافة للمخزون لأول مرة
            </span>
          </div>
        ) : (
          <Field label="المنتج" err={errors.product}>
            <select
              value={selectedVariantId}
              onChange={(e) => {
                setSelectedVariantId(e.target.value);
                setErrors({});
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 14,
              }}
            >
              {activeOptions.map((opt) => (
                <option key={opt.variantId} value={opt.variantId}>
                  {opt.productName} {opt.flavor ? `(${opt.flavor})` : ""} —
                  الموجود:{" "}
                  {opt.unitMode === "weight"
                    ? `${opt.currentStockBase / 1000} كجم`
                    : `${opt.currentStockBase} قطعة`}
                </option>
              ))}
            </select>
          </Field>
        )}

        {selectedOption && (
          <>
            {selectedOption.unitMode === "weight" ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 6,
                      color: "var(--ink2)",
                    }}
                  >
                    وحدة الوزن المدخلة:
                  </span>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border:
                          weightUnit === "kg"
                            ? "1.5px solid var(--ink)"
                            : "1px solid var(--line)",
                        background:
                          weightUnit === "kg" ? "var(--ink)" : "var(--sf)",
                        color: weightUnit === "kg" ? "var(--bg)" : "var(--ink)",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                      onClick={() => setWeightUnit("kg")}
                    >
                      بالكيلو (كجم)
                    </button>
                    <button
                      type="button"
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border:
                          weightUnit === "g"
                            ? "1.5px solid var(--ink)"
                            : "1px solid var(--line)",
                        background:
                          weightUnit === "g" ? "var(--ink)" : "var(--sf)",
                        color: weightUnit === "g" ? "var(--bg)" : "var(--ink)",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                      onClick={() => setWeightUnit("g")}
                    >
                      بالجرام (جم)
                    </button>
                  </div>
                </div>

                <Field
                  label={
                    weightUnit === "kg"
                      ? "الوزن اللي دخل (بالكيلو)"
                      : "الوزن اللي دخل (بالجرام)"
                  }
                  err={errors.qty}
                  hint={
                    totalBaseQty > 0
                      ? weightUnit === "kg"
                        ? `(تعادل ${totalBaseQty.toLocaleString("ar-EG")} جرام)`
                        : `(تعادل ${(totalBaseQty / 1000).toFixed(3)} كيلو)`
                      : undefined
                  }
                >
                  <input
                    type="number"
                    step={weightUnit === "kg" ? "0.05" : "1"}
                    min="0"
                    value={weightInput}
                    onChange={(e) => setWeightInput(e.target.value)}
                    placeholder={
                      weightUnit === "kg" ? "مثال: 5.5" : "مثال: 500"
                    }
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                    }}
                  />
                </Field>
              </div>
            ) : (
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      selectedOption.packQty > 1 ? "1fr 1fr" : "1fr",
                    gap: 10,
                  }}
                >
                  {selectedOption.packQty > 1 && (
                    <Field
                      label={`كراتين (${selectedOption.packQty} قطعة/كرتونة)`}
                    >
                      <input
                        type="number"
                        min="0"
                        value={cartons}
                        onChange={(e) => setCartons(e.target.value)}
                        placeholder="عدد الكراتين"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1.5px solid var(--line)",
                        }}
                      />
                    </Field>
                  )}
                  <Field
                    label={
                      selectedOption.packQty > 1
                        ? "قطع زيادة (مفرد)"
                        : "الكمية (قطع)"
                    }
                    err={errors.qty}
                  >
                    <input
                      type="number"
                      min="0"
                      value={pieces}
                      onChange={(e) => setPieces(e.target.value)}
                      placeholder="عدد القطع"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1.5px solid var(--line)",
                      }}
                    />
                  </Field>
                </div>
                {totalBaseQty > 0 && selectedOption.packQty > 1 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ok)",
                      fontWeight: 700,
                      marginTop: 4,
                    }}
                  >
                    إجمالي الكمية: {totalBaseQty} قطعة
                  </div>
                )}
              </div>
            )}

            <Field
              label="إجمالي سعر الشراء (ج.م)"
              err={errors.cost}
              hint={
                unitCostEgp > 0
                  ? selectedOption.unitMode === "weight"
                    ? weightUnit === "kg"
                      ? `الكيلو بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                      : `الجرام بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                    : `القطعة بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                  : "السعر الإجمالي اللي دفعته للكمية دي"
              }
            >
              <input
                type="number"
                step="0.5"
                min="0"
                value={costEgp}
                onChange={(e) => setCostEgp(e.target.value)}
                placeholder="مثال: 250"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                }}
              />
            </Field>

            <Field label="تاريخ الصلاحية" err={errors.expiry}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {!noExpiry && (
                  <input
                    type="date"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                    }}
                  />
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    setNoExpiry(!noExpiry);
                    if (!noExpiry) setExpiry("");
                  }}
                >
                  <input
                    type="checkbox"
                    id="noExpiryCheck"
                    checked={noExpiry}
                    onChange={(e) => {
                      setNoExpiry(e.target.checked);
                      if (e.target.checked) setExpiry("");
                    }}
                    style={{ width: 18, height: 18, cursor: "pointer" }}
                  />
                  <label
                    htmlFor="noExpiryCheck"
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    المنتج ملوش تاريخ صلاحية (زي المنظفات والورقيات)
                  </label>
                </div>

                {!noExpiry && (
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      marginTop: 4,
                    }}
                  >
                    {quickExpiryChips.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => setExpiry(addDaysToToday(chip.days))}
                        style={{
                          padding: "4px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          borderRadius: 6,
                          border: "1px solid var(--line)",
                          background: "var(--sf2)",
                          color: "var(--ink)",
                          cursor: "pointer",
                        }}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>

            <Field label="كود التشغيلة / الباتش (اختياري)">
              <input
                type="text"
                value={batchCode}
                onChange={(e) => setBatchCode(e.target.value)}
                placeholder="مثال: B-2026-11"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                }}
              />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
