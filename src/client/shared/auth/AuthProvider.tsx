"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import type { SessionState, StoreProfile } from "../api";
import { authApi } from "../api";

interface AuthContextValue {
  session: SessionState | null;
  isLoading: boolean;
  isLocked: boolean;
  isOfflineExpired: boolean;
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

  useEffect(() => {
    authApi.getSession().then((s) => {
      setSession(s);
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
  }, []);

  const unlock = useCallback(() => {}, []);

  const lock = useCallback(() => {}, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("hesba_current_store_id");
    }
    setSession(null);
    setIsLocked(false);
    setIsOfflineExpired(false);
  }, []);

  const handleSetSession = useCallback((newSession: SessionState | null) => {
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
