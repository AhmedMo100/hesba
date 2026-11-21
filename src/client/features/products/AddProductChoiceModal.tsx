"use client";

/**
 * @file AddProductChoiceModal.tsx
 * @description V19 addMenu — what «+ جديد» opens: «إيه اللي عاوز تضيفه؟» → an offer, a
 * sandwich (the recipe form, ADR-0018) or a new product (the product form).
 */

import React from "react";
import { Modal } from "@/client/shared/ui";
import f from "./ProductFormModal.module.css";
import o from "./OfferSheet.module.css";

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
    <Modal title="إيه اللي عاوز تضيفه؟" onClose={onClose}>
      <div className={o.choice} data-testid="add-choice">
        {onChooseOffer && (
          <button
            type="button"
            className={f.btn}
            onClick={onChooseOffer}
            data-testid="add-choice-offer"
          >
            🎁 عرض
          </button>
        )}
        <button
          type="button"
          className={`${f.btn} ${o.gold}`}
          onClick={onChooseSandwich}
          data-testid="add-choice-sandwich"
        >
          🥪 ساندوتش
        </button>
        <button
          type="button"
          className={`${f.btn} ${f.ghost}`}
          onClick={onChooseNormal}
          data-testid="add-choice-normal"
        >
          📦 منتج جديد
        </button>
        <button
          type="button"
          className={`${f.btn} ${f.ghost}`}
          onClick={onClose}
        >
          إلغاء
        </button>
      </div>
    </Modal>
  );
}
