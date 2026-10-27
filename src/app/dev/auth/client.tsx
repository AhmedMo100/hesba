"use client";

import React, { useState } from "react";
import { AuthScreen, PinLockScreen, ProfileModal } from "@/client/shared/auth";
import { ToastProvider, Button } from "@/client/shared/ui";

export default function DevAuthClient() {
  const [screen, setScreen] = useState<
    "signup-1" | "signup-2" | "login" | "otp" | "pin" | "profile"
  >(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("screen");
      if (
        p === "signup-1" ||
        p === "signup-2" ||
        p === "login" ||
        p === "otp" ||
        p === "pin" ||
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
            kind={screen === "otp" ? "primary" : "ghost"}
            onClick={() => setScreen("otp")}
          >
            كود OTP
          </Button>
          <Button
            kind={screen === "pin" ? "primary" : "ghost"}
            onClick={() => setScreen("pin")}
          >
            قفل PIN
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
          {(screen === "signup-1" || screen === "signup-2") && (
            <AuthScreen initialMode="signup" />
          )}

          {screen === "login" && <AuthScreen initialMode="login" />}

          {screen === "otp" && <AuthScreen initialMode="otp" />}

          {screen === "pin" && <PinLockScreen onUnlock={() => {}} />}

          {screen === "profile" && showProfile && (
            <ProfileModal onClose={() => setShowProfile(false)} />
          )}
        </div>
      </div>
    </ToastProvider>
  );
}
