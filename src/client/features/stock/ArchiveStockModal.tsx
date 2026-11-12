"use client";

import React, { useState } from "react";
import { Modal, Button } from "@/client/shared/ui";
import type { StockInventoryItem } from "@/client/shared/store-items";

export interface ArchiveStockModalProps {
  item: StockInventoryItem;
  onClose: () => void;
  onArchived: () => void;
  onOpenClearStock?: () => void;
}

export function ArchiveStockModal({
  item,
  onClose,
  onArchived,
  onOpenClearStock,
}: ArchiveStockModalProps) {
  const isWeight = item.unitMode === "weight";
  const packQty = item.packQty || 1;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formattedStock = isWeight
    ? `${(item.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`
    : packQty > 1
      ? `${Math.floor(item.currentStockBase / packQty)} كرتونة و ${item.currentStockBase % packQty} قطعة`
      : `${item.currentStockBase} قطعة`;

  const hasPositiveStock = item.currentStockBase > 0;

  const handleArchive = async () => {
    if (hasPositiveStock) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "archive",
          storeVariantId: item.variantId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error?.message || "فشل إزالة الصنف من قائمة المخزون النشطة",
        );
      }

      onArchived();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title="إزالة الصنف من قائمة المخزون"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          {hasPositiveStock ? (
            <>
              {onOpenClearStock && (
                <Button
                  kind="primary"
                  size="lg"
                  type="button"
                  onClick={onOpenClearStock}
                  style={{ flex: 1 }}
                >
                  تصفير المخزون أولاً
                </Button>
              )}
              <Button
                kind="soft"
                size="lg"
                type="button"
                onClick={onClose}
                style={{ flex: onOpenClearStock ? "none" : 1 }}
              >
                إغلاق
              </Button>
            </>
          ) : (
            <>
              <Button
                kind="danger"
                size="lg"
                type="button"
                disabled={isSubmitting}
                onClick={handleArchive}
                style={{ flex: 1 }}
              >
                {isSubmitting ? "جاري الإزالة..." : "تأكيد الإزالة من المخزون"}
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
            </>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {hasPositiveStock ? (
          /* Blocker Notice: Current stock is positive */
          <div
            style={{
              padding: "14px 16px",
              background: "rgba(224, 140, 36, 0.1)",
              border: "1.5px solid rgba(224, 140, 36, 0.35)",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <b style={{ fontSize: 15, color: "var(--amber, #e08c24)" }}>
              ⚠️ لا يمكن إزالة الصنف لأن رصيده موجب
            </b>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                color: "var(--ink)",
                lineHeight: 1.6,
              }}
            >
              الرصيد الحالي بالمخزن لصنف{" "}
              <b>
                {item.productName} {item.flavor ? `(${item.flavor})` : ""}
              </b>{" "}
              هو <b>{formattedStock}</b>.
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--ink2)",
                lineHeight: 1.5,
              }}
            >
              لحماية دقة الجرد وحسابات المحل من فقدان البضاعة أو إخفائها، يجب
              تصفير رصيد الصنف أولاً قبل حذفه من قائمة المخزون النشطة.
            </p>
          </div>
        ) : (
          /* Confirmation Notice: Current stock is 0 */
          <>
            <div
              style={{
                padding: "12px 14px",
                background: "rgba(100, 150, 100, 0.08)",
                border: "1px solid rgba(100, 150, 100, 0.25)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <b style={{ fontSize: 15, color: "var(--ink)" }}>
                إخفاء من قائمة المخزون اليومية
              </b>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "var(--ink2)",
                  lineHeight: 1.5,
                }}
              >
                أنت على وشك إزالة{" "}
                <b>
                  {item.productName} {item.flavor ? `(${item.flavor})` : ""}
                </b>{" "}
                (رصيده الحالي 0) من قائمة المخزون النشطة حتى لا يشغل مساحة في
                الشاشة.
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
                المنتج يظل محفوظاً في قائمة المنتجات ويمكن إعادة توريده في أي
                وقت.
              </li>
              <li>لا يتم حذف أي تشغيلات أو حركات تاريخية خاصة بالصنف.</li>
              <li>
                بمجرد إضافة بضاعة جديدة للمنتج مستقبلاً، سيظهر تلقائياً في قائمة
                المخزون مرة أخرى.
              </li>
            </ul>
          </>
        )}

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
      </div>
    </Modal>
  );
}

export default ArchiveStockModal;
