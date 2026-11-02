"use client";

import React, { useState } from "react";
import { Modal, Button, Field } from "../../shared/ui";
import type { StockInventoryItem } from "./StockView";

export interface ClearStockModalProps {
  item: StockInventoryItem;
  onClose: () => void;
  onCleared: () => void;
}

export function ClearStockModal({
  item,
  onClose,
  onCleared,
}: ClearStockModalProps) {
  const isWeight = item.unitMode === "weight";
  const packQty = item.packQty || 1;

  const [removeFromView, setRemoveFromView] = useState(true);
  const [reason, setReason] = useState("تصفير وإزالة الصنف من قائمة المخزون");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formattedStock = isWeight
    ? `${(item.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`
    : packQty > 1
      ? `${Math.floor(item.currentStockBase / packQty)} كرتونة و ${item.currentStockBase % packQty} قطعة`
      : `${item.currentStockBase} قطعة`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear",
          storeVariantId: item.variantId,
          removeFromView,
          reason,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "فشل إزالة الصنف من المخزون");
      }

      onCleared();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title="إزالة وتصفير المخزون"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          <Button
            kind="danger"
            size="lg"
            type="submit"
            disabled={isSubmitting}
            onClick={handleSubmit}
            style={{ flex: 1 }}
          >
            {isSubmitting ? "جاري الإزالة..." : "تأكيد الإزالة والتصفير"}
          </Button>
          <Button
            kind="soft"
            size="lg"
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
          >
            إلغاء
          </Button>
        </div>
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div
          style={{
            padding: "12px 14px",
            background: "rgba(207, 60, 60, 0.06)",
            border: "1px solid rgba(207, 60, 60, 0.2)",
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <b style={{ fontSize: 15, color: "var(--red, #cf3c3c)" }}>
            تنبيه هام قبل تصفير المخزون
          </b>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--ink)",
              lineHeight: 1.5,
            }}
          >
            أنت على وشك تصفير رصيد{" "}
            <b>
              {item.productName} {item.flavor ? `(${item.flavor})` : ""}
            </b>{" "}
            بالكامل (الرصيد الحالي: <b>{formattedStock}</b>).
          </p>
        </div>

        <ul
          style={{
            margin: 0,
            paddingRight: 20,
            fontSize: 13,
            color: "var(--ink2)",
            lineHeight: 1.6,
          }}
        >
          <li>
            سيتم تصفير جميع التشغيلات الحالية في المخزن وتسجيل حركة تسوية.
          </li>
          <li>لن يتم حذف أي فواتير بيع أو مشتريات تاريخية خاصة بالمنتج.</li>
          <li>
            المنتج يظل مسجلًا في قاعدة البيانات ويمكن إعادة إضافته في أي وقت.
          </li>
        </ul>

        {/* Checkbox: Remove from active view */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--ink)",
            padding: "8px 0",
          }}
        >
          <input
            type="checkbox"
            checked={removeFromView}
            onChange={(e) => setRemoveFromView(e.target.checked)}
            style={{
              width: 18,
              height: 18,
              accentColor: "var(--red, #cf3c3c)",
            }}
          />
          <span>إخفاء الصنف من شاشة المخزون الحالية</span>
        </label>

        {/* Reason */}
        <Field label="سبب الإزالة أو التصفير">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: توقف التعامل مع الصنف، تالف..."
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </Field>

        {error && (
          <div
            style={{
              color: "var(--red, #cf3c3c)",
              fontSize: 13,
              fontWeight: 700,
              background: "rgba(207, 60, 60, 0.08)",
              padding: "8px 12px",
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
export default ClearStockModal;
