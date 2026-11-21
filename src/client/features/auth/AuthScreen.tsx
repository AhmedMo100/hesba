"use client";

import React, { useState, useCallback } from "react";
import styles from "./AuthScreen.module.css";
import { Button, Field, Alert } from "@/client/shared/ui";
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

export interface AuthScreenProps {
  initialMode?: "signup" | "login" | "forgot-password";
  initialForgotStep?: 0 | 1;
  initialSuccess?: string;
  initialSuccessTitle?: string;
  initialError?: string;
  initialFieldErrors?: Record<string, string>;
  onSuccess?: (session: SessionState) => void;
  isOffline?: boolean;
}

export function AuthScreen({
  initialMode = "login",
  initialForgotStep = 0,
  initialSuccess = "",
  initialSuccessTitle = "",
  initialError = "",
  initialFieldErrors = {},
  onSuccess,
  isOffline = false,
}: AuthScreenProps) {
  const { t } = useTranslation();

  const [mode, setMode] = useState<"signup" | "login" | "forgot-password">(
    initialMode,
  );
  const [forgotStep, setForgotStep] = useState<0 | 1>(initialForgotStep);
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

  // Forgot password fields
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

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

  const switchMode = (newMode: "signup" | "login" | "forgot-password") => {
    setMode(newMode);
    setForgotStep(0);
    setGlobalErr("");
    setGlobalSuccess("");
    setGlobalSuccessTitle("");
    setFieldErrors({});
    setTouched({});
    setSubmitted(false);

    if (typeof window !== "undefined") {
      const targetPath = newMode === "login" ? "/login" : "/" + newMode;
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
      setBusy(false);
    }
  };

  // --- 2. Signup Handler (single step) ---
  const handleSignup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setGlobalErr("");
    setSubmitted(true);
    const errs = validateSignup(signupData, t, validatePasswordPolicy);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

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
      setBusy(false);
    }
  };

  // --- 3. Forgot Password Handlers ---
  const handleRequestCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setGlobalErr("");
    setGlobalSuccess("");
    setSubmitted(true);

    if (!okMail(forgotEmail)) {
      setFieldErrors({ forgotEmail: t("errors.invalidEmail") });
      return;
    }

    setBusy(true);
    try {
      const res = await authApi.requestPasswordReset(
        forgotEmail.trim().toLowerCase(),
      );
      if (!res.success) {
        setGlobalErr(res.error || t("errors.serverError"));
        return;
      }

      setForgotStep(1);
      setSubmitted(false);
      setTouched({});
      setGlobalSuccessTitle(t("auth.codeSentTitle"));
      setGlobalSuccess(res.data?.message || t("auth.forgotPasswordSub"));
      setResendCooldown(60);
      const timer = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setGlobalErr("");
    setGlobalSuccess("");
    setGlobalSuccessTitle("");
    setSubmitted(true);
    const errs: Record<string, string> = {};

    const cleanCode = normDigits(resetCode).replace(/\s|-/g, "");
    if (cleanCode.length !== 6) {
      errs["code"] = t("auth.codeLabel");
    }
    const pwdRes = validatePasswordPolicy(newPassword);
    if (!pwdRes.valid) {
      if (pwdRes.reason === "too_short" || pwdRes.reason === "empty") {
        errs["newPassword"] = t("auth.passwordLength");
      } else if (pwdRes.reason === "missing_letter") {
        errs["newPassword"] = t("auth.passwordMissingLetter");
      } else if (pwdRes.reason === "missing_number") {
        errs["newPassword"] = t("auth.passwordMissingNumber");
      } else if (pwdRes.reason === "too_long") {
        errs["newPassword"] = t("auth.passwordTooLong");
      } else if (pwdRes.reason === "too_common") {
        errs["newPassword"] = t("auth.passwordTooCommon");
      }
    }
    if (newPassword !== confirmPassword) {
      errs["confirmPassword"] = t("auth.passwordMismatch");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      const res = await authApi.resetPassword({
        email: forgotEmail.trim().toLowerCase(),
        code: cleanCode,
        newPassword,
      });

      if (!res.success) {
        setGlobalErr(res.error || t("errors.serverError"));
        return;
      }

      switchMode("login");
      setGlobalSuccessTitle(t("auth.passwordResetSuccessTitle"));
      setGlobalSuccess(t("auth.passwordResetSuccess"));
      setLoginPassword("");
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
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
                  <input
                    type="password"
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
                onClick={() => switchMode("forgot-password")}
              >
                {t("auth.forgotPasswordLink")}
              </button>

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
                  <input
                    type="password"
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

        {/* ----------------- 3. FORGOT PASSWORD MODE ----------------- */}
        {mode === "forgot-password" && (
          <div>
            <div className={styles.signupHead}>
              <h1>
                {forgotStep === 0
                  ? t("auth.forgotPasswordTitle")
                  : t("auth.resetPasswordTitle")}
              </h1>
              <p className={styles.brandSub}>
                {forgotStep === 0
                  ? t("auth.forgotPasswordSub")
                  : t("auth.resetPasswordSub")}
              </p>
            </div>

            {forgotStep === 0 ? (
              <form
                onSubmit={handleRequestCode}
                className={styles.body}
                noValidate
              >
                <Field
                  label={t("auth.emailLabel")}
                  err={showErr("forgotEmail")}
                >
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={t("auth.emailPlaceholder")}
                    value={forgotEmail}
                    onChange={(e) => {
                      setForgotEmail(e.target.value);
                      setFieldErrors({});
                      setGlobalErr("");
                    }}
                    onBlur={() => markTouched("forgotEmail")}
                    onKeyDown={enterNext}
                    disabled={busy}
                    autoFocus
                  />
                </Field>

                <Button
                  type="submit"
                  kind="primary"
                  wide
                  busy={busy}
                  disabled={busy}
                >
                  {busy ? t("auth.sendingCode") : t("auth.sendCodeBtn")}
                </Button>

                <button
                  type="button"
                  className={styles.outlineBtn}
                  onClick={() => switchMode("login")}
                >
                  {t("auth.backToLogin")}
                </button>
              </form>
            ) : (
              <form
                onSubmit={handleResetPassword}
                className={styles.body}
                noValidate
              >
                <Field label={t("auth.codeLabel")} err={showErr("code")}>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t("auth.codePlaceholder")}
                    className={styles.codeBox}
                    value={resetCode}
                    onChange={(e) => {
                      setResetCode(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, code: "" }));
                      setGlobalErr("");
                    }}
                    onBlur={() => markTouched("code")}
                    onKeyDown={enterNext}
                    disabled={busy}
                    autoFocus
                  />
                </Field>

                <Field
                  label={t("auth.newPasswordLabel")}
                  hint={t("auth.passwordHint")}
                  err={showErr("newPassword")}
                >
                  <div className={styles.passwordWrapper}>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setFieldErrors((prev) => ({
                          ...prev,
                          newPassword: "",
                        }));
                        setGlobalErr("");
                      }}
                      onBlur={() => markTouched("newPassword")}
                      onKeyDown={enterNext}
                      disabled={busy}
                    />
                  </div>
                </Field>

                <Field
                  label={t("auth.confirmPasswordLabel")}
                  err={showErr("confirmPassword")}
                >
                  <div className={styles.passwordWrapper}>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setFieldErrors((prev) => ({
                          ...prev,
                          confirmPassword: "",
                        }));
                        setGlobalErr("");
                      }}
                      onBlur={() => markTouched("confirmPassword")}
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
                  {busy
                    ? t("auth.savingPassword")
                    : t("auth.saveNewPasswordBtn")}
                </Button>

                {resendCooldown > 0 ? (
                  <span
                    className={styles.secondaryLink}
                    style={{ cursor: "default" }}
                  >
                    {t("auth.resendInSeconds").replace(
                      "{seconds}",
                      String(resendCooldown),
                    )}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.secondaryLink}
                    onClick={handleRequestCode}
                    disabled={busy}
                  >
                    {t("auth.resendCode")}
                  </button>
                )}

                <button
                  type="button"
                  className={styles.outlineBtn}
                  onClick={() => switchMode("login")}
                >
                  {t("auth.backToLogin")}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
