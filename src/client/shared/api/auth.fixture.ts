import type {
  AuthApi,
  AuthApiResult,
  LoginInput,
  SessionState,
  SignupInput,
  StoreProfile,
  StoreSession,
  UserSession,
} from "./auth";
import { validatePasswordPolicy } from "@/domain";

const DEFAULT_TEST_USER: UserSession = {
  id: "user-test-01",
  name: "مجدي أحمد (TEST)",
  phone: "01012345678",
  email: "magdi.test@hesba.app",
  emailVerified: true,
};

const DEFAULT_TEST_STORE: StoreSession = {
  id: "store-test-01",
  name: "سوبر ماركت البركة (TEST)",
  shopType: "سوبر ماركت",
  governorate: "القاهرة",
  area: "المعادي (TEST)",
  openedOn: "2020-01-01",
  workersCount: 2,
};

const STORAGE_KEY = "hesba_test_session";

class FixtureAuthApi implements AuthApi {
  private session: SessionState | null = null;
  private memoryStorage = new Map<string, string>();
  private activeResetCodes = new Map<string, string>();

  private getStorage():
    | Storage
    | {
        getItem: (k: string) => string | null;
        setItem: (k: string, v: string) => void;
        removeItem: (k: string) => void;
      } {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    return {
      getItem: (k: string) => this.memoryStorage.get(k) ?? null,
      setItem: (k: string, v: string) => this.memoryStorage.set(k, v),
      removeItem: (k: string) => this.memoryStorage.delete(k),
    };
  }

  async login(credentials: LoginInput): Promise<AuthApiResult<SessionState>> {
    const cleanPhone = credentials.phone.replace(/\s|-/g, "");
    if (!/^(01[0125]\d{8}|\+201[0125]\d{8})$/.test(cleanPhone)) {
      return { success: false, error: "رقم الموبايل غير صحيح" };
    }
    if (!credentials.password || credentials.password.length < 6) {
      return { success: false, error: "كلمة السر غير صحيحة" };
    }

    const state: SessionState = {
      user: { ...DEFAULT_TEST_USER, phone: cleanPhone },
      store: { ...DEFAULT_TEST_STORE },
      token: "fixture-token-123456",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };

    this.session = state;
    this.getStorage().setItem(STORAGE_KEY, JSON.stringify(state));
    return { success: true, data: state };
  }

  async signup(data: SignupInput): Promise<AuthApiResult<SessionState>> {
    const cleanPhone = data.phone.replace(/\s|-/g, "");
    if (!cleanPhone.startsWith("01") || cleanPhone.length !== 11) {
      return { success: false, error: "رقم الموبايل غير صحيح" };
    }
    const pwdCheck = validatePasswordPolicy(data.password);
    if (!pwdCheck.valid) {
      if (pwdCheck.reason === "too_short" || pwdCheck.reason === "empty") {
        return {
          success: false,
          error: "كلمة السر يجب أن تكون 12 حرف على الأقل",
        };
      }
      if (pwdCheck.reason === "missing_letter") {
        return {
          success: false,
          error: "كلمة السر يجب أن تحتوي على حرف واحد على الأقل",
        };
      }
      if (pwdCheck.reason === "missing_number") {
        return {
          success: false,
          error: "كلمة السر يجب أن تحتوي على رقم واحد على الأقل",
        };
      }
      if (pwdCheck.reason === "too_long") {
        return {
          success: false,
          error: "كلمة السر لا يجب أن تتجاوز 128 حرف",
        };
      }
      if (pwdCheck.reason === "too_common") {
        return {
          success: false,
          error: "كلمة السر شائعة وسهلة التخمين، اختار كلمة أصعب أو جملة سرية",
        };
      }
    }

    const state: SessionState = {
      user: {
        id: `user-${Date.now()}`,
        name: data.ownerName,
        phone: cleanPhone,
        email: data.email,
        emailVerified: true,
      },
      store: {
        id: `store-${Date.now()}`,
        name: data.storeName,
        shopType: data.shopType,
        governorate: data.governorate,
        area: data.area,
        openedOn: data.openedOn || "2024-01-01",
        workersCount: data.workersCount ?? 1,
      },
      token: `fixture-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };

    this.session = state;
    this.getStorage().setItem(STORAGE_KEY, JSON.stringify(state));
    return { success: true, data: state };
  }

  async requestPasswordReset(
    email: string,
  ): Promise<AuthApiResult<{ message: string }>> {
    const code = "123456";
    this.activeResetCodes.set(email.toLowerCase(), code);
    return {
      success: true,
      data: { message: "إذا كان البريد مسجلاً لدينا، تم إرسال كود التأكيد." },
    };
  }

  async resetPassword(data: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<AuthApiResult<{ message: string }>> {
    const expected =
      this.activeResetCodes.get(data.email.toLowerCase()) || "123456";
    if (data.code !== expected) {
      return { success: false, error: "كود التأكيد غير صحيح" };
    }
    const pwdCheck = validatePasswordPolicy(data.newPassword);
    if (!pwdCheck.valid) {
      if (pwdCheck.reason === "too_short" || pwdCheck.reason === "empty") {
        return {
          success: false,
          error: "كلمة السر الجديدة يجب أن تكون 12 حرف على الأقل",
        };
      }
      if (pwdCheck.reason === "missing_letter") {
        return {
          success: false,
          error: "كلمة السر يجب أن تحتوي على حرف واحد على الأقل",
        };
      }
      if (pwdCheck.reason === "missing_number") {
        return {
          success: false,
          error: "كلمة السر يجب أن تحتوي على رقم واحد على الأقل",
        };
      }
      if (pwdCheck.reason === "too_long") {
        return {
          success: false,
          error: "كلمة السر لا يجب أن تتجاوز 128 حرف",
        };
      }
      if (pwdCheck.reason === "too_common") {
        return {
          success: false,
          error: "كلمة السر شائعة وسهلة التخمين، اختار كلمة أصعب أو جملة سرية",
        };
      }
    }

    this.activeResetCodes.delete(data.email.toLowerCase());
    return {
      success: true,
      data: {
        message: "تم تغيير كلمة السر بنجاح. سجل دخولك بكلمة السر الجديدة.",
      },
    };
  }

  async getSession(): Promise<SessionState | null> {
    if (this.session) return this.session;
    const raw = this.getStorage().getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      this.session = JSON.parse(raw);
      return this.session;
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    this.session = null;
    this.getStorage().removeItem(STORAGE_KEY);
  }

  async updateProfile(
    profile: StoreProfile,
  ): Promise<AuthApiResult<StoreProfile>> {
    if (this.session) {
      this.session.user.name = profile.ownerName;
      this.session.user.phone = profile.phone;
      this.session.user.email = profile.email;
      this.session.store.name = profile.storeName;
      this.session.store.shopType = profile.shopType;
      this.session.store.governorate = profile.governorate;
      this.session.store.area = profile.area;
      this.session.store.openedOn =
        profile.openedOn || this.session.store.openedOn;
      this.session.store.workersCount = profile.workersCount;
      this.getStorage().setItem(STORAGE_KEY, JSON.stringify(this.session));
    }
    return { success: true, data: profile };
  }

  async revokeOtherSessions(): Promise<AuthApiResult<{ message: string }>> {
    return {
      success: true,
      data: { message: "تم إنهاء جميع الجلسات الأخرى بنجاح" },
    };
  }

  async simulateOfflineExpiry(): Promise<void> {
    if (this.session) {
      this.session.isOfflineExpired = true;
      this.getStorage().setItem(STORAGE_KEY, JSON.stringify(this.session));
    }
  }
}

export const fixtureAuthApi = new FixtureAuthApi();
export { FixtureAuthApi };
