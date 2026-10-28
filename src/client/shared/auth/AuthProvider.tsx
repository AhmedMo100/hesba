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
    setSession(null);
    setIsLocked(false);
    setIsOfflineExpired(false);
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
        setSession,
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
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
