"use client";

import React, { useEffect, useRef } from "react";
import styles from "./Modal.module.css";
import { Icon } from "../Icon/Icon";
import { useGhost } from "../../hooks/useGhost";
import { t } from "../../i18n";

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, footer }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useGhost(overlayRef, "out");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.body.classList.add("lock");

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("lock");
    };
  }, [onClose]);

  const handleFocus = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement;
    if (/INPUT|SELECT|TEXTAREA/.test(target.tagName)) {
      setTimeout(() => {
        try {
          target.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch {
          // Ignore
        }
      }, 280);
    }
  };

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className={styles.ov}
      ref={overlayRef}
      onFocus={handleFocus}
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.grab} aria-hidden="true" />
        <div className={styles.shHeader}>
          <h3>{title}</h3>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <Icon n="x" s={20} />
          </button>
        </div>
        <div className={styles.shBody}>{children}</div>
        {footer && <div className={styles.shFooter}>{footer}</div>}
      </div>
    </div>
  );
}
