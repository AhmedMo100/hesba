import type {
  AuthApi,
  AuthApiResult,
  LoginInput,
  OtpVerifyInput,
  SessionState,
  SignupInput,
  StoreProfile,
  StoreSession,
  UserSession,
} from "./auth";

const DEFAULT_TEST_USER: UserSession = {
  id: "user-test-01",
  name: "مجدي أحمد (TEST)",
  phone: "01012345678",
  email: "magdi.test@example.com",
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
const PIN_KEY = "hesba_test_pin";

class FixtureAuthApi implements AuthApi {
  private session: SessionState | null = null;
  private pin: string | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          this.session = JSON.parse(stored);
        }
        this.pin = localStorage.getItem(PIN_KEY);
      } catch {
        // Fallback to in-memory state
      }
    }
  }

  private persist() {
    if (typeof window !== "undefined") {
      try {
        if (this.session) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
        if (this.pin) {
          localStorage.setItem(PIN_KEY, this.pin);
        } else {
          localStorage.removeItem(PIN_KEY);
        }
      } catch {
        // Ignore storage errors in test environment
      }
    }
  }

  async signup(data: SignupInput): Promise<AuthApiResult<SessionState>> {
    const user: UserSession = {
      id: `user-test-${Date.now()}`,
      name: `${data.ownerName} (TEST)`,
      phone: data.phone,
      email: data.email ? `${data.email} (TEST)` : undefined,
    };

    const store: StoreSession = {
      id: `store-test-${Date.now()}`,
      name: `${data.storeName} (TEST)`,
      shopType: data.shopType,
      governorate: data.governorate,
      area: data.area ? `${data.area} (TEST)` : undefined,
      openedOn: data.openedOn,
      workersCount: data.workersCount,
    };

    this.session = {
      user,
      store,
      token: `jwt-token-test-${Date.now()}-TEST`,
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      isOfflineExpired: false,
      pinEnabled: false,
    };

    this.persist();
    return { success: true, data: this.session };
  }

  async login(creds: LoginInput): Promise<AuthApiResult<SessionState>> {
    // Check if phone matches Egyptian format
    const cleanPhone = creds.phone.replace(/\s|-/g, "");
    if (!cleanPhone.startsWith("01")) {
      return { success: false, error: "رقم موبايل مصري صحيح (TEST)" };
    }

    this.session = {
      user: {
        ...DEFAULT_TEST_USER,
        phone: cleanPhone,
      },
      store: DEFAULT_TEST_STORE,
      token: `jwt-login-token-TEST-${Date.now()}`,
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      isOfflineExpired: false,
      pinEnabled: Boolean(this.pin),
    };

    this.persist();
    return { success: true, data: this.session };
  }

  async requestOtp(phone: string): Promise<AuthApiResult<{ message: string }>> {
    const cleanPhone = phone.replace(/\s|-/g, "");
    if (!cleanPhone.startsWith("01")) {
      return { success: false, error: "رقم موبايل مصري صحيح (TEST)" };
    }
    return {
      success: true,
      data: { message: "تم إرسال كود التحقق 1234 (TEST)" },
    };
  }

  async verifyOtp(data: OtpVerifyInput): Promise<AuthApiResult<SessionState>> {
    // Accepts "1234" or any 4-digit code in test fixture
    if (data.code !== "1234" && data.code.length < 4) {
      return { success: false, error: "كود التحقق غير صحيح (TEST)" };
    }

    return this.login({ phone: data.phone });
  }

  async getSession(): Promise<SessionState | null> {
    return this.session;
  }

  async logout(): Promise<void> {
    this.session = null;
    this.persist();
  }

  async updateProfile(
    profile: StoreProfile,
  ): Promise<AuthApiResult<StoreProfile>> {
    // Simulated server error if test name indicates failure
    if (
      profile.ownerName.includes("خطأ") ||
      profile.ownerName.includes("FAIL")
    ) {
      return {
        success: false,
        error: "فشل في حفظ بيانات الحساب من السيرفر (TEST)",
      };
    }

    if (this.session) {
      this.session.user.name = profile.ownerName;
      this.session.user.phone = profile.phone;
      this.session.user.email = profile.email;
      this.session.store.name = profile.storeName;
      this.session.store.shopType = profile.shopType;
      this.session.store.governorate = profile.governorate;
      this.session.store.area = profile.area;
      this.session.store.openedOn = profile.openedOn;
      this.session.store.workersCount = profile.workersCount;
      this.persist();
    }

    return { success: true, data: profile };
  }

  async verifyPin(pin: string): Promise<boolean> {
    if (!this.pin) return true;
    return this.pin === pin;
  }

  async setPin(pin: string | null): Promise<void> {
    this.pin = pin;
    if (this.session) {
      this.session.pinEnabled = Boolean(pin);
    }
    this.persist();
  }

  async simulateOfflineExpiry(): Promise<void> {
    if (this.session) {
      this.session.isOfflineExpired = true;
      this.persist();
    }
  }
}

export const fixtureAuthApi = new FixtureAuthApi();
