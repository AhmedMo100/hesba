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
  StoreSession,
  UserSession,
} from "./auth";

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

const DEFAULT_TEST_PASSKEYS: PasskeyInfo[] = [
  {
    id: "passkey-test-device-1",
    label: "موبايل سامسونج (TEST)",
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    lastUsedAt: new Date().toISOString(),
  },
];

const STORAGE_KEY = "hesba_test_session";
const PIN_KEY = "hesba_test_pin";
const PASSKEYS_KEY = "hesba_test_passkeys";

class FixtureAuthApi implements AuthApi {
  private session: SessionState | null = null;
  private pin: string | null = null;
  private passkeys: PasskeyInfo[] = [...DEFAULT_TEST_PASSKEYS];

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          this.session = JSON.parse(stored);
        }
        this.pin = localStorage.getItem(PIN_KEY);
        const storedPasskeys = localStorage.getItem(PASSKEYS_KEY);
        if (storedPasskeys) {
          this.passkeys = JSON.parse(storedPasskeys);
        }
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
        localStorage.setItem(PASSKEYS_KEY, JSON.stringify(this.passkeys));
      } catch {
        // Ignore storage errors in test environment
      }
    }
  }

  async signup(data: SignupInput): Promise<
    AuthApiResult<{
      session: SessionState;
      passkeyOptions: PasskeyRegistrationOptions;
    }>
  > {
    const user: UserSession = {
      id: `user-test-${Date.now()}`,
      name: `${data.ownerName} (TEST)`,
      phone: data.phone,
      email: `${data.email} (TEST)`,
      emailVerified: false,
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

    const passkeyOptions: PasskeyRegistrationOptions = {
      challenge: `challenge-test-signup-${Date.now()}-TEST`,
      rp: {
        id: "hesba.app",
        name: "حسبة (TEST)",
      },
      user: {
        id: user.id,
        name: user.email,
        displayName: user.name,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      timeout: 60000,
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
    };

    this.persist();
    return {
      success: true,
      data: {
        session: this.session,
        passkeyOptions,
      },
    };
  }

  async completePasskeyRegistration(
    credential: PasskeyCredentialResponse,
    label = "مفتاح مرور جديد (TEST)",
  ): Promise<AuthApiResult<SessionState>> {
    if (credential.id.includes("fail") || credential.id.includes("error")) {
      return {
        success: false,
        error: "فشل تسجيل مفتاح المرور على الجهاز (TEST)",
      };
    }

    const newPasskey: PasskeyInfo = {
      id: credential.id,
      label,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };

    this.passkeys.push(newPasskey);
    if (this.session) {
      this.session.user.emailVerified = true;
    }
    this.persist();

    return {
      success: true,
      data: this.session ?? {
        user: DEFAULT_TEST_USER,
        store: DEFAULT_TEST_STORE,
        token: `jwt-token-test-${Date.now()}-TEST`,
        expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
        isOfflineExpired: false,
        pinEnabled: Boolean(this.pin),
      },
    };
  }

  async getPasskeyAuthOptions(
    _identifier?: string,
  ): Promise<AuthApiResult<PasskeyAuthenticationOptions>> {
    void _identifier;
    return {
      success: true,
      data: {
        challenge: `challenge-test-auth-${Date.now()}-TEST`,
        rpId: "hesba.app",
        timeout: 60000,
        userVerification: "preferred",
      },
    };
  }

  async loginWithPasskey(
    credential: PasskeyCredentialResponse,
  ): Promise<AuthApiResult<SessionState>> {
    if (credential.id === "canceled" || credential.id === "cancelled") {
      return {
        success: false,
        error: "تم إلغاء تسجيل الدخول بمفتاح المرور (TEST)",
      };
    }

    if (credential.id === "expired") {
      return {
        success: false,
        error: "انتهت صلاحية طلب التحقق، برجاء المحاولة مجدداً (TEST)",
      };
    }

    if (credential.id === "unsupported") {
      return {
        success: false,
        error: "جهازك لا يدعم مفاتيح المرور Passkeys (TEST)",
      };
    }

    this.session = {
      user: DEFAULT_TEST_USER,
      store: DEFAULT_TEST_STORE,
      token: `jwt-login-passkey-TEST-${Date.now()}`,
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      isOfflineExpired: false,
      pinEnabled: Boolean(this.pin),
    };

    this.persist();
    return { success: true, data: this.session };
  }

  async requestAccountRecovery(
    input: AccountRecoveryRequestInput,
  ): Promise<AuthApiResult<{ message: string }>> {
    if (!input.email || !input.email.includes("@")) {
      return {
        success: false,
        error: "برجاء كتابة بريد إلكتروني صحيح (TEST)",
      };
    }

    // Generic response resisting account enumeration
    return {
      success: true,
      data: {
        message:
          "لو الإيميل مسجل عندنا، بعتنا رابط استرداد الحساب صالح لمدة 30 دقيقة (TEST)",
      },
    };
  }

  async verifyRecoveryToken(
    token: string,
  ): Promise<
    AuthApiResult<{ email: string; passkeyOptions: PasskeyRegistrationOptions }>
  > {
    if (token === "expired") {
      return {
        success: false,
        error: "رابط استرداد الحساب منتهي الصلاحية (TEST)",
      };
    }

    if (token === "used" || token === "invalid") {
      return {
        success: false,
        error: "رابط استرداد الحساب تم استخدامه مسبقاً أو غير صالح (TEST)",
      };
    }

    return {
      success: true,
      data: {
        email: "magdi.test@hesba.app",
        passkeyOptions: {
          challenge: `challenge-recovery-${Date.now()}-TEST`,
          rp: { id: "hesba.app", name: "حسبة (TEST)" },
          user: {
            id: "user-test-01",
            name: "magdi.test@hesba.app",
            displayName: "مجدي أحمد (TEST)",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          timeout: 60000,
        },
      },
    };
  }

  async completeAccountRecovery(
    input: AccountRecoveryConfirmInput,
    credential: PasskeyCredentialResponse,
  ): Promise<AuthApiResult<SessionState>> {
    if (input.token === "expired" || input.token === "invalid") {
      return {
        success: false,
        error: "فشل استرداد الحساب: رمز التحقق غير صالح (TEST)",
      };
    }

    // Register new passkey
    this.passkeys = [
      {
        id: credential.id || `passkey-recovery-${Date.now()}-TEST`,
        label: input.passkeyLabel || "مفتاح مرور جديد بعد الاسترداد (TEST)",
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      },
    ];

    // Establish fresh session, revoking older sessions
    this.session = {
      user: {
        ...DEFAULT_TEST_USER,
        emailVerified: true,
      },
      store: DEFAULT_TEST_STORE,
      token: `jwt-recovered-token-${Date.now()}-TEST`,
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      isOfflineExpired: false,
      pinEnabled: false, // Reset local PIN after recovery
    };
    this.pin = null;

    this.persist();
    return { success: true, data: this.session };
  }

  async listPasskeys(): Promise<AuthApiResult<PasskeyInfo[]>> {
    return { success: true, data: [...this.passkeys] };
  }

  async revokePasskey(
    passkeyId: string,
  ): Promise<AuthApiResult<{ success: boolean }>> {
    this.passkeys = this.passkeys.filter((p) => p.id !== passkeyId);
    this.persist();
    return { success: true, data: { success: true } };
  }

  async reauthenticateWithPasskey(): Promise<
    AuthApiResult<{ verified: boolean }>
  > {
    return { success: true, data: { verified: true } };
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

  async resetPinWithReauth(): Promise<AuthApiResult<{ allowed: boolean }>> {
    // Requires successful Passkey re-authentication before clearing PIN
    const authCheck = await this.reauthenticateWithPasskey();
    if (!authCheck.success || !authCheck.data?.verified) {
      return {
        success: false,
        error: "يلزم تأكيد الهوية بمفتاح المرور لإعادة ضبط رمز PIN (TEST)",
      };
    }
    this.pin = null;
    if (this.session) {
      this.session.pinEnabled = false;
    }
    this.persist();
    return { success: true, data: { allowed: true } };
  }

  async simulateOfflineExpiry(): Promise<void> {
    if (this.session) {
      this.session.isOfflineExpired = true;
      this.persist();
    }
  }
}

export const fixtureAuthApi = new FixtureAuthApi();
