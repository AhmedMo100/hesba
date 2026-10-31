"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthScreen } from "@/client/shared/auth";
import { authApi } from "@/client/shared/api";
import { ToastProvider } from "@/client/shared/ui";

export interface AuthEntryClientProps {
  initialMode?: "login" | "signup" | "forgot-password";
}

export function AuthEntryClient({
  initialMode = "login",
}: AuthEntryClientProps = {}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [redirectTo] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("redirect");
      if (p && p.startsWith("/app")) {
        return p;
      }
    }
    return "/app";
  });

  useEffect(() => {
    authApi.getSession().then((session) => {
      if (session) {
        router.push(redirectTo);
        return;
      }
      setLoading(false);
    });
  }, [router, redirectTo]);

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

  return (
    <ToastProvider>
      <AuthScreen
        initialMode={initialMode}
        onSuccess={() => {
          router.push(redirectTo);
        }}
      />
    </ToastProvider>
  );
}
