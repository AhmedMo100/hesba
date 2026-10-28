import type {
  AuthApi,
  AuthApiResult,
  SessionState,
  SignupInput,
  StoreProfile,
} from "./auth";

const STORAGE_SESSION_KEY = "hesba_auth_session";
const STORAGE_PIN_KEY = "hesba_screen_lock_pin_hash";
const STORAGE_LOCKOUT_KEY = "hesba_pin_lockout_until";
const STORAGE_ATTEMPTS_KEY = "hesba_pin_failed_attempts";

async function hashPinLocally(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`hesba_local_pin_salt_${pin}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class RealAuthApi implements AuthApi {
  private session: SessionState | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_SESSION_KEY);
        if (stored) {
          this.session = JSON.parse(stored);
        }
      } catch {
        // Fallback to in-memory state
      }
    }
  }

  private persistSession(session: SessionState | null) {
    this.session = session;
    if (typeof window !== "undefined") {
      try {
        if (session) {
          localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
        } else {
          localStorage.removeItem(STORAGE_SESSION_KEY);
        }
      } catch {
        // Storage might fail in private browsing mode
      }
    }
  }

  async signup(data: SignupInput): Promise<AuthApiResult<SessionState>> {
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل تسجيل البيانات",
        };
      }

      const hasPin = this.hasLocalPin();
      const sessionState: SessionState = {
        ...json.data.session,
        pinEnabled: hasPin,
        isOfflineExpired: false,
      };

      this.persistSession(sessionState);

      return {
        success: true,
        data: sessionState,
      };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر. شغلك محفوظ ومتاح عند عودة الشبكة.",
      };
    }
  }

  async requestMagicLink(
    email: string,
  ): Promise<AuthApiResult<{ message: string }>> {
    try {
      const res = await fetch("/api/auth/magic-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل طلب رابط الدخول",
        };
      }

      return {
        success: true,
        data: json.data,
      };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر",
      };
    }
  }

  async verifyMagicLink(token: string): Promise<AuthApiResult<SessionState>> {
    try {
      const res = await fetch("/api/auth/magic-link/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error:
            json?.error?.message || "رابط الدخول غير صالح أو انتهت صلاحيته",
        };
      }

      const hasPin = this.hasLocalPin();
      const sessionState: SessionState = {
        ...json.data.session,
        pinEnabled: hasPin,
        isOfflineExpired: false,
      };

      this.persistSession(sessionState);

      return {
        success: true,
        data: sessionState,
      };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر",
      };
    }
  }

  async requestAccountRecovery(
    email: string,
  ): Promise<AuthApiResult<{ message: string }>> {
    try {
      const res = await fetch("/api/auth/recovery/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل طلب استرداد الحساب",
        };
      }

      return {
        success: true,
        data: json.data,
      };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر",
      };
    }
  }

  async verifyRecoveryToken(
    token: string,
  ): Promise<AuthApiResult<SessionState>> {
    try {
      const res = await fetch("/api/auth/recovery/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error:
            json?.error?.message || "رابط الاسترداد غير صالح أو انتهت صلاحيته",
        };
      }

      const hasPin = this.hasLocalPin();
      const sessionState: SessionState = {
        ...json.data.session,
        pinEnabled: hasPin,
        isOfflineExpired: false,
      };

      this.persistSession(sessionState);

      return {
        success: true,
        data: sessionState,
      };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر",
      };
    }
  }

  async verifyEmail(
    token: string,
  ): Promise<AuthApiResult<{ success: boolean }>> {
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error:
            json?.error?.message ||
            "رمز تأكيد البريد غير صالح أو منتهي الصلاحية",
        };
      }

      return { success: true, data: { success: true } };
    } catch {
      return { success: false, error: "تعذر الاتصال بالسيرفر" };
    }
  }

  async getSession(): Promise<SessionState | null> {
    // If offline, return cached session immediately to preserve offline sales & navigation
    if (typeof navigator !== "undefined" && !navigator.onLine && this.session) {
      return {
        ...this.session,
        isOfflineExpired: false,
      };
    }

    try {
      const res = await fetch("/api/auth/session");
      if (res.status === 401) {
        this.persistSession(null);
        return null;
      }

      const json = await res.json();
      if (res.ok && json.success && json.data) {
        const hasPin = this.hasLocalPin();

        const sessionState: SessionState = {
          ...json.data.session,
          user: json.data.user,
          store: json.data.store,
          pinEnabled: hasPin,
          isOfflineExpired: false,
        };

        this.persistSession(sessionState);
        return sessionState;
      }

      return this.session;
    } catch {
      // Network error / offline fallback: keep cached session intact!
      return this.session;
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors on logout
    }
    this.persistSession(null);
  }

  async updateProfile(
    profile: StoreProfile,
  ): Promise<AuthApiResult<StoreProfile>> {
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل تحديث البيانات",
        };
      }

      // Refresh local session display fields
      if (this.session) {
        this.session.user.name = profile.ownerName;
        this.session.user.phone = profile.phone;
        this.session.user.email = profile.email;
        this.session.store.name = profile.storeName;
        this.session.store.shopType = profile.shopType;
        this.session.store.governorate = profile.governorate;
        this.session.store.area = profile.area;
        this.persistSession(this.session);
      }

      return {
        success: true,
        data: json.data,
      };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر",
      };
    }
  }

  async revokeOtherSessions(): Promise<AuthApiResult<{ message: string }>> {
    try {
      const res = await fetch("/api/auth/revoke-other-sessions", {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل تسجيل الخروج من الأجهزة الأخرى",
        };
      }
      return { success: true, data: json.data };
    } catch {
      return { success: false, error: "تعذر الاتصال بالسيرفر" };
    }
  }

  // Local device screen lock (PIN)
  hasLocalPin(): boolean {
    if (typeof window === "undefined") return false;
    return !!localStorage.getItem(STORAGE_PIN_KEY);
  }

  getPinLockoutRemainingSeconds(): number {
    if (typeof window === "undefined") return 0;
    const untilStr = localStorage.getItem(STORAGE_LOCKOUT_KEY);
    if (!untilStr) return 0;
    const until = parseInt(untilStr, 10);
    const now = Date.now();
    if (until > now) {
      return Math.ceil((until - now) / 1000);
    }
    localStorage.removeItem(STORAGE_LOCKOUT_KEY);
    return 0;
  }

  recordFailedPinAttempt(): number {
    if (typeof window === "undefined") return 0;
    const countStr = localStorage.getItem(STORAGE_ATTEMPTS_KEY) || "0";
    const nextCount = parseInt(countStr, 10) + 1;
    localStorage.setItem(STORAGE_ATTEMPTS_KEY, String(nextCount));

    if (nextCount >= 5) {
      const lockoutSeconds = 30;
      const lockoutUntil = Date.now() + lockoutSeconds * 1000;
      localStorage.setItem(STORAGE_LOCKOUT_KEY, String(lockoutUntil));
      return lockoutSeconds;
    }
    return 0;
  }

  resetPinAttempts(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_ATTEMPTS_KEY);
    localStorage.removeItem(STORAGE_LOCKOUT_KEY);
  }

  async verifyPin(pin: string): Promise<boolean> {
    if (typeof window === "undefined") return false;
    if (this.getPinLockoutRemainingSeconds() > 0) {
      return false;
    }

    const storedHash = localStorage.getItem(STORAGE_PIN_KEY);
    if (!storedHash) return true; // No PIN set

    const enteredHash = await hashPinLocally(pin);
    const matches = enteredHash === storedHash;

    if (matches) {
      this.resetPinAttempts();
      return true;
    } else {
      this.recordFailedPinAttempt();
      return false;
    }
  }

  async setPin(pin: string | null): Promise<void> {
    if (typeof window === "undefined") return;
    if (pin && pin.trim().length === 6) {
      const hash = await hashPinLocally(pin.trim());
      localStorage.setItem(STORAGE_PIN_KEY, hash);
      this.resetPinAttempts();
      if (this.session) {
        this.session.pinEnabled = true;
        this.persistSession(this.session);
      }
    } else {
      localStorage.removeItem(STORAGE_PIN_KEY);
      this.resetPinAttempts();
      if (this.session) {
        this.session.pinEnabled = false;
        this.persistSession(this.session);
      }
    }
  }

  async simulateOfflineExpiry(): Promise<void> {
    if (this.session) {
      this.session.isOfflineExpired = true;
      this.persistSession(this.session);
    }
  }
}

export const realAuthApi = new RealAuthApi();
