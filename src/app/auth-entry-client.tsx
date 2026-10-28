"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthScreen, PinLockScreen } from "@/client/shared/auth";
import { authApi } from "@/client/shared/api";
import { ToastProvider } from "@/client/shared/ui";

export function AuthEntryClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [mode, setMode] = useState<"login" | "signup" | "recovery">("login");

  useEffect(() => {
    authApi.getSession().then((session) => {
      if (session) {
        if (authApi.hasLocalPin()) {
          setIsLocked(true);
        } else {
          router.push("/app");
          return;
        }
      }
      setLoading(false);
    });
  }, [router]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
        }}
      >
        <span style={{ color: "var(--ink2)", fontSize: "14px" }}>
          جاري التحميل...
        </span>
      </div>
    );
  }

  if (isLocked) {
    return (
      <ToastProvider>
        <PinLockScreen
          onUnlock={() => {
            router.push("/app");
          }}
          onLogout={async () => {
            await authApi.logout();
            setIsLocked(false);
            setMode("login");
          }}
          onTriggerRecovery={() => {
            setIsLocked(false);
            setMode("recovery");
          }}
        />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <AuthScreen
        initialMode={mode}
        onSuccess={() => {
          router.push("/app");
        }}
      />
    </ToastProvider>
  );
}
