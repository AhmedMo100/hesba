"use client";

/**
 * @file ChangePasswordScreen.tsx
 * @description The only screen of an account that signed in with a temporary password from
 * Hesba's team (admin reset): choose a new password, or sign out.
 *
 * @remarks
 * The server is what enforces it (every API answers 403 PASSWORD_CHANGE_REQUIRED until the
 * change); this screen only makes it the obvious next step. After the change the server closes
 * every other session of the account, and the app reloads the session and opens normally.
 */

import React, { useRef, useState } from "react";
import styles from "./AuthScreen.module.css";
import { Alert, Button, Field, PasswordInput } from "@/client/shared/ui";
import { useTranslation } from "@/client/shared/i18n";
import { authApi } from "@/client/shared/api";
import { validatePasswordPolicy } from "@/domain";

export interface ChangePasswordScreenProps {
  onChanged: () => void | Promise<void>;
  onLogout: () => void;
}

export function ChangePasswordScreen({
  onChanged,
  onLogout,
}: ChangePasswordScreenProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [globalErr, setGlobalErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const policyError = (pw: string): string | undefined => {
    const r = validatePasswordPolicy(pw);
    if (r.valid) return undefined;
    if (r.reason === "missing_letter") return t("auth.passwordMissingLetter");
    if (r.reason === "missing_number") return t("auth.passwordMissingNumber");
    if (r.reason === "too_long") return t("auth.passwordTooLong");
    if (r.reason === "too_common") return t("auth.passwordTooCommon");
    return t("auth.passwordLength");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    setGlobalErr("");
    const found: Record<string, string> = {};
    if (!current)
      found["currentPassword"] =
        "اكتب كلمة المرور المؤقتة اللي إدارة حِسبة بعتتهالك";
    const weak = policyError(next);
    if (weak) found["newPassword"] = weak;
    else if (next === current)
      found["newPassword"] = "اختار كلمة مرور جديدة غير المؤقتة";
    if (next !== confirm) found["confirmPassword"] = t("auth.passwordMismatch");
    setErrs(found);
    if (Object.keys(found).length > 0) return;

    inFlight.current = true;
    setBusy(true);
    try {
      const res = await authApi.changePassword({
        currentPassword: current,
        newPassword: next,
      });
      if (!res.success) {
        if (res.field === "currentPassword" || res.field === "newPassword") {
          setErrs({ [res.field]: res.error ?? "" });
        } else {
          setGlobalErr(res.error ?? t("errors.serverError"));
        }
        return;
      }
      await onChanged();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className={styles.auth} dir="rtl" data-testid="change-password-screen">
      <div className={styles.container}>
        {globalErr && (
          <Alert kind="error" onClose={() => setGlobalErr("")}>
            {globalErr}
          </Alert>
        )}
        <div className={styles.signupHead}>
          <h1>غيّر كلمة المرور</h1>
          <p className={styles.brandSub}>
            دخلت بكلمة مرور مؤقتة من إدارة حِسبة. اختار كلمة مرور جديدة خاصة بيك
            عشان تكمل. بعد الحفظ هيتقفل الدخول من أي جهاز تاني.
          </p>
        </div>
        <form onSubmit={submit} className={styles.body} noValidate>
          <Field label="كلمة المرور المؤقتة" err={errs["currentPassword"]}>
            <div className={styles.passwordWrapper}>
              <PasswordInput
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={busy}
                autoFocus
                data-testid="cp-current"
              />
            </div>
          </Field>
          <Field
            label="كلمة المرور الجديدة"
            hint={t("auth.passwordHint")}
            err={errs["newPassword"]}
          >
            <div className={styles.passwordWrapper}>
              <PasswordInput
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                disabled={busy}
                data-testid="cp-new"
              />
            </div>
          </Field>
          <Field label="أكّد كلمة المرور الجديدة" err={errs["confirmPassword"]}>
            <div className={styles.passwordWrapper}>
              <PasswordInput
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
                data-testid="cp-confirm"
              />
            </div>
          </Field>
          <Button
            type="submit"
            kind="primary"
            wide
            busy={busy}
            disabled={busy}
            data-testid="cp-save"
          >
            {busy ? "جاري الحفظ…" : "احفظ كلمة المرور الجديدة"}
          </Button>
          <button
            type="button"
            className={styles.outlineBtn}
            onClick={onLogout}
            disabled={busy}
            data-testid="cp-logout"
          >
            تسجيل الخروج
          </button>
        </form>
      </div>
    </div>
  );
}
