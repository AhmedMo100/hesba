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
  unit?: string;
  category?: string;
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
        unit: targetProduct.unit,
        category: targetProduct.category,
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

  const selectedOption = useMemo(
    () =>
      activeOptions.find((o) => o.variantId === selectedVariantId) ||
      initialOption,
    [activeOptions, selectedVariantId, initialOption],
  );

  const isInitialWeight =
    targetProduct?.unit === "weight" ||
    targetProduct?.unit === "kg" ||
    targetProduct?.unit === "g" ||
    selectedOption?.unitMode === "weight";

  const isBag = targetProduct?.unit === "bag" || selectedOption?.unit === "bag";

  const isCard =
    targetProduct?.category === "كروت شحن" ||
    targetProduct?.category === "كروت مرافق" ||
    selectedOption?.category === "كروت شحن" ||
    selectedOption?.category === "كروت مرافق";

  // المستخدم يختار بحرية بين بالقطعة/الكرتونة أو بالوزن
  const [entryMode, setEntryMode] = useState<"unit" | "weight">(
    isInitialWeight ? "weight" : "unit",
  );

  const defaultPackN =
    targetProduct?.variants?.[0]?.pack_qty &&
    targetProduct.variants[0].pack_qty > 1
      ? targetProduct.variants[0].pack_qty
      : selectedOption?.packQty && selectedOption.packQty > 1
        ? selectedOption.packQty
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
  const [prodDate, setProdDate] = useState("");
  const [expiry, setExpiry] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [batchCode, setBatchCode] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatOptionStock = (opt?: StockProductOption) => {
    if (!opt) return "—";
    if (opt.currentStockBase <= 0) return "خلصان (0)";
    if (opt.unitMode === "weight") {
      return `${(opt.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
    }
    const pack = opt.packQty || 1;
    if (pack > 1) {
      const cartonsCount = Math.floor(opt.currentStockBase / pack);
      const piecesCount = opt.currentStockBase % pack;
      const unitWord = opt.unit === "bag" ? "كيس" : "قطعة";
      if (cartonsCount > 0 && piecesCount > 0) {
        return `${cartonsCount} كرتونة و ${piecesCount} ${unitWord}`;
      }
      if (cartonsCount > 0 && piecesCount === 0) {
        return `${cartonsCount} كرتونة`;
      }
      return `${piecesCount} ${unitWord}`;
    }
    return `${opt.currentStockBase} ${opt.unit === "bag" ? "كيس" : isCard ? "كارت" : "قطعة"}`;
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

  // Registered piece/unit cost from Product
  const regPiecePiasters =
    targetProduct?.buy_cost_piasters ?? selectedOption?.buyCostPiasters ?? 0;
  const regPieceCost = regPiecePiasters > 0 ? regPiecePiasters / 100 : 0;
  const regCartonCost = regPieceCost * packMultiplier;

  // Expected purchase cost calculated from registered purchase price in Products
  const expectedCostEgp = useMemo(() => {
    if (regPieceCost <= 0 || totalBaseQty <= 0) return 0;
    if (entryMode === "weight") {
      const kg = totalBaseQty / 1000;
      return Math.round(kg * regPieceCost * 100) / 100;
    } else {
      return Math.round(totalBaseQty * regPieceCost * 100) / 100;
    }
  }, [entryMode, totalBaseQty, regPieceCost]);

  // Compute effective unit cost entered
  const unitCostEgp = useMemo(() => {
    const costNum = parseFloat(costEgp) || 0;
    if (costNum <= 0 || totalBaseQty <= 0) return 0;
    if (entryMode === "weight") {
      if (weightUnit === "kg") {
        return (costNum / totalBaseQty) * 1000;
      }
      return costNum / totalBaseQty;
    }
    return costNum / totalBaseQty;
  }, [costEgp, totalBaseQty, entryMode, weightUnit]);

  // Price comparison feedback against the registered cost in Products
  const priceComparison = useMemo(() => {
    const costNum = parseFloat(costEgp) || 0;
    if (costNum <= 0 || totalBaseQty <= 0) return null;

    const cartonsNum = parseInt(cartons, 10) || 0;
    const piecesNum = parseInt(pieces, 10) || 0;

    if (entryMode === "unit") {
      if (cartonsNum > 0 && piecesNum === 0) {
        const actualCartonCost = costNum / cartonsNum;
        if (regCartonCost > 0) {
          const diff = actualCartonCost - regCartonCost;
          if (Math.abs(diff) < 0.05) {
            return {
              status: "match" as const,
              msg: `سعر الشراء مطابق لسعر شراء الكرتونة المسجل بالمنتجات (${formatMoney(Math.round(regCartonCost * 100))}).`,
            };
          }
          if (diff > 0) {
            return {
              status: "higher" as const,
              msg: `تنبيه: سعر شراء الكرتونة الفعلي (${formatMoney(Math.round(actualCartonCost * 100))}) أعلى من المسجل (${formatMoney(Math.round(regCartonCost * 100))}). يمكنك مراجعة أسعار المنتج لتثبيت هامش ربحك.`,
            };
          }
          return {
            status: "lower" as const,
            msg: `تنبيه: سعر شراء الكرتونة الفعلي (${formatMoney(Math.round(actualCartonCost * 100))}) أقل من المسجل (${formatMoney(Math.round(regCartonCost * 100))}).`,
          };
        }
      } else {
        const actualPieceCost = costNum / totalBaseQty;
        if (regPieceCost > 0) {
          const diff = actualPieceCost - regPieceCost;
          const unitWord = isBag ? "الكيس" : isCard ? "الكارت" : "القطعة";
          if (Math.abs(diff) < 0.05) {
            return {
              status: "match" as const,
              msg: `سعر الشراء مطابق لسعر شراء ${unitWord} المسجل (${formatMoney(Math.round(regPieceCost * 100))}).`,
            };
          }
          if (diff > 0) {
            return {
              status: "higher" as const,
              msg: `تنبيه: سعر شراء ${unitWord} الفعلي (${formatMoney(Math.round(actualPieceCost * 100))}) أعلى من المسجل (${formatMoney(Math.round(regPieceCost * 100))}).`,
            };
          }
          return {
            status: "lower" as const,
            msg: `تنبيه: سعر شراء ${unitWord} الفعلي (${formatMoney(Math.round(actualPieceCost * 100))}) أقل من المسجل (${formatMoney(Math.round(regPieceCost * 100))}).`,
          };
        }
      }
    } else {
      const totalKg = totalBaseQty / 1000;
      if (totalKg > 0) {
        const actualKgCost = costNum / totalKg;
        if (regPieceCost > 0) {
          const diff = actualKgCost - regPieceCost;
          if (Math.abs(diff) < 0.05) {
            return {
              status: "match" as const,
              msg: `سعر الشراء مطابق لسعر شراء الكيلو المسجل (${formatMoney(Math.round(regPieceCost * 100))}).`,
            };
          }
          if (diff > 0) {
            return {
              status: "higher" as const,
              msg: `تنبيه: سعر شراء الكيلو الفعلي (${formatMoney(Math.round(actualKgCost * 100))}) أعلى من المسجل بالمنتجات (${formatMoney(Math.round(regPieceCost * 100))}).`,
            };
          }
          return {
            status: "lower" as const,
            msg: `تنبيه: سعر شراء الكيلو الفعلي (${formatMoney(Math.round(actualKgCost * 100))}) أقل من المسجل بالمنتجات (${formatMoney(Math.round(regPieceCost * 100))}).`,
          };
        }
      }
    }

    return null;
  }, [
    costEgp,
    totalBaseQty,
    cartons,
    pieces,
    entryMode,
    regCartonCost,
    regPieceCost,
    isBag,
    isCard,
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

    const costNum = parseFloat(costEgp);
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
            unit:
              entryMode === "weight"
                ? weightUnit
                : targetProduct.unit || "piece",
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
                  {targetProduct.category} — الرصيد الحالي:{" "}
                  <b>{formatOptionStock(initialOption)}</b>
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
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1.5px solid var(--line)",
                    fontSize: 14,
                    background: "var(--sf)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Icon n="search" s={16} />
                    <span
                      style={{
                        color: selectedOption ? "var(--ink)" : "var(--ink2)",
                        fontWeight: selectedOption ? 700 : 500,
                      }}
                    >
                      {selectedOption
                        ? `${selectedOption.productName} ${selectedOption.flavor ? `(${selectedOption.flavor})` : ""} — (المخزون: ${formatOptionStock(selectedOption)})`
                        : "دوّر على المنتج أو اختاره"}
                    </span>
                  </div>
                  <Icon n="down" s={16} />
                </div>

                {dropdownOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      background: "var(--sf)",
                      border: "1.5px solid var(--line)",
                      borderRadius: 12,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                      zIndex: 100,
                      maxHeight: 280,
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div
                      style={{
                        padding: "8px 10px",
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      <input
                        type="text"
                        value={searchDropdown}
                        onChange={(e) => setSearchDropdown(e.target.value)}
                        placeholder="ابحث بالاسم أو النكهة..."
                        autoFocus
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                          fontSize: 13,
                          background: "var(--sf2)",
                          color: "var(--ink)",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div style={{ flex: 1, overflowY: "auto" }}>
                      {filteredOptions.length === 0 ? (
                        <div
                          style={{
                            padding: "16px",
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
                              setErrors({});
                            }}
                            style={{
                              padding: "10px 12px",
                              borderBottom: "1px solid var(--line)",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              cursor: "pointer",
                              background:
                                selectedVariantId === opt.variantId
                                  ? "var(--sf2)"
                                  : "transparent",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 13.5,
                                fontWeight: 700,
                                color: "var(--ink)",
                              }}
                            >
                              {opt.productName}{" "}
                              {opt.flavor ? `(${opt.flavor})` : ""}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                color:
                                  opt.currentStockBase > 0
                                    ? "var(--ok, #108e5c)"
                                    : "var(--ink2)",
                                fontWeight: 600,
                              }}
                            >
                              {formatOptionStock(opt)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    <div
                      onClick={() => {
                        setDropdownOpen(false);
                        setShowNewProductModal(true);
                      }}
                      style={{
                        padding: "12px",
                        borderTop: "1.5px solid var(--line)",
                        background:
                          "color-mix(in srgb, var(--ok, #108e5c) 10%, var(--sf))",
                        color: "var(--ok, #108e5c)",
                        fontWeight: 700,
                        fontSize: 13.5,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                      }}
                    >
                      <Icon n="plus" s={16} />
                      <span>مش لاقيه؟ ضيف منتج جديد للمحل</span>
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
                [
                  "unit",
                  isBag
                    ? "بالكيس / الكرتونة"
                    : isCard
                      ? "بالكارت"
                      : "بالقطعة / الكرتونة",
                  "box",
                ],
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

                <Field
                  label={
                    isBag ? "أكياس زيادة" : isCard ? "كروت مفردة" : "قطع زيادة"
                  }
                >
                  <input
                    type="number"
                    min="0"
                    value={pieces}
                    onChange={(e) => setPieces(e.target.value)}
                    placeholder={
                      isBag ? "أكياس مفرد" : isCard ? "كروت مفرد" : "قطع مفرد"
                    }
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                    }}
                  />
                </Field>

                <Field
                  label={
                    isBag
                      ? "أكياس/كرتونة"
                      : isCard
                        ? "كروت/كرتونة"
                        : "قطع/كرتونة"
                  }
                >
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
                  إجمالي الكمية: {totalBaseQty}{" "}
                  {isBag ? "كيس" : isCard ? "كارت" : "قطعة"}
                  {parseInt(cartons, 10) > 0 &&
                    ` (${cartons} كرتونة${
                      parseInt(pieces, 10) > 0
                        ? ` و ${pieces} ${isBag ? "كيس" : isCard ? "كارت" : "قطعة"}`
                        : ""
                    })`}
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

          {/* إجمالي سعر الشراء */}
          <div>
            <Field
              label="إجمالي سعر الشراء للكمية دي (ج.م)"
              err={errors.cost}
              hint={
                unitCostEgp > 0
                  ? entryMode === "weight"
                    ? weightUnit === "kg"
                      ? `الكيلو بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                      : `الجرام بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                    : `${isBag ? "الكيس" : isCard ? "الكارت" : "القطعة"} بـ ${formatMoney(Math.round(unitCostEgp * 100))}${packMultiplier > 1 ? ` (الكرتونة بـ ${formatMoney(Math.round(unitCostEgp * packMultiplier * 100))})` : ""}`
                  : "السعر الإجمالي الكلي اللي دفعته لكل الكمية اللي دخلت"
              }
            >
              <input
                type="number"
                step="any"
                min="0"
                value={costEgp}
                onChange={(e) => setCostEgp(e.target.value)}
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

            {expectedCostEgp > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                  color: "var(--ink2)",
                  marginTop: 4,
                  marginBottom: 4,
                  background: "var(--sf2)",
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                }}
              >
                <span>
                  السعر المتوقع بناءً على سعر الشراء المسجل:{" "}
                  <b>{expectedCostEgp.toFixed(2)} ج.م</b>
                </span>
                <button
                  type="button"
                  onClick={() => setCostEgp(expectedCostEgp.toString())}
                  style={{
                    background: "var(--sf)",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    color: "var(--ok, #108e5c)",
                  }}
                >
                  تطبيق السعر المتوقع
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
                }}
              >
                <span>
                  {priceComparison.status === "higher"
                    ? "⚠️"
                    : priceComparison.status === "lower"
                      ? "ℹ️"
                      : "✅"}
                </span>
                <span>{priceComparison.msg}</span>
              </div>
            )}
          </div>

          {/* الصلاحية والدفعات */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
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
                المنتج ملوش تاريخ صلاحية (زي الكروت، المنظفات، والورقيات)
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
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
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

            <Field label="اسم المورد (اختياري)">
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="مثال: شركة الأمل للتوزيع"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                }}
              />
            </Field>
          </div>
        </form>
      </Modal>

      {/* New Product Modal for adding product inline */}
      {showNewProductModal && (
        <ProductFormModal
          onClose={() => setShowNewProductModal(false)}
          onSaved={(newProduct: unknown) => {
            setShowNewProductModal(false);
            const p = newProduct as {
              id?: string;
              nameAr?: string;
              name_ar?: string;
              unit?: string;
              variants?: Array<{
                id?: string;
                packQty?: number;
                pack_qty?: number;
                flavor?: string | null;
              }>;
            };
            const pName = p.nameAr || p.name_ar || "منتج جديد";
            const pVar = p.variants?.[0];
            const vId = pVar?.id || p.id || `created_${Date.now()}`;
            const newOpt: StockProductOption = {
              variantId: vId,
              productId: p.id || `prod_${Date.now()}`,
              productName: pName,
              flavor: pVar?.flavor ?? null,
              unitMode: p.unit === "kg" || p.unit === "g" ? "weight" : "piece",
              packQty: pVar?.packQty || pVar?.pack_qty || 1,
              currentStockBase: 0,
              unit: p.unit,
            };
            setExtraOptions((prev) => [newOpt, ...prev]);
            setSelectedVariantId(vId);
          }}
        />
      )}
    </>
  );
}

export default AddStockModal;
