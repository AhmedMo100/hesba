"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import styles from "./Toast.module.css";
import { Icon } from "../Icon/Icon";
import { useGhost } from "../../hooks/useGhost";
import { t } from "../../i18n";

export interface ToastOptions {
  id?: string;
  msg: string;
  kind?: "ok" | "err";
  undo?: () => void;
  ms?: number;
}

interface ToastItemData extends ToastOptions {
  id: string;
  kind: "ok" | "err";
  ms: number;
  key: number;
}

export interface ToastContextValue {
  show: (options: ToastOptions) => string;
  remove: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

function ToastItemComponent({
  item,
  onRemove,
}: {
  item: ToastItemData;
  onRemove: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useGhost(ref, "out");

  const isErr = item.kind === "err";

  return (
    <div
      ref={ref}
      className={`${styles.toast} ${isErr ? styles.err : ""}`}
      role="status"
    >
      <span className={styles.tIcon}>
        <Icon n={isErr ? "alert" : "check"} s={16} sw={2.6} />
      </span>
      <span className={styles.msg}>{item.msg}</span>
      {item.undo && (
        <button
          type="button"
          className={styles.undoBtn}
          onClick={() => {
            item.undo?.();
            onRemove(item.id);
          }}
        >
          <Icon n="undo" s={16} />
          {t("common.undo")}
        </button>
      )}
      <i
        className={styles.tbar}
        style={{ animationDuration: `${item.ms}ms` }}
        aria-hidden="true"
      />
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<ToastItemData[]>([]);
  const timers = useRef<Record<string, NodeJS.Timeout>>({});

  const remove = useCallback((id: string) => {
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
    setList((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      const id =
        options.id || `toast-${Math.random().toString(36).slice(2, 9)}`;
      const ms = options.ms || (options.undo ? 5000 : 3000);

      if (timers.current[id]) {
        clearTimeout(timers.current[id]);
      }

      timers.current[id] = setTimeout(() => {
        remove(id);
      }, ms);

      const newItem: ToastItemData = {
        id,
        msg: options.msg,
        kind: options.kind || "ok",
        undo: options.undo,
        ms,
        key: Date.now(),
      };

      setList((prev) => {
        const existingIndex = prev.findIndex((x) => x.id === id);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = newItem;
          return next;
        }
        // Keep at most 2 toasts visible, with newest on bottom
        return [...prev.slice(-1), newItem];
      });

      return id;
    },
    [remove],
  );

  const value = useMemo(() => ({ show, remove }), [show, remove]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.toasts} aria-live="polite">
        {list.map((item) => (
          <ToastItemComponent key={item.key} item={item} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
