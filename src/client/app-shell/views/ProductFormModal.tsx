"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Modal, Field, Seg, Icon } from "../../shared/ui";
import { HesbaDatabase } from "../../shared/db";
import {
  searchOfflineCatalog,
  type CatalogSearchResult,
} from "../../shared/catalog";
import { formatMoney } from "../../shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import styles from "./ProductsView.module.css";

export interface ProductFormModalProps {
  product?: {
    id: string;
    name_ar: string;
    category: string;
    unit: string;
    sell_price_piasters: number;
    buy_cost_piasters?: number;
    barcode?: string | null;
    brand_name?: string | null;
    is_custom?: boolean;
    global_product_id?: string | null;
    variants: Array<{
      id?: string;
      flavor?: string | null;
      size_value?: number | null;
      size_unit?: string | null;
      pack_qty?: number;
      barcode?: string | null;
      sell_price_piasters: number;
      buy_cost_piasters?: number;
    }>;
  } | null;
  presetName?: string;
  initialCatalogProduct?: CatalogSearchResult | null;
  defaultCategory?: string;
  existingProducts?: Array<{
    id: string;
    name_ar: string;
    barcode?: string | null;
    global_product_id?: string | null;
  }>;
  onClose: () => void;
  onSaved: (savedProduct: unknown) => void;
  onDeleted?: (productId: string) => void;
}

const PRODUCT_CATEGORIES = [
  "السلع الاستهلاكية",
  "سلع أساسية",
  "ألبان وجبن",
  "مشروبات",
  "سناكس ومقرمشات",
  "معلبات",
  "منظفات وورقيات",
  "حلويات وبسكويت",
  "مجمدات ولحوم",
  "مكرونة وأرز",
  "زيوت وسمن",
  "شاي وقهوة",
  "عطارة وتوابل",
  "مخبوزات",
  "كروت شحن",
  "أخرى",
] as const;

export function ProductFormModal({
  product,
  presetName,
  initialCatalogProduct,
  defaultCategory,
  existingProducts,
  onClose,
  onSaved,
  onDeleted,
}: ProductFormModalProps) {
  const firstVariant = product?.variants?.[0];

  const [name, setName] = useState(
    product
      ? product.name_ar
      : presetName ||
          (initialCatalogProduct ? initialCatalogProduct.product.nameAr : ""),
  );
  const initialSellingMethod = useMemo<
    "piece" | "can" | "jar" | "bag" | "carton" | "weight" | "custom"
  >(() => {
    if (!product) return "piece";
    const u = product.unit?.toLowerCase() || "";
    if (u === "weight" || u === "kg" || u === "g") return "weight";
    if (u === "carton" || u === "كرتونة") return "carton";
    if (u === "bag" || u === "كيس") return "bag";
    if (u === "can" || u === "علبة") return "can";
    if (u === "jar" || u === "برطمان") return "jar";
    if (u === "piece" || u === "unit" || u === "قطعة") return "piece";
    if (u) return "custom";
    return "piece";
  }, [product]);

  const [sellingMethod, setSellingMethod] = useState<
    "piece" | "can" | "jar" | "bag" | "carton" | "weight" | "custom"
  >(initialSellingMethod);
  const [customSellingMethod, setCustomSellingMethod] = useState<string>(
    initialSellingMethod === "custom" ? product?.unit || "" : "",
  );
  const [weightUnit, setWeightUnit] = useState<"kg" | "g">(
    product?.unit === "g" ? "g" : "kg",
  );

  // Bag packaging state
  const [bagContentType, setBagContentType] = useState<"weight" | "count">(
    firstVariant?.size_unit === "piece" ? "count" : "weight",
  );
  const [bagWeightVal, setBagWeightVal] = useState<string>(
    firstVariant?.size_value ? firstVariant.size_value.toString() : "500",
  );
  const [bagWeightUnit, setBagWeightUnit] = useState<"g" | "kg">(
    firstVariant?.size_unit === "kg" ? "kg" : "g",
  );
  const [bagCountVal, setBagCountVal] = useState<string>(
    firstVariant?.size_unit === "piece" && firstVariant?.size_value
      ? firstVariant.size_value.toString()
      : "10",
  );

  // Weight pricing (in pounds for user display/entry)
  const [wBuy, setWBuy] = useState(
    product &&
      (product.unit === "weight" ||
        product.unit === "kg" ||
        product.unit === "g")
      ? (product.buy_cost_piasters
          ? product.buy_cost_piasters / 100
          : ""
        ).toString()
      : "",
  );
  const [wSell, setWSell] = useState(
    product &&
      (product.unit === "weight" ||
        product.unit === "kg" ||
        product.unit === "g")
      ? (product.sell_price_piasters / 100).toString()
      : "",
  );

  // Unit packaging & pricing
  const hasCartonInitial = Boolean(
    firstVariant?.pack_qty && firstVariant.pack_qty > 1,
  );
  const [hasPack, setHasPack] = useState(hasCartonInitial);
  const [packN, setPackN] = useState(
    firstVariant?.pack_qty && firstVariant.pack_qty > 1
      ? firstVariant.pack_qty.toString()
      : initialCatalogProduct?.variants?.[0]?.packQty &&
          initialCatalogProduct.variants[0].packQty > 1
        ? initialCatalogProduct.variants[0].packQty.toString()
        : "12",
  );

  const initialPieceSell = product
    ? (product.sell_price_piasters / 100).toString()
    : "";
  const initialPieceBuy = product?.buy_cost_piasters
    ? (product.buy_cost_piasters / 100).toString()
    : "";

  const [pcSell, setPcSell] = useState(initialPieceSell);
  const [pcBuy, setPcBuy] = useState(initialPieceBuy);

  const [pkSell, setPkSell] = useState(
    product && hasCartonInitial && firstVariant?.pack_qty
      ? ((product.sell_price_piasters / 100) * firstVariant.pack_qty).toString()
      : "",
  );
  const [pkBuy, setPkBuy] = useState(
    product?.buy_cost_piasters && hasCartonInitial && firstVariant?.pack_qty
      ? ((product.buy_cost_piasters / 100) * firstVariant.pack_qty).toString()
      : "",
  );

  const initialCatValue = product
    ? product.category
    : defaultCategory
      ? defaultCategory
      : initialCatalogProduct
        ? initialCatalogProduct.product.category
        : "السلع الاستهلاكية";

  const [category, setCategory] = useState(initialCatValue);
  const [isCustomCategory, setIsCustomCategory] = useState<boolean>(() => {
    return (
      initialCatValue === "أخرى" ||
      !PRODUCT_CATEGORIES.includes(
        initialCatValue as (typeof PRODUCT_CATEGORIES)[number],
      )
    );
  });
  const [customCategoryName, setCustomCategoryName] = useState<string>(() => {
    return !PRODUCT_CATEGORIES.includes(
      initialCatValue as (typeof PRODUCT_CATEGORIES)[number],
    )
      ? initialCatValue
      : "";
  });

  const availableCategories = useMemo(() => {
    const standardWithoutOther = PRODUCT_CATEGORIES.filter((c) => c !== "أخرى");
    return [...standardWithoutOther, "أخرى"];
  }, []);

  const [barcode, setBarcode] = useState(
    product?.barcode || firstVariant?.barcode || "",
  );

  const [brandName, setBrandName] = useState(
    initialCatalogProduct?.brand?.nameAr ?? "",
  );
  const [flavor, setFlavor] = useState(
    firstVariant?.flavor ?? initialCatalogProduct?.variants[0]?.flavor ?? "",
  );
  const [sizeValue, setSizeValue] = useState(
    firstVariant?.size_value?.toString() ??
      initialCatalogProduct?.variants[0]?.sizeValue?.toString() ??
      "",
  );
  const [sizeUnit, setSizeUnit] = useState<"g" | "kg" | "ml" | "l" | "piece">(
    (firstVariant?.size_unit as "g" | "kg" | "ml" | "l" | "piece") ??
      (initialCatalogProduct?.variants[0]?.sizeUnit as
        "g" | "kg" | "ml" | "l" | "piece") ??
      "piece",
  );

  const [matches, setMatches] = useState<CatalogSearchResult[]>([]);
  const [selectedGlobalProduct, setSelectedGlobalProduct] =
    useState<CatalogSearchResult | null>(initialCatalogProduct ?? null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    initialCatalogProduct?.variants[0]?.id ?? null,
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Live offline search against IndexedDB when name changes (new product mode)
  useEffect(() => {
    if (product || selectedGlobalProduct) return;
    const trimmed = name.trim();
    let isMounted = true;

    const timer = setTimeout(() => {
      if (!isMounted) return;
      if (trimmed.length < 2) {
        setMatches([]);
        return;
      }

      const db = new HesbaDatabase();
      searchOfflineCatalog(db, trimmed, { limit: 4 })
        .then((results) => {
          if (isMounted) {
            setMatches(results);
          }
        })
        .catch(() => {});
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [name, product, selectedGlobalProduct]);

  // Bidirectional price calculations between carton and piece
  const handlePackSellChange = (val: string) => {
    setPkSell(val);
    const n = parseFloat(packN);
    const p = parseFloat(val);
    if (!isNaN(n) && n > 0 && !isNaN(p)) {
      setPcSell((p / n).toFixed(2).replace(/\.00$/, ""));
    }
  };

  const handlePieceSellChange = (val: string) => {
    setPcSell(val);
    const n = parseFloat(packN);
    const p = parseFloat(val);
    if (!isNaN(n) && n > 0 && !isNaN(p)) {
      setPkSell((p * n).toFixed(2).replace(/\.00$/, ""));
    }
  };

  const handlePackBuyChange = (val: string) => {
    setPkBuy(val);
    const n = parseFloat(packN);
    const p = parseFloat(val);
    if (!isNaN(n) && n > 0 && !isNaN(p)) {
      setPcBuy((p / n).toFixed(2).replace(/\.00$/, ""));
    }
  };

  const handlePieceBuyChange = (val: string) => {
    setPcBuy(val);
    const n = parseFloat(packN);
    const p = parseFloat(val);
    if (!isNaN(n) && n > 0 && !isNaN(p)) {
      setPkBuy((p * n).toFixed(2).replace(/\.00$/, ""));
    }
  };

  const handlePackNChange = (val: string) => {
    setPackN(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) {
      if (pkSell && !pcSell) {
        setPcSell((parseFloat(pkSell) / n).toFixed(2).replace(/\.00$/, ""));
      } else if (pcSell) {
        setPkSell((parseFloat(pcSell) * n).toFixed(2).replace(/\.00$/, ""));
      }
      if (pkBuy && !pcBuy) {
        setPcBuy((parseFloat(pkBuy) / n).toFixed(2).replace(/\.00$/, ""));
      } else if (pcBuy) {
        setPkBuy((parseFloat(pcBuy) * n).toFixed(2).replace(/\.00$/, ""));
      }
    }
  };

  const handleSelectCatalogMatch = (match: CatalogSearchResult) => {
    if (existingProducts && existingProducts.length > 0) {
      const matchNameNorm = normalizeArabic(match.product.nameAr);
      const isAlreadyAdded = existingProducts.some(
        (p) =>
          normalizeArabic(p.name_ar).trim() === matchNameNorm ||
          (p.global_product_id && p.global_product_id === match.product.id),
      );
      if (isAlreadyAdded) {
        alert(
          `⚠️ الصنف «${match.product.nameAr}» مضاف بالفعل مسبقاً في المحل! يمكنك تعديل سعره أو كميته في المخزون مباشرة.`,
        );
        return;
      }
    }

    setSelectedGlobalProduct(match);
    setName(match.product.nameAr);
    setCategory(match.product.category);
    if (match.brand) {
      setBrandName(match.brand.nameAr);
    }
    if (match.variants.length > 0) {
      const first = match.variants[0]!;
      setSelectedVariantId(first.id);
      if (first.flavor) setFlavor(first.flavor);
      if (first.sizeValue) setSizeValue(first.sizeValue.toString());
      if (first.sizeUnit)
        setSizeUnit(first.sizeUnit as "g" | "kg" | "ml" | "l" | "piece");
      if (first.packQty && first.packQty > 1) {
        setHasPack(true);
        setPackN(first.packQty.toString());
      }
    }
    setMatches([]);
  };

  const handleClearCatalogMatch = () => {
    setSelectedGlobalProduct(null);
    setSelectedVariantId(null);
  };

  const getUnitSingularLabel = useCallback(
    (m: typeof sellingMethod) => {
      switch (m) {
        case "piece":
          return "القطعة";
        case "can":
          return "العلبة";
        case "jar":
          return "البرطمان";
        case "bag":
          return "الكيس";
        case "carton":
          return "الكرتونة";
        case "weight":
          return weightUnit === "kg" ? "الكيلو" : "الجرام";
        case "custom":
          return customSellingMethod.trim() || "الوحدة";
      }
    },
    [weightUnit, customSellingMethod],
  );

  const getUnitNameLabel = useCallback(
    (m: typeof sellingMethod) => {
      switch (m) {
        case "piece":
          return "قطعة";
        case "can":
          return "علبة";
        case "jar":
          return "برطمان";
        case "bag":
          return "كيس";
        case "carton":
          return "كرتونة";
        case "weight":
          return weightUnit === "kg" ? "كجم" : "جرام";
        case "custom":
          return customSellingMethod.trim() || "وحدة";
      }
    },
    [weightUnit, customSellingMethod],
  );

  const getUnitPluralLabel = useCallback(
    (m: typeof sellingMethod) => {
      switch (m) {
        case "piece":
          return "قطع";
        case "can":
          return "علب";
        case "jar":
          return "برطمانات";
        case "bag":
          return "أكياس";
        case "carton":
          return "كراتين";
        case "weight":
          return "كجم";
        case "custom":
          return customSellingMethod.trim() || "وحدات";
      }
    },
    [customSellingMethod],
  );

  // Expected gross profit calculation
  const profitHint = useMemo(() => {
    if (sellingMethod === "weight") {
      const sell = parseFloat(wSell);
      const buy = parseFloat(wBuy);
      if (!isNaN(sell) && sell > 0 && !isNaN(buy) && buy > 0) {
        const diffPiasters = Math.round((sell - buy) * 100);
        const unitLabel = weightUnit === "g" ? "الجرام" : "الكيلو";
        return `مجمل الربح المتوقع في ${unitLabel}: ${formatMoney(diffPiasters)}`;
      }
    } else if (sellingMethod === "carton") {
      const sell = parseFloat(pkSell);
      const buy = parseFloat(pkBuy);
      if (!isNaN(sell) && sell > 0 && !isNaN(buy) && buy > 0) {
        const diffPiasters = Math.round((sell - buy) * 100);
        return `مجمل الربح المتوقع في الكرتونة: ${formatMoney(diffPiasters)}`;
      }
    } else {
      const sell = parseFloat(pcSell);
      const buy = parseFloat(pcBuy);
      if (!isNaN(sell) && sell > 0 && !isNaN(buy) && buy > 0) {
        const diffPiasters = Math.round((sell - buy) * 100);
        const uLabel = getUnitSingularLabel(sellingMethod);
        return `مجمل الربح المتوقع في ${uLabel}: ${formatMoney(diffPiasters)}`;
      }
    }
    return "";
  }, [
    sellingMethod,
    getUnitSingularLabel,
    weightUnit,
    wSell,
    wBuy,
    pcSell,
    pcBuy,
    pkSell,
    pkBuy,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "اكتب اسم المنتج";
    }

    if (!product && existingProducts && existingProducts.length > 0) {
      const trimmedName = name.trim();
      const normName = normalizeArabic(trimmedName);
      const trimmedBarcode = barcode.trim();

      const existingMatch = existingProducts.find((p) => {
        if (
          trimmedBarcode &&
          p.barcode &&
          p.barcode.trim() === trimmedBarcode
        ) {
          return true;
        }
        if (trimmedName && normalizeArabic(p.name_ar).trim() === normName) {
          return true;
        }
        return false;
      });

      if (existingMatch) {
        newErrors.name = `⚠️ هذا الصنف «${existingMatch.name_ar}» مضاف بالفعل مسبقاً في المحل!`;
      }
    }

    let sellPriceNum = 0;
    let buyCostNum = 0;

    if (sellingMethod === "weight") {
      sellPriceNum = parseFloat(wSell);
      buyCostNum = parseFloat(wBuy) || 0;
      if (isNaN(sellPriceNum) || sellPriceNum <= 0) {
        newErrors.price =
          weightUnit === "g" ? "اكتب سعر بيع الجرام" : "اكتب سعر بيع الكيلو";
      }
    } else if (sellingMethod === "carton") {
      sellPriceNum = parseFloat(pkSell);
      buyCostNum = parseFloat(pkBuy) || 0;
      if (isNaN(sellPriceNum) || sellPriceNum <= 0) {
        newErrors.price = "اكتب سعر بيع الكرتونة";
      }
    } else {
      sellPriceNum = parseFloat(pcSell);
      buyCostNum = parseFloat(pcBuy) || 0;
      const uLabel = getUnitSingularLabel(sellingMethod);
      if (isNaN(sellPriceNum) || sellPriceNum <= 0) {
        newErrors.price = `اكتب سعر بيع ${uLabel}`;
      }
      if (sellingMethod === "custom" && !customSellingMethod.trim()) {
        newErrors.sellingMethod = "اكتب طريقة البيع المخصصة";
      }
      if (hasPack) {
        const n = parseInt(packN, 10);
        const pLabel = getUnitPluralLabel(sellingMethod);
        if (isNaN(n) || n < 2) {
          newErrors.packN = `عدد الـ ${pLabel} في الكرتونة (2 أو أكثر)`;
        }
      }
    }

    const finalCategory =
      isCustomCategory || category === "أخرى"
        ? customCategoryName.trim()
        : category.trim();

    if (!finalCategory) {
      newErrors.category = "يرجى كتابة اسم التصنيف الجديد";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const sellPricePiasters = Math.round(sellPriceNum * 100);
      const buyCostPiasters = buyCostNum > 0 ? Math.round(buyCostNum * 100) : 0;
      const isCustom = product ? product.is_custom : !selectedGlobalProduct;
      const packQtyNum =
        sellingMethod === "carton" ? 1 : hasPack ? parseInt(packN, 10) || 1 : 1;

      const targetUnit =
        sellingMethod === "weight"
          ? weightUnit
          : sellingMethod === "bag"
            ? ("bag" as const)
            : sellingMethod === "can"
              ? "علبة"
              : sellingMethod === "jar"
                ? "برطمان"
                : sellingMethod === "carton"
                  ? "كرتونة"
                  : sellingMethod === "custom"
                    ? customSellingMethod.trim() || "piece"
                    : ("piece" as const);

      const targetSizeValue =
        sellingMethod === "weight"
          ? 1
          : sellingMethod === "bag"
            ? bagContentType === "weight"
              ? parseFloat(bagWeightVal) || 500
              : parseInt(bagCountVal, 10) || 10
            : sizeValue
              ? parseFloat(sizeValue)
              : null;

      const targetSizeUnit =
        sellingMethod === "weight"
          ? weightUnit
          : sellingMethod === "bag"
            ? bagContentType === "weight"
              ? bagWeightUnit
              : "piece"
            : sizeValue
              ? sizeUnit
              : null;

      const payload = {
        id: product?.id,
        nameAr: name.trim(),
        category: finalCategory,
        unit: targetUnit,
        sellPricePiasters,
        buyCostPiasters: buyCostPiasters > 0 ? buyCostPiasters : null,
        isCustom,
        globalProductId: selectedGlobalProduct
          ? selectedGlobalProduct.product.id
          : (product?.global_product_id ?? null),
        brandName: brandName.trim() || null,
        barcode: barcode.trim() || null,
        variants: [
          {
            id: firstVariant?.id,
            flavor: flavor.trim() || null,
            sizeValue: targetSizeValue,
            sizeUnit: targetSizeUnit,
            packQty: packQtyNum,
            sellPricePiasters,
            costPricePiasters: buyCostPiasters > 0 ? buyCostPiasters : null,
            globalVariantId: selectedVariantId || null,
            barcode: barcode.trim() || null,
          },
        ],
      };

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error?.message || "فشل حفظ المنتج، برجاء المحاولة لاحقاً",
        );
      }

      const responseData = await res.json();
      onSaved(responseData.data || payload);
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "حدث خطأ أثناء الحفظ";
      setErrors({ submit: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!product) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/products?id=${product.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("فشل إخفاء/حذف المنتج");
      if (onDeleted) onDeleted(product.id);
      onClose();
    } catch (err) {
      console.error("Delete failed:", err);
      alert("تعذر حذف المنتج، برجاء المحاولة لاحقاً");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <>
      <Modal
        title={product ? "تعديل المنتج" : "إضافة منتج"}
        onClose={onClose}
        footer={
          <div className={styles.modalFooter}>
            {product ? (
              <button
                type="button"
                className={styles.modalFooterBtnDelete}
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isSubmitting || isDeleting}
              >
                <Icon n="trash" s={16} />
                <span>حذف</span>
              </button>
            ) : (
              <span />
            )}
            <div className={styles.modalFooterLeft}>
              <button
                type="button"
                className={styles.modalFooterBtnCancel}
                onClick={onClose}
                disabled={isSubmitting || isDeleting}
              >
                إلغاء
              </button>
              <button
                type="button"
                className={styles.modalFooterBtnSave}
                onClick={handleSubmit}
                disabled={isSubmitting || isDeleting}
              >
                <Icon n="check" s={16} />
                <span>{product ? "حفظ" : "إضافة"}</span>
              </button>
            </div>
          </div>
        }
      >
        <form onSubmit={handleSubmit} className={styles.modalDark}>
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

          {/* اسم المنتج */}
          <Field label="اسم المنتج" err={errors.name}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pepsi 1L"
              autoFocus={!product}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 15,
                background: "var(--sf)",
                color: "var(--ink)",
              }}
            />
          </Field>

          {/* Autocomplete suggestions from Egyptian Global Catalog */}
          {matches.length > 0 && !selectedGlobalProduct && (
            <div className={styles.catalogMatches}>
              <div className={styles.catalogMatchesTitle}>
                هل تقصد أحد هذه الأصناف من الكتالوج المصري؟
              </div>
              {matches.map((m) => (
                <div
                  key={m.product.id}
                  className={styles.matchCard}
                  onClick={() => handleSelectCatalogMatch(m)}
                >
                  <div className={styles.matchInfo}>
                    <span className={styles.matchName}>
                      {m.product.nameAr} {m.brand ? `(${m.brand.nameAr})` : ""}
                    </span>
                    <span className={styles.matchCategory}>
                      {m.product.category}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--ok, #108e5c)",
                    }}
                  >
                    اختيار
                  </span>
                </div>
              ))}
            </div>
          )}

          {selectedGlobalProduct && (
            <div
              style={{
                background: "var(--sf2, #fbf7ef)",
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--ok, #108e5c)",
                }}
              >
                ✓ مربوط بالكتالوج: {selectedGlobalProduct.product.nameAr}
              </span>
              <button
                type="button"
                className={styles.unhideBtn}
                onClick={handleClearCatalogMatch}
              >
                إلغاء الربط
              </button>
            </div>
          )}

          {/* تصنيف وبراند وباركود المنتج الفيزيائي */}
          <div className={styles.metaFieldsGrid}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--ink)",
                  }}
                >
                  التصنيف
                </span>
                {product ? (
                  <span className={styles.categoryAlreadyBadge}>
                    <Icon n="check" s={11} />
                    <span>مصنف بالفعل</span>
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--ink2)",
                      fontWeight: 500,
                    }}
                  >
                    إلزامي للإضافة
                  </span>
                )}
              </div>
              <div className={styles.selectWrapper}>
                <select
                  value={isCustomCategory ? "أخرى" : category}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "أخرى") {
                      setIsCustomCategory(true);
                      setCategory("أخرى");
                    } else {
                      setIsCustomCategory(false);
                      setCategory(val);
                      setCustomCategoryName("");
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.category;
                        return next;
                      });
                    }
                  }}
                  className={styles.styledSelect}
                >
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat === "أخرى" ? "أخرى (إنشاء تصنيف جديد...)" : cat}
                    </option>
                  ))}
                </select>
                <span className={styles.selectArrow}>
                  <Icon n="down" s={14} />
                </span>
              </div>
              {isCustomCategory && (
                <div className={styles.categoryCustomBox}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span style={{ fontSize: 13 }}>🏷️</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--br, #5a7d5a)",
                      }}
                    >
                      إنشاء تصنيف جديد للمحل:
                    </span>
                  </div>
                  <input
                    type="text"
                    value={customCategoryName}
                    onChange={(e) => {
                      setCustomCategoryName(e.target.value);
                      if (errors.category) {
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.category;
                          return next;
                        });
                      }
                    }}
                    placeholder="اكتب اسم التصنيف الجديد هنا..."
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: errors.category
                        ? "1.5px solid var(--red, #cf3c3c)"
                        : "1.5px solid var(--br, #5a7d5a)",
                      background: "var(--sf)",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                      boxSizing: "border-box",
                    }}
                    autoFocus
                  />
                  {errors.category && (
                    <div
                      style={{
                        color: "var(--red, #cf3c3c)",
                        fontSize: 11.5,
                        fontWeight: 700,
                        marginTop: 2,
                      }}
                    >
                      {errors.category}
                    </div>
                  )}
                </div>
              )}
            </div>

            <Field label="البراند / الماركة (اختياري)">
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="مثال: جهينة، عبور لاند..."
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                  fontSize: 13.5,
                  background: "var(--sf)",
                  color: "var(--ink)",
                  boxSizing: "border-box",
                }}
              />
            </Field>
          </div>

          <Field label="الباركود (اختياري)">
            <input
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="مثال: 6223000..."
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1.5px solid var(--line)",
                fontSize: 13,
                background: "var(--sf)",
                color: "var(--ink)",
              }}
            />
          </Field>

          {/* طريقة البيع - بيتباع إزاي؟ */}
          <div style={{ marginBottom: 6 }}>
            <span
              style={{
                display: "block",
                fontSize: 12.5,
                fontWeight: 700,
                marginBottom: 6,
                color: "var(--ink2)",
              }}
            >
              طريقة البيع (بيتباع إزاي؟):
            </span>
            <div className={styles.sellingMethodsGrid}>
              <button
                type="button"
                className={`${styles.methodCard} ${sellingMethod === "piece" ? styles.active : ""}`}
                onClick={() => setSellingMethod("piece")}
                aria-label="بالقطعة / الكرتونة"
                title="بالقطعة / الكرتونة"
              >
                <Icon n="box" s={18} />
                <span className={styles.methodTitle}>قطعة</span>
              </button>
              <button
                type="button"
                className={`${styles.methodCard} ${sellingMethod === "can" ? styles.active : ""}`}
                onClick={() => setSellingMethod("can")}
                aria-label="بالعلبة"
                title="بالعلبة"
              >
                <Icon n="box" s={18} />
                <span className={styles.methodTitle}>علبة</span>
              </button>
              <button
                type="button"
                className={`${styles.methodCard} ${sellingMethod === "jar" ? styles.active : ""}`}
                onClick={() => setSellingMethod("jar")}
                aria-label="بالبرطمان"
                title="بالبرطمان"
              >
                <Icon n="box" s={18} />
                <span className={styles.methodTitle}>برطمان</span>
              </button>
              <button
                type="button"
                className={`${styles.methodCard} ${sellingMethod === "bag" ? styles.active : ""}`}
                onClick={() => setSellingMethod("bag")}
                aria-label="بالكيس"
                title="بالكيس"
              >
                <Icon n="layers" s={18} />
                <span className={styles.methodTitle}>كيس</span>
              </button>
              <button
                type="button"
                className={`${styles.methodCard} ${sellingMethod === "carton" ? styles.active : ""}`}
                onClick={() => setSellingMethod("carton")}
                aria-label="بالكرتونة"
                title="بالكرتونة"
              >
                <Icon n="store" s={18} />
                <span className={styles.methodTitle}>كرتونة</span>
              </button>
              <button
                type="button"
                className={`${styles.methodCard} ${sellingMethod === "weight" ? styles.active : ""}`}
                onClick={() => setSellingMethod("weight")}
                aria-label="بالوزن"
                title="بالوزن"
              >
                <Icon n="scale" s={18} />
                <span className={styles.methodTitle}>وزن</span>
              </button>
              <button
                type="button"
                className={`${styles.methodCard} ${sellingMethod === "custom" ? styles.active : ""}`}
                onClick={() => setSellingMethod("custom")}
                aria-label="أخرى"
                title="طريقة بيع مخصصة"
              >
                <Icon n="plus" s={18} />
                <span className={styles.methodTitle}>أخرى</span>
              </button>
            </div>

            {sellingMethod === "custom" && (
              <div className={styles.categoryCustomBox}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--br, #5a7d5a)",
                  }}
                >
                  طريقة البيع المخصصة:
                </span>
                <input
                  type="text"
                  value={customSellingMethod}
                  onChange={(e) => {
                    setCustomSellingMethod(e.target.value);
                    if (errors.sellingMethod) {
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.sellingMethod;
                        return next;
                      });
                    }
                  }}
                  placeholder="مثال: شيكارة، لتر، دستة، طرد..."
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 9,
                    border: errors.sellingMethod
                      ? "1.5px solid var(--red, #cf3c3c)"
                      : "1.5px solid var(--br, #5a7d5a)",
                    background: "var(--sf)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink)",
                    boxSizing: "border-box",
                  }}
                  autoFocus
                />
                {errors.sellingMethod && (
                  <div
                    style={{
                      color: "var(--red, #cf3c3c)",
                      fontSize: 11.5,
                      fontWeight: 700,
                      marginTop: 2,
                    }}
                  >
                    {errors.sellingMethod}
                  </div>
                )}
              </div>
            )}
          </div>

          {sellingMethod === "weight" ? (
            <div className={styles.priceCardGroup}>
              {/* خيارات وحدة تسعير الوزن */}
              <div style={{ marginBottom: 12 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: "var(--ink2)",
                  }}
                >
                  التسعير بالوزن:
                </span>
                <Seg
                  value={weightUnit}
                  onChange={(val) => setWeightUnit(val as "kg" | "g")}
                  options={[
                    ["kg", "بالكيلو (كجم)"],
                    ["g", "بالجرام (جم)"],
                  ]}
                />
              </div>

              <div className={styles.priceCardTitle}>
                {weightUnit === "kg" ? "سعر الكيلو" : "سعر الجرام"}
              </div>
              <div className={styles.priceInputsGrid}>
                <div className={styles.priceInputCol}>
                  <span className={styles.priceInputLabel}>شراء</span>
                  <div className={styles.inputWithBadge}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={wBuy}
                      onChange={(e) => setWBuy(e.target.value)}
                      placeholder="0"
                    />
                    <span className={styles.inputBadge}>ج.م</span>
                  </div>
                </div>
                <div className={styles.priceInputCol}>
                  <span className={styles.priceInputLabel}>بيع</span>
                  <div className={styles.inputWithBadge}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={wSell}
                      onChange={(e) => setWSell(e.target.value)}
                      placeholder="0"
                    />
                    <span className={styles.inputBadge}>ج.م</span>
                  </div>
                </div>
              </div>
              {Number(wSell) > 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink2)",
                    marginTop: 8,
                    fontWeight: 600,
                  }}
                >
                  {weightUnit === "kg"
                    ? `(100 جرام تعادل ${(Number(wSell) / 10).toFixed(2)} ج.م)`
                    : `(الكيلو يعادل ${(Number(wSell) * 1000).toLocaleString("ar-EG")} ج.م)`}
                </div>
              )}
              {errors.price && (
                <div
                  style={{
                    color: "var(--red, #cf3c3c)",
                    fontSize: 12,
                    fontWeight: 700,
                    marginTop: 6,
                  }}
                >
                  {errors.price}
                </div>
              )}
            </div>
          ) : sellingMethod === "carton" ? (
            /* بيع مباشر بالكرتونة */
            <div className={styles.priceCardGroup}>
              <div className={styles.priceCardTitle}>سعر الكرتونة</div>
              <div className={styles.priceInputsGrid}>
                <div className={styles.priceInputCol}>
                  <span className={styles.priceInputLabel}>شراء</span>
                  <div className={styles.inputWithBadge}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={pkBuy}
                      onChange={(e) => setPkBuy(e.target.value)}
                      placeholder="0"
                    />
                    <span className={styles.inputBadge}>ج.م</span>
                  </div>
                </div>
                <div className={styles.priceInputCol}>
                  <span className={styles.priceInputLabel}>بيع</span>
                  <div className={styles.inputWithBadge}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={pkSell}
                      onChange={(e) => setPkSell(e.target.value)}
                      placeholder="0"
                    />
                    <span className={styles.inputBadge}>ج.م</span>
                  </div>
                </div>
              </div>
              {errors.price && (
                <div
                  style={{
                    color: "var(--red, #cf3c3c)",
                    fontSize: 12,
                    fontWeight: 700,
                    marginTop: 6,
                  }}
                >
                  {errors.price}
                </div>
              )}
            </div>
          ) : sellingMethod === "bag" ? (
            <>
              {/* إعدادات محتوى الكيس */}
              <div className={styles.priceCardGroup}>
                <div style={{ marginBottom: 12 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 6,
                      color: "var(--ink2)",
                    }}
                  >
                    محتوى الكيس:
                  </span>
                  <Seg
                    value={bagContentType}
                    onChange={(val) =>
                      setBagContentType(val as "weight" | "count")
                    }
                    size="sm"
                    className={styles.compactSeg}
                    options={[
                      ["weight", "بالوزن (جرام / كجم)"],
                      ["count", "بالعدد (قطع)"],
                    ]}
                  />
                </div>

                {bagContentType === "weight" ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr",
                      gap: 8,
                    }}
                  >
                    <Field label="وزن الكيس">
                      <input
                        type="number"
                        step="any"
                        min="1"
                        value={bagWeightVal}
                        onChange={(e) => setBagWeightVal(e.target.value)}
                        placeholder="500"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1.5px solid var(--line)",
                          fontSize: 14,
                          background: "var(--sf)",
                          color: "var(--ink)",
                        }}
                      />
                    </Field>
                    <Field label="الوحدة">
                      <Seg
                        value={bagWeightUnit}
                        onChange={(val) => setBagWeightUnit(val as "g" | "kg")}
                        size="sm"
                        options={[
                          ["g", "جم"],
                          ["kg", "كجم"],
                        ]}
                      />
                    </Field>
                  </div>
                ) : (
                  <Field label="عدد القطع داخل الكيس">
                    <div className={styles.inputWithBadge}>
                      <input
                        type="number"
                        min="1"
                        value={bagCountVal}
                        onChange={(e) => setBagCountVal(e.target.value)}
                        placeholder="10"
                      />
                      <span className={styles.inputBadge}>قطعة</span>
                    </div>
                  </Field>
                )}
              </div>

              {/* بيتباع كرتونة كمان للأكياس */}
              <div
                className={styles.cartonToggleCard}
                onClick={() => setHasPack(!hasPack)}
                role="checkbox"
                aria-checked={hasPack}
                tabIndex={0}
              >
                <span className={styles.cartonToggleLabel}>
                  بيتباع كرتونة كمان (تحتوي على أكياس)
                </span>
                <div
                  className={`${styles.customCheckbox} ${hasPack ? styles.checked : ""}`}
                >
                  {hasPack && <Icon n="check" s={14} />}
                </div>
              </div>

              {hasPack && (
                <>
                  <Field label="عدد الأكياس في الكرتونة" err={errors.packN}>
                    <div className={styles.inputWithBadge}>
                      <input
                        type="number"
                        min="2"
                        value={packN}
                        onChange={(e) => handlePackNChange(e.target.value)}
                        placeholder="20"
                      />
                      <span className={styles.inputBadge}>كيس</span>
                    </div>
                  </Field>

                  <div className={styles.priceCardGroup}>
                    <div className={styles.priceCardTitle}>سعر الكرتونة</div>
                    <div className={styles.priceInputsGrid}>
                      <div className={styles.priceInputCol}>
                        <span className={styles.priceInputLabel}>شراء</span>
                        <div className={styles.inputWithBadge}>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={pkBuy}
                            onChange={(e) =>
                              handlePackBuyChange(e.target.value)
                            }
                            placeholder="0"
                          />
                          <span className={styles.inputBadge}>ج.م</span>
                        </div>
                      </div>
                      <div className={styles.priceInputCol}>
                        <span className={styles.priceInputLabel}>بيع</span>
                        <div className={styles.inputWithBadge}>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={pkSell}
                            onChange={(e) =>
                              handlePackSellChange(e.target.value)
                            }
                            placeholder="0"
                          />
                          <span className={styles.inputBadge}>ج.م</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* سعر الكيس الواحد */}
              <div className={styles.priceCardGroup}>
                <div className={styles.priceCardTitle}>سعر الكيس الواحد</div>
                <div className={styles.priceInputsGrid}>
                  <div className={styles.priceInputCol}>
                    <span className={styles.priceInputLabel}>شراء</span>
                    <div className={styles.inputWithBadge}>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={pcBuy}
                        onChange={(e) => handlePieceBuyChange(e.target.value)}
                        placeholder="0"
                      />
                      <span className={styles.inputBadge}>ج.م</span>
                    </div>
                  </div>
                  <div className={styles.priceInputCol}>
                    <span className={styles.priceInputLabel}>بيع</span>
                    <div className={styles.inputWithBadge}>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={pcSell}
                        onChange={(e) => handlePieceSellChange(e.target.value)}
                        placeholder="0"
                      />
                      <span className={styles.inputBadge}>ج.م</span>
                    </div>
                  </div>
                </div>
                {errors.price && (
                  <div
                    style={{
                      color: "var(--red, #cf3c3c)",
                      fontSize: 12,
                      fontWeight: 700,
                      marginTop: 6,
                    }}
                  >
                    {errors.price}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* للقطع والعلب والبرطمانات والطرق المخصصة */
            <>
              {/* بيتباع كرتونة كمان toggle card */}
              <div
                className={styles.cartonToggleCard}
                onClick={() => setHasPack(!hasPack)}
                role="checkbox"
                aria-checked={hasPack}
                tabIndex={0}
              >
                <span className={styles.cartonToggleLabel}>
                  بيتباع كرتونة كمان (تحتوي على{" "}
                  {getUnitPluralLabel(sellingMethod)})
                </span>
                <div
                  className={`${styles.customCheckbox} ${hasPack ? styles.checked : ""}`}
                >
                  {hasPack && <Icon n="check" s={14} />}
                </div>
              </div>

              {hasPack && (
                <>
                  {/* عدد الوحدات في الكرتونة */}
                  <Field
                    label={
                      sellingMethod === "piece"
                        ? "عدد القطع في الكرتونة"
                        : `عدد الـ ${getUnitPluralLabel(sellingMethod)} في الكرتونة`
                    }
                    err={errors.packN}
                  >
                    <div className={styles.inputWithBadge}>
                      <input
                        type="number"
                        min="2"
                        value={packN}
                        onChange={(e) => handlePackNChange(e.target.value)}
                        placeholder="12"
                      />
                      <span className={styles.inputBadge}>
                        {getUnitNameLabel(sellingMethod)}
                      </span>
                    </div>
                  </Field>

                  {/* سعر الكرتونة */}
                  <div className={styles.priceCardGroup}>
                    <div className={styles.priceCardTitle}>سعر الكرتونة</div>
                    <div className={styles.priceInputsGrid}>
                      <div className={styles.priceInputCol}>
                        <span className={styles.priceInputLabel}>شراء</span>
                        <div className={styles.inputWithBadge}>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={pkBuy}
                            onChange={(e) =>
                              handlePackBuyChange(e.target.value)
                            }
                            placeholder="0"
                          />
                          <span className={styles.inputBadge}>ج.م</span>
                        </div>
                      </div>
                      <div className={styles.priceInputCol}>
                        <span className={styles.priceInputLabel}>بيع</span>
                        <div className={styles.inputWithBadge}>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={pkSell}
                            onChange={(e) =>
                              handlePackSellChange(e.target.value)
                            }
                            placeholder="0"
                          />
                          <span className={styles.inputBadge}>ج.م</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* سعر الوحدة المنفردة */}
              <div className={styles.priceCardGroup}>
                <div className={styles.priceCardTitle}>
                  {category === "كروت شحن"
                    ? "سعر الكارت"
                    : sellingMethod === "piece"
                      ? "سعر القطعة"
                      : `سعر ${getUnitSingularLabel(sellingMethod)} الواحد`}
                </div>
                <div className={styles.priceInputsGrid}>
                  <div className={styles.priceInputCol}>
                    <span className={styles.priceInputLabel}>شراء</span>
                    <div className={styles.inputWithBadge}>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={pcBuy}
                        onChange={(e) => handlePieceBuyChange(e.target.value)}
                        placeholder="0"
                      />
                      <span className={styles.inputBadge}>ج.م</span>
                    </div>
                  </div>
                  <div className={styles.priceInputCol}>
                    <span className={styles.priceInputLabel}>بيع</span>
                    <div className={styles.inputWithBadge}>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={pcSell}
                        onChange={(e) => handlePieceSellChange(e.target.value)}
                        placeholder="0"
                      />
                      <span className={styles.inputBadge}>ج.م</span>
                    </div>
                  </div>
                </div>
                {errors.price && (
                  <div
                    style={{
                      color: "var(--red, #cf3c3c)",
                      fontSize: 12,
                      fontWeight: 700,
                      marginTop: 6,
                    }}
                  >
                    {errors.price}
                  </div>
                )}
              </div>
            </>
          )}

          {profitHint && (
            <div
              className={styles.profitLine}
              style={{ padding: "8px 12px", fontSize: 12 }}
            >
              <span>📈 {profitHint}</span>
            </div>
          )}
        </form>
      </Modal>

      {/* Delete / Hide Confirmation Dialog */}
      {showDeleteConfirm && (
        <Modal
          title="حذف المنتج من المحل"
          onClose={() => setShowDeleteConfirm(false)}
          footer={
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                width: "100%",
              }}
            >
              <button
                type="button"
                className={styles.modalFooterBtnCancel}
                onClick={() => setShowDeleteConfirm(false)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className={styles.modalFooterBtnDelete}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                تأكيد الحذف
              </button>
            </div>
          }
        >
          <div style={{ fontSize: 14, lineHeight: 1.5, color: "var(--ink)" }}>
            هل أنت متأكد من إخفاء المنتج <b>«{product?.name_ar}»</b> من محلك؟
            <div style={{ marginTop: 8, color: "var(--ink2)", fontSize: 12 }}>
              لن يظهر المنتج في قائمة البيع اليومية، مع الحفاظ الكامل على
              فواتيرك السابقة. يمكنك إعادة إظهاره في أي وقت من فلتر «المخفية».
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export default ProductFormModal;
