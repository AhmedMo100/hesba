"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/client/shared/auth/AuthScreen.module.css";
import { Button, Icon } from "@/client/shared/ui";
import { useTranslation } from "@/client/shared/i18n";
import { authApi } from "@/client/shared/api";

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
  const [userEmail, setUserEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!tok) {
      return;
    }

    async function verify() {
      try {
        if (typ === "recovery") {
          const res = await authApi.verifyRecoveryToken(tok!);
          if (res.success && res.data) {
            setUserEmail(res.data.email || "");
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
        } else if (typ === "login") {
          if (authApi.verifyMagicLink) {
            const res = await authApi.verifyMagicLink(tok!);
            if (res.success && res.data) {
              setSuccessType("login");
            } else {
              setErr(res.error || t("errors.linkExpiredOrUsed"));
            }
          } else {
            setErr(t("errors.linkExpiredOrUsed"));
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

  const handleCompleteRecovery = async () => {
    if (!tok) return;
    setBusy(true);
    setErr("");

    try {
      const res = await authApi.completeAccountRecovery({
        token: tok,
        passkeyLabel: "جهاز مسترد",
      });

      if (!res.success) {
        setErr(res.error || t("auth.passkeyCanceled"));
        return;
      }

      setCompleted(true);
      setTimeout(() => {
        router.push("/app");
      }, 1500);
    } catch {
      setErr(t("auth.passkeyCanceled"));
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
            style={{ height: 56 }}
          />

          <h1>{t("auth.verifyLinkTitle")}</h1>
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <p style={{ color: "var(--ink2)", fontSize: 14 }}>
              {t("auth.verifyLinkLoading")}
            </p>
          </div>
        )}

        {err && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div className={styles.globalErr} style={{ marginBottom: 16 }}>
              {err}
            </div>
            <Button
              kind="primary"
              className="lg"
              onClick={() => router.push("/")}
            >
              {t("auth.hasAccountLink")}
            </Button>
          </div>
        )}

        {!loading && !err && (
          <div className={styles.body}>
            {/* RECOVERY PASSKEY RE-REGISTRATION */}
            {successType === "recovery" && !completed && (
              <div style={{ textAlign: "center", padding: "8px 0" }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background:
                      "color-mix(in srgb, var(--br) 12%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--br)",
                    margin: "0 auto 16px",
                  }}
                >
                  <Icon n="sparkle" s={28} />
                </div>
                <h2
                  style={{
                    fontSize: 18,
                    color: "var(--ink)",
                    margin: "0 0 8px",
                  }}
                >
                  {t("auth.recoveryTitle")}
                </h2>
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--ink2)",
                    lineHeight: 1.6,
                    margin: "0 0 20px",
                  }}
                >
                  {userEmail
                    ? `تم التحقق من رابط الاسترداد لـ (${userEmail}). `
                    : ""}
                  {t("auth.verifyLinkRecoverySuccess")}
                </p>

                <div className={styles.actions}>
                  <Button
                    kind="primary"
                    className={`lg ${styles.grow1}`}
                    busy={busy}
                    onClick={handleCompleteRecovery}
                  >
                    {t("auth.recoveryEnterPasskey")}
                  </Button>
                </div>
              </div>
            )}

            {/* RECOVERY COMPLETED */}
            {successType === "recovery" && completed && (
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
                  {t("auth.recoveryCompleteSuccess")}
                </h2>
                <p style={{ fontSize: 14, color: "var(--ink2)", margin: 0 }}>
                  جاري تحويلك إلى المحل…
                </p>
              </div>
            )}

            {/* EMAIL VERIFICATION SUCCESS */}
            {successType === "verify_email" && (
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
                  {t("auth.verifyLinkEmailSuccess")}
                </h2>
                <div className={styles.actions} style={{ marginTop: 20 }}>
                  <Button
                    kind="primary"
                    className={`lg ${styles.grow1}`}
                    onClick={() => router.push("/app")}
                  >
                    {t("auth.enterApp")}
                  </Button>
                </div>
              </div>
            )}

            {/* MAGIC LINK / DIRECT LOGIN SUCCESS */}
            {successType === "login" && (
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
                  {t("auth.verifyLinkLoginSuccess")}
                </h2>
                <div className={styles.actions} style={{ marginTop: 20 }}>
                  <Button
                    kind="primary"
                    className={`lg ${styles.grow1}`}
                    onClick={() => router.push("/app")}
                  >
                    {t("auth.enterApp")}
                  </Button>
                </div>
              </div>
            )}
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
        <div className={styles.auth}>
          <div className={styles.card}>
            <div style={{ textAlign: "center", padding: 20 }}>
              جاري التحميل…
            </div>
          </div>
        </div>
      }
    >
      <VerifyLinkContent />
    </Suspense>
  );
}
