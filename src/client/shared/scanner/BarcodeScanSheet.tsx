"use client";

/**
 * @file BarcodeScanSheet.tsx
 * @description The barcode scanner (V19 #scanSheet), shared by Stock, the product form and
 * Sales. The camera opens as soon as the sheet opens — the browser asks for permission only
 * the first time — and decodes on the device (`BarcodeDetector`): no AI, no quota, no network.
 * A physical (keyboard) scanner works while it is open. The camera stops when the sheet
 * closes, the screen unmounts or the page is hidden.
 *
 * The parent decides what a code means: it receives each new code (the same code is ignored
 * for 2 s) and shows the result under the camera (`children`), pausing decoding meanwhile.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/client/shared/ui";
import styles from "./BarcodeScanSheet.module.css";

const FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
  "qr_code",
];
const REPEAT_MS = 2000;

type Detector = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
};
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

export interface BarcodeScanSheetProps {
  title?: string;
  /** A new code was read (camera, physical scanner, or typed). */
  onCode: (code: string) => void;
  onClose: () => void;
  /** Stop decoding while the parent shows a result (the camera stays open). */
  paused?: boolean;
  /** The result of the last code and its actions, under the camera. */
  children?: React.ReactNode;
  /** Shown with the typed fallback when the camera cannot be used (e.g. «سجّل يدوي»). */
  fallbackAction?: { label: string; onClick: () => void; testId?: string };
}

export function BarcodeScanSheet({
  title = "📷 امسح الباركود",
  onCode,
  onClose,
  paused = false,
  children,
  fallbackAction,
}: BarcodeScanSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("بنفتح الكاميرا…");
  const [fallback, setFallback] = useState(false);
  const [typed, setTyped] = useState("");
  const pausedRef = useRef(paused);
  const onCodeRef = useRef(onCode);
  const onCloseRef = useRef(onClose);
  const last = useRef({ code: "", at: 0 });

  useEffect(() => {
    pausedRef.current = paused;
    onCodeRef.current = onCode;
    onCloseRef.current = onClose;
  });

  const emit = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < REPEAT_MS) return;
    last.current = { code, at: now };
    onCodeRef.current(code);
  }, []);

  // ─── The camera: opened on mount, always stopped on the way out ───
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const stop = () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor })
        .BarcodeDetector;
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage("الكاميرا مش متاحة في المتصفح ده. اكتب الباركود.");
        setFallback(true);
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = videoRef.current;
        if (v) {
          v.srcObject = s;
          await v.play().catch(() => {});
        }
        if (!Ctor) {
          setMessage(
            "الكاميرا شغالة، بس المتصفح ده مش بيقرا الباركود. اكتبه أو استخدم قارئ الباركود.",
          );
          setFallback(true);
          return;
        }
        setMessage("وجّه الكاميرا على الباركود");
        let detector: Detector;
        try {
          detector = new Ctor({ formats: FORMATS });
        } catch {
          detector = new Ctor({ formats: ["ean_13", "code_128"] });
        }
        timer = setInterval(async () => {
          const video = videoRef.current;
          if (pausedRef.current || !video || video.readyState < 2) return;
          try {
            const found = await detector.detect(video);
            if (found[0]?.rawValue && !stopped) emit(found[0].rawValue);
          } catch {
            // A frame that could not be read: try the next one.
          }
        }, 350);
      } catch (err) {
        const denied =
          err instanceof DOMException && err.name === "NotAllowedError";
        setMessage(
          denied
            ? "الكاميرا مقفولة للموقع ده. اسمح بيها من إعدادات المتصفح، أو اكتب الباركود."
            : "ما قدرناش نفتح الكاميرا. اكتب الباركود يدوي.",
        );
        setFallback(true);
      }
    };

    void start();
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        stop();
        onCloseRef.current();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      stop();
    };
  }, [emit]);

  // ─── A physical scanner: fast keystrokes ending with Enter ───
  useEffect(() => {
    let buffer = "";
    let reset: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Enter") {
        if (buffer.length >= 4) {
          // The scanner's Enter must not also press the focused button (e.g. close).
          e.preventDefault();
          e.stopPropagation();
          emit(buffer);
        }
        buffer = "";
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
        if (reset) clearTimeout(reset);
        reset = setTimeout(() => (buffer = ""), 100);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (reset) clearTimeout(reset);
    };
  }, [emit]);

  const submitTyped = () => {
    const code = typed.trim();
    if (!code) return;
    last.current = { code: "", at: 0 };
    emit(code);
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className={styles.body} data-testid="barcode-scan-sheet">
        <video
          ref={videoRef}
          className={styles.video}
          playsInline
          muted
          data-testid="barcode-video"
        />
        <div className={styles.note} role="status" data-testid="scan-msg">
          {message}
        </div>
        {children}
        {fallback && !paused && (
          <div data-testid="scan-fallback">
            <label className={styles.lbl} htmlFor="scan-typed">
              اكتب الباركود
            </label>
            <input
              id="scan-typed"
              className={styles.input}
              inputMode="numeric"
              placeholder="مثلاً 6221000000011"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitTyped()}
              data-testid="scan-typed"
            />
            <button
              type="button"
              className={styles.btn}
              onClick={submitTyped}
              data-testid="scan-typed-ok"
            >
              تمام
            </button>
            {fallbackAction && (
              <button
                type="button"
                className={`${styles.btn} ${styles.ghost}`}
                onClick={fallbackAction.onClick}
                data-testid={fallbackAction.testId}
              >
                {fallbackAction.label}
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          className={`${styles.btn} ${styles.ghost}`}
          onClick={onClose}
          data-testid="scan-cancel"
        >
          إلغاء
        </button>
      </div>
    </Modal>
  );
}

export default BarcodeScanSheet;
