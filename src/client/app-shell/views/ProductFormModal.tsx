"use client";

import React, { useState, useEffect } from "react";
import { Modal, Button, Field, Seg } from "../../shared/ui";
import { HesbaDatabase } from "../../shared/db";
import {
  searchOfflineCatalog,
  type CatalogSearchResult,
} from "../../shared/catalog";
import styles from "./ProductsView.module.css";

export interface ProductFormModalProps {
  product?: {
    id: string;
    name_ar: string;
    category: string;
    unit: string;
    sell_price_piasters: number;
    variants: Array<{
      id?: string;
      flavor?: string | null;
      size_value?: number | null;
      size_unit?: string | null;
      pack_qty?: number;
      sell_price_piasters: number;
    }>;
  } | null;
  initialCatalogProduct?: CatalogSearchResult | null;
  onClose: () => void;
  onSaved: (savedProduct: unknown) => void;
}

export function ProductFormModal({
  product,
  initialCatalogProduct,
  onClose,
  onSaved,
}: ProductFormModalProps) {
  const [name, setName] = useState(
    product
      ? product.name_ar
      : initialCatalogProduct
        ? initialCatalogProduct.product.nameAr
        : "",
  );
  const [unit, setUnit] = useState<"piece" | "weight">(
    product?.unit === "weight" ? "weight" : "piece",
  );
  const [sellPriceEgp, setSellPriceEgp] = useState(
    product ? (product.sell_price_piasters / 100).toString() : "",
  );
  const [category, setCategory] = useState(
    product
      ? product.category
      : initialCatalogProduct
        ? initialCatalogProduct.product.category
        : "السلع الاستهلاكية",
  );
  const [brandName, setBrandName] = useState(
    initialCatalogProduct?.brand?.nameAr ?? "",
  );
  const [flavor, setFlavor] = useState(
    product?.variants[0]?.flavor ??
      initialCatalogProduct?.variants[0]?.flavor ??
      "",
  );
  const [sizeValue, setSizeValue] = useState(
    product?.variants[0]?.size_value?.toString() ??
      initialCatalogProduct?.variants[0]?.sizeValue?.toString() ??
      "",
  );
  const [sizeUnit, setSizeUnit] = useState<"g" | "kg" | "ml" | "l" | "piece">(
    (product?.variants[0]?.size_unit as "g" | "kg" | "ml" | "l" | "piece") ??
      (initialCatalogProduct?.variants[0]?.sizeUnit as
        "g" | "kg" | "ml" | "l" | "piece") ??
      "piece",
  );
  const [packQty, setPackQty] = useState(
    product?.variants[0]?.pack_qty
      ? product.variants[0].pack_qty.toString()
      : initialCatalogProduct?.variants[0]?.packQty
        ? initialCatalogProduct.variants[0].packQty.toString()
        : "1",
  );

  const [matches, setMatches] = useState<CatalogSearchResult[]>([]);
  const [selectedGlobalProduct, setSelectedGlobalProduct] =
    useState<CatalogSearchResult | null>(initialCatalogProduct ?? null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    initialCatalogProduct?.variants[0]?.id ?? null,
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live offline search against IndexedDB when name changes
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
      searchOfflineCatalog(db, trimmed, { limit: 5 })
        .then((results) => {
          if (isMounted) {
            setMatches(results);
          }
        })
        .catch(() => {
          // Fallback gracefully
        });
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [name, product, selectedGlobalProduct]);

  const handleSelectCatalogMatch = (match: CatalogSearchResult) => {
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
      if (first.packQty) setPackQty(first.packQty.toString());
    }
    setMatches([]);
  };

  const handleClearCatalogMatch = () => {
    setSelectedGlobalProduct(null);
    setSelectedVariantId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "اسم المنتج مطلوب";
    }

    const priceNum = parseFloat(sellPriceEgp);
    if (isNaN(priceNum) || priceNum < 0) {
      newErrors.price = "سعر البيع يجب أن يكون رقماً صحيحاً أو عشرياً موجباً";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const pricePiasters = Math.round(priceNum * 100);
      const isCustom = !selectedGlobalProduct;

      const payload = {
        id: product?.id,
        nameAr: name.trim(),
        category,
        unit: unit === "weight" ? "kg" : "piece",
        sellPricePiasters: pricePiasters,
        isCustom,
        globalProductId: selectedGlobalProduct
          ? selectedGlobalProduct.product.id
          : null,
        brandName: brandName.trim() || null,
        variants: [
          {
            id: product?.variants[0]?.id,
            flavor: flavor.trim() || null,
            sizeValue: sizeValue ? parseFloat(sizeValue) : null,
            sizeUnit: sizeValue ? sizeUnit : null,
            packQty: packQty ? parseInt(packQty, 10) : 1,
            sellPricePiasters: pricePiasters,
            globalVariantId: selectedVariantId || null,
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

  return (
    <Modal
      title={product ? "تعديل المنتج" : "إضافة منتج"}
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
            {product ? "حفظ التعديلات" : "إضافة للمحل"}
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

        <Field label="اسم المنتج" err={errors.name}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اكتب اسم المنتج (مثل: شاي العروسة)"
            autoFocus={!product}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
            }}
          />
        </Field>

        {/* Display Catalog Suggestions Match If Found */}
        {matches.length > 0 && !selectedGlobalProduct && (
          <div className={styles.catalogMatches}>
            <div className={styles.catalogMatchesTitle}>
              هل تقصد أحد هذه المنتجات من الكتالوج العام؟
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
                <Button size="sm" kind="soft">
                  اختيار
                </Button>
              </div>
            ))}
          </div>
        )}

        {selectedGlobalProduct && (
          <div
            style={{
              background: "var(--soft, #f5efe6)",
              padding: "8px 12px",
              borderRadius: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--br, #c8651b)",
              }}
            >
              ✓ مربوط بكتالوج: {selectedGlobalProduct.product.nameAr}
            </span>
            <Button size="sm" kind="ghost" onClick={handleClearCatalogMatch}>
              إلغاء الربط
            </Button>
          </div>
        )}

        <Field label="طريقة البيع">
          <Seg
            value={unit}
            onChange={(val) => setUnit(val as "piece" | "weight")}
            options={[
              ["piece", "بالقطعة / الكرتونة", "box"],
              ["weight", "بالوزن (كيلو)", "scale"],
            ]}
          />
        </Field>

        <Field
          label={
            unit === "weight" ? "سعر بيع الكيلو (ج.م)" : "سعر بيع القطعة (ج.م)"
          }
          err={errors.price}
        >
          <input
            type="number"
            step="0.25"
            min="0"
            value={sellPriceEgp}
            onChange={(e) => setSellPriceEgp(e.target.value)}
            placeholder="0.00"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
            }}
          />
        </Field>

        {unit === "piece" && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <Field label="النكهة / الصنف (اختياري)">
                <input
                  type="text"
                  value={flavor}
                  onChange={(e) => setFlavor(e.target.value)}
                  placeholder="مثال: شطة وليمون"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1.5px solid var(--line)",
                  }}
                />
              </Field>
              <Field label="عدد العبوات في الكرتونة">
                <input
                  type="number"
                  min="1"
                  value={packQty}
                  onChange={(e) => setPackQty(e.target.value)}
                  placeholder="1"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1.5px solid var(--line)",
                  }}
                />
              </Field>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <Field label="قيمة الحجم / الوزن">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={sizeValue}
                  onChange={(e) => setSizeValue(e.target.value)}
                  placeholder="مثال: 250"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1.5px solid var(--line)",
                  }}
                />
              </Field>
              <Field label="الوحدة">
                <select
                  value={sizeUnit}
                  onChange={(e) =>
                    setSizeUnit(
                      e.target.value as "g" | "kg" | "ml" | "l" | "piece",
                    )
                  }
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1.5px solid var(--line)",
                    background: "var(--sf)",
                  }}
                >
                  <option value="piece">قطعة</option>
                  <option value="g">جرام (جم)</option>
                  <option value="kg">كيلو (كجم)</option>
                  <option value="ml">مليلتر (مل)</option>
                  <option value="l">لتر</option>
                </select>
              </Field>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
