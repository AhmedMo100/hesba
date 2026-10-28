"use client";

import React, { useState, useEffect } from "react";
import styles from "./PinLockScreen.module.css";
import { Button, Field, Icon } from "../ui";
import { useTranslation } from "../i18n";
import { authApi } from "../api";

export interface PinLockScreenProps {
  onUnlock: () => void;
  onLogout?: () => void;
  onTriggerRecovery?: () => void;
}

export function PinLockScreen({
  onUnlock,
  onLogout,
  onTriggerRecovery,
}: PinLockScreenProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(() => {
    return typeof window !== "undefined"
      ? authApi.getPinLockoutRemainingSeconds()
      : 0;
  });

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setErr("");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const handleUnlock = async () => {
    if (lockoutSeconds > 0) return;

    if (pin.length !== 6) {
      setErr(t("errors.pinLength"));
      return;
    }

    setBusy(true);
    setErr("");
    try {
      const ok = await authApi.verifyPin(pin);
      if (ok) {
        onUnlock();
      } else {
        const remaining = authApi.getPinLockoutRemainingSeconds();
        if (remaining > 0) {
          setLockoutSeconds(remaining);
          setErr(t("auth.pinLockedOut", { seconds: String(remaining) }));
        } else {
          setErr(t("errors.wrongPin"));
        }
      }
    } catch {
      setErr(t("errors.wrongPin"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.card}>
        <div className={styles.iconBox}>
          <Icon n="check" s={28} />
        </div>
        <h2 className={styles.title}>{t("auth.pinTitle")}</h2>
        <p className={styles.sub}>{t("auth.pinSub")}</p>

        {lockoutSeconds > 0 && (
          <div
            style={{
              color: "var(--danger, #e74c3c)",
              fontSize: "13px",
              marginBottom: "12px",
              textAlign: "center",
              lineHeight: "1.5",
            }}
          >
            {t("auth.pinLockedOut", { seconds: String(lockoutSeconds) })}
          </div>
        )}

        <Field label="" err={err}>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            maxLength={6}
            disabled={lockoutSeconds > 0}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
              setErr("");
            }}
            placeholder="••••••"
            className={styles.pinInput}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                pin.length === 6 &&
                lockoutSeconds === 0
              ) {
                handleUnlock();
              }
            }}
          />
        </Field>

        <div className={styles.actions}>
          {onLogout && (
            <Button kind="ghost" className="lg" onClick={onLogout}>
              {t("auth.switchAccount")}
            </Button>
          )}
          <Button
            className={`lg ${styles.grow1}`}
            disabled={busy || pin.length !== 6 || lockoutSeconds > 0}
            onClick={handleUnlock}
          >
            {t("auth.unlock")}
          </Button>
        </div>

        {onTriggerRecovery && (
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color: "var(--ink2)",
              fontSize: "12.5px",
              display: "block",
              margin: "14px auto 0",
              cursor: "pointer",
              textDecoration: "underline",
            }}
            onClick={onTriggerRecovery}
          >
            {t("auth.forgotPin")}
          </button>
        )}
      </div>
    </div>
  );
}
