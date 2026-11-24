"use client";

import React, { useState, useCallback, useRef } from "react";
import styles from "./AuthScreen.module.css";
import { Button, Field, Alert, PasswordInput } from "@/client/shared/ui";
import { useTranslation } from "@/client/shared/i18n";
import { authApi } from "@/client/shared/api";
import type { SessionState, SignupInput } from "@/client/shared/api";
import { validatePasswordPolicy } from "@/domain";
import {
  normDigits,
  okPhone,
  okMail,
  validateSignup,
  isEmailIdentifier,
} from "./auth.logic";

export {
  GOVERNORATES,
  SHOP_TYPES,
  normDigits,
  okPhone,
  okMail,
  validateSignup,
  isEmailIdentifier,
} from "./auth.logic";

/**
 * There is no e-mail recovery (retired): a forgotten password is reset by Hesba's team, who
 * give the owner a temporary one (docs/ops/password-reset.md).
 */
export const FORGOT_PASSWORD_HELP =
  "نسيت كلمة المرور؟ تواصل مع إدارة حِسبة لمساعدتك في استعادة الحساب.";

export interface AuthScreenProps {
  initialMode?: "signup" | "login";
  initialSuccess?: string;
  initialSuccessTitle?: string;
  initialError?: string;
  initialFieldErrors?: Record<string, string>;
  onSuccess?: (session: SessionState) => void;
  isOffline?: boolean;
}

export function AuthScreen({
  initialMode = "login",
  initialSuccess = "",
  initialSuccessTitle = "",
  initialError = "",
  initialFieldErrors = {},
  onSuccess,
  isOffline = false,
}: AuthScreenProps) {
  const { t } = useTranslation();

  const [mode, setMode] = useState<"signup" | "login">(initialMode);
  const [showForgotHelp, setShowForgotHelp] = useState(false);
  // Set synchronously on submit: a double tap / double Enter in the same tick still sends ONE
  // request (the `busy` state only applies after the next render).
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [globalErr, setGlobalErr] = useState(initialError);
  const [globalSuccess, setGlobalSuccess] = useState(initialSuccess);
  const [globalSuccessTitle, setGlobalSuccessTitle] =
    useState(initialSuccessTitle);
  const [fieldErrors, setFieldErrors] =
    useState<Record<string, string>>(initialFieldErrors);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(
    Object.keys(initialFieldErrors).length > 0,
  );

  // Signup fields (simplified: store name, phone, email optional, password)
  const [signupData, setSignupData] = useState<SignupInput>({
    ownerName: "",
    phone: "",
    email: "",
    password: "",
    storeName: "",
    shopType: "سوبر ماركت",
    governorate: "القاهرة",
  });

  // Login fields
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const showErr = useCallback(
    (field: string) =>
      (touched[field] || submitted) && fieldErrors[field]
        ? fieldErrors[field]
        : undefined,
    [touched, submitted, fieldErrors],
  );

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const enterNext = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const form = e.currentTarget.form;
    if (!form) return;
    const els = Array.from(form.elements).filter(
      (el): el is HTMLInputElement | HTMLSelectElement =>
        (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) &&
        !el.disabled &&
        el.type !== "hidden" &&
        el.type !== "submit",
    );
    const idx = els.indexOf(
      e.currentTarget as HTMLInputElement | HTMLSelectElement,
    );
    if (idx >= 0 && idx < els.length - 1) els[idx + 1]?.focus();
    else form.requestSubmit();
  };

  const switchMode = (newMode: "signup" | "login") => {
    setMode(newMode);
    setShowForgotHelp(false);
    setGlobalErr("");
    setGlobalSuccess("");
    setGlobalSuccessTitle("");
    setFieldErrors({});
    setTouched({});
    setSubmitted(false);

    if (typeof window !== "undefined") {
      const targetPath = newMode === "login" ? "/login" : "/signup";
      if (
        window.location.pathname !== targetPath &&
        window.location.pathname !== "/"
      ) {
        window.history.replaceState(null, "", targetPath);
      }
    }
  };

  // --- 1. Login Handler ---
  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inFlight.current) return;
    setGlobalErr("");
    setGlobalSuccess("");
    setSubmitted(true);
    const errs: Record<string, string> = {};

    const id = loginIdentifier.trim();
    if (!id) {
      errs["loginIdentifier"] = t("errors.invalidCredentials");
    } else if (isEmailIdentifier(id)) {
      if (!okMail(id)) {
        errs["loginIdentifier"] = t("errors.invalidEmail");
      }
    } else {
      const cleanPhone = normDigits(id).replace(/\s|-/g, "");
      if (!okPhone(cleanPhone)) {
        errs["loginIdentifier"] = t("errors.invalidPhone");
      }
    }
    if (!loginPassword) {
      errs["loginPassword"] = t("errors.invalidCredentials");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    inFlight.current = true;
    setBusy(true);
    try {
      const identifier = isEmailIdentifier(loginIdentifier.trim())
        ? loginIdentifier.trim()
        : normDigits(loginIdentifier).replace(/\s|-/g, "");

      const res = await authApi.login({
        identifier,
        password: loginPassword,
      });

      if (!res.success || !res.data) {
        setGlobalErr(res.error || t("errors.invalidCredentials"));
        return;
      }

      onSuccess?.(res.data);
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // --- 2. Signup Handler (single step) ---
  const handleSignup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inFlight.current) return;
    setGlobalErr("");
    setSubmitted(true);
    const errs = validateSignup(signupData, t, validatePasswordPolicy);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    inFlight.current = true;
    setBusy(true);
    try {
      const res = await authApi.signup({
        ...signupData,
        ownerName: signupData.storeName.trim(),
        phone: normDigits(signupData.phone).replace(/\s|-/g, ""),
        email: signupData.email?.trim().toLowerCase() || undefined,
      });

      if (!res.success || !res.data) {
        setGlobalErr(res.error || t("errors.serverError"));
        return;
      }

      onSuccess?.(res.data);
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className={styles.auth} dir="rtl">
      <div className={styles.container}>
        {/* Offline Notice */}
        {isOffline && (
          <Alert kind="warning" icon="wifioff">
            {t("auth.offlineNotice")}
          </Alert>
        )}

        {/* Global Notifications */}
        {globalErr && (
          <Alert kind="error" onClose={() => setGlobalErr("")}>
            {globalErr}
          </Alert>
        )}
        {globalSuccess && (
          <Alert
            kind="success"
            title={globalSuccessTitle || undefined}
            onClose={() => {
              setGlobalSuccess("");
              setGlobalSuccessTitle("");
            }}
          >
            {globalSuccess}
          </Alert>
        )}

        {/* ----------------- 1. LOGIN MODE ----------------- */}
        {mode === "login" && (
          <>
            <div className={styles.loginHead}>
              <h1 className={styles.brandTitle}>{t("auth.loginTitle")}</h1>
              <p className={styles.brandSub}>{t("auth.loginSub")}</p>
            </div>

            <form onSubmit={handleLogin} className={styles.body} noValidate>
              <Field
                label={t("auth.loginIdentifierLabel")}
                err={showErr("loginIdentifier")}
              >
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="username"
                  placeholder={t("auth.loginIdentifierPlaceholder")}
                  value={loginIdentifier}
                  onChange={(e) => {
                    setLoginIdentifier(e.target.value);
                    setFieldErrors((prev) => ({
                      ...prev,
                      loginIdentifier: "",
                    }));
                    setGlobalErr("");
                  }}
                  onBlur={() => markTouched("loginIdentifier")}
                  onKeyDown={enterNext}
                  disabled={busy}
                  autoFocus
                />
              </Field>

              <Field
                label={t("auth.passwordLabel")}
                err={showErr("loginPassword")}
              >
                <div className={styles.passwordWrapper}>
                  <PasswordInput
                    autoComplete="current-password"
                    placeholder={t("auth.loginPasswordPlaceholder")}
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      setFieldErrors((prev) => ({
                        ...prev,
                        loginPassword: "",
                      }));
                      setGlobalErr("");
                    }}
                    onBlur={() => markTouched("loginPassword")}
                    onKeyDown={enterNext}
                    disabled={busy}
                  />
                </div>
              </Field>

              <Button
                type="submit"
                kind="primary"
                wide
                busy={busy}
                disabled={busy}
              >
                {busy ? t("auth.loggingIn") : t("auth.loginBtn")}
              </Button>

              <button
                type="button"
                className={styles.forgotLink}
                aria-expanded={showForgotHelp}
                onClick={() => setShowForgotHelp((v) => !v)}
                data-testid="forgot-password-link"
              >
                {t("auth.forgotPasswordLink")}
              </button>
              {showForgotHelp && (
                <p
                  className={styles.forgotHelp}
                  data-testid="forgot-password-help"
                >
                  {FORGOT_PASSWORD_HELP}
                </p>
              )}

              <div className={styles.switchSection}>
                <span className={styles.switchText}>{t("auth.noAccount")}</span>
                <button
                  type="button"
                  className={styles.outlineBtn}
                  onClick={() => switchMode("signup")}
                >
                  {t("auth.newAccountLink")}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ----------------- 2. SIGNUP MODE (single step) ----------------- */}
        {mode === "signup" && (
          <>
            <div className={styles.signupHead}>
              <h1>{t("auth.signupTitle")}</h1>
            </div>

            <form onSubmit={handleSignup} className={styles.body} noValidate>
              <Field
                label={t("auth.storeNameLabel")}
                err={showErr("storeName")}
              >
                <input
                  type="text"
                  placeholder={t("auth.storeNamePlaceholder")}
                  value={signupData.storeName}
                  onChange={(e) => {
                    setSignupData({ ...signupData, storeName: e.target.value });
                    setFieldErrors((prev) => ({ ...prev, storeName: "" }));
                    setGlobalErr("");
                  }}
                  onBlur={() => markTouched("storeName")}
                  onKeyDown={enterNext}
                  disabled={busy}
                  autoFocus
                />
              </Field>

              <Field label={t("auth.phoneLabel")} err={showErr("phone")}>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder={t("auth.phonePlaceholder")}
                  value={signupData.phone}
                  onChange={(e) => {
                    setSignupData({ ...signupData, phone: e.target.value });
                    setFieldErrors((prev) => ({ ...prev, phone: "" }));
                    setGlobalErr("");
                  }}
                  onBlur={() => markTouched("phone")}
                  onKeyDown={enterNext}
                  disabled={busy}
                />
              </Field>

              <Field
                label={t("auth.emailOptionalLabel")}
                err={showErr("email")}
              >
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder={t("auth.emailPlaceholder")}
                  value={signupData.email}
                  onChange={(e) => {
                    setSignupData({ ...signupData, email: e.target.value });
                    setFieldErrors((prev) => ({ ...prev, email: "" }));
                    setGlobalErr("");
                  }}
                  onBlur={() => markTouched("email")}
                  onKeyDown={enterNext}
                  disabled={busy}
                />
              </Field>

              <Field
                label={t("auth.passwordLabelWithHint")}
                err={showErr("password")}
              >
                <div className={styles.passwordWrapper}>
                  <PasswordInput
                    autoComplete="new-password"
                    value={signupData.password}
                    onChange={(e) => {
                      setSignupData({
                        ...signupData,
                        password: e.target.value,
                      });
                      setFieldErrors((prev) => ({ ...prev, password: "" }));
                      setGlobalErr("");
                    }}
                    onBlur={() => markTouched("password")}
                    onKeyDown={enterNext}
                    disabled={busy}
                  />
                </div>
              </Field>

              <p className={styles.trialNote} data-testid="trial-note">
                🎁 أول 3 أيام مجانًا، وبعدها بتكلم إدارة حِسبة عشان تفعّل
                الاشتراك.
              </p>

              <Button
                type="submit"
                kind="primary"
                wide
                busy={busy}
                disabled={busy}
              >
                {busy ? t("auth.creating") : t("auth.createAccount")}
              </Button>

              <button
                type="button"
                className={styles.outlineBtn}
                onClick={() => switchMode("login")}
              >
                {t("auth.hasAccount")}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
