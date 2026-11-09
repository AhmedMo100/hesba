"use client";

import React, { useState, useMemo } from "react";
import {
  Modal,
  Field,
  Input,
  Num,
  Button,
  Icon,
  SearchBox,
} from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import type { StoreProductItem } from "@/client/shared/store-items";
import type { SuggestedPromotion } from "@/domain/alerts";
import styles from "./EditPromoModal.module.css";

export interface EditPromoModalProps {
  initialPromo: SuggestedPromotion;
  allProducts: StoreProductItem[];
  onClose: () => void;
  onSaveAndPublish: (promo: SuggestedPromotion) => Promise<void>;
  onDelete?: (promoId: string) => Promise<void>;
}

export function EditPromoModal({
  initialPromo,
  allProducts,
  onClose,
  onSaveAndPublish,
  onDelete,
}: EditPromoModalProps) {
  const [title, setTitle] = useState(initialPromo.title);
  const [promoPriceEgp, setPromoPriceEgp] = useState(
    (initialPromo.promoPricePiasters / 100).toString(),
  );

  const [items, setItems] = useState<SuggestedPromotion["items"]>(() => [
    ...initialPromo.items,
  ]);

  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Compute original price from items
  const originalPricePiasters = useMemo(() => {
    return items.reduce((sum, it) => {
      const q = it.unit === "weight" ? it.quantityBase / 1000 : it.quantityBase;
      return sum + Math.round(it.regularPricePiasters * q);
    }, 0);
  }, [items]);

  const promoPricePiasters = useMemo(() => {
    const val = parseFloat(promoPriceEgp.trim());
    return isNaN(val) ? 0 : Math.round(val * 100);
  }, [promoPriceEgp]);

  const savingsPiasters = Math.max(
    0,
    originalPricePiasters - promoPricePiasters,
  );
  const savingsPercent =
    originalPricePiasters > 0
      ? Math.round((savingsPiasters / originalPricePiasters) * 100)
      : 0;

  // Filter products for picker
  const filteredProducts = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return allProducts
      .filter((p) => {
        // Exclude products already in items
        if (items.some((it) => it.productId === p.id)) return false;
        if (!q) return true;
        return (
          p.name_ar.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [allProducts, items, pickerQuery]);

  const handleAddItem = (product: StoreProductItem) => {
    const primaryVar = product.variants?.[0];
    const isWeight =
      product.unit === "weight" ||
      product.unit === "kg" ||
      product.unit === "g";
    const baseQty = isWeight ? 1000 : 1;
    const sellPrice =
      primaryVar?.sell_price_piasters || product.sell_price_piasters || 0;

    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        variantId: primaryVar?.id || product.id,
        productName: product.name_ar,
        quantityBase: baseQty,
        unit: product.unit || "piece",
        regularPricePiasters: sellPrice,
      },
    ]);
    setShowPicker(false);
    setPickerQuery("");
  };

  const handleUpdateQty = (index: number, delta: number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const step = item.unit === "weight" ? 250 : 1;
        const newQty = Math.max(step, item.quantityBase + delta * step);
        return { ...item, quantityBase: newQty };
      }),
    );
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert("يرجى كتابة عنوان العرض");
      return;
    }
    if (items.length === 0) {
      alert("العرض يجب أن يحتوي على صنف واحد على الأقل");
      return;
    }
    if (promoPricePiasters <= 0) {
      alert("يرجى تحديد سعر بيع صحيح للعرض");
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedPromo: SuggestedPromotion = {
        ...initialPromo,
        title: title.trim(),
        description: initialPromo.description || "",
        type: items.length > 1 ? "bundle" : "single_discount",
        items,
        originalPricePiasters,
        promoPricePiasters,
        savingsPiasters,
      };

      await onSaveAndPublish(updatedPromo);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر حفظ العرض";
      alert(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm("هل أنت متأكد من حذف هذا العرض بالكامل؟")) return;
    setIsSubmitting(true);
    try {
      await onDelete(initialPromo.id);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر حذف العرض";
      alert(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title="تعديل العرض الترويجي"
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <Button
              kind="dangerghost"
              icon="trash"
              onClick={handleDelete}
              disabled={isSubmitting}
            >
              حذف
            </Button>
          )}
          <span className={styles.sp} />
          <Button kind="ghost" onClick={onClose} disabled={isSubmitting}>
            إلغاء
          </Button>
          <Button
            kind="primary"
            icon="check"
            onClick={handleSave}
            loading={isSubmitting}
            disabled={items.length === 0 || promoPricePiasters <= 0}
          >
            حفظ ونشر في البيع
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {/* Section 1: Main Details */}
        <div className={styles.row2}>
          <Field label="اسم أو عنوان العرض">
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: كومبو عصير وبسكويت"
              autoFocus
            />
          </Field>

          <Field label="سعر البيع بعد الخصم">
            <Num
              value={promoPriceEgp}
              onChange={setPromoPriceEgp}
              suffix="ج.م"
              placeholder="0.00"
            />
          </Field>
        </div>

        {/* Section 2: Items in the bundle */}
        <div className={styles.secMini}>
          <Icon n="box" s={16} />
          <span>الأصناف المشمولة بالعرض ({items.length})</span>
        </div>

        <div className={styles.itemsHeader}>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => setShowPicker(!showPicker)}
          >
            <Icon n={showPicker ? "x" : "plus"} s={14} />
            <span>{showPicker ? "إلغاء البحث" : "إضافة صنف آخر"}</span>
          </button>
        </div>

        {/* Dropdown Product Search Picker */}
        {showPicker && (
          <div className={styles.pickerBox}>
            <SearchBox
              value={pickerQuery}
              onChange={setPickerQuery}
              placeholder="ابحث بالاسم لاختيار صنف..."
            />
            <div className={styles.pickerList}>
              {filteredProducts.length === 0 ? (
                <span
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink2)",
                    padding: "10px",
                    textAlign: "center",
                  }}
                >
                  لا توجد منتجات مطابقة للبحث
                </span>
              ) : (
                filteredProducts.map((prod) => (
                  <button
                    key={prod.id}
                    type="button"
                    className={styles.pickerOption}
                    onClick={() => handleAddItem(prod)}
                  >
                    <span>{prod.name_ar}</span>
                    <span className={styles.pickerOptionPrice}>
                      {formatMoney(prod.sell_price_piasters || 0)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Items List */}
        <div className={styles.itemsList}>
          {items.map((item, idx) => (
            <div key={`${item.productId}_${idx}`} className={styles.itemRow}>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{item.productName}</span>
                <span className={styles.itemSub}>
                  السعر الأصلي: {formatMoney(item.regularPricePiasters)}
                </span>
              </div>

              <div className={styles.itemControls}>
                <div className={styles.stepper}>
                  <button
                    type="button"
                    className={styles.stepperBtn}
                    onClick={() => handleUpdateQty(idx, -1)}
                    title="تقليل الكمية"
                  >
                    -
                  </button>
                  <span className={styles.stepperVal}>
                    {item.unit === "weight"
                      ? `${item.quantityBase >= 1000 ? item.quantityBase / 1000 : item.quantityBase} كجم`
                      : item.quantityBase}
                  </span>
                  <button
                    type="button"
                    className={styles.stepperBtn}
                    onClick={() => handleUpdateQty(idx, 1)}
                    title="زيادة الكمية"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  className={styles.delBtn}
                  onClick={() => handleRemoveItem(idx)}
                  title="حذف من العرض"
                >
                  <Icon n="trash" s={15} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Section 3: Summary / Calculations Pill */}
        <div className={styles.hintPill}>
          <div className={styles.hintNumbers}>
            <span>
              الأصلي:{" "}
              <span className={styles.hintOriginal}>
                {formatMoney(originalPricePiasters)}
              </span>
            </span>
            <span>
              بالعرض:{" "}
              <b className={styles.hintPromo}>
                {formatMoney(promoPricePiasters)}
              </b>
            </span>
          </div>
          <span className={styles.hintSavings}>
            وفرت {formatMoney(savingsPiasters)}{" "}
            {savingsPercent > 0 ? `(${savingsPercent}%)` : ""}
          </span>
        </div>
      </div>
    </Modal>
  );
}
