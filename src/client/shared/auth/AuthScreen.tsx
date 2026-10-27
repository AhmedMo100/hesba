"use client";

import React, { useState } from "react";
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
  if (!v || !v.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export interface AuthScreenProps {
  initialMode?: "signup" | "login" | "otp";
  onSuccess?: (session: SessionState) => void;
  isOffline?: boolean;
}

export function AuthScreen({
  initialMode = "signup",
  onSuccess,
  isOffline = false,
}: AuthScreenProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"signup" | "login" | "otp">(initialMode);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const [globalErr, setGlobalErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Signup state
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

  // Login state
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // OTP state
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");

  const updateSignup = (patch: Partial<SignupInput>) => {
    setSignupData((prev) => ({ ...prev, ...patch }));
    setFieldErrors({});
    setGlobalErr("");
  };

  const handleNextStep = () => {
    const errs: Record<string, string> = {};
    if (signupData.ownerName.trim().length < 2) {
      errs["owner"] = t("errors.writeName");
    }
    if (!okPhone(signupData.phone)) {
      errs["phone"] = t("errors.invalidPhone");
    }
    if (!okMail(signupData.email || "")) {
      errs["email"] = t("errors.invalidEmail");
    }
    if (!signupData.password || signupData.password.length < 6) {
      errs["pass"] = t("errors.passwordMin");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setDir(1);
    setStep(1);
  };

  const handleCreateAccount = async () => {
    const errs: Record<string, string> = {};
    if (!signupData.storeName.trim()) {
      errs["storeName"] = t("errors.writeStoreName");
    }
    if (!signupData.openedOn) {
      errs["opened"] = t("errors.chooseOpenedDate");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setGlobalErr("");
    try {
      const res = await authApi.signup({
        ...signupData,
        phone: normDigits(signupData.phone).replace(/\s|-/g, ""),
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

  const handleLogin = async () => {
    const errs: Record<string, string> = {};
    if (!okPhone(loginPhone)) {
      errs["phone"] = t("errors.invalidPhone");
    }
    if (!loginPassword) {
      errs["pass"] = t("errors.invalidCredentials");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setGlobalErr("");
    try {
      const res = await authApi.login({
        phone: normDigits(loginPhone).replace(/\s|-/g, ""),
        password: loginPassword,
      });

      if (!res.success || !res.data) {
        setGlobalErr(res.error || t("errors.invalidCredentials"));
        return;
      }

      onSuccess?.(res.data);
    } catch {
      setGlobalErr(t("errors.invalidCredentials"));
    } finally {
      setBusy(false);
    }
  };

  const handleRequestOtp = async () => {
    if (!okPhone(loginPhone)) {
      setFieldErrors({ phone: t("errors.invalidPhone") });
      return;
    }

    setBusy(true);
    setGlobalErr("");
    try {
      const res = await authApi.requestOtp(normDigits(loginPhone).trim());
      if (!res.success) {
        setGlobalErr(res.error || t("errors.serverError"));
        return;
      }
      setOtpPhone(loginPhone);
      setMode("otp");
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length < 4) {
      setFieldErrors({ otp: t("errors.wrongCode") });
      return;
    }

    setBusy(true);
    setGlobalErr("");
    try {
      const res = await authApi.verifyOtp({
        phone: normDigits(otpPhone).trim(),
        code: otpCode.trim(),
      });

      if (!res.success || !res.data) {
        setGlobalErr(res.error || t("errors.wrongCode"));
        return;
      }

      onSuccess?.(res.data);
    } catch {
      setGlobalErr(t("errors.wrongCode"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.auth}>
      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.logoBox}>
            <Icon n="store" s={28} />
          </div>
          <h1>
            {mode === "signup"
              ? t("auth.signupTitle")
              : mode === "login"
                ? t("auth.loginTitle")
                : t("auth.otpTitle")}
          </h1>
          <p>
            {mode === "signup"
              ? t("auth.signupSub")
              : mode === "login"
                ? t("auth.loginSub")
                : t("auth.otpSub")}
          </p>
        </div>

        {isOffline && (
          <div className={styles.offlineNotice}>
            <Icon n="alert" s={16} />
            <span>{t("auth.offlineNotice")}</span>
          </div>
        )}

        {globalErr && <div className={styles.globalErr}>{globalErr}</div>}

        {mode === "signup" && (
          <>
            <div className={styles.steps} aria-label={`خطوة ${step + 1} من 2`}>
              <div
                className={`${styles.st} ${step === 0 ? styles.on : styles.done}`}
              >
                <span className={styles.stN}>
                  {step > 0 ? <Icon n="check" s={14} /> : 1}
                </span>
                <b>{t("auth.step1")}</b>
              </div>
              <div className={`${styles.st} ${step === 1 ? styles.on : ""}`}>
                <span className={styles.stN}>2</span>
                <b>{t("auth.step2")}</b>
              </div>
              <i className={styles.stLine}>
                <i
                  className={styles.stLineFill}
                  style={{ transform: `scaleX(${step})` }}
                />
              </i>
            </div>

            <div className={styles.body} key={step} data-dir={dir}>
              {step === 0 ? (
                <>
                  <Field
                    label={t("auth.ownerLabel")}
                    err={fieldErrors["owner"]}
                  >
                    <input
                      autoFocus
                      value={signupData.ownerName}
                      onChange={(e) =>
                        updateSignup({ ownerName: e.target.value })
                      }
                      placeholder={t("auth.ownerPlaceholder")}
                      autoComplete="name"
                    />
                  </Field>

                  <Field
                    label={t("auth.phoneLabel")}
                    err={fieldErrors["phone"]}
                  >
                    <input
                      dir="ltr"
                      className="ltr"
                      inputMode="tel"
                      value={signupData.phone}
                      onChange={(e) => updateSignup({ phone: e.target.value })}
                      placeholder={t("auth.phonePlaceholder")}
                      autoComplete="tel"
                    />
                  </Field>

                  <Field
                    label={t("auth.emailLabel")}
                    err={fieldErrors["email"]}
                  >
                    <input
                      dir="ltr"
                      className="ltr"
                      inputMode="email"
                      value={signupData.email}
                      onChange={(e) => updateSignup({ email: e.target.value })}
                      placeholder={t("auth.emailPlaceholder")}
                      autoComplete="email"
                    />
                  </Field>

                  <Field
                    label={t("auth.passwordLabel")}
                    err={fieldErrors["pass"]}
                  >
                    <input
                      type="password"
                      value={signupData.password}
                      onChange={(e) =>
                        updateSignup({ password: e.target.value })
                      }
                      placeholder={t("auth.passwordPlaceholder")}
                      autoComplete="new-password"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleNextStep();
                      }}
                    />
                  </Field>

                  <Button className="wide lg" onClick={handleNextStep}>
                    {t("auth.next")}
                  </Button>
                </>
              ) : (
                <>
                  <Field
                    label={t("auth.storeNameLabel")}
                    err={fieldErrors["storeName"]}
                  >
                    <input
                      autoFocus
                      value={signupData.storeName}
                      onChange={(e) =>
                        updateSignup({ storeName: e.target.value })
                      }
                      placeholder={t("auth.storeNamePlaceholder")}
                      autoComplete="organization"
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
                          className={`${styles.chip} ${signupData.shopType === type ? styles.on : ""}`}
                          onClick={() => updateSignup({ shopType: type })}
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
                          updateSignup({ governorate: e.target.value })
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
                        value={signupData.area}
                        onChange={(e) => updateSignup({ area: e.target.value })}
                        placeholder={t("auth.areaPlaceholder")}
                      />
                    </Field>
                  </div>

                  <div className={styles.row2}>
                    <Field
                      label={t("auth.openedDateLabel")}
                      err={fieldErrors["opened"]}
                    >
                      <input
                        type="date"
                        value={signupData.openedOn}
                        onChange={(e) =>
                          updateSignup({ openedOn: e.target.value })
                        }
                      />
                    </Field>

                    <Field label={t("auth.workersCountLabel")}>
                      <div className={styles.stepper}>
                        <button
                          type="button"
                          aria-label="أقل"
                          onClick={() =>
                            updateSignup({
                              workersCount: Math.max(
                                0,
                                signupData.workersCount - 1,
                              ),
                            })
                          }
                        >
                          −
                        </button>
                        <b>{signupData.workersCount}</b>
                        <button
                          type="button"
                          aria-label="أكتر"
                          onClick={() =>
                            updateSignup({
                              workersCount: Math.min(
                                99,
                                signupData.workersCount + 1,
                              ),
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                    </Field>
                  </div>

                  <label className={styles.chkDemo}>
                    <input
                      type="checkbox"
                      checked={signupData.withDemoData}
                      onChange={(e) =>
                        updateSignup({ withDemoData: e.target.checked })
                      }
                    />
                    <div className={styles.chkDemoText}>
                      <b>{t("auth.demoData")}</b>
                      <small>{t("auth.demoDataDesc")}</small>
                    </div>
                  </label>

                  <div className={styles.actions}>
                    <Button
                      kind="ghost"
                      className="lg"
                      onClick={() => {
                        setDir(-1);
                        setStep(0);
                      }}
                    >
                      {t("auth.back")}
                    </Button>
                    <Button
                      className={`lg ${styles.grow1}`}
                      disabled={busy}
                      onClick={handleCreateAccount}
                    >
                      {busy ? t("auth.creating") : t("auth.createAccount")}
                    </Button>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              className={styles.linkCenter}
              onClick={() => {
                setMode("login");
                setFieldErrors({});
                setGlobalErr("");
              }}
            >
              {t("auth.hasAccount")}
            </button>
          </>
        )}

        {mode === "login" && (
          <div className={styles.body}>
            <Field label={t("auth.phoneLabel")} err={fieldErrors["phone"]}>
              <input
                autoFocus
                dir="ltr"
                className="ltr"
                inputMode="tel"
                value={loginPhone}
                onChange={(e) => {
                  setLoginPhone(e.target.value);
                  setFieldErrors({});
                  setGlobalErr("");
                }}
                placeholder={t("auth.phonePlaceholder")}
                autoComplete="tel"
              />
            </Field>

            <Field label={t("auth.passwordLabel")} err={fieldErrors["pass"]}>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => {
                  setLoginPassword(e.target.value);
                  setFieldErrors({});
                  setGlobalErr("");
                }}
                placeholder={t("auth.passwordPlaceholder")}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
              />
            </Field>

            <div className={styles.actions}>
              <Button
                className={`lg ${styles.grow1}`}
                disabled={busy}
                onClick={handleLogin}
              >
                {t("auth.login")}
              </Button>
            </div>

            <button
              type="button"
              className={styles.linkCenter}
              onClick={handleRequestOtp}
            >
              {t("auth.otpTitle")}
            </button>

            <button
              type="button"
              className={styles.linkCenter}
              onClick={() => {
                setMode("signup");
                setFieldErrors({});
                setGlobalErr("");
              }}
            >
              {t("auth.noAccount")}
            </button>
          </div>
        )}

        {mode === "otp" && (
          <div className={styles.body}>
            <Field label={t("auth.otpTitle")} err={fieldErrors["otp"]}>
              <input
                autoFocus
                dir="ltr"
                className="ltr"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value);
                  setFieldErrors({});
                  setGlobalErr("");
                }}
                placeholder={t("auth.otpPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleVerifyOtp();
                }}
              />
            </Field>

            <div className={styles.actions}>
              <Button
                kind="ghost"
                className="lg"
                onClick={() => setMode("login")}
              >
                {t("auth.back")}
              </Button>
              <Button
                className={`lg ${styles.grow1}`}
                disabled={busy}
                onClick={handleVerifyOtp}
              >
                {t("auth.verify")}
              </Button>
            </div>

            <button
              type="button"
              className={styles.linkCenter}
              onClick={handleRequestOtp}
            >
              {t("auth.resendOtp")}
            </button>
          </div>
        )}

        <small className={styles.note}>{t("auth.testNote")}</small>
      </div>
    </div>
  );
}
