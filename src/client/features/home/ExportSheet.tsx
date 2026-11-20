"use client";

/**
 * @file ExportSheet.tsx
 * @description «تصدير ومشاركة» for التقارير and الجرد (V19 sheet). The file is made on the
 * server as soon as the sheet opens (Excel or CSV), then: «شارك الملف» opens the phone's share
 * sheet with the file itself (WhatsApp is one of its choices) where the browser supports it;
 * otherwise the file is downloaded and the owner is told how to send it. «ابعت الملخص» sends a
 * text summary on WhatsApp. The screen never says the file was sent to WhatsApp — only what
 * really happened (shared from the sheet, cancelled, downloaded).
 */

import React, { useEffect, useState } from "react";
import { Modal } from "@/client/shared/ui";
import {
  canShareFile,
  downloadFile,
  fetchExport,
  shareFile,
  whatsappTextUrl,
  type ExportedFile,
} from "@/client/shared/api/export-file";
import styles from "./HomeView.module.css";

export interface ExportSheetProps {
  title: string;
  /** The server's export URL without `format` (it is added here). */
  url: string;
  fallbackName: string;
  onClose: () => void;
}

const kb = (bytes: number) =>
  bytes < 1024 ? `${bytes} بايت` : `${Math.round(bytes / 1024)} ك.ب`;

export function ExportSheet({
  title,
  url,
  fallbackName,
  onClose,
}: ExportSheetProps) {
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [ready, setReady] = useState<ExportedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Make the file as soon as the sheet opens (and again for another format), so «شارك»
  // can open the share sheet straight from the tap.
  useEffect(() => {
    let alive = true;
    const sep = url.includes("?") ? "&" : "?";
    fetchExport(`${url}${sep}format=${format}`, `${fallbackName}.${format}`)
      .then((f) => {
        if (!alive) return;
        setReady(f);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setReady(null);
        setError(e instanceof Error ? e.message : "مقدرناش نجهّز الملف");
      });
    return () => {
      alive = false;
    };
  }, [url, format, fallbackName, attempt]);

  const pick = (f: "xlsx" | "csv") => {
    if (f === format) return;
    setReady(null);
    setStatus(null);
    setFormat(f);
  };

  const share = async () => {
    if (!ready) return;
    setStatus(null);
    if (!canShareFile(ready.file)) {
      downloadFile(ready.file);
      setStatus(
        "المتصفح ده مش بيقدر يشارك ملفات، فالملف اتنزّل على الجهاز. ابعته من واتساب: 📎 ← مستند ← اختار الملف من التنزيلات.",
      );
      return;
    }
    try {
      const r = await shareFile(ready.file, ready.summary || title);
      setStatus(
        r === "shared"
          ? "اتشارك الملف من شاشة المشاركة ✅"
          : "اتقفلت شاشة المشاركة من غير ما يتبعت حاجة.",
      );
    } catch {
      downloadFile(ready.file);
      setStatus(
        "المشاركة ما اشتغلتش على الجهاز ده، فالملف اتنزّل بدالها. ابعته من واتساب: 📎 ← مستند.",
      );
    }
  };

  return (
    <Modal title={`📤 ${title}`} onClose={onClose}>
      <div className={styles.exportSheet} data-testid="export-sheet">
        <div className={styles.lbl}>الصيغة</div>
        <div className={styles.chips}>
          {(
            [
              ["xlsx", "Excel (.xlsx)"],
              ["csv", "CSV"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`${styles.chip} ${format === k ? styles.chipOn : ""}`}
              onClick={() => pick(k)}
              data-testid={`export-format-${k}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.sumbox} data-testid="export-file">
          {error ? (
            <div className={styles.warn} role="alert">
              {error}{" "}
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setAttempt((n) => n + 1)}
              >
                جرّب تاني
              </button>
            </div>
          ) : ready ? (
            <div className={styles.line}>
              <span dir="auto">📄 {ready.file.name}</span>
              <b>{kb(ready.file.size)}</b>
            </div>
          ) : (
            <div className={styles.note}>بيتجهّز الملف…</div>
          )}
        </div>

        <button
          type="button"
          className={styles.btn}
          disabled={!ready}
          onClick={() => void share()}
          data-testid="export-share"
        >
          📤 شارك الملف (واتساب وغيره)
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          disabled={!ready}
          onClick={() => {
            if (!ready) return;
            downloadFile(ready.file);
            setStatus("الملف اتنزّل على الجهاز.");
          }}
          data-testid="export-download"
        >
          ⬇️ نزّل الملف
        </button>
        {ready?.summary && (
          <a
            className={`${styles.btn} ${styles.btnGhost}`}
            href={whatsappTextUrl(ready.summary)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="export-whatsapp-text"
          >
            💬 ابعت الملخص على واتساب (نص من غير الملف)
          </a>
        )}
        {status && (
          <p className={styles.note} role="status" data-testid="export-status">
            {status}
          </p>
        )}
      </div>
    </Modal>
  );
}
