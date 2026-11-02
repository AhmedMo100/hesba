"use client";

import React, { useState, useMemo } from "react";
import { Modal, Button, Field, Seg, Icon } from "../../shared/ui";
import { formatMoney } from "../../shared/i18n";
import { ProductFormModal } from "./ProductFormModal";
import type { StoreProductItem } from "./ProductsView";

export interface StockProductOption {
  variantId: string;
  productId: string;
  productName: string;
  flavor?: string | null;
  unitMode: "piece" | "weight";
  packQty: number;
  currentStockBase: number;
  buyCostPiasters?: number;
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
        packQty: primaryVar?.pack_qty || 12,
        currentStockBase: targetProduct.stock_quantity || 0,
        buyCostPiasters: targetProduct.buy_cost_piasters,
      };
    }
    return undefined;
  }, [targetProduct]);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchDropdown, setSearchDropdown] = useState("");
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [extraOptions, setExtraOptions] = useState<StockProductOption[]>([]);

  const activeOptions = useMemo(() => {
    if (initialOption) return [initialOption];
    return [...extraOptions, ...options];
  }, [initialOption, extraOptions, options]);

  const [selectedVariantId, setSelectedVariantId] = useState(
    presetVariantId ||
      initialOption?.variantId ||
      (options[0]?.variantId ?? ""),
  );

  const isInitialWeight =
    targetProduct?.unit === "weight" ||
    targetProduct?.unit === "kg" ||
    targetProduct?.unit === "g";

  // المستخدم يختار بحرية بين بالقطعة/الكرتونة أو بالوزن
  const [entryMode, setEntryMode] = useState<"unit" | "weight">(
    isInitialWeight ? "weight" : "unit",
  );

  const defaultPackN =
    targetProduct?.variants?.[0]?.pack_qty &&
    targetProduct.variants[0].pack_qty > 1
      ? targetProduct.variants[0].pack_qty
      : 12;

  const [packN, setPackN] = useState<string>(defaultPackN.toString());
  const [cartons, setCartons] = useState(
    !isInitialWeight && defaultPackN > 1 ? "1" : "",
  );
  const [pieces, setPieces] = useState(
    !isInitialWeight && defaultPackN <= 1 ? "1" : "",
  );
  const [weightUnit, setWeightUnit] = useState<"kg" | "g">(
    targetProduct?.unit === "g" ? "g" : "kg",
  );
  const [weightInput, setWeightInput] = useState(isInitialWeight ? "1" : "");
  const [costEgp, setCostEgp] = useState("");
  const [isCostManuallyEdited, setIsCostManuallyEdited] = useState(false);
  const [prodDate, setProdDate] = useState("");
  const [expiry, setExpiry] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [batchCode, setBatchCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatOptionStock = (opt: StockProductOption) => {
    if (opt.currentStockBase <= 0) return "خلصان";
    if (opt.unitMode === "weight") {
      return `${(opt.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
    }
    const pack = opt.packQty || 1;
    if (pack > 1) {
      const cartonsCount = Math.floor(opt.currentStockBase / pack);
      const piecesCount = opt.currentStockBase % pack;
      if (cartonsCount > 0 && piecesCount > 0) {
        return `${cartonsCount} كرتونة و ${piecesCount} قطعة`;
      }
      if (cartonsCount > 0 && piecesCount === 0) {
        return `${cartonsCount} كرتونة`;
      }
      return `${piecesCount} قطعة`;
    }
    return `${opt.currentStockBase} قطعة`;
  };

  const filteredOptions = useMemo(() => {
    const q = searchDropdown.trim().toLowerCase();
    if (!q) return activeOptions;
    return activeOptions.filter(
      (opt) =>
        opt.productName.toLowerCase().includes(q) ||
        (opt.flavor && opt.flavor.toLowerCase().includes(q)),
    );
  }, [activeOptions, searchDropdown]);

  const selectedOption = useMemo(
    () =>
      activeOptions.find((o) => o.variantId === selectedVariantId) ||
      initialOption,
    [activeOptions, selectedVariantId, initialOption],
  );

  const packMultiplier = Math.max(1, parseInt(packN, 10) || 1);

  // Compute total base quantity (pieces for unit, grams for weight)
  const totalBaseQty = useMemo(() => {
    if (entryMode === "weight") {
      const wNum = parseFloat(weightInput) || 0;
      return weightUnit === "kg" ? Math.round(wNum * 1000) : Math.round(wNum);
    } else {
      const cartonsNum = parseInt(cartons, 10) || 0;
      const piecesNum = parseInt(pieces, 10) || 0;
      return cartonsNum * packMultiplier + piecesNum;
    }
  }, [entryMode, weightUnit, weightInput, cartons, pieces, packMultiplier]);

  const regPiecePiasters =
    targetProduct?.buy_cost_piasters ?? selectedOption?.buyCostPiasters ?? 0;
  const regPieceCost = regPiecePiasters > 0 ? regPiecePiasters / 100 : 0;
  const regCartonCost = regPieceCost * packMultiplier;

  // Auto-calculated expected cost based on registered product pricing
  const expectedCostEgp = useMemo(() => {
    if (regPieceCost <= 0) return 0;
    if (entryMode === "weight") {
      const wNum = parseFloat(weightInput) || 0;
      if (wNum <= 0) return 0;
      if (weightUnit === "kg") {
        return Math.round(wNum * regPieceCost * 100) / 100;
      }
      return Math.round((wNum / 1000) * regPieceCost * 100) / 100;
    } else {
      const cartonsNum = parseInt(cartons, 10) || 0;
      const piecesNum = parseInt(pieces, 10) || 0;
      if (cartonsNum <= 0 && piecesNum <= 0) return 0;
      const totalExpected =
        cartonsNum * regCartonCost + piecesNum * regPieceCost;
      return Math.round(totalExpected * 100) / 100;
    }
  }, [
    regPieceCost,
    regCartonCost,
    entryMode,
    weightUnit,
    weightInput,
    cartons,
    pieces,
  ]);

  // If not manually edited by user, use expectedCostEgp if available
  const effectiveCostEgp = isCostManuallyEdited
    ? costEgp
    : expectedCostEgp > 0
      ? expectedCostEgp.toString()
      : costEgp;

  // Compute effective unit cost entered
  const unitCostEgp = useMemo(() => {
    const costNum = parseFloat(effectiveCostEgp) || 0;
    if (costNum <= 0 || totalBaseQty <= 0) return 0;
    if (entryMode === "weight") {
      if (weightUnit === "kg") {
        return (costNum / totalBaseQty) * 1000;
      }
      return costNum / totalBaseQty;
    }
    return costNum / totalBaseQty;
  }, [effectiveCostEgp, totalBaseQty, entryMode, weightUnit]);

  // Price comparison feedback against the registered cost in Products
  const priceComparison = useMemo(() => {
    const costNum = parseFloat(effectiveCostEgp) || 0;
    if (costNum <= 0 || totalBaseQty <= 0) return null;

    const cartonsNum = parseInt(cartons, 10) || 0;
    const piecesNum = parseInt(pieces, 10) || 0;

    if (entryMode === "unit") {
      // إذا أدخل كراتين فقط
      if (cartonsNum > 0 && piecesNum === 0) {
        const actualCartonCost = costNum / cartonsNum;
        if (regCartonCost > 0) {
          const diff = actualCartonCost - regCartonCost;
          if (Math.abs(diff) < 0.05) {
            return {
              status: "match" as const,
              msg: `سعر الشراء مطابق لسعر شراء الكرتونة المسجل في صفحة المنتجات (${formatMoney(Math.round(regCartonCost * 100))}).`,
            };
          }
          if (diff > 0) {
            return {
              status: "higher" as const,
              msg: `تنبيه: سعر شراء الكرتونة الفعلي (${formatMoney(Math.round(actualCartonCost * 100))}) أعلى من سعر الشراء المسجل في صفحة المنتجات (${formatMoney(Math.round(regCartonCost * 100))}). لازم تعدل سعر الشراء أو البيع في صفحة المنتجات عشان تحافظ على هامش ربحك.`,
            };
          }
          return {
            status: "lower" as const,
            msg: `تنبيه: سعر شراء الكرتونة الفعلي (${formatMoney(Math.round(actualCartonCost * 100))}) أقل من سعر الشراء المسجل في صفحة المنتجات (${formatMoney(Math.round(regCartonCost * 100))}). تقدر تحدث سعر الشراء في صفحة المنتجات لحساب أرباحك بدقة.`,
          };
        }
      } else {
        // قطع أو كراتين + قطع
        const actualPieceCost = costNum / totalBaseQty;
        if (regPieceCost > 0) {
          const diff = actualPieceCost - regPieceCost;
          if (Math.abs(diff) < 0.05) {
            return {
              status: "match" as const,
              msg: `سعر الشراء مطابق لسعر شراء القطعة المسجل في صفحة المنتجات (${formatMoney(Math.round(regPieceCost * 100))}).`,
            };
          }
          if (diff > 0) {
            return {
              status: "higher" as const,
              msg: `تنبيه: سعر شراء القطعة الفعلي (${formatMoney(Math.round(actualPieceCost * 100))}) أعلى من سعر الشراء المسجل في صفحة المنتجات (${formatMoney(Math.round(regPieceCost * 100))}). لازم تعدل سعر الشراء أو البيع في صفحة المنتجات عشان تحافظ على ربحك.`,
            };
          }
          return {
            status: "lower" as const,
            msg: `تنبيه: سعر شراء القطعة الفعلي (${formatMoney(Math.round(actualPieceCost * 100))}) أقل من سعر الشراء المسجل في صفحة المنتجات (${formatMoney(Math.round(regPieceCost * 100))}). تقدر تحدث سعر الشراء في صفحة المنتجات.`,
          };
        }
      }
    } else {
      // وزن
      const totalKg = totalBaseQty / 1000;
      if (totalKg > 0) {
        const actualKgCost = costNum / totalKg;
        if (regPieceCost > 0) {
          const diff = actualKgCost - regPieceCost;
          if (Math.abs(diff) < 0.05) {
            return {
              status: "match" as const,
              msg: `سعر الشراء مطابق لسعر شراء الكيلو المسجل في صفحة المنتجات (${formatMoney(Math.round(regPieceCost * 100))}).`,
            };
          }
          if (diff > 0) {
            return {
              status: "higher" as const,
              msg: `تنبيه: سعر شراء الكيلو الفعلي (${formatMoney(Math.round(actualKgCost * 100))}) أعلى من سعر الشراء المسجل في صفحة المنتجات (${formatMoney(Math.round(regPieceCost * 100))}). يرجى مراجعة وتحديث أسعار المنتج من صفحة المنتجات.`,
            };
          }
          return {
            status: "lower" as const,
            msg: `تنبيه: سعر شراء الكيلو الفعلي (${formatMoney(Math.round(actualKgCost * 100))}) أقل من سعر الشراء المسجل في صفحة المنتجات (${formatMoney(Math.round(regPieceCost * 100))}). تقدر تحدث سعر الشراء في صفحة المنتجات.`,
          };
        }
      }
    }

    return null;
  }, [
    effectiveCostEgp,
    totalBaseQty,
    cartons,
    pieces,
    entryMode,
    regCartonCost,
    regPieceCost,
  ]);

  const computeExpiryDate = (baseIso: string, months: number) => {
    const d = baseIso ? new Date(baseIso) : new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().split("T")[0]!;
  };

  const applyDurationMonths = (months: number) => {
    const base = prodDate || new Date().toISOString().split("T")[0]!;
    setExpiry(computeExpiryDate(base, months));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!selectedVariantId && !targetProduct) {
      newErrors.product = "اختر المنتج أولاً";
    }

    if (totalBaseQty <= 0) {
      newErrors.qty =
        entryMode === "weight"
          ? "اكتب وزن البضاعة التي دخلت"
          : "اكتب الكمية التي دخلت";
    }

    const costNum = parseFloat(effectiveCostEgp);
    if (isNaN(costNum) || costNum < 0) {
      newErrors.cost = "اكتب إجمالي سعر الشراء";
    }

    if (!noExpiry && !expiry) {
      newErrors.expiry = 'اختر تاريخ الصلاحية أو اضغط "مفيش صلاحية"';
    } else if (!noExpiry && prodDate && expiry && expiry < prodDate) {
      newErrors.expiry = "تاريخ الانتهاء يجب ألا يسبق تاريخ الإنتاج";
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

      const isValidUuid = (val?: string | null): val is string =>
        Boolean(
          val &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            val,
          ),
        );

      // If adding a global catalog product that has no confirmed storeVariant row yet, upsert storeProduct first
      if (
        targetProduct &&
        (targetProduct.id.startsWith("gp_") ||
          targetVariantId.startsWith("temp_") ||
          !isValidUuid(targetVariantId))
      ) {
        const calculatedBuyCost =
          costPiasters > 0 && totalBaseQty > 0
            ? Math.round(costPiasters / totalBaseQty)
            : (targetProduct.buy_cost_piasters ?? 0);

        const rawGlobalProductId =
          targetProduct.global_product_id ||
          (targetProduct.id.startsWith("gp_")
            ? targetProduct.id.replace("gp_", "")
            : targetProduct.id);
        const validGlobalProductId = isValidUuid(rawGlobalProductId)
          ? rawGlobalProductId
          : null;

        const rawGlobalVariantId =
          targetProduct.variants?.[0]?.global_variant_id ||
          targetProduct.variants?.[0]?.id;
        const validGlobalVariantId = isValidUuid(rawGlobalVariantId)
          ? rawGlobalVariantId
          : null;

        const prodRes = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nameAr: targetProduct.name_ar,
            category: targetProduct.category,
            unit: entryMode === "weight" ? weightUnit : "piece",
            sellPricePiasters:
              targetProduct.sell_price_piasters > 0
                ? targetProduct.sell_price_piasters
                : costPiasters,
            buyCostPiasters: calculatedBuyCost,
            globalProductId: validGlobalProductId,
            variants: [
              {
                flavor: targetProduct.variants?.[0]?.flavor ?? null,
                sizeValue: targetProduct.variants?.[0]?.size_value ?? null,
                sizeUnit: targetProduct.variants?.[0]?.size_unit ?? null,
                packQty: packMultiplier,
                sellPricePiasters:
                  targetProduct.variants?.[0]?.sell_price_piasters ??
                  targetProduct.sell_price_piasters ??
                  costPiasters,
                costPricePiasters: calculatedBuyCost,
                globalVariantId: validGlobalVariantId,
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
        targetVariantId =
          prodData.data?.variants?.[0]?.id ||
          prodData.product?.variants?.[0]?.id;

        if (!targetVariantId) {
          throw new Error("تعذر تحديد معرّف الصنف في المخزون");
        }
      }

      const payload = {
        action: "add",
        storeVariantId: targetVariantId,
        quantityBase: totalBaseQty,
        costPricePiasters: costPiasters,
        productionDate: noExpiry ? null : prodDate || null,
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
    { label: "بعد شهر", months: 1 },
    { label: "بعد 3 شهور", months: 3 },
    { label: "بعد 6 شهور", months: 6 },
    { label: "بعد سنة", months: 12 },
    { label: "بعد سنتين", months: 24 },
  ];

  return (
    <>
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
                  style={{
                    display: "block",
                    fontSize: 14,
                    color: "var(--ink)",
                  }}
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
                إضافة للمخزون
              </span>
            </div>
          ) : (
            <Field label="المنتج" err={errors.product}>
              <div style={{ position: "relative", width: "100%" }}>
                <div
                  role="combobox"
                  aria-expanded={dropdownOpen}
                  aria-controls="product-dropdown-list"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "11px 14px",
                    borderRadius: 12,
                    border: dropdownOpen
                      ? "1.5px solid var(--br, #5a7d5a)"
                      : "1.5px solid var(--line)",
                    background: "var(--sf)",
                    cursor: "pointer",
                    userSelect: "none",
                    boxShadow: dropdownOpen
                      ? "0 0 0 2px color-mix(in srgb, var(--br, #5a7d5a) 20%, transparent)"
                      : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        color: "var(--ink2)",
                        transform: dropdownOpen ? "rotate(180deg)" : "none",
                        transition: "transform 0.2s",
                      }}
                    >
                      <Icon n="down" s={16} />
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: selectedOption ? 700 : 500,
                        color: selectedOption ? "var(--ink)" : "var(--ink2)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selectedOption
                        ? `${selectedOption.productName}${selectedOption.flavor ? ` (${selectedOption.flavor})` : ""}`
                        : "دوّر على المنتج أو اختاره"}
                    </span>
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      color: "var(--ink2)",
                    }}
                  >
                    <Icon n="search" s={18} />
                  </span>
                </div>

                {dropdownOpen && (
                  <div
                    id="product-dropdown-list"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      left: 0,
                      background: "var(--sf)",
                      border: "1.5px solid var(--br, #5a7d5a)",
                      borderRadius: 12,
                      zIndex: 60,
                      maxHeight: 250,
                      overflowY: "auto",
                      boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {/* Quick search input inside dropdown */}
                    <div
                      style={{
                        padding: "8px 10px",
                        borderBottom: "1px solid var(--line)",
                        background: "var(--sf2)",
                      }}
                    >
                      <input
                        type="text"
                        autoFocus
                        value={searchDropdown}
                        onChange={(e) => setSearchDropdown(e.target.value)}
                        placeholder="اكتب اسم المنتج..."
                        style={{
                          width: "100%",
                          padding: "7px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                          fontSize: 13,
                          background: "var(--sf)",
                          color: "var(--ink)",
                          boxSizing: "border-box",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Dropdown Items matching Image 6 */}
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {filteredOptions.length === 0 ? (
                        <div
                          style={{
                            padding: "14px 12px",
                            textAlign: "center",
                            fontSize: 13,
                            color: "var(--ink2)",
                          }}
                        >
                          مفيش منتج بالاسم ده
                        </div>
                      ) : (
                        filteredOptions.map((opt) => (
                          <div
                            key={opt.variantId}
                            onClick={() => {
                              setSelectedVariantId(opt.variantId);
                              setDropdownOpen(false);
                              setSearchDropdown("");
                              setErrors({});
                              if (opt.unitMode === "weight") {
                                setEntryMode("weight");
                              } else {
                                setEntryMode("unit");
                                if (opt.packQty && opt.packQty > 1) {
                                  setPackN(opt.packQty.toString());
                                }
                              }
                            }}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "11px 14px",
                              borderBottom: "1px solid var(--line)",
                              cursor: "pointer",
                              background:
                                opt.variantId === selectedVariantId
                                  ? "var(--sf2)"
                                  : "transparent",
                              fontSize: 13.5,
                              fontWeight: 600,
                              color: "var(--ink)",
                            }}
                          >
                            <span>
                              {opt.productName}{" "}
                              {opt.flavor ? `(${opt.flavor})` : ""}
                            </span>
                            <span
                              style={{
                                fontSize: 12.5,
                                color:
                                  opt.currentStockBase <= 0
                                    ? "var(--red, #cf3c3c)"
                                    : "var(--ink2)",
                                direction: "ltr",
                              }}
                            >
                              {formatOptionStock(opt)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    {/* "+ مش لاقيه؟ ضيف منتج جديد" matching Image 6 */}
                    <div
                      onClick={() => {
                        setDropdownOpen(false);
                        setShowNewProductModal(true);
                      }}
                      style={{
                        padding: "12px 14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        color: "var(--br, #5a7d5a)",
                        fontWeight: 800,
                        fontSize: 14,
                        cursor: "pointer",
                        borderTop: "1px solid var(--line)",
                        background: "var(--sf2)",
                      }}
                    >
                      + مش لاقيه؟ ضيف منتج جديد
                    </div>
                  </div>
                )}
              </div>
            </Field>
          )}

          {/* اختيار نوع الكمية: قطعة/كرتونة أو بالوزن */}
          <div>
            <span
              style={{
                display: "block",
                fontSize: 12.5,
                fontWeight: 700,
                marginBottom: 6,
                color: "var(--ink2)",
              }}
            >
              نوع الكمية التي يتم إدخالها:
            </span>
            <Seg
              value={entryMode}
              onChange={(val) => setEntryMode(val as "unit" | "weight")}
              options={[
                ["unit", "بالقطعة / الكرتونة", "box"],
                ["weight", "بالوزن", "scale"],
              ]}
            />
          </div>

          {entryMode === "weight" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                  placeholder={weightUnit === "kg" ? "مثال: 5.5" : "مثال: 500"}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* إمكانية تعديل عدد القطع في الكرتونة */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 8,
                }}
              >
                <Field label="كراتين">
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

                <Field label="قطع زيادة">
                  <input
                    type="number"
                    min="0"
                    value={pieces}
                    onChange={(e) => setPieces(e.target.value)}
                    placeholder="قطع مفرد"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                    }}
                  />
                </Field>

                <Field label="قطع/كرتونة">
                  <input
                    type="number"
                    min="1"
                    value={packN}
                    onChange={(e) => setPackN(e.target.value)}
                    placeholder="12"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                    }}
                  />
                </Field>
              </div>

              {totalBaseQty > 0 && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ok)",
                    fontWeight: 700,
                    background: "var(--soft)",
                    padding: "6px 10px",
                    borderRadius: 8,
                  }}
                >
                  إجمالي الكمية: {totalBaseQty} قطعة
                  {parseInt(cartons, 10) > 0 &&
                    ` (${cartons} كرتونة${parseInt(pieces, 10) > 0 ? ` و ${pieces} قطعة` : ""})`}
                </div>
              )}
              {errors.qty && (
                <span
                  style={{
                    color: "var(--red, #cf3c3c)",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {errors.qty}
                </span>
              )}
            </div>
          )}

          {/* إجمالي سعر الشراء مع التنبيه والمقارنة المباشرة */}
          <div>
            <Field
              label="إجمالي سعر الشراء للكمية دي (ج.م)"
              err={errors.cost}
              hint={
                expectedCostEgp > 0 && !isCostManuallyEdited
                  ? `✨ تكلفة تقديرية محسوبة: ${formatMoney(Math.round(expectedCostEgp * 100))} — تقدر تعدلها لو سعر المورد مختلف`
                  : unitCostEgp > 0
                    ? entryMode === "weight"
                      ? weightUnit === "kg"
                        ? `الكيلو بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                        : `الجرام بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                      : `القطعة بـ ${formatMoney(Math.round(unitCostEgp * 100))}${packMultiplier > 1 ? ` (الكرتونة بـ ${formatMoney(Math.round(unitCostEgp * packMultiplier * 100))})` : ""}`
                    : "السعر الإجمالي الكلي اللي دفعته لكل الكمية اللي دخلت"
              }
            >
              <input
                type="number"
                step="any"
                min="0"
                value={effectiveCostEgp}
                onChange={(e) => {
                  setCostEgp(e.target.value);
                  setIsCostManuallyEdited(true);
                }}
                placeholder="مثال: 1000"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                  fontSize: 15,
                  fontWeight: 700,
                }}
              />
            </Field>

            {expectedCostEgp > 0 &&
              isCostManuallyEdited &&
              parseFloat(effectiveCostEgp) !== expectedCostEgp && (
                <div
                  style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink2)" }}
                >
                  سعر مخصص من المورد &bull;{" "}
                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--br, #5a7d5a)",
                      fontWeight: 700,
                      textDecoration: "underline",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    onClick={() => {
                      setCostEgp("");
                      setIsCostManuallyEdited(false);
                    }}
                  >
                    استخدام السعر المسجل ({expectedCostEgp} ج.م)
                  </button>
                </div>
              )}

            {/* تنبيه المقارنة مع سعر الشراء المسجل في صفحة المنتجات */}
            {priceComparison && (
              <div
                style={{
                  marginTop: 8,
                  padding: "10px 12px",
                  borderRadius: 10,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  fontWeight: 700,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  background:
                    priceComparison.status === "higher"
                      ? "var(--yelBg, #fdf6e2)"
                      : priceComparison.status === "lower"
                        ? "var(--sf2, #f5f0e1)"
                        : "var(--soft, #e1e8d4)",
                  border: `1.5px solid ${
                    priceComparison.status === "higher"
                      ? "var(--yelLine, #d9a92e)"
                      : priceComparison.status === "lower"
                        ? "var(--line, #ddd4bc)"
                        : "var(--ok, #4f6b46)"
                  }`,
                  color:
                    priceComparison.status === "higher"
                      ? "var(--yel, #b8841a)"
                      : priceComparison.status === "lower"
                        ? "var(--ink)"
                        : "var(--ok, #4f6b46)",
                }}
              >
                <span style={{ fontSize: 15, flex: "none" }}>
                  {priceComparison.status === "higher"
                    ? "⚠️"
                    : priceComparison.status === "lower"
                      ? "ℹ️"
                      : "✓"}
                </span>
                <span>{priceComparison.msg}</span>
              </div>
            )}
          </div>

          {/* إدارة الصلاحية وتاريخ الإنتاج والانتهاء */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
              }}
              onClick={() => {
                const next = !noExpiry;
                setNoExpiry(next);
                if (next) {
                  setExpiry("");
                  setProdDate("");
                }
              }}
            >
              <input
                type="checkbox"
                id="noExpiryCheck"
                checked={noExpiry}
                onChange={(e) => {
                  setNoExpiry(e.target.checked);
                  if (e.target.checked) {
                    setExpiry("");
                    setProdDate("");
                  }
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
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  <Field label="تاريخ الإنتاج / البداية (اختياري)">
                    <input
                      type="date"
                      value={prodDate}
                      onChange={(e) => setProdDate(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1.5px solid var(--line)",
                      }}
                    />
                  </Field>

                  <Field label="تاريخ الانتهاء" err={errors.expiry}>
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
                  </Field>
                </div>

                {/* أزرار حساب مدة الصلاحية التلقائية */}
                <div>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: "var(--ink2)",
                      marginBottom: 6,
                    }}
                  >
                    حساب مدة الصلاحية سريعاً من الإنتاج:
                  </span>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {quickExpiryChips.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => applyDurationMonths(chip.months)}
                        style={{
                          padding: "5px 10px",
                          fontSize: 11.5,
                          fontWeight: 700,
                          borderRadius: 8,
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
                </div>
              </div>
            )}
          </div>

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
        </form>
      </Modal>
      {showNewProductModal && (
        <ProductFormModal
          onClose={() => setShowNewProductModal(false)}
          onSaved={(savedData: unknown) => {
            setShowNewProductModal(false);
            if (savedData && typeof savedData === "object") {
              const data = savedData as {
                id?: string;
                storeProductId?: string;
                name_ar?: string;
                nameAr?: string;
                unit?: string;
                variants?: Array<{
                  id?: string;
                  flavor?: string | null;
                  pack_qty?: number;
                  packQty?: number;
                }>;
              };
              const prodId = data.id || data.storeProductId || "";
              const primaryVar = data.variants?.[0];
              const varId = primaryVar?.id || `temp_${prodId}`;
              const isWeight =
                data.unit === "kg" ||
                data.unit === "g" ||
                data.unit === "weight";
              const newOpt: StockProductOption = {
                variantId: varId,
                productId: prodId,
                productName: data.name_ar || data.nameAr || "منتج جديد",
                flavor: primaryVar?.flavor,
                unitMode: isWeight ? "weight" : "piece",
                packQty: primaryVar?.packQty || primaryVar?.pack_qty || 12,
                currentStockBase: 0,
              };
              setExtraOptions((prev) => [newOpt, ...prev]);
              setSelectedVariantId(varId);
              if (isWeight) {
                setEntryMode("weight");
              } else {
                setEntryMode("unit");
                setPackN((newOpt.packQty || 12).toString());
              }
            }
          }}
        />
      )}
    </>
  );
}
