"use client";

import React, { useState } from "react";
import { AuthScreen, ProfileModal } from "@/client/shared/auth";
import { ToastProvider, Button } from "@/client/shared/ui";

export default function DevAuthClient() {
  const [screen, setScreen] = useState<
    | "signup-1"
    | "signup-2"
    | "login"
    | "forgot-password"
    | "forgot-password-code"
    | "profile"
    | "reset-success"
    | "error-feedback"
  >(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("screen");
      if (
        p === "signup-1" ||
        p === "signup-2" ||
        p === "login" ||
        p === "forgot-password" ||
        p === "forgot-password-code" ||
        p === "profile" ||
        p === "reset-success" ||
        p === "error-feedback"
      ) {
        return p;
      }
    }
    return "signup-1";
  });

  const [showProfile, setShowProfile] = useState(true);

  return (
    <ToastProvider>
      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          direction: "rtl",
        }}
      >
        <div
          id="dev-auth-toolbar"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--sf)",
            borderBottom: "1px solid var(--line)",
            padding: "8px 12px",
            display: "flex",
            gap: "8px",
            overflowX: "auto",
          }}
        >
          <Button
            kind={screen === "signup-1" ? "primary" : "ghost"}
            onClick={() => setScreen("signup-1")}
          >
            عنك (1)
          </Button>
          <Button
            kind={screen === "signup-2" ? "primary" : "ghost"}
            onClick={() => setScreen("signup-2")}
          >
            محلك (2)
          </Button>
          <Button
            kind={screen === "login" ? "primary" : "ghost"}
            onClick={() => setScreen("login")}
          >
            دخول
          </Button>
          <Button
            kind={screen === "forgot-password" ? "primary" : "ghost"}
            onClick={() => setScreen("forgot-password")}
          >
            طلب الكود
          </Button>
          <Button
            kind={screen === "forgot-password-code" ? "primary" : "ghost"}
            onClick={() => setScreen("forgot-password-code")}
          >
            إدخال الكود
          </Button>
          <Button
            kind={screen === "reset-success" ? "primary" : "ghost"}
            onClick={() => setScreen("reset-success")}
          >
            تأكيد النجاح
          </Button>
          <Button
            kind={screen === "error-feedback" ? "primary" : "ghost"}
            onClick={() => setScreen("error-feedback")}
          >
            رسالة خطأ
          </Button>
          <Button
            kind={screen === "profile" ? "primary" : "ghost"}
            onClick={() => {
              setScreen("profile");
              setShowProfile(true);
            }}
          >
            الملف الشخصي
          </Button>
        </div>

        <div style={{ paddingTop: "56px" }}>
          {screen === "signup-1" && (
            <AuthScreen initialMode="signup" initialStep={0} />
          )}

          {screen === "signup-2" && (
            <AuthScreen initialMode="signup" initialStep={1} />
          )}

          {screen === "login" && <AuthScreen initialMode="login" />}

          {screen === "forgot-password" && (
            <AuthScreen initialMode="forgot-password" initialForgotStep={0} />
          )}

          {screen === "forgot-password-code" && (
            <AuthScreen initialMode="forgot-password" initialForgotStep={1} />
          )}

          {screen === "reset-success" && (
            <AuthScreen
              initialMode="login"
              initialSuccessTitle="تم تغيير كلمة السر بنجاح"
              initialSuccess="سجل دخولك الآن بكلمة السر الجديدة للاستمرار في إدارة محلك."
            />
          )}

          {screen === "error-feedback" && (
            <AuthScreen
              initialMode="login"
              initialError="رقم الموبايل أو كلمة السر غير صحيحة. تأكد من البيانات وحاول تاني."
              initialFieldErrors={{
                loginPhone: "رقم موبايل مصري صحيح (01xxxxxxxxx)",
              }}
            />
          )}

          {screen === "profile" && showProfile && (
            <ProfileModal onClose={() => setShowProfile(false)} />
          )}
        </div>
      </div>
    </ToastProvider>
  );
}
