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
  initialMode?: "signup" | "login" | "passkey-reg" | "recovery";
  onSuccess?: (session: SessionState) => void;
  isOffline?: boolean;
}

export function AuthScreen({
  initialMode = "signup",
  onSuccess,
  isOffline = false,
}: AuthScreenProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<
    "signup" | "login" | "passkey-reg" | "recovery"
  >(initialMode);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const [globalErr, setGlobalErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Signup state (Passwords removed, Email required for recovery)
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

  // Login state (Identifier optional; Passkey primary)
  const [loginIdentifier, setLoginIdentifier] = useState("");

  // Passkey registration state
  const [passkeyStatus, setPasskeyStatus] = useState<
    "idle" | "registering" | "success" | "canceled" | "unsupported"
  >("idle");
  const [activeSession, setActiveSession] = useState<SessionState | null>(null);

  // Recovery state
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoverySent, setRecoverySent] = useState(false);

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
    if (!okMail(signupData.email)) {
      errs["email"] = t("errors.invalidEmail");
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
        email: signupData.email.trim().toLowerCase(),
      });

      if (!res.success || !res.data) {
        setGlobalErr(res.error || t("errors.serverError"));
        return;
      }

      setActiveSession(res.data.session);
      setMode("passkey-reg");
      setPasskeyStatus("idle");
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterPasskey = async () => {
    setBusy(true);
    setPasskeyStatus("registering");
    setGlobalErr("");

    try {
      const res = await authApi.completePasskeyRegistration({
        id: `passkey-cred-${Date.now()}-TEST`,
        rawId: `raw-cred-${Date.now()}-TEST`,
        type: "public-key",
        response: {
          clientDataJSON: "eyJjaGFsbGVuZ2UiOiJ0ZXN0In0=",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVik",
        },
      });

      if (!res.success || !res.data) {
        setPasskeyStatus("canceled");
        setGlobalErr(res.error || t("errors.passkeyFailed"));
        return;
      }

      setActiveSession(res.data);
      setPasskeyStatus("success");
    } catch {
      setPasskeyStatus("canceled");
      setGlobalErr(t("errors.passkeyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setBusy(true);
    setGlobalErr("");

    try {
      const optionsRes = await authApi.getPasskeyAuthOptions(
        loginIdentifier ? normDigits(loginIdentifier).trim() : undefined,
      );

      if (!optionsRes.success) {
        setGlobalErr(optionsRes.error || t("errors.serverError"));
        return;
      }

      const res = await authApi.loginWithPasskey({
        id: `passkey-auth-cred-${Date.now()}-TEST`,
        rawId: `raw-auth-${Date.now()}-TEST`,
        type: "public-key",
        response: {
          clientDataJSON: "eyJjaGFsbGVuZ2UiOiJ0ZXN0In0=",
          authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MBAAAA",
          signature: "MEUCIQD1TESTSIGNATURE",
        },
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

  const handleRequestRecovery = async () => {
    if (!okMail(recoveryEmail)) {
      setFieldErrors({ email: t("errors.invalidEmail") });
      return;
    }

    setBusy(true);
    setGlobalErr("");
    try {
      const res = await authApi.requestAccountRecovery({
        email: recoveryEmail.trim().toLowerCase(),
      });

      if (!res.success) {
        setGlobalErr(res.error || t("errors.serverError"));
        return;
      }

      setRecoverySent(true);
    } catch {
      setGlobalErr(t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteRecovery = async () => {
    setBusy(true);
    setGlobalErr("");
    try {
      const res = await authApi.completeAccountRecovery(
        {
          token: "valid-recovery-token-TEST",
          passkeyLabel: "مفتاح مرور جديد بعد الاسترداد (TEST)",
        },
        {
          id: `passkey-recovery-cred-${Date.now()}-TEST`,
          rawId: `raw-recovery-${Date.now()}-TEST`,
          type: "public-key",
          response: {
            clientDataJSON: "eyJjaGFsbGVuZ2UiOiJ0ZXN0In0=",
          },
        },
      );

      if (!res.success || !res.data) {
        setGlobalErr(res.error || t("errors.recoveryTokenUsed"));
        return;
      }

      onSuccess?.(res.data);
    } catch {
      setGlobalErr(t("errors.recoveryTokenUsed"));
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
                : mode === "passkey-reg"
                  ? t("auth.passkeyTitle")
                  : t("auth.recoveryTitle")}
          </h1>
          <p>
            {mode === "signup"
              ? t("auth.signupSub")
              : mode === "login"
                ? t("auth.loginSub")
                : mode === "passkey-reg"
                  ? t("auth.passkeySub")
                  : t("auth.recoverySub")}
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
                  <small
                    style={{
                      color: "var(--ink2)",
                      fontSize: "12px",
                      marginTop: "-8px",
                      marginBottom: "4px",
                      display: "block",
                    }}
                  >
                    {t("auth.emailHelp")}
                  </small>

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

        {mode === "passkey-reg" && (
          <div className={styles.body}>
            {passkeyStatus === "success" ? (
              <div style={{ textAlign: "center", padding: "16px 8px" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background:
                      "color-mix(in srgb, var(--green, #2ecc71) 15%, transparent)",
                    color: "var(--green, #2ecc71)",
                    marginBottom: "16px",
                  }}
                >
                  <Icon n="check" s={32} />
                </div>
                <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>
                  {t("auth.passkeySuccessTitle")}
                </h2>
                <p
                  style={{
                    color: "var(--ink2)",
                    fontSize: "14px",
                    marginBottom: "24px",
                  }}
                >
                  {t("auth.passkeySuccessSub")}
                </p>
                <Button
                  className="wide lg"
                  onClick={() => {
                    if (activeSession) onSuccess?.(activeSession);
                  }}
                >
                  {t("auth.enterApp")}
                </Button>
              </div>
            ) : (
              <>
                <div
                  style={{
                    background: "var(--sf2)",
                    border: "1.5px solid var(--line)",
                    borderRadius: "18px",
                    padding: "20px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "16px",
                      background:
                        "color-mix(in srgb, var(--br) 12%, var(--sf))",
                      color: "var(--br)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 12px",
                    }}
                  >
                    <Icon n="check" s={28} />
                  </div>
                  <b
                    style={{
                      display: "block",
                      fontSize: "15px",
                      marginBottom: "6px",
                    }}
                  >
                    {t("auth.passkeyPrompt")}
                  </b>
                  <p
                    style={{
                      color: "var(--ink2)",
                      fontSize: "13px",
                      margin: 0,
                    }}
                  >
                    {t("auth.passkeySub")}
                  </p>
                </div>

                <div className={styles.actions}>
                  <Button
                    className={`wide lg ${styles.grow1}`}
                    disabled={busy}
                    onClick={handleRegisterPasskey}
                  >
                    {busy
                      ? t("auth.registeringPasskey")
                      : t("auth.registerPasskeyBtn")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {mode === "login" && (
          <div className={styles.body}>
            <Field label={t("auth.phoneLabel")} err={fieldErrors["identifier"]}>
              <input
                autoFocus
                dir="ltr"
                className="ltr"
                inputMode="tel"
                value={loginIdentifier}
                onChange={(e) => {
                  setLoginIdentifier(e.target.value);
                  setFieldErrors({});
                  setGlobalErr("");
                }}
                placeholder={t("auth.phonePlaceholder")}
                autoComplete="username webauthn"
              />
            </Field>

            <div className={styles.actions}>
              <Button
                className={`wide lg ${styles.grow1}`}
                disabled={busy}
                onClick={handlePasskeyLogin}
              >
                {t("auth.login")}
              </Button>
            </div>

            <button
              type="button"
              className={styles.linkCenter}
              onClick={() => {
                setMode("recovery");
                setFieldErrors({});
                setGlobalErr("");
              }}
            >
              {t("auth.forgotPasskey")}
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

        {mode === "recovery" && (
          <div className={styles.body}>
            {recoverySent ? (
              <div style={{ textAlign: "center", padding: "16px 8px" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "56px",
                    height: "56px",
                    borderRadius: "50%",
                    background: "color-mix(in srgb, var(--br) 12%, var(--sf))",
                    color: "var(--br)",
                    marginBottom: "16px",
                  }}
                >
                  <Icon n="check" s={28} />
                </div>
                <h2 style={{ fontSize: "18px", marginBottom: "8px" }}>
                  {t("auth.recoverySentTitle")}
                </h2>
                <p
                  style={{
                    color: "var(--ink2)",
                    fontSize: "13px",
                    lineHeight: "1.6",
                    marginBottom: "20px",
                  }}
                >
                  {t("auth.recoverySentDesc")}
                </p>

                {/* Developer/Test action to complete recovery flow */}
                <Button
                  className="wide lg"
                  disabled={busy}
                  onClick={handleCompleteRecovery}
                >
                  {t("auth.completeRecoveryBtn")}
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
                    value={recoveryEmail}
                    onChange={(e) => {
                      setRecoveryEmail(e.target.value);
                      setFieldErrors({});
                      setGlobalErr("");
                    }}
                    placeholder={t("auth.emailPlaceholder")}
                    autoComplete="email"
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
                    onClick={handleRequestRecovery}
                  >
                    {busy
                      ? t("auth.sendingRecovery")
                      : t("auth.sendRecoveryLink")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <small className={styles.note}>{t("auth.testNote")}</small>
      </div>
    </div>
  );
}
