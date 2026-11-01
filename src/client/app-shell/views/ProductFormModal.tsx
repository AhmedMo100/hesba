"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Modal, Field, Seg, Icon } from "../../shared/ui";
import { HesbaDatabase } from "../../shared/db";
import {
  searchOfflineCatalog,
  type CatalogSearchResult,
} from "../../shared/catalog";
import { formatMoney } from "../../shared/i18n";
import styles from "./ProductsView.module.css";

export interface ProductFormModalProps {
  product?: {
    id: string;
    name_ar: string;
    category: string;
    unit: string;
    sell_price_piasters: number;
    buy_cost_piasters?: number;
    is_custom?: boolean;
    global_product_id?: string | null;
    variants: Array<{
      id?: string;
      flavor?: string | null;
      size_value?: number | null;
      size_unit?: string | null;
      pack_qty?: number;
      sell_price_piasters: number;
      buy_cost_piasters?: number;
    }>;
  } | null;
  initialCatalogProduct?: CatalogSearchResult | null;
  onClose: () => void;
  onSaved: (savedProduct: unknown) => void;
  onDeleted?: (productId: string) => void;
}

export function ProductFormModal({
  product,
  initialCatalogProduct,
  onClose,
  onSaved,
  onDeleted,
}: ProductFormModalProps) {
  const firstVariant = product?.variants?.[0];

  const [name, setName] = useState(
    product
      ? product.name_ar
      : initialCatalogProduct
        ? initialCatalogProduct.product.nameAr
        : "",
  );
  const [kind, setKind] = useState<"unit" | "weight">(
    product?.unit === "weight" ||
      product?.unit === "kg" ||
      product?.unit === "g"
      ? "weight"
      : "unit",
  );
  const [weightUnit, setWeightUnit] = useState<"kg" | "g">(
    product?.unit === "g" ? "g" : "kg",
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

  // Expected gross profit calculation
  const profitHint = useMemo(() => {
    if (kind === "weight") {
      const sell = parseFloat(wSell);
      const buy = parseFloat(wBuy);
      if (!isNaN(sell) && sell > 0 && !isNaN(buy) && buy > 0) {
        const diffPiasters = Math.round((sell - buy) * 100);
        const unitLabel = weightUnit === "g" ? "الجرام" : "الكيلو";
        return `مجمل الربح المتوقع في ${unitLabel}: ${formatMoney(diffPiasters)}`;
      }
    } else {
      const sell = parseFloat(pcSell);
      const buy = parseFloat(pcBuy);
      if (!isNaN(sell) && sell > 0 && !isNaN(buy) && buy > 0) {
        const diffPiasters = Math.round((sell - buy) * 100);
        return `مجمل الربح المتوقع في القطعة: ${formatMoney(diffPiasters)}`;
      }
    }
    return "";
  }, [kind, weightUnit, wSell, wBuy, pcSell, pcBuy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "اكتب اسم المنتج";
    }

    let sellPriceNum = 0;
    let buyCostNum = 0;

    if (kind === "weight") {
      sellPriceNum = parseFloat(wSell);
      buyCostNum = parseFloat(wBuy) || 0;
      if (isNaN(sellPriceNum) || sellPriceNum <= 0) {
        newErrors.price =
          weightUnit === "g" ? "اكتب سعر بيع الجرام" : "اكتب سعر بيع الكيلو";
      }
    } else {
      sellPriceNum = parseFloat(pcSell);
      buyCostNum = parseFloat(pcBuy) || 0;
      if (isNaN(sellPriceNum) || sellPriceNum <= 0) {
        newErrors.price = "اكتب سعر بيع القطعة";
      }
      if (hasPack) {
        const n = parseInt(packN, 10);
        if (isNaN(n) || n < 2) {
          newErrors.packN = "عدد القطع في الكرتونة (2 أو أكثر)";
        }
      }
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
        hasPack && kind === "unit" ? parseInt(packN, 10) || 1 : 1;

      const payload = {
        id: product?.id,
        nameAr: name.trim(),
        category,
        unit: kind === "weight" ? weightUnit : ("piece" as const),
        sellPricePiasters,
        buyCostPiasters: buyCostPiasters > 0 ? buyCostPiasters : null,
        isCustom,
        globalProductId: selectedGlobalProduct
          ? selectedGlobalProduct.product.id
          : (product?.global_product_id ?? null),
        brandName: brandName.trim() || null,
        variants: [
          {
            id: firstVariant?.id,
            flavor: flavor.trim() || null,
            sizeValue:
              kind === "weight" ? 1 : sizeValue ? parseFloat(sizeValue) : null,
            sizeUnit:
              kind === "weight" ? weightUnit : sizeValue ? sizeUnit : null,
            packQty: packQtyNum,
            sellPricePiasters,
            costPricePiasters: buyCostPiasters > 0 ? buyCostPiasters : null,
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

          {/* بيتباع إزاي؟ */}
          <Field label="بيتباع إزاي؟">
            <Seg
              value={kind}
              onChange={(val) => setKind(val as "unit" | "weight")}
              options={[
                ["unit", "بالقطعة / الكرتونة", "box"],
                ["weight", "بالوزن (كيلو)", "scale"],
              ]}
            />
          </Field>

          {kind === "weight" ? (
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
                      step={weightUnit === "g" ? "0.01" : "0.25"}
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
                      step={weightUnit === "g" ? "0.01" : "0.25"}
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
          ) : (
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
                  بيتباع كرتونة كمان
                </span>
                <div
                  className={`${styles.customCheckbox} ${hasPack ? styles.checked : ""}`}
                >
                  {hasPack && <Icon n="check" s={14} />}
                </div>
              </div>

              {hasPack && (
                <>
                  {/* عدد القطع في الكرتونة */}
                  <Field label="عدد القطع في الكرتونة" err={errors.packN}>
                    <div className={styles.inputWithBadge}>
                      <input
                        type="number"
                        min="2"
                        value={packN}
                        onChange={(e) => handlePackNChange(e.target.value)}
                        placeholder="12"
                      />
                      <span className={styles.inputBadge}>قطعة</span>
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
                            step="0.25"
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
                            step="0.25"
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

              {/* سعر القطعة */}
              <div className={styles.priceCardGroup}>
                <div className={styles.priceCardTitle}>سعر القطعة</div>
                <div className={styles.priceInputsGrid}>
                  <div className={styles.priceInputCol}>
                    <span className={styles.priceInputLabel}>شراء</span>
                    <div className={styles.inputWithBadge}>
                      <input
                        type="number"
                        step="0.25"
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
                        step="0.25"
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
