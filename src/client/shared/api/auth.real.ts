import type {
  AuthApi,
  AuthApiResult,
  LoginInput,
  SessionState,
  SignupInput,
  StoreProfile,
} from "./auth";

export class RealAuthApi implements AuthApi {
  async login(credentials: LoginInput): Promise<AuthApiResult<SessionState>> {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return {
          success: false,
          error: data.error?.message || "رقم الموبايل أو كلمة السر غير صحيحة",
        };
      }
      return { success: true, data: data.data };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر. تأكد من اتصال الإنترنت.",
      };
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
          error:
            json.error?.message ||
            "تعذر إنشاء الحساب. تأكد من البيانات المدخلة.",
        };
      }
      return { success: true, data: json.data };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر. تأكد من اتصال الإنترنت.",
      };
    }
  }

  async requestPasswordReset(
    email: string,
  ): Promise<AuthApiResult<{ message: string }>> {
    try {
      const res = await fetch("/api/auth/forgot-password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error:
            json.error?.message || "تعذر إرسال كود التأكيد. حاول مرة أخرى.",
        };
      }
      return { success: true, data: json.data };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر. تأكد من اتصال الإنترنت.",
      };
    }
  }

  async resetPassword(data: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<AuthApiResult<{ message: string }>> {
    try {
      const res = await fetch("/api/auth/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error?.message || "كود التأكيد غير صحيح أو انتهت صلاحيته",
        };
      }
      return { success: true, data: json.data };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر. تأكد من اتصال الإنترنت.",
      };
    }
  }

  async getSession(): Promise<SessionState | null> {
    try {
      const res = await fetch("/api/auth/session");
      // The server said this session is over (revoked, expired, membership removed): QA-51.
      sessionRefused = res.status === 401;
      if (!res.ok) return null;
      const json = await res.json();
      if (!json.success || !json.data) return null;
      void slideSessionIfDue(json.data);
      return json.data;
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Offline fallback: server session will expire naturally
    }
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
          error: json.error?.message || "تعذر حفظ بيانات الحساب",
        };
      }
      return { success: true, data: json.data };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر. تأكد من اتصال الإنترنت.",
      };
    }
  }

  async revokeOtherSessions(): Promise<AuthApiResult<{ message: string }>> {
    try {
      const res = await fetch("/api/auth/revoke-other-sessions", {
        method: "POST",
      });
      const json = await res.json();
      return { success: true, data: json.data };
    } catch {
      return { success: false, error: "تعذر إنهاء الجلسات الأخرى" };
    }
  }

  async simulateOfflineExpiry(): Promise<void> {
    // In-memory offline expiration simulation
  }
}

export const realAuthApi = new RealAuthApi();

/**
 * Session sliding (QA-51), by the existing rotation policy ("rotation on periodic use"): once
 * a session is more than {@link SESSION_SLIDE_AFTER_MS} old, the app rotates it
 * (`POST /api/auth/rotate`). The server answers with a new token and a fresh 30-day HttpOnly
 * cookie, so a shop used every day never gets logged out, while an unused one still expires.
 * A failed rotation changes nothing (the current session stays valid until its expiry).
 */
let sessionRefused = false;
/**
 * True when the last session check got a 401: the server refused this session (signed out
 * elsewhere, expired, removed from the shop). Not set by a network error or a 5xx, so offline
 * use is unchanged.
 */
export function sessionRefusedByServer(): boolean {
  return sessionRefused;
}

export const SESSION_SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
let sliding = false;

export async function slideSessionIfDue(
  data: unknown,
  now: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const expiresAt = (data as { session?: { expiresAt?: string } } | null)
    ?.session?.expiresAt;
  const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(expiry)) return false;
  const age = SESSION_LIFETIME_MS - (expiry - now);
  if (age < SESSION_SLIDE_AFTER_MS || sliding) return false;
  sliding = true;
  try {
    const res = await fetchImpl("/api/auth/rotate", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  } finally {
    sliding = false;
  }
}
