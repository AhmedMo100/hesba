"use client";

import React, { useState } from "react";
import styles from "./PinLockScreen.module.css";
import { Button, Field, Icon } from "../ui";
import { useTranslation } from "../i18n";
import { authApi } from "../api";

export interface PinLockScreenProps {
  onUnlock: () => void;
  onLogout?: () => void;
}

export function PinLockScreen({ onUnlock, onLogout }: PinLockScreenProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.card}>
        <div className={styles.iconBox}>
          <Icon n="check" s={28} />
        </div>
        <h2 className={styles.title}>{t("auth.pinTitle")}</h2>
        <p className={styles.sub}>{t("auth.pinSub")}</p>

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
            placeholder="••••"
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
      </div>
    </div>
  );
}
