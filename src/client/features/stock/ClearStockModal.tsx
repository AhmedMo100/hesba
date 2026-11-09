"use client";

import React, { useState } from "react";
import { Modal, Button, Field } from "@/client/shared/ui";
import type { StockInventoryItem } from "@/client/shared/store-items";

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

  const [reason, setReason] = useState("عجز جرد وتصفير رصيد");
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
          removeFromView: false,
          reason,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "فشل تصفير المخزون");
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
      title="تصفير المخزون"
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
            {isSubmitting ? "جاري التصفير..." : "تأكيد تصفير المخزون"}
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
            بالكامل (الرصيد الحالي بالمخزن: <b>{formattedStock}</b>).
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
            سيتم تصفير جميع التشغيلات الحالية في المخزن وتسجيل حركة تسوية
            (adjustment).
          </li>
          <li>
            يظل المنتج موجوداً في قائمة المخزون بحالة <b>خلصان (0)</b>.
          </li>
          <li>لن يتم حذف أي فواتير بيع أو مشتريات تاريخية خاصة بالصنف.</li>
        </ul>

        {/* Reason */}
        <Field label="سبب تصفير المخزون">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              fontSize: 14,
              boxSizing: "border-box",
              background: "var(--card-bg, #1e241e)",
              color: "var(--ink)",
              marginBottom: 8,
            }}
          >
            <option value="عجز جرد وتصفير رصيد">عجز جرد وتصفير رصيد</option>
            <option value="تلف وهالك بالكامل">تلف وهالك بالكامل</option>
            <option value="انتهاء صلاحية">انتهاء صلاحية</option>
            <option value="تسوية مخزنية دورية">تسوية مخزنية دورية</option>
            <option value="أخرى">سبب آخر (اكتبه بالأسفل)</option>
          </select>
          {reason === "أخرى" && (
            <input
              type="text"
              placeholder="اكتب سبب التصفير..."
              onChange={(e) => setReason(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          )}
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
