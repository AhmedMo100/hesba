import type {
  AccountRecoveryConfirmInput,
  AccountRecoveryRequestInput,
  AuthApi,
  AuthApiResult,
  PasskeyAuthenticationOptions,
  PasskeyCredentialResponse,
  PasskeyInfo,
  PasskeyRegistrationOptions,
  SessionState,
  SignupInput,
  StoreProfile,
} from "./auth";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

const STORAGE_SESSION_KEY = "hesba_auth_session";
const STORAGE_PIN_KEY = "hesba_screen_lock_pin_hash";

async function hashPinLocally(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`hesba_local_pin_salt_${pin}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class RealAuthApi implements AuthApi {
  private session: SessionState | null = null;
  private pendingSignupContext: {
    userId: string;
    storeId: string;
    passkeyOptions: PasskeyRegistrationOptions;
  } | null = null;
  private pendingAuthOptions: PasskeyAuthenticationOptions | null = null;
  private pendingRecoveryOptions: PasskeyRegistrationOptions | null = null;

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

  async signup(data: SignupInput): Promise<
    AuthApiResult<{
      session: SessionState;
      passkeyOptions: PasskeyRegistrationOptions;
    }>
  > {
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

      const { userId, storeId, passkeyOptions } = json.data;
      this.pendingSignupContext = { userId, storeId, passkeyOptions };

      const initialSession: SessionState = {
        user: {
          id: userId,
          name: data.ownerName,
          phone: data.phone,
          email: data.email,
          emailVerified: false,
        },
        store: {
          id: storeId,
          name: data.storeName,
          shopType: data.shopType,
          governorate: data.governorate,
          area: data.area,
          openedOn: data.openedOn,
          workersCount: data.workersCount,
        },
        token: "",
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        isOfflineExpired: false,
        pinEnabled: false,
      };

      return {
        success: true,
        data: {
          session: initialSession,
          passkeyOptions,
        },
      };
    } catch {
      return {
        success: false,
        error: "تعذر الاتصال بالسيرفر. شغلك محفوظ ومتاح عند عودة الشبكة.",
      };
    }
  }

  async completePasskeyRegistration(
    credential?: PasskeyCredentialResponse,
    label = "جهاز المالك",
  ): Promise<AuthApiResult<SessionState>> {
    try {
      if (!this.pendingSignupContext) {
        return {
          success: false,
          error: "جلسة التسجيل غير موجودة أو انتهت صلاحيتها",
        };
      }

      let credToSubmit = credential;

      // If no mock/manual credential passed and WebAuthn is supported, launch browser ceremony
      if (!credToSubmit && browserSupportsWebAuthn()) {
        try {
          const resp = await startRegistration({
            optionsJSON: this.pendingSignupContext
              .passkeyOptions as unknown as PublicKeyCredentialCreationOptionsJSON,
          });
          credToSubmit = resp as unknown as PasskeyCredentialResponse;
        } catch (webAuthnErr: unknown) {
          const isCancel =
            webAuthnErr instanceof Error &&
            webAuthnErr.name === "NotAllowedError";
          return {
            success: false,
            error: isCancel
              ? "تم إلغاء عملية مفتاح المرور"
              : "فشل التحقق من مفتاح المرور على هذا الجهاز",
          };
        }
      }

      if (!credToSubmit) {
        return {
          success: false,
          error: "بيانات مفتاح المرور مطلوبة",
        };
      }

      const res = await fetch("/api/auth/register-passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: this.pendingSignupContext.userId,
          storeId: this.pendingSignupContext.storeId,
          credential: credToSubmit,
          label,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل تسجيل مفتاح المرور",
        };
      }

      const hasPin =
        typeof window !== "undefined" &&
        !!localStorage.getItem(STORAGE_PIN_KEY);

      const sessionState: SessionState = {
        ...json.data,
        pinEnabled: hasPin,
        isOfflineExpired: false,
      };

      this.persistSession(sessionState);
      this.pendingSignupContext = null;

      return {
        success: true,
        data: sessionState,
      };
    } catch {
      return {
        success: false,
        error: "حصل خطأ غير متوقع في الخادم",
      };
    }
  }

  async getPasskeyAuthOptions(
    identifier?: string,
  ): Promise<AuthApiResult<PasskeyAuthenticationOptions>> {
    try {
      const res = await fetch("/api/auth/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل طلب خيارات تسجيل الدخول",
        };
      }

      this.pendingAuthOptions = json.data;
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

  async loginWithPasskey(
    credential?: PasskeyCredentialResponse,
  ): Promise<AuthApiResult<SessionState>> {
    try {
      let credToSubmit = credential;

      if (
        !credToSubmit &&
        this.pendingAuthOptions &&
        browserSupportsWebAuthn()
      ) {
        try {
          const resp = await startAuthentication({
            optionsJSON: this
              .pendingAuthOptions as unknown as PublicKeyCredentialRequestOptionsJSON,
          });
          credToSubmit = resp as unknown as PasskeyCredentialResponse;
        } catch (webAuthnErr: unknown) {
          const isCancel =
            webAuthnErr instanceof Error &&
            webAuthnErr.name === "NotAllowedError";
          return {
            success: false,
            error: isCancel
              ? "تم إلغاء تسجيل الدخول بمفتاح المرور"
              : "فشل التعرف على مفتاح المرور",
          };
        }
      }

      if (!credToSubmit) {
        return {
          success: false,
          error: "بيانات مفتاح المرور مطلوبة",
        };
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: credToSubmit }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل تسجيل الدخول",
        };
      }

      const hasPin =
        typeof window !== "undefined" &&
        !!localStorage.getItem(STORAGE_PIN_KEY);

      const sessionState: SessionState = {
        ...json.data,
        pinEnabled: hasPin,
        isOfflineExpired: false,
      };

      this.persistSession(sessionState);
      this.pendingAuthOptions = null;

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
    input: AccountRecoveryRequestInput,
  ): Promise<AuthApiResult<{ message: string }>> {
    try {
      const res = await fetch("/api/auth/recovery/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
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
  ): Promise<
    AuthApiResult<{ email: string; passkeyOptions: PasskeyRegistrationOptions }>
  > {
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
            json?.error?.message || "رمز الاسترداد غير صالح أو انتهت صلاحيته",
        };
      }

      this.pendingRecoveryOptions = json.data.passkeyOptions;

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

  async completeAccountRecovery(
    input: AccountRecoveryConfirmInput,
    credential?: PasskeyCredentialResponse,
  ): Promise<AuthApiResult<SessionState>> {
    try {
      let credToSubmit = credential;

      if (
        !credToSubmit &&
        this.pendingRecoveryOptions &&
        browserSupportsWebAuthn()
      ) {
        try {
          const resp = await startRegistration({
            optionsJSON: this
              .pendingRecoveryOptions as unknown as PublicKeyCredentialCreationOptionsJSON,
          });
          credToSubmit = resp as unknown as PasskeyCredentialResponse;
        } catch {
          return {
            success: false,
            error: "فشل التحقق من مفتاح المرور الجديد",
          };
        }
      }

      if (!credToSubmit) {
        return {
          success: false,
          error: "بيانات مفتاح المرور الجديد مطلوبة",
        };
      }

      const res = await fetch("/api/auth/recovery/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: input.token,
          credential: credToSubmit,
          passkeyLabel: input.passkeyLabel,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل إتمام استرداد الحساب",
        };
      }

      const hasPin =
        typeof window !== "undefined" &&
        !!localStorage.getItem(STORAGE_PIN_KEY);

      const sessionState: SessionState = {
        ...json.data,
        pinEnabled: hasPin,
        isOfflineExpired: false,
      };

      this.persistSession(sessionState);
      this.pendingRecoveryOptions = null;

      return {
        success: true,
        data: sessionState,
      };
    } catch {
      return {
        success: false,
        error: "حصل خطأ غير متوقع",
      };
    }
  }

  async listPasskeys(): Promise<AuthApiResult<PasskeyInfo[]>> {
    try {
      const res = await fetch("/api/auth/passkeys");
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل جلب قائمة المفاتيح",
        };
      }
      return { success: true, data: json.data };
    } catch {
      return { success: false, error: "تعذر الاتصال بالسيرفر" };
    }
  }

  async revokePasskey(
    passkeyId: string,
  ): Promise<AuthApiResult<{ success: boolean }>> {
    try {
      const res = await fetch("/api/auth/passkeys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passkeyId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json?.error?.message || "فشل حذف المفتاح",
        };
      }
      return { success: true, data: { success: true } };
    } catch {
      return { success: false, error: "تعذر الاتصال بالسيرفر" };
    }
  }

  async reauthenticateWithPasskey(): Promise<
    AuthApiResult<{ verified: boolean }>
  > {
    const optsRes = await this.getPasskeyAuthOptions();
    if (!optsRes.success || !optsRes.data) {
      return { success: false, error: optsRes.error || "فشل خيارات المصادقة" };
    }

    const loginRes = await this.loginWithPasskey();
    return {
      success: loginRes.success,
      data: { verified: loginRes.success },
      error: loginRes.error,
    };
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
        const hasPin =
          typeof window !== "undefined" &&
          !!localStorage.getItem(STORAGE_PIN_KEY);

        const sessionState: SessionState = {
          ...json.data,
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

  // Local device screen lock (PIN)
  async verifyPin(pin: string): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const storedHash = localStorage.getItem(STORAGE_PIN_KEY);
    if (!storedHash) return true; // No PIN set

    const enteredHash = await hashPinLocally(pin);
    return enteredHash === storedHash;
  }

  async setPin(pin: string | null): Promise<void> {
    if (typeof window === "undefined") return;
    if (pin && pin.trim().length === 6) {
      const hash = await hashPinLocally(pin.trim());
      localStorage.setItem(STORAGE_PIN_KEY, hash);
      if (this.session) {
        this.session.pinEnabled = true;
        this.persistSession(this.session);
      }
    } else {
      localStorage.removeItem(STORAGE_PIN_KEY);
      if (this.session) {
        this.session.pinEnabled = false;
        this.persistSession(this.session);
      }
    }
  }

  async resetPinWithReauth(): Promise<AuthApiResult<{ allowed: boolean }>> {
    const reauth = await this.reauthenticateWithPasskey();
    if (reauth.success && reauth.data?.verified) {
      await this.setPin(null);
      return { success: true, data: { allowed: true } };
    }
    return {
      success: false,
      error: "يجب تأكيد هويتك بمفتاح المرور لإلغاء قفل الشاشة",
    };
  }

  async simulateOfflineExpiry(): Promise<void> {
    if (this.session) {
      this.session.isOfflineExpired = true;
      this.persistSession(this.session);
    }
  }
}

export const realAuthApi = new RealAuthApi();
