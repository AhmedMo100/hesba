"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/client/shared/auth/AuthScreen.module.css";
import { Button, Field, Icon } from "@/client/shared/ui";
import { useTranslation } from "@/client/shared/i18n";
import { authApi } from "@/client/shared/api";
import { normDigits } from "@/client/shared/auth";

function VerifyLinkContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tok = searchParams.get("token");
  const typ = searchParams.get("type");

  const { t } = useTranslation();
  const [loading, setLoading] = useState(() => Boolean(tok));
  const [err, setErr] = useState(() =>
    tok ? "" : t("errors.linkExpiredOrUsed"),
  );
  const [successType, setSuccessType] = useState<
    "login" | "recovery" | "verify_email" | null
  >(null);

  // PIN setup state after login / recovery verification
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tok) {
      return;
    }

    async function verify() {
      try {
        if (typ === "login") {
          const res = await authApi.verifyMagicLink(tok!);
          if (res.success && res.data) {
            setSuccessType("login");
          } else {
            setErr(res.error || t("errors.linkExpiredOrUsed"));
          }
        } else if (typ === "recovery") {
          const res = await authApi.verifyRecoveryToken(tok!);
          if (res.success && res.data) {
            setSuccessType("recovery");
          } else {
            setErr(res.error || t("errors.linkExpiredOrUsed"));
          }
        } else if (typ === "verify_email") {
          const res = await authApi.verifyEmail(tok!);
          if (res.success) {
            setSuccessType("verify_email");
          } else {
            setErr(res.error || t("errors.linkExpiredOrUsed"));
          }
        } else {
          setErr(t("errors.linkExpiredOrUsed"));
        }
      } catch {
        setErr(t("errors.linkExpiredOrUsed"));
      } finally {
        setLoading(false);
      }
    }

    verify();
  }, [tok, typ, t]);

  const handleSavePinAndEnter = async () => {
    const norm = normDigits(pin).trim();
    const normC = normDigits(confirmPin).trim();

    if (norm.length !== 6) {
      setPinErr(t("errors.pinLength"));
      return;
    }
    if (norm !== normC) {
      setPinErr(t("errors.pinMismatch"));
      return;
    }

    setBusy(true);
    try {
      await authApi.setPin(norm);
      router.push("/app");
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
          <h1>{t("auth.verifyLinkTitle")}</h1>
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <p style={{ color: "var(--ink2)", fontSize: "14px" }}>
              {t("auth.verifyLinkLoading")}
            </p>
          </div>
        )}

        {err && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div
              style={{
                color: "var(--danger, #e74c3c)",
                fontSize: "14px",
                marginBottom: "20px",
              }}
            >
              {err}
            </div>
            <Button
              className="lg"
              onClick={() => {
                router.push("/");
              }}
            >
              {t("auth.hasAccount")}
            </Button>
          </div>
        )}

        {!loading && !err && successType === "verify_email" && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div className={styles.successIconBox}>
              <Icon n="check" s={32} />
            </div>
            <h3 style={{ fontSize: "17px", margin: "16px 0 8px" }}>
              {t("auth.verifyLinkEmailSuccess")}
            </h3>
            <div className={styles.actions} style={{ marginTop: "24px" }}>
              <Button
                className={`lg ${styles.grow1}`}
                onClick={() => {
                  router.push("/app");
                }}
              >
                {t("auth.enterApp")}
              </Button>
            </div>
          </div>
        )}

        {!loading &&
          !err &&
          (successType === "login" || successType === "recovery") && (
            <div className={styles.body}>
              <div style={{ textAlign: "center", marginBottom: "8px" }}>
                <h3 style={{ fontSize: "16px", marginBottom: "6px" }}>
                  {successType === "login"
                    ? t("auth.verifyLinkLoginSuccess")
                    : t("auth.verifyLinkRecoverySuccess")}
                </h3>
              </div>

              <Field label={t("auth.pinLabel")} err={pinErr}>
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
                    setPinErr("");
                  }}
                />
              </Field>

              <Field label={t("auth.confirmPinLabel")}>
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
                    setPinErr("");
                  }}
                />
              </Field>

              <div className={styles.actions}>
                <Button
                  className={`lg ${styles.grow1}`}
                  icon="check"
                  disabled={busy}
                  onClick={handleSavePinAndEnter}
                >
                  {t("auth.savePinAndContinue")}
                </Button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

export default function VerifyLinkPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "40px", textAlign: "center" }}>
          جاري التحميل...
        </div>
      }
    >
      <VerifyLinkContent />
    </Suspense>
  );
}
