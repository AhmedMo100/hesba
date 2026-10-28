"use client";

import React, { useState } from "react";
import { AuthScreen, ProfileModal } from "@/client/shared/auth";
import { ToastProvider, Button } from "@/client/shared/ui";

export default function DevAuthClient() {
  const [screen, setScreen] = useState<
    "signup-1" | "signup-2" | "login" | "forgot-password" | "profile"
  >(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("screen");
      if (
        p === "signup-1" ||
        p === "signup-2" ||
        p === "login" ||
        p === "forgot-password" ||
        p === "profile"
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
            نسيت كلمة السر
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
            <AuthScreen initialMode="forgot-password" />
          )}

          {screen === "profile" && showProfile && (
            <ProfileModal onClose={() => setShowProfile(false)} />
          )}
        </div>
      </div>
    </ToastProvider>
  );
}
