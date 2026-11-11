"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Modal, Button, Field, Seg, Icon } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { unitCostFromTotal } from "@/domain/stock/batch-cost";
import { ProductFormModal } from "../products/ProductFormModal";
import {
  type StoreProductItem,
  isServiceProduct,
} from "@/client/shared/store-items";
import styles from "../products/ProductsView.module.css";

export type StockSellingMethod =
  "piece" | "can" | "jar" | "bag" | "carton" | "weight" | "custom" | string;

export function resolveSellingMethod(u?: string): string {
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

  // Automatically fetch all products from the Products page so the dropdown has 100% of store items
  useEffect(() => {
    let ignore = false;
    apiGet("/api/products?filter=all")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!ignore && data?.products) {
          const loaded: StoreProductItem[] = data.products;
          const mapped: StockProductOption[] = loaded
            .filter((p) => !isServiceProduct(p))
            .map((p) => {
              const v = p.variants?.[0];
              const isWeight =
                p.unit === "weight" || p.unit === "kg" || p.unit === "g";
              return {
                variantId: v?.id || p.id,
                productId: p.id,
                productName: p.name_ar,
                flavor: v?.flavor,
                unitMode: isWeight ? "weight" : "piece",
                packQty: v?.pack_qty || 12,
                currentStockBase: v?.stock_quantity ?? p.stock_quantity ?? 0,
                buyCostPiasters: v?.buy_cost_piasters ?? p.buy_cost_piasters,
                unit: p.unit,
                category: p.category,
              };
            });
          setExtraOptions(mapped);
        }
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  const activeOptions = useMemo(() => {
    if (initialOption) return [initialOption];
    const seen = new Set<string>();
    const combined: StockProductOption[] = [];

    options.forEach((opt) => {
      seen.add(opt.variantId);
      seen.add(opt.productId);
      combined.push(opt);
    });

    extraOptions.forEach((opt) => {
      if (!seen.has(opt.variantId) && !seen.has(opt.productId)) {
        seen.add(opt.variantId);
        seen.add(opt.productId);
        combined.push(opt);
      }
    });

    return combined;
  }, [initialOption, extraOptions, options]);

  const [selectedVariantId, setSelectedVariantId] = useState(
    presetVariantId || initialOption?.variantId || "",
  );

  const selectedOption = useMemo(
    () =>
      (selectedVariantId
        ? activeOptions.find((o) => o.variantId === selectedVariantId)
        : undefined) || initialOption,
    [activeOptions, selectedVariantId, initialOption],
  );

  const isCard =
    targetProduct?.category === "كروت شحن" ||
    targetProduct?.category === "كروت مرافق" ||
    selectedOption?.category === "كروت شحن" ||
    selectedOption?.category === "كروت مرافق";

  // The selling unit is the product's (set on the Products screen); this form only reads it.
  const productUnit = targetProduct?.unit || selectedOption?.unit;
  const sellingMethod: StockSellingMethod = resolveSellingMethod(productUnit);

  const isInitialWeight = sellingMethod === "weight";

  // Pieces per carton, from the product's variant (not edited here).
  const productPack = Math.max(
    1,
    targetProduct?.variants?.[0]?.pack_qty || selectedOption?.packQty || 1,
  );
  const defaultPackN = productPack;

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
  // The purchase total starts from the product's registered buy price (Products screen) and
  // follows the quantity until the owner types their own total.
  const [costInput, setCostInput] = useState("");
  const [costTouched, setCostTouched] = useState(false);
  const setCostEgp = (v: string) => {
    setCostTouched(true);
    setCostInput(v);
  };
  const [prodDate, setProdDate] = useState("");
  const [expiry, setExpiry] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [batchCode, setBatchCode] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getProductUnitWord = useCallback(
    (u?: string) => {
      const val = (u || "").toLowerCase();
      if (val === "can" || val === "علبة") return "علبة";
      if (val === "jar" || val === "برطمان") return "برطمان";
      if (val === "bag" || val === "كيس") return "كيس";
      if (val === "carton" || val === "كرتونة") return "كرتونة";
      if (val === "weight" || val === "kg" || val === "g") return "كجم";
      if (isCard) return "كارت";
      if (val && !["piece", "unit", "قطعة"].includes(val)) return val;
      return "قطعة";
    },
    [isCard],
  );

  const getProductPluralUnitWord = useCallback(
    (u?: string) => {
      const val = (u || "").toLowerCase();
      if (val === "can" || val === "علبة") return "علب";
      if (val === "jar" || val === "برطمان") return "برطمانات";
      if (val === "bag" || val === "كيس") return "أكياس";
      if (val === "carton" || val === "كرتونة") return "كراتين";
      if (val === "weight" || val === "kg" || val === "g") return "كجم";
      if (isCard) return "كروت";
      if (val && !["piece", "unit", "قطعة"].includes(val)) return val;
      return "قطع";
    },
    [isCard],
  );

  const formatOptionStock = (opt?: StockProductOption) => {
    if (!opt) return "—";
    if (opt.currentStockBase <= 0) return "خلصان (0)";
    if (opt.unitMode === "weight") {
      return `${(opt.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
    }
    const pack = opt.packQty || 1;
    const unitWord = getProductUnitWord(opt.unit);
    if (pack > 1) {
      const cartonsCount = Math.floor(opt.currentStockBase / pack);
      const piecesCount = opt.currentStockBase % pack;
      if (cartonsCount > 0 && piecesCount > 0) {
        return `${cartonsCount} كرتونة و ${piecesCount} ${unitWord}`;
      }
      if (cartonsCount > 0 && piecesCount === 0) {
        return `${cartonsCount} كرتونة`;
      }
      return `${piecesCount} ${unitWord}`;
    }
    return `${opt.currentStockBase} ${unitWord}`;
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

  const packMultiplier = productPack;

  // Compute total base quantity (pieces for unit, grams for weight, cartons for carton)
  const totalBaseQty = useMemo(() => {
    if (sellingMethod === "weight") {
      const wNum = parseFloat(weightInput) || 0;
      return weightUnit === "kg" ? Math.round(wNum * 1000) : Math.round(wNum);
    }
    const cartonsNum = parseInt(cartons, 10) || 0;
    if (sellingMethod === "carton") {
      return cartonsNum;
    }
    const piecesNum = parseInt(pieces, 10) || 0;
    return cartonsNum * packMultiplier + piecesNum;
  }, [sellingMethod, weightUnit, weightInput, cartons, pieces, packMultiplier]);

  // Registered piece/unit cost from Product
  const regPiecePiasters =
    targetProduct?.buy_cost_piasters ?? selectedOption?.buyCostPiasters ?? 0;
  const regPieceCost = regPiecePiasters > 0 ? regPiecePiasters / 100 : 0;
  const regCartonCost = regPieceCost * packMultiplier;

  // Expected purchase cost calculated from registered purchase price in Products
  const expectedCostEgp = useMemo(() => {
    if (regPieceCost <= 0 || totalBaseQty <= 0) return 0;
    if (sellingMethod === "weight") {
      const kg = totalBaseQty / 1000;
      return Math.round(kg * regPieceCost * 100) / 100;
    } else {
      return Math.round(totalBaseQty * regPieceCost * 100) / 100;
    }
  }, [sellingMethod, totalBaseQty, regPieceCost]);
  const costFromProduct = !costTouched && expectedCostEgp > 0;
  const costEgp = costFromProduct ? expectedCostEgp.toFixed(2) : costInput;

  // Compute effective unit cost entered
  const unitCostEgp = useMemo(() => {
    const costNum = parseFloat(costEgp) || 0;
    if (costNum <= 0 || totalBaseQty <= 0) return 0;
    if (sellingMethod === "weight") {
      if (weightUnit === "kg") {
        return (costNum / totalBaseQty) * 1000;
      }
      return costNum / totalBaseQty;
    }
    return costNum / totalBaseQty;
  }, [costEgp, totalBaseQty, sellingMethod, weightUnit]);

  // Price comparison feedback against the registered cost in Products
  const priceComparison = useMemo(() => {
    const costNum = parseFloat(costEgp) || 0;
    if (costNum <= 0 || totalBaseQty <= 0) return null;

    const cartonsNum = parseInt(cartons, 10) || 0;
    const piecesNum = parseInt(pieces, 10) || 0;

    if (sellingMethod !== "weight") {
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
          const unitWord = getProductUnitWord(sellingMethod);
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
    sellingMethod,
    regCartonCost,
    regPieceCost,
    getProductUnitWord,
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
        sellingMethod === "weight"
          ? "اكتب وزن البضاعة التي دخلت"
          : sellingMethod === "carton"
            ? "اكتب عدد الكراتين التي دخلت"
            : `اكتب كمية الـ ${getProductPluralUnitWord(sellingMethod)} التي دخلت`;
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
        // Buy price per SELLING unit (per kg for weighed goods), from the total paid
        // (ADR-0021) — the same rule the server uses for the batch's unit cost.
        const newUnit =
          targetProduct.unit || (sellingMethod === "weight" ? "kg" : "piece");
        const derivedUnitCost =
          costPiasters > 0 && totalBaseQty > 0
            ? unitCostFromTotal(costPiasters, totalBaseQty, newUnit)
            : null;
        const calculatedBuyCost =
          derivedUnitCost !== null
            ? Number(derivedUnitCost)
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
            unit: newUnit,
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
        // What was paid for the whole quantity (the form asks for the total).
        costTotalPiasters: costPiasters,
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
              إضافة ✓
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
                        placeholder="دوّر على المنتج أو اختاره"
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
                              // Quantity fields follow the chosen product's unit.
                              const w =
                                resolveSellingMethod(opt.unit) === "weight";
                              const pack = Math.max(1, opt.packQty || 1);
                              setWeightInput(w ? "1" : "");
                              setCartons(!w && pack > 1 ? "1" : "");
                              setPieces(!w && pack <= 1 ? "1" : "");
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
                      <span>+ مش لاقيه؟ ضيف منتج جديد</span>
                    </div>
                  </div>
                )}
              </div>
            </Field>
          )}

          {selectedOption && (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink2)",
                  margin: "0 0 6px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>الموجود دلوقتي:</span>
                <b style={{ color: "var(--ink)" }}>
                  {formatOptionStock(selectedOption)}
                </b>
              </div>

              {/* The unit comes from the product (Products screen), never chosen here. */}
              <div className={styles.unitFromProduct} data-testid="stock-unit">
                <Icon n={sellingMethod === "weight" ? "scale" : "box"} s={16} />
                <span>
                  بيتباع{" "}
                  <b>
                    {sellingMethod === "weight"
                      ? "بالوزن (كيلو)"
                      : `بـ${getProductUnitWord(sellingMethod)}`}
                  </b>
                  {packMultiplier > 1 && sellingMethod !== "weight"
                    ? ` · الكرتونة ${packMultiplier} ${getProductUnitWord(sellingMethod)}`
                    : ""}
                </span>
                <small>من بيانات المنتج</small>
              </div>

              {sellingMethod === "weight" ? (
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
                    <Seg
                      value={weightUnit}
                      onChange={(val) => setWeightUnit(val as "kg" | "g")}
                      size="sm"
                      options={[
                        ["kg", "بالكيلو (كجم)"],
                        ["g", "بالجرام (جم)"],
                      ]}
                    />
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
              ) : sellingMethod === "carton" ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <Field
                    label="عدد الكراتين التي دخلت المخزون"
                    err={errors.qty}
                  >
                    <input
                      type="number"
                      min="1"
                      value={cartons}
                      onChange={(e) => setCartons(e.target.value)}
                      placeholder="مثال: 5 كراتين"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1.5px solid var(--line)",
                      }}
                    />
                  </Field>

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
                      إجمالي الكمية: {totalBaseQty} كرتونة
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
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        packMultiplier > 1 ? "1fr 1fr" : "1fr",
                      gap: 8,
                    }}
                  >
                    {packMultiplier > 1 && (
                      <Field label="عدد الكراتين">
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={cartons}
                          onChange={(e) => setCartons(e.target.value)}
                          placeholder="عدد الكراتين"
                          data-testid="stock-cartons"
                        />
                      </Field>
                    )}

                    <Field
                      label={
                        packMultiplier > 1
                          ? `${getProductPluralUnitWord(sellingMethod)} زيادة`
                          : `عدد الـ${getProductPluralUnitWord(sellingMethod)}`
                      }
                    >
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={pieces}
                        onChange={(e) => setPieces(e.target.value)}
                        placeholder={getProductPluralUnitWord(sellingMethod)}
                        data-testid="stock-pieces"
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
                      {getProductUnitWord(sellingMethod)}
                      {parseInt(cartons, 10) > 0 &&
                        ` (${cartons} كرتونة${
                          parseInt(pieces, 10) > 0
                            ? ` و ${pieces} ${getProductUnitWord(sellingMethod)}`
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
                      ? sellingMethod === "weight"
                        ? weightUnit === "kg"
                          ? `الكيلو بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                          : `الجرام بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                        : sellingMethod === "carton"
                          ? `الكرتونة بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                          : `${getProductUnitWord(sellingMethod)} بـ ${formatMoney(Math.round(unitCostEgp * 100))}${packMultiplier > 1 ? ` (الكرتونة بـ ${formatMoney(Math.round(unitCostEgp * packMultiplier * 100))})` : ""}`
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
                    data-testid="stock-cost-total"
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

                {costFromProduct && (
                  <small
                    data-testid="stock-cost-from-product"
                    style={{ color: "var(--ink2)", fontSize: 12 }}
                  >
                    محسوب من سعر الشراء المسجل في المنتجات — لو دفعت مبلغ تاني
                    اكتبه.
                  </small>
                )}
                {expectedCostEgp > 0 && costTouched && (
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
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
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
                      <div
                        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
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
            </>
          )}
        </form>
      </Modal>

      {/* New Product Modal for adding product inline */}
      {showNewProductModal && (
        <ProductFormModal
          presetName={searchDropdown}
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
