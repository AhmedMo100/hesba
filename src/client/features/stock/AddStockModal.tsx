"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Modal,
  Button,
  Field,
  Seg,
  Icon,
  Chip,
  Chips,
} from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { unitCostFromTotal } from "@/domain/stock/batch-cost";
import { ProductFormModal } from "../products/ProductFormModal";
import {
  type StoreProductItem,
  isServiceProduct,
} from "@/client/shared/store-items";
import styles from "../products/ProductsView.module.css";
import f from "./AddStockModal.module.css";

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

  const unitWordNow = getProductUnitWord(sellingMethod);
  const compareClass = priceComparison
    ? priceComparison.status === "higher"
      ? f.higher
      : priceComparison.status === "lower"
        ? ""
        : f.same
    : "";

  return (
    <>
      <Modal
        title={
          targetProduct
            ? `إضافة للمخزون: ${targetProduct.name_ar}`
            : "إضافة للمخزون"
        }
        onClose={isSubmitting ? () => {} : onClose}
        footer={
          <>
            <Button kind="ghost" onClick={onClose} disabled={isSubmitting}>
              إلغاء
            </Button>
            <Button
              kind="primary"
              onClick={handleSubmit}
              disabled={isSubmitting}
              busy={isSubmitting}
              data-testid="stock-add-submit"
            >
              {isSubmitting ? "بيتسجّل…" : "إضافة ✓"}
            </Button>
          </>
        }
      >
        <form
          onSubmit={handleSubmit}
          className={f.form}
          data-testid="add-stock-form"
        >
          {errors.submit && (
            <div className={f.error} role="alert">
              {errors.submit}
            </div>
          )}

          {targetProduct ? (
            <div className={f.product}>
              <div>
                <b>{targetProduct.name_ar}</b>
                <small>
                  {targetProduct.category} — الرصيد الحالي:{" "}
                  <b>{formatOptionStock(initialOption)}</b>
                </small>
              </div>
            </div>
          ) : (
            <Field label="المنتج" err={errors.product} div>
              <div className={f.picker}>
                <button
                  type="button"
                  className={f.pickerBtn}
                  aria-haspopup="listbox"
                  aria-expanded={dropdownOpen}
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <Icon n="search" s={16} />
                  <span className={selectedOption ? f.chosen : undefined}>
                    {selectedOption
                      ? `${selectedOption.productName} ${selectedOption.flavor ? `(${selectedOption.flavor})` : ""} — (المخزون: ${formatOptionStock(selectedOption)})`
                      : "دوّر على المنتج أو اختاره"}
                  </span>
                  <Icon n="down" s={16} />
                </button>

                {dropdownOpen && (
                  <div className={f.menu}>
                    <div className={f.menuSearch}>
                      <input
                        type="text"
                        value={searchDropdown}
                        onChange={(e) => setSearchDropdown(e.target.value)}
                        placeholder="دوّر على المنتج أو اختاره"
                        aria-label="دوّر على المنتج"
                        autoFocus
                      />
                    </div>
                    <div className={f.menuList} role="listbox">
                      {filteredOptions.length === 0 ? (
                        <div className={f.menuEmpty}>مفيش منتج بالاسم ده</div>
                      ) : (
                        filteredOptions.map((opt) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={selectedVariantId === opt.variantId}
                            key={opt.variantId}
                            className={f.option}
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
                          >
                            <span>
                              {opt.productName}{" "}
                              {opt.flavor ? `(${opt.flavor})` : ""}
                            </span>
                            <small
                              className={
                                opt.currentStockBase > 0 ? f.has : undefined
                              }
                            >
                              {formatOptionStock(opt)}
                            </small>
                          </button>
                        ))
                      )}
                    </div>
                    <button
                      type="button"
                      className={f.menuAdd}
                      onClick={() => {
                        setDropdownOpen(false);
                        setShowNewProductModal(true);
                      }}
                    >
                      <Icon n="plus" s={16} />
                      <span>مش لاقيه؟ ضيف منتج جديد</span>
                    </button>
                  </div>
                )}
              </div>
            </Field>
          )}

          {selectedOption && (
            <>
              {!targetProduct && (
                <div className={f.now}>
                  الموجود دلوقتي: <b>{formatOptionStock(selectedOption)}</b>
                </div>
              )}

              {/* The unit comes from the product (Products screen), never chosen here. */}
              <div className={styles.unitFromProduct} data-testid="stock-unit">
                <Icon n={sellingMethod === "weight" ? "scale" : "box"} s={16} />
                <span>
                  بيتباع{" "}
                  <b>
                    {sellingMethod === "weight"
                      ? "بالوزن (كيلو)"
                      : `بـ${unitWordNow}`}
                  </b>
                  {packMultiplier > 1 && sellingMethod !== "weight"
                    ? ` · الكرتونة ${packMultiplier} ${unitWordNow}`
                    : ""}
                </span>
                <small>من بيانات المنتج</small>
              </div>

              <div className={f.section}>
                <div className={f.sectionTitle}>
                  <Icon n="box" s={16} /> الكمية اللي دخلت
                </div>
                {sellingMethod === "weight" ? (
                  <>
                    <Seg
                      value={weightUnit}
                      onChange={(val) => setWeightUnit(val as "kg" | "g")}
                      size="sm"
                      ariaLabel="وحدة الوزن"
                      options={[
                        ["kg", "بالكيلو (كجم)"],
                        ["g", "بالجرام (جم)"],
                      ]}
                    />
                    <div style={{ height: 10 }} />
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
                        inputMode="decimal"
                        step={weightUnit === "kg" ? "0.05" : "1"}
                        min="0"
                        value={weightInput}
                        onChange={(e) => setWeightInput(e.target.value)}
                        placeholder={
                          weightUnit === "kg" ? "مثال: 5.5" : "مثال: 500"
                        }
                        data-testid="stock-weight"
                      />
                    </Field>
                  </>
                ) : sellingMethod === "carton" ? (
                  <Field label="عدد الكراتين" err={errors.qty}>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      value={cartons}
                      onChange={(e) => setCartons(e.target.value)}
                      placeholder="مثال: 5"
                      data-testid="stock-cartons"
                    />
                  </Field>
                ) : (
                  <>
                    <div
                      className={`${f.row} ${packMultiplier > 1 ? "" : f.one}`}
                    >
                      {packMultiplier > 1 && (
                        <Field label="عدد الكراتين">
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={cartons}
                            onChange={(e) => setCartons(e.target.value)}
                            placeholder="0"
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
                        err={errors.qty}
                      >
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={pieces}
                          onChange={(e) => setPieces(e.target.value)}
                          placeholder="0"
                          data-testid="stock-pieces"
                        />
                      </Field>
                    </div>
                  </>
                )}
                {totalBaseQty > 0 && sellingMethod !== "weight" && (
                  <div className={f.total}>
                    إجمالي الكمية: {totalBaseQty} {unitWordNow}
                    {packMultiplier > 1 &&
                      sellingMethod !== "carton" &&
                      parseInt(cartons, 10) > 0 &&
                      ` (${cartons} كرتونة${
                        parseInt(pieces, 10) > 0
                          ? ` و ${pieces} ${unitWordNow}`
                          : ""
                      })`}
                  </div>
                )}
              </div>

              <div className={f.section}>
                <div className={f.sectionTitle}>
                  <Icon n="wallet" s={16} /> التكلفة
                </div>
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
                          : `${unitWordNow} بـ ${formatMoney(Math.round(unitCostEgp * 100))}${packMultiplier > 1 ? ` (الكرتونة بـ ${formatMoney(Math.round(unitCostEgp * packMultiplier * 100))})` : ""}`
                      : "السعر الإجمالي الكلي اللي دفعته لكل الكمية اللي دخلت"
                  }
                >
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={costEgp}
                    onChange={(e) => setCostEgp(e.target.value)}
                    placeholder="مثال: 1000"
                    data-testid="stock-cost-total"
                  />
                </Field>
                {costFromProduct && (
                  <small
                    className={f.note}
                    data-testid="stock-cost-from-product"
                  >
                    محسوب من سعر الشراء المسجل في المنتجات — لو دفعت مبلغ تاني
                    اكتبه.
                  </small>
                )}
                {expectedCostEgp > 0 && costTouched && (
                  <div className={f.expected}>
                    <span>
                      السعر المتوقع بناءً على سعر الشراء المسجل:{" "}
                      <b>{expectedCostEgp.toFixed(2)} ج.م</b>
                    </span>
                    <Button
                      kind="soft"
                      size="sm"
                      onClick={() => setCostEgp(expectedCostEgp.toString())}
                    >
                      تطبيق السعر المتوقع
                    </Button>
                  </div>
                )}
                {priceComparison && (
                  <div className={`${f.compare} ${compareClass}`}>
                    <span aria-hidden="true">
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

              <div className={f.section}>
                <div className={f.sectionTitle}>
                  <Icon n="clock" s={16} /> الصلاحية (دفعة جديدة)
                </div>
                <div className={f.sectionHint}>
                  الكمية دي بتتسجّل دفعة لوحدها بصلاحيتها، ومش بتغيّر صلاحية
                  الدفعات اللي قبلها. البيع بياخد الأقرب انتهاءً الأول.
                </div>
                <label className={f.check}>
                  <input
                    type="checkbox"
                    checked={noExpiry}
                    onChange={(e) => {
                      setNoExpiry(e.target.checked);
                      if (e.target.checked) {
                        setExpiry("");
                        setProdDate("");
                      }
                    }}
                  />
                  <span>
                    المنتج ملوش تاريخ صلاحية (زي الكروت، المنظفات، والورقيات)
                  </span>
                </label>

                {!noExpiry && (
                  <>
                    <div className={f.row}>
                      <Field label="تاريخ الإنتاج / البداية">
                        <input
                          type="date"
                          value={prodDate}
                          onChange={(e) => setProdDate(e.target.value)}
                        />
                      </Field>
                      <Field label="تاريخ الانتهاء" err={errors.expiry}>
                        <input
                          type="date"
                          value={expiry}
                          onChange={(e) => setExpiry(e.target.value)}
                          data-testid="stock-expiry"
                        />
                      </Field>
                    </div>
                    <span className={f.quickLabel}>
                      حساب مدة الصلاحية سريعاً من الإنتاج:
                    </span>
                    <Chips tight>
                      {quickExpiryChips.map((chip) => (
                        <Chip
                          key={chip.label}
                          onClick={() => applyDurationMonths(chip.months)}
                        >
                          {chip.label}
                        </Chip>
                      ))}
                    </Chips>
                  </>
                )}
              </div>

              <div className={f.section}>
                <div className={f.row}>
                  <Field label="كود التشغيلة / الباتش">
                    <input
                      type="text"
                      value={batchCode}
                      onChange={(e) => setBatchCode(e.target.value)}
                      placeholder="مثال: B-2026-11"
                    />
                  </Field>
                  <Field label="اسم المورد (اختياري)">
                    <input
                      type="text"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder="مثال: شركة الأمل للتوزيع"
                    />
                  </Field>
                </div>
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
