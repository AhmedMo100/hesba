"use client";

/**
 * @file AuthProvider.tsx
 * @description React context holding the current session (user + store) for the client app.
 *
 * @responsibility
 * Loads the session once on mount from `/api/auth/session`, mirrors the active store id into
 * `sessionStorage` (`hesba_current_store_id`, read by the client API helpers), and exposes
 * `logout`, `setSession` and `updateProfile`.
 *
 * @usedBy
 * `app-shell/AppShell.tsx` (provider) and every feature that calls `useAuth()`.
 *
 * @remarks
 * When the session request fails (including offline) the session is `null`; it is read again
 * when the browser comes back online. `lock`/`unlock` are no-ops.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import type { SessionState, StoreProfile } from "../api";
import { authApi } from "../api";
import { clearInflightRequests } from "../api/dedupe";
import { sessionRefusedByServer } from "../api/auth.real";

interface AuthContextValue {
  session: SessionState | null;
  isLoading: boolean;
  isLocked: boolean;
  isOfflineExpired: boolean;
  /** The server refused the session (QA-51): the owner must sign in again. */
  isSessionRefused: boolean;
  unlock: () => void;
  lock: () => void;
  logout: () => Promise<void>;
  setSession: (session: SessionState | null) => void;
  updateProfile: (profile: StoreProfile) => Promise<boolean>;
  simulateOfflineExpiry: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [isOfflineExpired, setIsOfflineExpired] = useState(false);
  const [isSessionRefused, setIsSessionRefused] = useState(false);

  useEffect(() => {
    authApi.getSession().then((s) => {
      setSession(s);
      setIsSessionRefused(!s && sessionRefusedByServer());
      if (typeof window !== "undefined") {
        if (s?.store?.id) {
          window.sessionStorage.setItem("hesba_current_store_id", s.store.id);
        } else {
          window.sessionStorage.removeItem("hesba_current_store_id");
        }
      }
      if (s?.isOfflineExpired) {
        setIsOfflineExpired(true);
      }
      setIsLoading(false);
    });
    // Offline the session request fails; read it again when the connection returns, so
    // queued sales (ADR-0020) sync under the real server session.
    const onOnline = () => {
      authApi.getSession().then((s) => {
        if (s) setSession(s);
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const unlock = useCallback(() => {}, []);

  const lock = useCallback(() => {}, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    clearInflightRequests();
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("hesba_current_store_id");
    }
    setSession(null);
    setIsLocked(false);
    setIsOfflineExpired(false);
  }, []);

  const handleSetSession = useCallback((newSession: SessionState | null) => {
    clearInflightRequests();
    setSession(newSession);
    if (typeof window !== "undefined") {
      if (newSession?.store?.id) {
        window.sessionStorage.setItem(
          "hesba_current_store_id",
          newSession.store.id,
        );
      } else {
        window.sessionStorage.removeItem("hesba_current_store_id");
      }
    }
  }, []);

  const updateProfile = useCallback(async (profile: StoreProfile) => {
    const res = await authApi.updateProfile(profile);
    if (res.success && res.data) {
      const refreshed = await authApi.getSession();
      setSession(refreshed);
      return true;
    }
    return false;
  }, []);

  const simulateOfflineExpiry = useCallback(async () => {
    await authApi.simulateOfflineExpiry();
    setIsOfflineExpired(true);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        isLocked,
        isOfflineExpired,
        isSessionRefused,
        unlock,
        lock,
        logout,
        setSession: handleSetSession,
        updateProfile,
        simulateOfflineExpiry,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      session: null,
      isLoading: false,
      isLocked: false,
      isOfflineExpired: false,
      isSessionRefused: false,
      unlock: () => {},
      lock: () => {},
      logout: async () => {},
      setSession: () => {},
      updateProfile: async () => false,
      simulateOfflineExpiry: async () => {},
    };
  }
  return ctx;
}
