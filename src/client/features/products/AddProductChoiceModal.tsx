"use client";

/**
 * @file AddProductChoiceModal.tsx
 * @description What "إضافة منتج" opens: pick a normal product (the existing product form,
 * unchanged) or a sandwich (the recipe form, ADR-0018).
 */

import React from "react";
import { Modal, Icon } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import styles from "./SandwichFormModal.module.css";

interface AddProductChoiceModalProps {
  onClose: () => void;
  onChooseNormal: () => void;
  onChooseSandwich: () => void;
  /** V19 «🎁 عرض»: a new offer (optional where offers are not managed). */
  onChooseOffer?: () => void;
}

export function AddProductChoiceModal({
  onClose,
  onChooseNormal,
  onChooseSandwich,
  onChooseOffer,
}: AddProductChoiceModalProps) {
  return (
    <Modal title={t("sandwich.chooseTitle")} onClose={onClose}>
      <div className={styles.choiceList}>
        {onChooseOffer && (
          <button
            type="button"
            className={styles.choiceBtn}
            onClick={onChooseOffer}
            data-testid="add-choice-offer"
          >
            <span className={styles.choiceIcon} aria-hidden="true">
              🎁
            </span>
            <span className={styles.choiceText}>
              <b>عرض</b>
              <small>خصم أو مجموعة منتجات بسعر واحد</small>
            </span>
          </button>
        )}
        <button
          type="button"
          className={styles.choiceBtn}
          onClick={onChooseNormal}
          data-testid="add-choice-normal"
        >
          <span className={styles.choiceIcon} aria-hidden="true">
            <Icon n="box" s={22} />
          </span>
          <span className={styles.choiceText}>
            <b>{t("sandwich.chooseNormal")}</b>
            <small>{t("sandwich.chooseNormalSub")}</small>
          </span>
        </button>
        <button
          type="button"
          className={styles.choiceBtn}
          onClick={onChooseSandwich}
          data-testid="add-choice-sandwich"
        >
          <span className={styles.choiceIcon} aria-hidden="true">
            <Icon n="layers" s={22} />
          </span>
          <span className={styles.choiceText}>
            <b>{t("sandwich.chooseSandwich")}</b>
            <small>{t("sandwich.chooseSandwichSub")}</small>
          </span>
        </button>
      </div>
    </Modal>
  );
}
