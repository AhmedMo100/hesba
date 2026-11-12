"use client";

/**
 * @file SandwichQuantitySheet.tsx
 * @description The quantity step opened by "إضافة إلى البيع" on a sandwich card. Nothing is
 * saved while it is open; "تأكيد البيع" records ONE sale of N sandwiches through the existing
 * sandwich sale (`POST /api/sales`), which deducts every ingredient once, atomically.
 * Cancelling saves nothing and deducts nothing.
 */

import React, { useState } from "react";
import { Modal, Button, Icon, Alert } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import {
  checkSandwichQuantity,
  parseSaleQuantity,
  stepQuantity,
} from "./sandwich-quantity";
import styles from "./SandwichQuantitySheet.module.css";

export interface QuantitySheetSandwich {
  id: string;
  name: string;
  sellPricePiasters: number;
  availableCount: number;
}

interface SandwichQuantitySheetProps {
  sandwich: QuantitySheetSandwich;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (quantity: number) => void;
}

export function SandwichQuantitySheet({
  sandwich,
  busy,
  error,
  onCancel,
  onConfirm,
}: SandwichQuantitySheetProps) {
  const [text, setText] = useState("1");
  const check = checkSandwichQuantity(
    text,
    sandwich.sellPricePiasters,
    sandwich.availableCount,
  );
  const current = parseSaleQuantity(text);
  const outOfStock = sandwich.availableCount < 1;

  const setStep = (delta: 1 | -1) =>
    setText(String(stepQuantity(current, delta, sandwich.availableCount)));

  return (
    <Modal
      title={t("sandwichSale.title")}
      onClose={() => !busy && onCancel()}
      footer={
        <div className={styles.footer}>
          <Button
            kind="ghost"
            onClick={onCancel}
            disabled={busy}
            data-testid="sandwich-qty-cancel"
          >
            {t("sandwichSale.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="cart"
            className={styles.confirm}
            busy={busy}
            disabled={!check.ok}
            onClick={() => check.ok && onConfirm(check.quantity)}
            data-testid="sandwich-qty-confirm"
          >
            {check.ok
              ? t("sandwichSale.confirm", {
                  amount: formatMoney(check.totalPiasters),
                })
              : t("sandwichSale.confirmPlain")}
          </Button>
        </div>
      }
    >
      <div className={styles.body} data-testid="sandwich-qty-sheet">
        <div className={styles.head}>
          <b className={styles.name}>{sandwich.name}</b>
          <span className={styles.price}>
            {t("sandwichSale.unitPrice", {
              amount: formatMoney(sandwich.sellPricePiasters),
            })}
          </span>
          <span className={styles.available}>
            {outOfStock
              ? t("sandwich.notEnough")
              : t("sandwich.canMake", { count: sandwich.availableCount })}
          </span>
        </div>

        <div
          className={styles.stepper}
          role="group"
          aria-label={t("sandwichSale.quantity")}
        >
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => setStep(1)}
            disabled={
              busy || outOfStock || (current ?? 0) >= sandwich.availableCount
            }
            aria-label={t("sandwichSale.more")}
            data-testid="sandwich-qty-plus"
          >
            <Icon n="plus" s={22} />
          </button>
          <input
            className={styles.qty}
            inputMode="numeric"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            aria-label={t("sandwichSale.quantity")}
            disabled={busy}
            data-testid="sandwich-qty-input"
          />
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => setStep(-1)}
            disabled={busy || (current ?? 1) <= 1}
            aria-label={t("sandwichSale.less")}
            data-testid="sandwich-qty-minus"
          >
            <span className={styles.minus} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.total}>
          <span>{t("sandwichSale.total")}</span>
          <b data-testid="sandwich-qty-total">
            {check.ok ? formatMoney(check.totalPiasters) : "—"}
          </b>
        </div>

        {!check.ok && check.reason !== "invalid" && (
          <p className={styles.warn} role="alert">
            {check.reason === "not_enough"
              ? t("sandwichSale.notEnough", { count: sandwich.availableCount })
              : t("sandwichSale.tooMany")}
          </p>
        )}
        {!check.ok && check.reason === "invalid" && text.trim() !== "" && (
          <p className={styles.warn} role="alert">
            {t("sandwichSale.invalid")}
          </p>
        )}
        <p className={styles.note}>{t("sandwichSale.note")}</p>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
