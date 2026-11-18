"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Modal } from "@/client/shared/ui";
import { BarcodeScanSheet } from "@/client/shared/scanner/BarcodeScanSheet";
import { HesbaDatabase } from "@/client/offline/db";
import {
  searchOfflineCatalog,
  type CatalogSearchResult,
} from "@/client/offline/catalog";
import { formatMoney } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import {
  packToPiecePrice,
  pieceToPackPrice,
  recalcOnPackQtyChange,
} from "./product-form.logic";
import {
  getCachedCustomTaxonomy,
  fetchCustomTaxonomy,
  saveCustomTaxonomy,
  SECONDARY_PACKAGING_PRESETS,
} from "@/client/shared/api/custom-taxonomy";
import styles from "./ProductsView.module.css";
import f from "./ProductFormModal.module.css";

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
  /** A barcode just scanned that no product has (ADR-0031): prefilled, still editable. */
  presetBarcode?: string;
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
  presetBarcode,
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
    "piece" | "can" | "jar" | "bag" | "carton" | "weight" | "custom" | string
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

  const [customTaxonomy, setCustomTaxonomy] = useState(() =>
    getCachedCustomTaxonomy(),
  );

  useEffect(() => {
    void fetchCustomTaxonomy().then(setCustomTaxonomy);
    const handleTaxonomyUpdate = () => {
      setCustomTaxonomy(getCachedCustomTaxonomy());
    };
    window.addEventListener(
      "hesba_custom_taxonomy_updated",
      handleTaxonomyUpdate,
    );
    return () => {
      window.removeEventListener(
        "hesba_custom_taxonomy_updated",
        handleTaxonomyUpdate,
      );
    };
  }, []);

  const availableCategories = useMemo(() => {
    const standardWithoutOther = PRODUCT_CATEGORIES.filter((c) => c !== "أخرى");
    const merged = Array.from(
      new Set([...standardWithoutOther, ...customTaxonomy.customCategories]),
    );
    return [...merged, "أخرى"];
  }, [customTaxonomy.customCategories]);

  const availableSellingMethods = useMemo(() => {
    const base = [
      { key: "piece", label: "قطعة", icon: "box" },
      { key: "can", label: "علبة", icon: "box" },
      { key: "jar", label: "برطمان", icon: "box" },
      { key: "bag", label: "كيس", icon: "layers" },
      { key: "carton", label: "كرتونة", icon: "store" },
      { key: "weight", label: "وزن", icon: "scale" },
    ];
    const customs = customTaxonomy.customSellingMethods
      .filter((m) => !base.some((b) => b.key === m || b.label === m))
      .map((m) => ({ key: m, label: m, icon: "box" }));
    return [
      ...base,
      ...customs,
      { key: "custom", label: "أخرى", icon: "plus" },
    ];
  }, [customTaxonomy.customSellingMethods]);

  // Secondary packaging / Multiple selling method state
  const [packMethod, setPackMethod] = useState<string>(() => {
    if (
      firstVariant?.size_unit &&
      ["carton", "dozen", "bag", "box"].includes(firstVariant.size_unit)
    ) {
      return firstVariant.size_unit;
    }
    return "carton";
  });
  const [customPackMethod, setCustomPackMethod] = useState<string>(() => {
    if (
      firstVariant?.size_unit &&
      ![
        "carton",
        "dozen",
        "bag",
        "box",
        "piece",
        "g",
        "kg",
        "unit",
        "ml",
        "l",
      ].includes(firstVariant.size_unit)
    ) {
      return firstVariant.size_unit;
    }
    return "";
  });

  const secondaryPackTitle = useMemo(() => {
    if (packMethod === "custom") {
      return customPackMethod.trim() || "عبوة";
    }
    const found = SECONDARY_PACKAGING_PRESETS.find((p) => p.key === packMethod);
    return found ? (found.label.split(" ")[0] ?? "عبوة") : "عبوة";
  }, [packMethod, customPackMethod]);

  const [barcode, setBarcode] = useState(
    product?.barcode || firstVariant?.barcode || presetBarcode || "",
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
  const [scanning, setScanning] = useState(false);

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
    const pc = packToPiecePrice(val, packN);
    if (pc !== null) setPcSell(pc);
  };

  const handlePieceSellChange = (val: string) => {
    setPcSell(val);
    const pk = pieceToPackPrice(val, packN);
    if (pk !== null) setPkSell(pk);
  };

  const handlePackBuyChange = (val: string) => {
    setPkBuy(val);
    const pc = packToPiecePrice(val, packN);
    if (pc !== null) setPcBuy(pc);
  };

  const handlePieceBuyChange = (val: string) => {
    setPcBuy(val);
    const pk = pieceToPackPrice(val, packN);
    if (pk !== null) setPkBuy(pk);
  };

  const handlePackNChange = (val: string) => {
    setPackN(val);
    const updates = recalcOnPackQtyChange(val, pkSell, pcSell, pkBuy, pcBuy);
    if (updates.pcSell !== undefined) setPcSell(updates.pcSell);
    if (updates.pkSell !== undefined) setPkSell(updates.pkSell);
    if (updates.pcBuy !== undefined) setPcBuy(updates.pcBuy);
    if (updates.pkBuy !== undefined) setPkBuy(updates.pkBuy);
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

      const secondaryUnitName = hasPack
        ? packMethod === "custom"
          ? customPackMethod.trim() || "pack"
          : packMethod
        : targetSizeUnit;

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
            sizeUnit: secondaryUnitName,
            packQty: packQtyNum,
            sellPricePiasters,
            costPricePiasters: buyCostPiasters > 0 ? buyCostPiasters : null,
            globalVariantId: selectedVariantId || null,
            barcode: barcode.trim() || null,
          },
        ],
      };

      // Persist custom category or custom selling methods in store's DB
      if (isCustomCategory && customCategoryName.trim()) {
        void saveCustomTaxonomy({ newCategory: customCategoryName.trim() });
      }
      if (sellingMethod === "custom" && customSellingMethod.trim()) {
        void saveCustomTaxonomy({
          newSellingMethod: customSellingMethod.trim(),
        });
      }
      if (hasPack && packMethod === "custom" && customPackMethod.trim()) {
        void saveCustomTaxonomy({ newSellingMethod: customPackMethod.trim() });
      }

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

  const unitOne = getUnitNameLabel(sellingMethod) ?? "قطعة";
  const unitThe = getUnitSingularLabel(sellingMethod) ?? "القطعة";
  const packThe =
    packMethod === "carton" || secondaryPackTitle === "كرتونة"
      ? "الكرتونة"
      : secondaryPackTitle.startsWith("ال")
        ? secondaryPackTitle
        : `ال${secondaryPackTitle}`;
  const priceErr = errors.price ? (
    <div className={f.err} role="alert">
      {errors.price}
    </div>
  ) : null;
  const buySell = (
    label: string,
    buy: string,
    onBuy: (v: string) => void,
    sell: string,
    onSell: (v: string) => void,
    testId: string,
  ) => (
    <div className={f.two}>
      <div>
        <label className={f.lbl}>سعر الشراء ({label})</label>
        <input
          className={f.input}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={buy}
          onChange={(e) => onBuy(e.target.value)}
          placeholder="0"
          data-testid={`${testId}-buy`}
        />
      </div>
      <div>
        <label className={f.lbl}>سعر البيع ({label})</label>
        <input
          className={`${f.input} ${errors.price && !sell ? f.inputErr : ""}`}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={sell}
          onChange={(e) => onSell(e.target.value)}
          placeholder="0"
          data-testid={`${testId}-sell`}
        />
      </div>
    </div>
  );
  const chip = (
    on: boolean,
    label: string,
    onClick: () => void,
    testId?: string,
  ) => (
    <button
      type="button"
      className={`${f.chip} ${on ? f.chipOn : ""}`}
      onClick={onClick}
      aria-pressed={on}
      data-testid={testId}
    >
      {label}
    </button>
  );

  return (
    <>
      <Modal
        title={product ? "✏️ تعديل المنتج" : "📦 منتج جديد"}
        onClose={onClose}
      >
        <form
          onSubmit={handleSubmit}
          className={f.form}
          data-testid="product-form"
          dir="rtl"
        >
          {errors.submit && (
            <div className={f.errBox} role="alert">
              {errors.submit}
            </div>
          )}

          {/* ─── V19: اسم المنتج ─── */}
          <label className={f.lbl} htmlFor="pf-name">
            اسم المنتج
          </label>
          <input
            id="pf-name"
            className={`${f.input} ${errors.name ? f.inputErr : ""}`}
            type="text"
            dir="auto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً: شيبسي كبير"
            autoFocus={!product}
            data-testid="product-name"
          />
          {errors.name && <div className={f.err}>{errors.name}</div>}

          {/* The Egyptian catalog: the same product, already described */}
          {matches.length > 0 && !selectedGlobalProduct && (
            <div className={f.matches}>
              <div className={f.note}>تقصد واحد من دول؟</div>
              {matches.map((m) => (
                <button
                  key={m.product.id}
                  type="button"
                  className={f.match}
                  onClick={() => handleSelectCatalogMatch(m)}
                >
                  <span>
                    {m.product.nameAr} {m.brand ? `(${m.brand.nameAr})` : ""}
                    <br />
                    <small>{m.product.category}</small>
                  </span>
                  <span>اختار</span>
                </button>
              ))}
            </div>
          )}
          {selectedGlobalProduct && (
            <div className={f.linked}>
              <span>✓ من الكتالوج: {selectedGlobalProduct.product.nameAr}</span>
              <button
                type="button"
                className={f.linkBtn}
                onClick={handleClearCatalogMatch}
              >
                إلغاء الربط
              </button>
            </div>
          )}

          {/* ─── الباركود: امسحه أو اكتبه (اختياري) ─── */}
          <label className={f.lbl} htmlFor="pf-barcode">
            الباركود (اختياري)
          </label>
          <div className={f.barRow}>
            <input
              id="pf-barcode"
              className={f.input}
              inputMode="numeric"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="امسحه أو اكتبه"
              data-testid="product-barcode"
            />
            <button
              type="button"
              className={f.scanBtn}
              onClick={() => setScanning(true)}
              data-testid="product-barcode-scan"
            >
              📷 امسح
            </button>
          </div>

          {/* ─── بتبيعه إزاي؟ every selling unit the shop uses ─── */}
          <div className={f.lbl}>بتبيعه إزاي؟</div>
          <div className={f.chips} data-testid="product-methods">
            {availableSellingMethods.map((m) => (
              <React.Fragment key={m.key}>
                {chip(
                  sellingMethod === m.key,
                  m.key === "weight" ? "بالوزن" : m.label,
                  () => {
                    setSellingMethod(m.key);
                    if (
                      m.key !== "custom" &&
                      ![
                        "piece",
                        "can",
                        "jar",
                        "bag",
                        "carton",
                        "weight",
                      ].includes(m.key)
                    ) {
                      setCustomSellingMethod(m.label);
                    }
                  },
                  `product-method-${m.key}`,
                )}
              </React.Fragment>
            ))}
          </div>
          {sellingMethod === "custom" && (
            <>
              <input
                className={`${f.input} ${errors.sellingMethod ? f.inputErr : ""}`}
                dir="auto"
                value={customSellingMethod}
                onChange={(e) => {
                  setCustomSellingMethod(e.target.value);
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.sellingMethod;
                    return next;
                  });
                }}
                placeholder="اسم الوحدة: شيكارة، لفة، طبق…"
                data-testid="product-method-custom-name"
              />
              {errors.sellingMethod && (
                <div className={f.err}>{errors.sellingMethod}</div>
              )}
            </>
          )}

          {sellingMethod === "weight" ? (
            <>
              <div className={f.chips}>
                {chip(weightUnit === "kg", "بالكيلو", () =>
                  setWeightUnit("kg"),
                )}
                {chip(weightUnit === "g", "بالجرام", () => setWeightUnit("g"))}
              </div>
              {buySell(
                weightUnit === "kg" ? "الكيلو" : "الجرام",
                wBuy,
                setWBuy,
                wSell,
                setWSell,
                "product-price",
              )}
              {Number(wSell) > 0 && (
                <div className={f.note}>
                  {weightUnit === "kg"
                    ? `الـ 100 جرام بـ ${(Number(wSell) / 10).toFixed(2)} ج`
                    : `الكيلو بـ ${(Number(wSell) * 1000).toLocaleString("en-US")} ج`}
                </div>
              )}
              {priceErr}
            </>
          ) : sellingMethod === "carton" ? (
            <>
              {buySell(
                "الكرتونة",
                pkBuy,
                setPkBuy,
                pkSell,
                setPkSell,
                "product-price",
              )}
              {priceErr}
            </>
          ) : (
            <>
              {sellingMethod === "bag" && (
                <>
                  <div className={f.lbl}>الكيس فيه</div>
                  <div className={f.chips}>
                    {chip(bagContentType === "weight", "وزن", () =>
                      setBagContentType("weight"),
                    )}
                    {chip(bagContentType === "count", "عدد قطع", () =>
                      setBagContentType("count"),
                    )}
                  </div>
                  {bagContentType === "weight" ? (
                    <div className={f.two}>
                      <div>
                        <label className={f.lbl}>وزن الكيس</label>
                        <input
                          className={f.input}
                          type="number"
                          inputMode="decimal"
                          min="1"
                          value={bagWeightVal}
                          onChange={(e) => setBagWeightVal(e.target.value)}
                          placeholder="500"
                          data-testid="product-bag-weight"
                        />
                      </div>
                      <div className={f.chips}>
                        {chip(bagWeightUnit === "g", "جرام", () =>
                          setBagWeightUnit("g"),
                        )}
                        {chip(bagWeightUnit === "kg", "كيلو", () =>
                          setBagWeightUnit("kg"),
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className={f.lbl}>عدد القطع في الكيس</label>
                      <input
                        className={f.input}
                        type="number"
                        inputMode="numeric"
                        min="1"
                        value={bagCountVal}
                        onChange={(e) => setBagCountVal(e.target.value)}
                        placeholder="10"
                        data-testid="product-bag-count"
                      />
                    </>
                  )}
                </>
              )}

              {buySell(
                category === "كروت شحن" ? "الكارت" : unitThe,
                pcBuy,
                handlePieceBuyChange,
                pcSell,
                handlePieceSellChange,
                "product-price",
              )}
              {priceErr}

              {/* V19: «كمان بتتباع بالكرتونة» — a second selling unit */}
              <label className={f.chk}>
                <input
                  type="checkbox"
                  checked={hasPack}
                  onChange={(e) => setHasPack(e.target.checked)}
                  data-testid="product-has-pack"
                />
                {sellingMethod === "bag"
                  ? "كمان بتتباع بالكرتونة"
                  : "كمان بتتباع بعبوة أكبر (كرتونة، دستة…)"}
              </label>
              {hasPack && (
                <div className={f.packBox} data-testid="product-pack">
                  {sellingMethod !== "bag" && (
                    <div className={f.chips}>
                      {SECONDARY_PACKAGING_PRESETS.map((p) => (
                        <React.Fragment key={p.key}>
                          {chip(packMethod === p.key, p.label, () => {
                            setPackMethod(p.key);
                            if (p.defaultPack && p.key !== "custom") {
                              handlePackNChange(p.defaultPack.toString());
                            }
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                  {packMethod === "custom" && sellingMethod !== "bag" && (
                    <input
                      className={f.input}
                      dir="auto"
                      value={customPackMethod}
                      onChange={(e) => setCustomPackMethod(e.target.value)}
                      placeholder="اسم العبوة: شيكارة، طرد…"
                    />
                  )}
                  <label className={f.lbl}>
                    عدد ال{getUnitPluralLabel(sellingMethod)} في {packThe}
                  </label>
                  <input
                    className={`${f.input} ${errors.packN ? f.inputErr : ""}`}
                    type="number"
                    inputMode="numeric"
                    min="2"
                    value={packN}
                    onChange={(e) => handlePackNChange(e.target.value)}
                    placeholder="12"
                    data-testid="product-pack-qty"
                  />
                  {errors.packN && <div className={f.err}>{errors.packN}</div>}
                  {buySell(
                    packThe,
                    pkBuy,
                    handlePackBuyChange,
                    pkSell,
                    handlePackSellChange,
                    "product-pack-price",
                  )}
                  {Number(packN) > 1 && (
                    <div className={f.note}>
                      {packThe} = {packN} {unitOne}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ─── التصنيف ─── */}
          <label className={f.lbl} htmlFor="pf-category">
            التصنيف
          </label>
          <select
            id="pf-category"
            className={f.select}
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
          >
            {availableCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === "أخرى" ? "تصنيف جديد…" : cat}
              </option>
            ))}
          </select>
          {isCustomCategory && (
            <input
              className={`${f.input} ${errors.category ? f.inputErr : ""}`}
              dir="auto"
              value={customCategoryName}
              onChange={(e) => {
                setCustomCategoryName(e.target.value);
                setErrors((prev) => {
                  const next = { ...prev };
                  delete next.category;
                  return next;
                });
              }}
              placeholder="اسم التصنيف الجديد"
              style={{ marginTop: 8 }}
            />
          )}
          {errors.category && <div className={f.err}>{errors.category}</div>}

          {/* ─── V19: تفاصيل أكتر (اختياري) ─── */}
          <details className={f.details}>
            <summary>تفاصيل أكتر (اختياري)</summary>
            <label className={f.lbl}>البراند</label>
            <input
              className={f.input}
              dir="auto"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="مثلاً: جهينة"
            />
            <label className={f.lbl}>النكهة</label>
            <input
              className={f.input}
              dir="auto"
              value={flavor}
              onChange={(e) => setFlavor(e.target.value)}
            />
            {sellingMethod !== "bag" && sellingMethod !== "weight" && (
              <>
                <label className={f.lbl}>الوزن / الحجم</label>
                <div className={f.two}>
                  <input
                    className={f.input}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={sizeValue}
                    onChange={(e) => setSizeValue(e.target.value)}
                    placeholder="مثلاً: 1"
                  />
                  <select
                    className={f.select}
                    value={sizeUnit}
                    onChange={(e) =>
                      setSizeUnit(e.target.value as typeof sizeUnit)
                    }
                  >
                    <option value="g">جرام</option>
                    <option value="kg">كيلو</option>
                    <option value="ml">مللي</option>
                    <option value="l">لتر</option>
                    <option value="piece">قطعة</option>
                  </select>
                </div>
              </>
            )}
          </details>

          {profitHint && <div className={f.sumbox}>📈 {profitHint}</div>}

          <button
            type="submit"
            className={f.btn}
            disabled={isSubmitting || isDeleting}
            data-testid="product-save"
          >
            {isSubmitting
              ? "بيتحفظ…"
              : product
                ? "حفظ التعديل ✅"
                : "حفظ المنتج ✅"}
          </button>
          {product && (
            <button
              type="button"
              className={`${f.btn} ${f.danger}`}
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isSubmitting || isDeleting}
              data-testid="product-delete"
            >
              🗑️ احذف المنتج
            </button>
          )}
        </form>
      </Modal>

      {scanning && (
        <BarcodeScanSheet
          onCode={(code) => {
            setBarcode(code);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}

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
