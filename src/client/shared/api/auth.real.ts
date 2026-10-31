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
      if (!res.ok) return null;
      const json = await res.json();
      if (!json.success || !json.data) return null;
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
