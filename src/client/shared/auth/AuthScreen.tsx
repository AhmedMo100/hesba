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
  if (!v || !v.trim()) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export interface AuthScreenProps {
  initialMode?: "signup" | "login" | "recovery";
  onSuccess?: (session: SessionState) => void;
  isOffline?: boolean;
}

export function AuthScreen({
  initialMode = "signup",
  onSuccess,
  isOffline = false,
}: AuthScreenProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"signup" | "login" | "recovery">(
    initialMode,
  );
  const [step, setStep] = useState(0); // 0 = عنك, 1 = محلك, 2 = أمان الجهاز (Passkey)
  const [dir, setDir] = useState<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const [globalErr, setGlobalErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 1. Signup state
  const [signupData, setSignupData] = useState<SignupInput>({
    ownerName: "",
    phone: "",
    email: "",
    storeName: "",
    shopType: "سوبر ماركت",
    governorate: "القاهرة",
    area: "",
    openedOn: new Date().toISOString().split("T")[0] ?? "2024-01-01",
    workersCount: 1,
    withDemoData: true,
  });

  // 2. Login state
  const [loginIdentifier, setLoginIdentifier] = useState("");

  // 3. Recovery state
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoverySent, setRecoverySent] = useState(false);

  const updateSignup = (patch: Partial<SignupInput>) => {
    setSignupData((prev) => ({ ...prev, ...patch }));
    setFieldErrors({});
    setGlobalErr("");
  };

  const handleNextToStep2 = () => {
    const errs: Record<string, string> = {};
    if (signupData.ownerName.trim().length < 2) {
      errs["owner"] = t("errors.writeName");
    }
    if (!okPhone(signupData.phone)) {
      errs["phone"] = t("errors.invalidPhone");
    }
    if (!okMail(signupData.email)) {
      errs["email"] = t("errors.invalidEmail");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setDir(1);
    setStep(1);
  };

  const handleNextToStep3 = async () => {
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
        email: signupData.email.trim().toLowerCase(),
      });

      if (!res.success) {
        setGlobalErr(res.error || t("errors.serverError"));
        return;
      }

      setDir(1);
      setStep(2);
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterPasskey = async () => {
    setBusy(true);
    setGlobalErr("");

    try {
      const res = await authApi.completePasskeyRegistration();
      if (!res.success || !res.data) {
        setGlobalErr(res.error || t("auth.passkeyCanceled"));
        return;
      }

      onSuccess?.(res.data);
    } catch {
      setGlobalErr(t("auth.passkeyCanceled"));
    } finally {
      setBusy(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setBusy(true);
    setGlobalErr("");

    try {
      const trimmedId = loginIdentifier
        ? normDigits(loginIdentifier).trim()
        : undefined;
      const optsRes = await authApi.getPasskeyAuthOptions(trimmedId);

      if (!optsRes.success) {
        setGlobalErr(optsRes.error || t("errors.serverError"));
        return;
      }

      const res = await authApi.loginWithPasskey();
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

  const handleRequestRecovery = async () => {
    if (!okMail(recoveryEmail)) {
      setFieldErrors({ email: t("errors.invalidEmail") });
      return;
    }

    setBusy(true);
    setGlobalErr("");
    try {
      const res = await authApi.requestAccountRecovery(
        recoveryEmail.trim().toLowerCase(),
      );
      if (res.success) {
        setRecoverySent(true);
      } else {
        setGlobalErr(res.error || t("errors.serverError"));
      }
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.auth}>
      <div className={styles.card}>
        <div className={styles.head}>
          {/* Approved Hesba Logo Matching Demo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="حسبة"
            className={styles.logoImg}
            style={{ height: mode === "signup" ? 56 : 76 }}
          />

          <h1>
            {mode === "signup"
              ? t("auth.signupTitle")
              : mode === "login"
                ? t("auth.loginTitle")
                : t("auth.recoveryTitle")}
          </h1>
          <p>
            {mode === "signup"
              ? t("auth.signupSub")
              : mode === "login"
                ? t("auth.loginSub")
                : t("auth.recoverySub")}
          </p>
        </div>

        {globalErr && <div className={styles.globalErr}>{globalErr}</div>}

        {isOffline && (
          <div className={styles.offlineNotice}>
            <Icon n="wifioff" s={16} />
            <span>{t("auth.offlineNotice")}</span>
          </div>
        )}

        {/* MODE: SIGNUP */}
        {mode === "signup" && (
          <>
            <div className={styles.steps}>
              <div
                className={`${styles.st} ${step === 0 ? styles.active : ""} ${step > 0 ? styles.done : ""}`}
              >
                <span>{step > 0 ? "✓" : "١"}</span>
                <small>{t("auth.step1")}</small>
              </div>
              <div
                className={`${styles.st} ${step === 1 ? styles.active : ""} ${step > 1 ? styles.done : ""}`}
              >
                <span>{step > 1 ? "✓" : "٢"}</span>
                <small>{t("auth.step2")}</small>
              </div>
              <div
                className={`${styles.st} ${step === 2 ? styles.active : ""}`}
              >
                <span>٣</span>
                <small>{t("auth.step3")}</small>
              </div>
            </div>

            {/* STEP 0: عنك */}
            {step === 0 && (
              <div className={styles.body} data-dir={dir}>
                <Field label={t("auth.ownerLabel")} err={fieldErrors["owner"]}>
                  <input
                    type="text"
                    value={signupData.ownerName}
                    onChange={(e) =>
                      updateSignup({ ownerName: e.target.value })
                    }
                    placeholder={t("auth.ownerPlaceholder")}
                    autoFocus
                  />
                </Field>

                <Field label={t("auth.phoneLabel")} err={fieldErrors["phone"]}>
                  <input
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    className="ltr"
                    value={signupData.phone}
                    onChange={(e) => updateSignup({ phone: e.target.value })}
                    placeholder={t("auth.phonePlaceholder")}
                  />
                </Field>

                <Field
                  label={t("auth.emailLabel")}
                  err={fieldErrors["email"]}
                  hint={t("auth.emailHelp")}
                >
                  <input
                    type="email"
                    inputMode="email"
                    dir="ltr"
                    className="ltr"
                    value={signupData.email}
                    onChange={(e) => updateSignup({ email: e.target.value })}
                    placeholder={t("auth.emailPlaceholder")}
                  />
                </Field>

                <div className={styles.actions}>
                  <Button
                    kind="primary"
                    className={`lg ${styles.grow1}`}
                    onClick={handleNextToStep2}
                  >
                    {t("auth.next")}
                  </Button>
                </div>

                <button
                  type="button"
                  className={styles.linkCenter}
                  onClick={() => {
                    setMode("login");
                    setGlobalErr("");
                  }}
                >
                  {t("auth.hasAccountLink")}
                </button>
              </div>
            )}

            {/* STEP 1: محلك */}
            {step === 1 && (
              <div className={styles.body} data-dir={dir}>
                <Field
                  label={t("auth.storeNameLabel")}
                  err={fieldErrors["storeName"]}
                >
                  <input
                    type="text"
                    value={signupData.storeName}
                    onChange={(e) =>
                      updateSignup({ storeName: e.target.value })
                    }
                    placeholder={t("auth.storeNamePlaceholder")}
                    autoFocus
                  />
                </Field>

                <div className={styles.row2}>
                  <Field label={t("auth.shopTypeLabel")}>
                    <select
                      value={signupData.shopType}
                      onChange={(e) =>
                        updateSignup({ shopType: e.target.value })
                      }
                    >
                      {SHOP_TYPES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t("auth.governorateLabel")}>
                    <select
                      value={signupData.governorate}
                      onChange={(e) =>
                        updateSignup({ governorate: e.target.value })
                      }
                    >
                      {GOVERNORATES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className={styles.row2}>
                  <Field label={t("auth.areaLabel")}>
                    <input
                      type="text"
                      value={signupData.area ?? ""}
                      onChange={(e) => updateSignup({ area: e.target.value })}
                      placeholder={t("auth.areaPlaceholder")}
                    />
                  </Field>

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
                </div>

                <Field label={t("auth.workersCountLabel")}>
                  <select
                    value={signupData.workersCount}
                    onChange={(e) =>
                      updateSignup({
                        workersCount: parseInt(e.target.value, 10) || 1,
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

                <label className={styles.chkDemo}>
                  <input
                    type="checkbox"
                    checked={signupData.withDemoData}
                    onChange={(e) =>
                      updateSignup({ withDemoData: e.target.checked })
                    }
                  />
                  <span className={styles.chkDemoText}>
                    <b>{t("auth.demoData")}</b>
                    <small>{t("auth.demoDataDesc")}</small>
                  </span>
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
                    kind="primary"
                    className={`lg ${styles.grow1}`}
                    busy={busy}
                    onClick={handleNextToStep3}
                  >
                    {t("auth.next")}
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2: أمان الجهاز (Passkey) */}
            {step === 2 && (
              <div className={styles.body} data-dir={dir}>
                <div style={{ textAlign: "center", padding: "16px 0 24px" }}>
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      margin: "0 auto 16px",
                      borderRadius: "50%",
                      background:
                        "color-mix(in srgb, var(--br) 12%, transparent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--br)",
                    }}
                  >
                    <Icon n="sparkle" s={32} />
                  </div>
                  <h3
                    style={{
                      fontSize: 18,
                      margin: "0 0 8px",
                      color: "var(--ink)",
                    }}
                  >
                    {t("auth.passkeyStepTitle")}
                  </h3>
                  <p
                    style={{
                      fontSize: 14,
                      color: "var(--ink2)",
                      margin: 0,
                      lineHeight: 1.6,
                    }}
                  >
                    {t("auth.passkeyStepSub")}
                  </p>
                </div>

                <div className={styles.actions}>
                  <Button
                    kind="primary"
                    className={`lg ${styles.grow1}`}
                    busy={busy}
                    onClick={handleRegisterPasskey}
                  >
                    {t("auth.registerPasskeyBtn")}
                  </Button>
                </div>

                <button
                  type="button"
                  className={styles.linkCenter}
                  onClick={() => {
                    setMode("login");
                    setGlobalErr("");
                  }}
                >
                  {t("auth.hasAccountLink")}
                </button>
              </div>
            )}
          </>
        )}

        {/* MODE: LOGIN (Passkey Login) */}
        {mode === "login" && (
          <div className={styles.body}>
            <Field
              label={t("auth.phoneLabel") + " / " + t("auth.emailLabel")}
              hint="اختياري — لو جهازك مسجل عليه مفتاح المرور تقدر تدخل مباشرة"
            >
              <input
                type="text"
                dir="ltr"
                className="ltr"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                placeholder="01xxxxxxxxx / name@email.com"
                autoFocus
              />
            </Field>

            <div className={styles.actions}>
              <Button
                kind="primary"
                className={`lg ${styles.grow1}`}
                busy={busy}
                onClick={handlePasskeyLogin}
              >
                {t("auth.loginPasskeyBtn")}
              </Button>
            </div>

            <div
              style={{
                marginTop: 20,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <button
                type="button"
                className={styles.linkCenter}
                onClick={() => {
                  setMode("signup");
                  setStep(0);
                  setGlobalErr("");
                }}
              >
                {t("auth.noAccountLink")}
              </button>

              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ink2)",
                  fontSize: 13,
                  cursor: "pointer",
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
                onClick={() => {
                  setMode("recovery");
                  setRecoverySent(false);
                  setGlobalErr("");
                }}
              >
                {t("auth.forgotPasskey")}
              </button>
            </div>
          </div>
        )}

        {/* MODE: RECOVERY (Single-use Expiring Link via Resend) */}
        {mode === "recovery" && (
          <div className={styles.body}>
            {!recoverySent ? (
              <>
                <Field
                  label={t("auth.recoveryEmailLabel")}
                  err={fieldErrors["email"]}
                  hint="هنبعتلك رابط استرداد آمن لمرة واحدة وصالح لمدة ساعة لإعادة تسجيل مفتاح المرور"
                >
                  <input
                    type="email"
                    dir="ltr"
                    className="ltr"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="name@email.com"
                    autoFocus
                  />
                </Field>

                <div className={styles.actions}>
                  <Button
                    kind="primary"
                    className={`lg ${styles.grow1}`}
                    busy={busy}
                    onClick={handleRequestRecovery}
                  >
                    {t("auth.sendRecoveryLink")}
                  </Button>
                </div>

                <button
                  type="button"
                  className={styles.linkCenter}
                  onClick={() => {
                    setMode("login");
                    setGlobalErr("");
                  }}
                >
                  {t("auth.hasAccountLink")}
                </button>
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background:
                      "color-mix(in srgb, var(--ok, #27ae60) 12%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--ok, #27ae60)",
                    margin: "0 auto 16px",
                  }}
                >
                  <Icon n="check" s={28} />
                </div>
                <h2
                  style={{
                    fontSize: 18,
                    color: "var(--ink)",
                    margin: "0 0 8px",
                  }}
                >
                  {t("auth.recoverySentTitle")}
                </h2>
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--ink2)",
                    lineHeight: 1.6,
                    margin: "0 0 24px",
                  }}
                >
                  {t("auth.recoverySuccessMsg")}
                </p>
                <Button
                  kind="ghost"
                  className="lg"
                  onClick={() => {
                    setMode("login");
                    setRecoverySent(false);
                    setGlobalErr("");
                  }}
                >
                  {t("auth.hasAccountLink")}
                </Button>
              </div>
            )}
          </div>
        )}

        <small className={styles.note}>{t("auth.testNote")}</small>
      </div>
    </div>
  );
}
