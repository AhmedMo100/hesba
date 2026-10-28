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
  const [step, setStep] = useState(0); // 0 = عنك, 1 = محلك, 2 = أمان الجهاز
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
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  // 2. Login state (Magic link)
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSent, setLoginSent] = useState(false);

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

  const handleNextToStep3 = () => {
    const errs: Record<string, string> = {};
    if (!signupData.storeName.trim()) {
      errs["storeName"] = t("errors.writeStoreName");
    }
    if (!signupData.openedOn) {
      errs["opened"] = t("errors.chooseOpenedDate");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setDir(1);
    setStep(2);
  };

  const handleCreateAccount = async () => {
    const errs: Record<string, string> = {};
    const normPin = normDigits(pin).trim();
    const normConfirm = normDigits(confirmPin).trim();

    if (normPin.length !== 6) {
      errs["pin"] = t("errors.pinLength");
    } else if (normPin !== normConfirm) {
      errs["confirmPin"] = t("errors.pinMismatch");
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

      if (!res.success || !res.data) {
        setGlobalErr(res.error || t("errors.serverError"));
        return;
      }

      // Save local device PIN
      await authApi.setPin(normPin);

      onSuccess?.(res.data);
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  };

  const handleRequestMagicLink = async () => {
    if (!okMail(loginEmail)) {
      setFieldErrors({ email: t("errors.invalidEmail") });
      return;
    }

    setBusy(true);
    setGlobalErr("");
    try {
      const res = await authApi.requestMagicLink(
        loginEmail.trim().toLowerCase(),
      );
      if (res.success) {
        setLoginSent(true);
      } else {
        setGlobalErr(res.error || t("errors.serverError"));
      }
    } catch {
      setGlobalErr(t("errors.serverError"));
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
          <div className={styles.logoBox}>
            <Icon n="cart" s={28} />
          </div>
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

        {globalErr && <div className={styles.errBox}>{globalErr}</div>}

        {isOffline && (
          <div className={styles.offlineBox}>
            <Icon n="wifioff" s={16} />
            <span>{t("auth.offlineNotice")}</span>
          </div>
        )}

        {/* ================= EXPERIENCE A: SIGNUP (3-STEP) ================= */}
        {mode === "signup" && (
          <>
            <div className={styles.steps}>
              <div
                className={`${styles.st} ${step === 0 ? styles.on : step > 0 ? styles.done : ""}`}
              >
                <div className={styles.stN}>1</div>
                <span>{t("auth.step1")}</span>
              </div>
              <div
                className={`${styles.st} ${step === 1 ? styles.on : step > 1 ? styles.done : ""}`}
              >
                <div className={styles.stN}>2</div>
                <span>{t("auth.step2")}</span>
              </div>
              <div className={`${styles.st} ${step === 2 ? styles.on : ""}`}>
                <div className={styles.stN}>3</div>
                <span>{t("auth.step3")}</span>
              </div>
              <div className={styles.stLine}>
                <span
                  className={styles.stLineFill}
                  style={{
                    transform: `scaleX(${step === 0 ? 0 : step === 1 ? 0.5 : 1})`,
                  }}
                />
              </div>
            </div>

            {/* STEP 1: Owner Information */}
            {step === 0 && (
              <div className={styles.body} data-dir={dir}>
                <Field label={t("auth.ownerLabel")} err={fieldErrors["owner"]}>
                  <input
                    autoFocus
                    placeholder={t("auth.ownerPlaceholder")}
                    value={signupData.ownerName}
                    onChange={(e) =>
                      updateSignup({ ownerName: e.target.value })
                    }
                  />
                </Field>

                <Field label={t("auth.phoneLabel")} err={fieldErrors["phone"]}>
                  <input
                    dir="ltr"
                    className="ltr"
                    inputMode="tel"
                    placeholder={t("auth.phonePlaceholder")}
                    value={signupData.phone}
                    onChange={(e) => updateSignup({ phone: e.target.value })}
                  />
                </Field>

                <Field label={t("auth.emailLabel")} err={fieldErrors["email"]}>
                  <input
                    dir="ltr"
                    className="ltr"
                    inputMode="email"
                    placeholder={t("auth.emailPlaceholder")}
                    value={signupData.email}
                    onChange={(e) => updateSignup({ email: e.target.value })}
                  />
                </Field>
                <small className={styles.fieldHelp}>
                  {t("auth.emailHelp")}
                </small>

                <div className={styles.actions}>
                  <Button
                    className={`lg ${styles.grow1}`}
                    icon="left"
                    onClick={handleNextToStep2}
                  >
                    {t("auth.next")}
                  </Button>
                </div>

                <div className={styles.switchLink}>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setGlobalErr("");
                      setFieldErrors({});
                    }}
                  >
                    {t("auth.hasAccount")}
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Shop Information */}
            {step === 1 && (
              <div className={styles.body} data-dir={dir}>
                <Field
                  label={t("auth.storeNameLabel")}
                  err={fieldErrors["storeName"]}
                >
                  <input
                    autoFocus
                    placeholder={t("auth.storeNamePlaceholder")}
                    value={signupData.storeName}
                    onChange={(e) =>
                      updateSignup({ storeName: e.target.value })
                    }
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
                      placeholder={t("auth.areaPlaceholder")}
                      value={signupData.area}
                      onChange={(e) => updateSignup({ area: e.target.value })}
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
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={signupData.workersCount}
                      onChange={(e) =>
                        updateSignup({
                          workersCount: parseInt(e.target.value, 10) || 1,
                        })
                      }
                    />
                  </Field>
                </div>

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
                    icon="left"
                    onClick={handleNextToStep3}
                  >
                    {t("auth.next")}
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3: Device Security & Local PIN */}
            {step === 2 && (
              <div className={styles.body} data-dir={dir}>
                <div style={{ textAlign: "center", marginBottom: "8px" }}>
                  <h3 style={{ fontSize: "16px", marginBottom: "4px" }}>
                    {t("auth.pinStepTitle")}
                  </h3>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--ink2)",
                      lineHeight: "1.5",
                    }}
                  >
                    {t("auth.pinStepSub")}
                  </p>
                </div>

                <Field label={t("auth.pinLabel")} err={fieldErrors["pin"]}>
                  <input
                    autoFocus
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    dir="ltr"
                    className="ltr"
                    placeholder="******"
                    value={pin}
                    onChange={(e) => {
                      setPin(normDigits(e.target.value).slice(0, 6));
                      setFieldErrors({});
                    }}
                  />
                </Field>

                <Field
                  label={t("auth.confirmPinLabel")}
                  err={fieldErrors["confirmPin"]}
                >
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    dir="ltr"
                    className="ltr"
                    placeholder="******"
                    value={confirmPin}
                    onChange={(e) => {
                      setConfirmPin(normDigits(e.target.value).slice(0, 6));
                      setFieldErrors({});
                    }}
                  />
                </Field>

                <div className={styles.actions}>
                  <Button
                    kind="ghost"
                    className="lg"
                    disabled={busy}
                    onClick={() => {
                      setDir(-1);
                      setStep(1);
                    }}
                  >
                    {t("auth.back")}
                  </Button>
                  <Button
                    className={`lg ${styles.grow1}`}
                    icon="check"
                    disabled={busy}
                    onClick={handleCreateAccount}
                  >
                    {busy ? t("auth.creating") : t("auth.createAccount")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ================= EXPERIENCE B: LOGIN (MAGIC LINK) ================= */}
        {mode === "login" && (
          <div className={styles.body}>
            {loginSent ? (
              <div style={{ textAlign: "center", padding: "12px 0" }}>
                <div className={styles.successIconBox}>
                  <Icon n="check" s={32} />
                </div>
                <h3 style={{ fontSize: "18px", margin: "14px 0 8px" }}>
                  {t("auth.magicLinkSentTitle")}
                </h3>
                <p
                  style={{
                    color: "var(--ink2)",
                    fontSize: "13.5px",
                    lineHeight: "1.6",
                    marginBottom: "20px",
                  }}
                >
                  {t("auth.magicLinkSentDesc")}
                </p>
                <Button
                  kind="ghost"
                  className="lg"
                  onClick={() => setLoginSent(false)}
                >
                  {t("auth.back")}
                </Button>
              </div>
            ) : (
              <>
                <Field
                  label={t("auth.loginEmailLabel")}
                  err={fieldErrors["email"]}
                >
                  <input
                    autoFocus
                    dir="ltr"
                    className="ltr"
                    inputMode="email"
                    placeholder={t("auth.emailPlaceholder")}
                    value={loginEmail}
                    onChange={(e) => {
                      setLoginEmail(e.target.value);
                      setFieldErrors({});
                      setGlobalErr("");
                    }}
                  />
                </Field>

                <div className={styles.actions}>
                  <Button
                    className={`lg ${styles.grow1}`}
                    disabled={busy}
                    onClick={handleRequestMagicLink}
                  >
                    {busy ? t("auth.sendingLink") : t("auth.sendMagicLinkBtn")}
                  </Button>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: "16px",
                    fontSize: "13px",
                  }}
                >
                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--br)",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                    onClick={() => {
                      setMode("signup");
                      setGlobalErr("");
                      setFieldErrors({});
                    }}
                  >
                    {t("auth.noAccount")}
                  </button>

                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--ink2)",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                    onClick={() => {
                      setMode("recovery");
                      setGlobalErr("");
                      setFieldErrors({});
                    }}
                  >
                    {t("auth.forgotPin")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ================= EXPERIENCE C: RECOVERY & PIN RESET ================= */}
        {mode === "recovery" && (
          <div className={styles.body}>
            {recoverySent ? (
              <div style={{ textAlign: "center", padding: "12px 0" }}>
                <div className={styles.successIconBox}>
                  <Icon n="check" s={32} />
                </div>
                <h3 style={{ fontSize: "18px", margin: "14px 0 8px" }}>
                  {t("auth.recoverySentTitle")}
                </h3>
                <p
                  style={{
                    color: "var(--ink2)",
                    fontSize: "13.5px",
                    lineHeight: "1.6",
                    marginBottom: "20px",
                  }}
                >
                  {t("auth.recoverySentDesc")}
                </p>
                <Button
                  kind="ghost"
                  className="lg"
                  onClick={() => setRecoverySent(false)}
                >
                  {t("auth.back")}
                </Button>
              </div>
            ) : (
              <>
                <Field
                  label={t("auth.recoveryEmailLabel")}
                  err={fieldErrors["email"]}
                >
                  <input
                    autoFocus
                    dir="ltr"
                    className="ltr"
                    inputMode="email"
                    placeholder={t("auth.emailPlaceholder")}
                    value={recoveryEmail}
                    onChange={(e) => {
                      setRecoveryEmail(e.target.value);
                      setFieldErrors({});
                      setGlobalErr("");
                    }}
                  />
                </Field>

                <div className={styles.actions}>
                  <Button
                    className={`lg ${styles.grow1}`}
                    disabled={busy}
                    onClick={handleRequestRecovery}
                  >
                    {busy
                      ? t("auth.sendingRecovery")
                      : t("auth.sendRecoveryLink")}
                  </Button>
                </div>

                <div className={styles.switchLink}>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setGlobalErr("");
                      setFieldErrors({});
                    }}
                  >
                    {t("auth.back")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
