"use client";

import React, { useState, useMemo } from "react";
import { Modal, Field, Icon } from "../../shared/ui";
import styles from "./ProductsView.module.css";
import { normalizeArabic } from "@/domain/normalize";

export interface ServiceFormModalProps {
  product?: {
    id: string;
    name_ar: string;
    category: string;
    unit: string;
    sell_price_piasters: number;
    buy_cost_piasters?: number;
    brand_name?: string | null;
    is_custom?: boolean;
    variants?: Array<{
      id?: string;
      sell_price_piasters?: number;
    }>;
  } | null;
  existingServices?: Array<{ id: string; name_ar: string }>;
  presetCategory?: string;
  onClose: () => void;
  onSaved: (savedProduct: unknown) => void;
  onDeleted?: (productId: string) => void;
}

const SERVICE_CATEGORIES = [
  { value: "خدمات مرافق", label: "شحن مرافق (كهرباء/مياه/غاز)" },
  { value: "فواتير إنترنت", label: "فواتير إنترنت وتليفون" },
  { value: "كروت شحن", label: "كروت شحن" },
  { value: "تحويل أموال", label: "تحويل أموال ومحافظ" },
  { value: "شحن رصيد", label: "شحن رصيد على الهواء" },
  { value: "خدمات رقمية", label: "خدمات رقمية أخرى" },
] as const;

export function ServiceFormModal({
  product,
  existingServices,
  presetCategory = "خدمات مرافق",
  onClose,
  onSaved,
  onDeleted,
}: ServiceFormModalProps) {
  const [name, setName] = useState(product?.name_ar || "");
  const [category, setCategory] = useState(
    product?.category || presetCategory || "خدمات مرافق",
  );
  const [brandName, setBrandName] = useState(product?.brand_name || "");

  const [commissionModel, setCommissionModel] = useState<
    "fixed" | "percent" | "tiers"
  >("fixed");
  const [commissionValue, setCommissionValue] = useState(
    product ? (product.sell_price_piasters / 100).toString() : "5",
  );
  const [percentRate, setPercentRate] = useState("1.5");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isCard =
    category === "كروت شحن" ||
    category === "كروت مرافق" ||
    name.includes("كارت");

  // Contextual placeholder based on category
  const namePlaceholder = useMemo(() => {
    if (category === "كروت شحن") return "مثال: كارت شحن فودافون فكة 10";
    if (category === "خدمات مرافق")
      return "مثال: كارت شحن كهرباء، كارت مياه...";
    if (category === "فواتير إنترنت") return "مثال: باقة وي إنترنت منزلي سوبر";
    if (category === "تحويل أموال")
      return "مثال: تحويل فودافون كاش، إنستاباي...";
    if (category === "شحن رصيد") return "مثال: شحن رصيد فودافون على الهواء";
    return "مثال: كارت شحن فودافون 10، فاتورة نت وي...";
  }, [category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "اكتب اسم الخدمة أو الكارت";
    } else if (!product && existingServices && existingServices.length > 0) {
      const normInput = normalizeArabic(name.trim());
      const duplicate = existingServices.find(
        (s) => normalizeArabic(s.name_ar) === normInput,
      );
      if (duplicate) {
        newErrors.name = `هذه الخدمة «${duplicate.name_ar}» مسجلة بالفعل في قائمتك`;
      }
    }

    let sellPriceNum = 0;
    if (commissionModel === "fixed" || commissionModel === "tiers") {
      sellPriceNum = parseFloat(commissionValue) || 0;
    } else {
      sellPriceNum = parseFloat(percentRate) || 0;
    }

    if (isNaN(sellPriceNum) || sellPriceNum <= 0) {
      newErrors.price = isCard
        ? "اكتب سعر بيع الكارت"
        : "اكتب قيمة عمولة المحل";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const sellPricePiasters = Math.round(sellPriceNum * 100);
      const isCustom = product ? product.is_custom : true;

      const payload = {
        id: product?.id,
        nameAr: name.trim(),
        category,
        unit: "service" as const,
        sellPricePiasters,
        buyCostPiasters: null,
        isCustom,
        brandName: brandName.trim() || null,
        barcode: null,
        variants: [
          {
            id: product?.variants?.[0]?.id,
            flavor: null,
            sizeValue: 1,
            sizeUnit: "piece" as const,
            packQty: 1,
            sellPricePiasters,
            costPricePiasters: null,
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
          data.error?.message || "فشل حفظ الخدمة، برجاء المحاولة لاحقاً",
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
      if (!res.ok) throw new Error("فشل حذف الخدمة");
      if (onDeleted) onDeleted(product.id);
      onClose();
    } catch (err) {
      console.error("Delete failed:", err);
      alert("تعذر حذف الخدمة، برجاء المحاولة لاحقاً");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <>
      <Modal
        title={product ? "تعديل الخدمة / الكارت" : "إضافة خدمة أو كارت"}
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
                <span>حذف الخدمة</span>
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
                <span>{product ? "حفظ التعديلات" : "إضافة الخدمة"}</span>
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

          {/* اسم الخدمة أو الكارت */}
          <Field label="اسم الخدمة أو الكارت" err={errors.name}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={namePlaceholder}
              autoFocus={!product}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 14.5,
                background: "var(--sf)",
                color: "var(--ink)",
                boxSizing: "border-box",
              }}
            />
          </Field>

          {/* تصنيف الخدمة والمزود في شبكة متجاوبة */}
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
                  تصنيف الخدمة
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
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={styles.styledSelect}
                >
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                  {/* If custom category exists */}
                  {!SERVICE_CATEGORIES.some((c) => c.value === category) && (
                    <option value={category}>{category}</option>
                  )}
                </select>
                <span className={styles.selectArrow}>
                  <Icon n="down" s={14} />
                </span>
              </div>
            </div>

            <Field label="المزود أو الشركة">
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="مثال: فودافون، وي، فوري، شركة الكهرباء..."
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

          {/* طريقة احتساب عمولة المحل - بطاقات مدمجة متجاوبة */}
          <div style={{ marginTop: 2, marginBottom: 8 }}>
            <span
              style={{
                display: "block",
                fontSize: 12.5,
                fontWeight: 700,
                marginBottom: 6,
                color: "var(--ink2)",
              }}
            >
              طريقة احتساب عمولة المحل:
            </span>
            <div className={styles.commissionGrid}>
              <button
                type="button"
                className={`${styles.commissionCard} ${commissionModel === "fixed" ? styles.active : ""}`}
                onClick={() => setCommissionModel("fixed")}
              >
                <Icon n="wallet" s={16} />
                <span className={styles.commissionTitle}>مبلغ ثابت (ج.م)</span>
              </button>
              <button
                type="button"
                className={`${styles.commissionCard} ${commissionModel === "percent" ? styles.active : ""}`}
                onClick={() => setCommissionModel("percent")}
              >
                <span style={{ fontSize: 16, fontWeight: 800 }}>%</span>
                <span className={styles.commissionTitle}>نسبة مئوية (%)</span>
              </button>
              <button
                type="button"
                className={`${styles.commissionCard} ${commissionModel === "tiers" ? styles.active : ""}`}
                onClick={() => setCommissionModel("tiers")}
              >
                <Icon n="layers" s={16} />
                <span className={styles.commissionTitle}>شرائح مبالغ</span>
              </button>
            </div>
          </div>

          {/* قيمة العمولة أو السعر حسب النموذج المختار */}
          {commissionModel === "fixed" && (
            <Field
              label={isCard ? "سعر بيع الكارت (ج.م)" : "قيمة عمولة المحل (ج.م)"}
              err={errors.price}
            >
              <div className={styles.inputWithBadge}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={commissionValue}
                  onChange={(e) => setCommissionValue(e.target.value)}
                  placeholder="5"
                />
                <span className={styles.inputBadge}>ج.م</span>
              </div>
            </Field>
          )}

          {commissionModel === "percent" && (
            <Field label="نسبة العمولة من قيمة المعاملة (%)" err={errors.price}>
              <div className={styles.inputWithBadge}>
                <input
                  type="number"
                  step="any"
                  min="0.1"
                  max="100"
                  value={percentRate}
                  onChange={(e) => setPercentRate(e.target.value)}
                  placeholder="1.5"
                />
                <span className={styles.inputBadge}>%</span>
              </div>
            </Field>
          )}

          {commissionModel === "tiers" && (
            <Field label="قيمة العمولة الأساسية (ج.م)" err={errors.price}>
              <div className={styles.inputWithBadge}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={commissionValue}
                  onChange={(e) => setCommissionValue(e.target.value)}
                  placeholder="5"
                />
                <span className={styles.inputBadge}>ج.م</span>
              </div>
            </Field>
          )}

          {/* تنبيه تنظيمي خفيف */}
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink2)",
              marginTop: 6,
              lineHeight: 1.5,
              background: "var(--sf2)",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--line)",
            }}
          >
            ℹ️ تطبيق «حِسبة» يقوم بحساب وتسجيل العمولات وأرباح المحل، ولا يقوم
            بتنفيذ أي تحويلات بنكية أو معاملات دفع نقدي فعلي عبر الشبكات.
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <Modal
          title="حذف الخدمة"
          onClose={() => setShowDeleteConfirm(false)}
          footer={
            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <button
                type="button"
                className={styles.modalFooterBtnCancel}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                إلغاء
              </button>
              <button
                type="button"
                className={styles.modalFooterBtnDelete}
                onClick={handleDelete}
                disabled={isDeleting}
                style={{ flex: 1 }}
              >
                {isDeleting ? "جارٍ الحذف..." : "تأكيد الحذف النهائي"}
              </button>
            </div>
          }
        >
          <div style={{ padding: "8px 0", fontSize: 14, color: "var(--ink)" }}>
            هل أنت متأكد من رغبتك في حذف <b>{name}</b> من قائمة الخدمات؟
          </div>
        </Modal>
      )}
    </>
  );
}
