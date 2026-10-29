"use client";

import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "auto";

export const THEME_STORAGE_KEY = "hesba-theme";

/**
 * Returns the saved theme preference from localStorage.
 * Defaults to "light" if no previous preference is saved.
 */
export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.localStorage) return "light";
  try {
    const saved = window.localStorage.getItem(
      THEME_STORAGE_KEY,
    ) as ThemeMode | null;
    if (saved && (saved === "light" || saved === "dark" || saved === "auto")) {
      return saved;
    }
  } catch {
    // Ignore storage access errors in private mode
  }
  return "light";
}

/**
 * Applies the given theme mode to document.documentElement.
 * "auto": resolves to OS preference via media query.
 * "light" / "dark": sets explicit data-theme attribute.
 */
export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;

  if (mode === "auto") {
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute(
      "data-theme",
      prefersDark ? "dark" : "light",
    );
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
}

/**
 * Central theme hook for Hesba.
 * - Defaults to "light" if no saved preference exists.
 * - Respects and persists user choices ("light" | "dark" | "auto").
 * - Cycles themes: light -> dark -> auto -> light.
 * - Keeps all pages and components unified.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Sync if another tab or component changes the preference
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        if (["light", "dark", "auto"].includes(e.newValue)) {
          const newTheme = e.newValue as ThemeMode;
          setThemeState(newTheme);
          applyTheme(newTheme);
        }
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Listen to OS preference changes if theme is auto
  useEffect(() => {
    if (theme !== "auto" || typeof window === "undefined") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      applyTheme("auto");
    };

    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      }
    } catch {
      // Ignore storage errors
    }
    applyTheme(newTheme);
  }, []);

  const cycleTheme = useCallback(() => {
    let next: ThemeMode = "light";
    if (theme === "light") next = "dark";
    else if (theme === "dark") next = "auto";
    else next = "light";

    setTheme(next);
  }, [theme, setTheme]);

  return {
    theme,
    setTheme,
    cycleTheme,
  };
}
