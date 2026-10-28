"use client";

import React, { useState } from "react";
import Image from "next/image";
import styles from "./AuthScreen.module.css";
import { Button, Field, Icon } from "../ui";
import { useTranslation } from "../i18n";
import { authApi } from "../api";
import type { SessionState, SignupInput } from "../api";

export const GOVERNORATES = [
  "القاهرة",
  "الجيزة",
  "الإسكندرية",
  "القليوبية",
  "الشرقية",
  "الدقهلية",
  "الغربية",
  "المنوفية",
  "البحيرة",
  "كفر الشيخ",
  "دمياط",
  "بورسعيد",
  "الإسماعيلية",
  "السويس",
  "الفيوم",
  "بني سويف",
  "المنيا",
  "أسيوط",
  "سوهاج",
  "قنا",
  "الأقصر",
  "أسوان",
  "البحر الأحمر",
  "الوادي الجديد",
  "مطروح",
  "شمال سيناء",
  "جنوب سيناء",
];

export const SHOP_TYPES = [
  "سوبر ماركت",
  "بقالة",
  "ميني ماركت",
  "جملة / نص جملة",
  "أخرى",
];

export function normDigits(v: string): string {
  return v
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[0-9]/g, (d) => d);
}

export function okPhone(v: string): boolean {
  const clean = normDigits(v).replace(/\s|-/g, "");
  return /^01[0125]\d{8}$/.test(clean);
}

export function okMail(v: string): boolean {
  if (!v || !v.trim()) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export interface AuthScreenProps {
  initialMode?: "signup" | "login" | "forgot-password";
  initialStep?: 0 | 1;
  initialForgotStep?: 0 | 1;
  onSuccess?: (session: SessionState) => void;
  isOffline?: boolean;
}

export function AuthScreen({
  initialMode = "login",
  initialStep = 0,
  initialForgotStep = 0,
  onSuccess,
  isOffline = false,
}: AuthScreenProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"signup" | "login" | "forgot-password">(
    initialMode,
  );
  const [step, setStep] = useState<0 | 1>(initialStep); // 0 = عنك, 1 = محلك
  const [forgotStep, setForgotStep] = useState<0 | 1>(initialForgotStep); // 0 = إرسال الكود, 1 = إدخال الكود وكلمة السر
  const [dir, setDir] = useState<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const [globalErr, setGlobalErr] = useState("");
  const [globalSuccess, setGlobalSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Password visibility toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // 1. Signup state
  const [signupData, setSignupData] = useState<SignupInput>({
    ownerName: "",
    phone: "",
    email: "",
    password: "",
    storeName: "",
    shopType: "سوبر ماركت",
    governorate: "القاهرة",
    area: "",
    openedOn: new Date().toISOString().split("T")[0] ?? "2024-01-01",
    workersCount: 1,
    withDemoData: true,
  });

  // 2. Login state
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // 3. Forgot Password state
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // Clear errors when switching modes
  const switchMode = (newMode: "signup" | "login" | "forgot-password") => {
    setMode(newMode);
    setStep(0);
    setForgotStep(0);
    setGlobalErr("");
    setGlobalSuccess("");
    setFieldErrors({});
  };

  // --- 1. Login Handler ---
  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setGlobalErr("");
    setGlobalSuccess("");
    const errs: Record<string, string> = {};

    const cleanPhone = normDigits(loginPhone).replace(/\s|-/g, "");
    if (!cleanPhone || !okPhone(cleanPhone)) {
      errs["loginPhone"] = t("errors.invalidPhone");
    }
    if (!loginPassword) {
      errs["loginPassword"] = t("errors.invalidCredentials");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      const res = await authApi.login({
        phone: cleanPhone,
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

  // --- 2. Signup Handlers ---
  const handleNextSignupStep = () => {
    setGlobalErr("");
    const errs: Record<string, string> = {};

    if (
      !signupData.ownerName.trim() ||
      signupData.ownerName.trim().length < 2
    ) {
      errs["ownerName"] = t("errors.writeName");
    }
    if (!okPhone(signupData.phone)) {
      errs["phone"] = t("errors.invalidPhone");
    }
    if (signupData.email.trim() && !okMail(signupData.email)) {
      errs["email"] = t("errors.invalidEmail");
    }
    if (!signupData.password || signupData.password.length < 6) {
      errs["password"] = t("auth.passwordLength");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setDir(1);
    setStep(1);
  };

  const handleCompleteSignup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setGlobalErr("");
    const errs: Record<string, string> = {};

    if (!signupData.storeName.trim()) {
      errs["storeName"] = t("errors.writeStoreName");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      const res = await authApi.signup({
        ...signupData,
        phone: normDigits(signupData.phone).replace(/\s|-/g, ""),
        email: signupData.email.trim().toLowerCase(),
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
    const errs: Record<string, string> = {};

    const cleanCode = normDigits(resetCode).replace(/\s|-/g, "");
    if (cleanCode.length !== 6) {
      errs["code"] = t("auth.codeLabel");
    }
    if (!newPassword || newPassword.length < 6) {
      errs["newPassword"] = t("auth.passwordLength");
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

      // Success! Switch back to login with success message
      switchMode("login");
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
      <div className={styles.card}>
        {/* Header */}
        <div className={styles.head}>
          <Image
            src="/logo.png"
            width={64}
            height={64}
            alt="حسبة"
            className={styles.logoImg}
            priority
          />

          <h1>
            {mode === "login"
              ? t("auth.loginTitle")
              : mode === "signup"
                ? t("auth.signupTitle")
                : forgotStep === 0
                  ? t("auth.forgotPasswordTitle")
                  : t("auth.resetPasswordTitle")}
          </h1>

          <p>
            {mode === "login"
              ? t("auth.loginSub")
              : mode === "signup"
                ? t("auth.signupSub")
                : forgotStep === 0
                  ? t("auth.forgotPasswordSub")
                  : t("auth.resetPasswordSub")}
          </p>
        </div>

        {/* Offline Notice if applicable */}
        {isOffline && (
          <div className={styles.offlineNotice}>
            <Icon n="wifioff" s={16} />
            <span>{t("auth.offlineNotice")}</span>
          </div>
        )}

        {/* Global Notifications */}
        {globalErr && <div className={styles.globalErr}>{globalErr}</div>}
        {globalSuccess && (
          <div className={styles.globalSuccess}>{globalSuccess}</div>
        )}

        {/* ----------------- 1. LOGIN MODE ----------------- */}
        {mode === "login" && (
          <form onSubmit={handleLogin} className={styles.body}>
            <Field label={t("auth.phoneLabel")} err={fieldErrors["loginPhone"]}>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t("auth.loginPhonePlaceholder")}
                value={loginPhone}
                onChange={(e) => {
                  setLoginPhone(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, loginPhone: "" }));
                }}
                disabled={busy}
                autoFocus
              />
            </Field>

            <Field
              label={t("auth.passwordLabel")}
              err={fieldErrors["loginPassword"]}
            >
              <div className={styles.passwordWrapper}>
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={t("auth.passwordPlaceholder")}
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, loginPassword: "" }));
                  }}
                  disabled={busy}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={
                    showPassword ? "إخفاء كلمة السر" : "عرض كلمة السر"
                  }
                >
                  <Icon n={showPassword ? "eyeoff" : "eye"} s={18} />
                </button>
              </div>
            </Field>

            <div style={{ marginTop: "10px" }}>
              <Button
                type="submit"
                kind="primary"
                wide
                busy={busy}
                disabled={busy}
              >
                {busy ? t("auth.loggingIn") : t("auth.loginBtn")}
              </Button>
            </div>

            <button
              type="button"
              className={styles.linkCenter}
              onClick={() => switchMode("signup")}
            >
              {t("auth.newAccountLink")}
            </button>

            <button
              type="button"
              className={styles.secondaryLink}
              onClick={() => switchMode("forgot-password")}
            >
              {t("auth.forgotPasswordLink")}
            </button>

            <small className={styles.note}>{t("auth.testNote")}</small>
          </form>
        )}

        {/* ----------------- 2. SIGNUP MODE ----------------- */}
        {mode === "signup" && (
          <div>
            {/* Stepper with exactly 2 steps */}
            <div className={styles.steps}>
              <div
                className={`${styles.st} ${step === 0 ? styles.on : styles.done}`}
              >
                <span className={styles.stN}>{step > 0 ? "✓" : "1"}</span>
                <span>{t("auth.step1")}</span>
              </div>

              <div className={styles.stLine}>
                <span
                  className={styles.stLineFill}
                  style={{
                    transform: step === 1 ? "scaleX(1)" : "scaleX(0)",
                  }}
                />
              </div>

              <div className={`${styles.st} ${step === 1 ? styles.on : ""}`}>
                <span className={styles.stN}>2</span>
                <span>{t("auth.step2")}</span>
              </div>
            </div>

            {/* Step 1: عنك */}
            {step === 0 && (
              <div className={styles.body} data-dir={dir}>
                <Field
                  label={t("auth.ownerLabel")}
                  err={fieldErrors["ownerName"]}
                >
                  <input
                    type="text"
                    autoComplete="name"
                    placeholder={t("auth.ownerPlaceholder")}
                    value={signupData.ownerName}
                    onChange={(e) =>
                      setSignupData({
                        ...signupData,
                        ownerName: e.target.value,
                      })
                    }
                    disabled={busy}
                    autoFocus
                  />
                </Field>

                <Field label={t("auth.phoneLabel")} err={fieldErrors["phone"]}>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={t("auth.phonePlaceholder")}
                    value={signupData.phone}
                    onChange={(e) =>
                      setSignupData({ ...signupData, phone: e.target.value })
                    }
                    disabled={busy}
                  />
                </Field>

                <Field label={t("auth.emailLabel")} err={fieldErrors["email"]}>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={t("auth.emailPlaceholder")}
                    value={signupData.email}
                    onChange={(e) =>
                      setSignupData({ ...signupData, email: e.target.value })
                    }
                    disabled={busy}
                  />
                </Field>

                <Field
                  label={t("auth.passwordLabel")}
                  err={fieldErrors["password"]}
                >
                  <div className={styles.passwordWrapper}>
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder={t("auth.passwordPlaceholder")}
                      value={signupData.password}
                      onChange={(e) =>
                        setSignupData({
                          ...signupData,
                          password: e.target.value,
                        })
                      }
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? "إخفاء كلمة السر" : "عرض كلمة السر"
                      }
                    >
                      <Icon n={showPassword ? "eyeoff" : "eye"} s={18} />
                    </button>
                  </div>
                </Field>

                <div style={{ marginTop: "10px" }}>
                  <Button
                    type="button"
                    kind="primary"
                    wide
                    onClick={handleNextSignupStep}
                  >
                    {t("auth.next")}
                  </Button>
                </div>

                <button
                  type="button"
                  className={styles.linkCenter}
                  onClick={() => switchMode("login")}
                >
                  {t("auth.hasAccount")}
                </button>

                <small className={styles.note}>{t("auth.testNote")}</small>
              </div>
            )}

            {/* Step 2: محلك */}
            {step === 1 && (
              <form
                onSubmit={handleCompleteSignup}
                className={styles.body}
                data-dir={dir}
              >
                <Field
                  label={t("auth.storeNameLabel")}
                  err={fieldErrors["storeName"]}
                >
                  <input
                    type="text"
                    placeholder={t("auth.storeNamePlaceholder")}
                    value={signupData.storeName}
                    onChange={(e) =>
                      setSignupData({
                        ...signupData,
                        storeName: e.target.value,
                      })
                    }
                    disabled={busy}
                    autoFocus
                  />
                </Field>

                <div>
                  <div className={styles.fieldLabel}>
                    {t("auth.shopTypeLabel")}
                  </div>
                  <div className={styles.chipsWrap}>
                    {SHOP_TYPES.map((type) => (
                      <button
                        type="button"
                        key={type}
                        className={`${styles.chip} ${
                          signupData.shopType === type ? styles.on : ""
                        }`}
                        onClick={() =>
                          setSignupData({ ...signupData, shopType: type })
                        }
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.row2}>
                  <Field label={t("auth.governorateLabel")}>
                    <select
                      value={signupData.governorate}
                      onChange={(e) =>
                        setSignupData({
                          ...signupData,
                          governorate: e.target.value,
                        })
                      }
                    >
                      {GOVERNORATES.map((gov) => (
                        <option key={gov} value={gov}>
                          {gov}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t("auth.areaLabel")}>
                    <input
                      type="text"
                      placeholder={t("auth.areaPlaceholder")}
                      value={signupData.area}
                      onChange={(e) =>
                        setSignupData({ ...signupData, area: e.target.value })
                      }
                      disabled={busy}
                    />
                  </Field>
                </div>

                <div className={styles.row2}>
                  <Field label={t("auth.openedDateLabel")}>
                    <input
                      type="date"
                      value={signupData.openedOn}
                      onChange={(e) =>
                        setSignupData({
                          ...signupData,
                          openedOn: e.target.value,
                        })
                      }
                      disabled={busy}
                    />
                  </Field>

                  <Field label={t("auth.workersCountLabel")}>
                    <select
                      value={signupData.workersCount}
                      onChange={(e) =>
                        setSignupData({
                          ...signupData,
                          workersCount: Number(e.target.value),
                        })
                      }
                    >
                      <option value={1}>١ (أنا بس)</option>
                      <option value={2}>٢</option>
                      <option value={3}>٣</option>
                      <option value={4}>٤</option>
                      <option value={5}>٥ أو أكتر</option>
                    </select>
                  </Field>
                </div>

                <label className={styles.chkDemo}>
                  <input
                    type="checkbox"
                    checked={signupData.withDemoData}
                    onChange={(e) =>
                      setSignupData({
                        ...signupData,
                        withDemoData: e.target.checked,
                      })
                    }
                  />
                  <div className={styles.chkDemoText}>
                    <b>{t("auth.demoData")}</b>
                    <small>{t("auth.demoDataDesc")}</small>
                  </div>
                </label>

                <div className={styles.actions}>
                  <Button
                    type="button"
                    kind="ghost"
                    onClick={() => {
                      setDir(-1);
                      setStep(0);
                    }}
                    disabled={busy}
                  >
                    {t("auth.back")}
                  </Button>

                  <div className={styles.grow1}>
                    <Button
                      type="submit"
                      kind="primary"
                      wide
                      busy={busy}
                      disabled={busy}
                    >
                      {busy ? t("auth.creating") : t("auth.createAccount")}
                    </Button>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.linkCenter}
                  onClick={() => switchMode("login")}
                >
                  {t("auth.hasAccount")}
                </button>

                <small className={styles.note}>{t("auth.testNote")}</small>
              </form>
            )}
          </div>
        )}

        {/* ----------------- 3. FORGOT PASSWORD MODE ----------------- */}
        {mode === "forgot-password" && (
          <div>
            {forgotStep === 0 ? (
              <form onSubmit={handleRequestCode} className={styles.body}>
                <Field
                  label={t("auth.emailLabel")}
                  err={fieldErrors["forgotEmail"]}
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
                    }}
                    disabled={busy}
                    autoFocus
                  />
                </Field>

                <div style={{ marginTop: "10px" }}>
                  <Button
                    type="submit"
                    kind="primary"
                    wide
                    busy={busy}
                    disabled={busy}
                  >
                    {busy ? t("auth.sendingCode") : t("auth.sendCodeBtn")}
                  </Button>
                </div>

                <button
                  type="button"
                  className={styles.linkCenter}
                  onClick={() => switchMode("login")}
                >
                  {t("auth.backToLogin")}
                </button>

                <small className={styles.note}>{t("auth.testNote")}</small>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className={styles.body}>
                <Field label={t("auth.codeLabel")} err={fieldErrors["code"]}>
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
                    }}
                    disabled={busy}
                    autoFocus
                  />
                </Field>

                <Field
                  label={t("auth.newPasswordLabel")}
                  err={fieldErrors["newPassword"]}
                >
                  <div className={styles.passwordWrapper}>
                    <input
                      type={showNewPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder={t("auth.passwordPlaceholder")}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setFieldErrors((prev) => ({
                          ...prev,
                          newPassword: "",
                        }));
                      }}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      aria-label={
                        showNewPassword ? "إخفاء كلمة السر" : "عرض كلمة السر"
                      }
                    >
                      <Icon n={showNewPassword ? "eyeoff" : "eye"} s={18} />
                    </button>
                  </div>
                </Field>

                <Field
                  label={t("auth.confirmPasswordLabel")}
                  err={fieldErrors["confirmPassword"]}
                >
                  <input
                    type={showNewPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={t("auth.confirmPasswordLabel")}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setFieldErrors((prev) => ({
                        ...prev,
                        confirmPassword: "",
                      }));
                    }}
                    disabled={busy}
                  />
                </Field>

                <div style={{ marginTop: "10px" }}>
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
                </div>

                {resendCooldown > 0 ? (
                  <span
                    className={styles.secondaryLink}
                    style={{ cursor: "default" }}
                  >
                    إعادة إرسال الكود خلال {resendCooldown} ثانية
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
                  className={styles.linkCenter}
                  onClick={() => switchMode("login")}
                >
                  {t("auth.backToLogin")}
                </button>

                <small className={styles.note}>{t("auth.testNote")}</small>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
