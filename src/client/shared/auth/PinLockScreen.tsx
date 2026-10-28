"use client";

import React, { useState } from "react";
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
  const [showReauthModal, setShowReauthModal] = useState(false);

  const handleUnlock = async () => {
    if (pin.length < 4) {
      setErr(t("errors.wrongPin"));
      return;
    }

    setBusy(true);
    setErr("");
    try {
      const ok = await authApi.verifyPin(pin);
      if (ok) {
        onUnlock();
      } else {
        setErr(t("errors.wrongPin"));
      }
    } catch {
      setErr(t("errors.wrongPin"));
    } finally {
      setBusy(false);
    }
  };

  const handleResetPinWithPasskey = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await authApi.resetPinWithReauth();
      if (res.success && res.data?.allowed) {
        setShowReauthModal(false);
        onUnlock();
      } else {
        setErr(res.error || t("errors.reauthRequired"));
      }
    } catch {
      setErr(t("errors.reauthRequired"));
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

        {showReauthModal ? (
          <div style={{ textAlign: "center", marginTop: "12px" }}>
            <h3 style={{ fontSize: "16px", marginBottom: "8px" }}>
              {t("auth.resetPinTitle")}
            </h3>
            <p
              style={{
                color: "var(--ink2)",
                fontSize: "13px",
                lineHeight: "1.5",
                marginBottom: "20px",
              }}
            >
              {t("auth.resetPinDesc")}
            </p>

            {err && (
              <div
                style={{
                  color: "var(--danger, #e74c3c)",
                  fontSize: "13px",
                  marginBottom: "12px",
                }}
              >
                {err}
              </div>
            )}

            <div className={styles.actions}>
              <Button
                kind="ghost"
                className="lg"
                onClick={() => {
                  setShowReauthModal(false);
                  setErr("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                className={`lg ${styles.grow1}`}
                disabled={busy}
                onClick={handleResetPinWithPasskey}
              >
                {t("auth.confirmPasskeyForPin")}
              </Button>
            </div>

            {onTriggerRecovery && (
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--br)",
                  fontSize: "13px",
                  marginTop: "16px",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
                onClick={onTriggerRecovery}
              >
                {t("auth.forgotPasskey")}
              </button>
            )}
          </div>
        ) : (
          <>
            <Field label="" err={err}>
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ""));
                  setErr("");
                }}
                placeholder="••••••"
                className={styles.pinInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleUnlock();
                }}
              />
            </Field>

            <div className={styles.actions}>
              {onLogout && (
                <Button kind="ghost" className="lg" onClick={onLogout}>
                  {t("profile.logout")}
                </Button>
              )}
              <Button
                className={`lg ${styles.grow1}`}
                disabled={busy || pin.length < 4}
                onClick={handleUnlock}
              >
                {t("auth.unlock")}
              </Button>
            </div>

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
              onClick={() => {
                setShowReauthModal(true);
                setErr("");
              }}
            >
              {t("auth.forgotPinLink")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
