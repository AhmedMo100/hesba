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

const STORAGE_KEY = "hesba_test_session";
const PIN_KEY = "hesba_test_pin";
const LOCKOUT_KEY = "hesba_test_lockout";
const ATTEMPTS_KEY = "hesba_test_attempts";

class FixtureAuthApi implements AuthApi {
  private session: SessionState | null = null;
  private pin: string | null = null;
  private memoryStorage = new Map<string, string>();
  private passkeys: PasskeyInfo[] = [
    {
      id: "passkey-fixture-01",
      label: "جهاز المالك الأساسي (TEST)",
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    },
  ];

  private getItem(key: string): string | null {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      return localStorage.getItem(key);
    }
    return this.memoryStorage.get(key) ?? null;
  }

  private setItem(key: string, val: string): void {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem(key, val);
    } else {
      this.memoryStorage.set(key, val);
    }
  }

  private removeItem(key: string): void {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
    } else {
      this.memoryStorage.delete(key);
    }
  }

  constructor() {
    try {
      const stored = this.getItem(STORAGE_KEY);
      if (stored) {
        this.session = JSON.parse(stored);
      }
      this.pin = this.getItem(PIN_KEY);
    } catch {
      // Fallback to in-memory state
    }
  }

  private persist() {
    try {
      if (this.session) {
        this.setItem(STORAGE_KEY, JSON.stringify(this.session));
      } else {
        this.removeItem(STORAGE_KEY);
      }
      if (this.pin) {
        this.setItem(PIN_KEY, this.pin);
      } else {
        this.removeItem(PIN_KEY);
      }
    } catch {
      // Ignore storage errors in test environment
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
      email: data.email,
      emailVerified: false,
    };

    const store: StoreSession = {
      id: `store-test-${Date.now()}`,
      name: `${data.storeName} (TEST)`,
      shopType: data.shopType,
      governorate: data.governorate,
      area: data.area,
      openedOn: data.openedOn,
      workersCount: data.workersCount,
    };

    this.session = {
      user,
      store,
      token: `hesba-token-${Date.now()}-TEST`,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      pinEnabled: this.hasLocalPin(),
      isOfflineExpired: false,
    };

    this.persist();

    const passkeyOptions: PasskeyRegistrationOptions = {
      challenge: "fixture-challenge-test",
      rp: { id: "localhost", name: "حسبة" },
      user: { id: user.id, name: user.email, displayName: user.name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    };

    return {
      success: true,
      data: {
        session: this.session,
        passkeyOptions,
      },
    };
  }

  async completePasskeyRegistration(
    _credential?: PasskeyCredentialResponse,
    label = "جهاز المالك",
  ): Promise<AuthApiResult<SessionState>> {
    if (!this.session) {
      return { success: false, error: "لا توجد جلسة تسجيل نشطة" };
    }
    this.passkeys.push({
      id: `passkey-${Date.now()}`,
      label,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    });
    return { success: true, data: this.session };
  }

  async getPasskeyAuthOptions(
    _identifier?: string,
  ): Promise<AuthApiResult<PasskeyAuthenticationOptions>> {
    void _identifier;
    return {
      success: true,
      data: {
        challenge: "fixture-auth-challenge",
        rpId: "localhost",
        timeout: 60000,
        userVerification: "preferred",
      },
    };
  }

  async loginWithPasskey(
    _credential?: PasskeyCredentialResponse,
  ): Promise<AuthApiResult<SessionState>> {
    void _credential;
    this.session = {
      user: { ...DEFAULT_TEST_USER },
      store: { ...DEFAULT_TEST_STORE },
      token: `hesba-passkey-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      pinEnabled: this.hasLocalPin(),
      isOfflineExpired: false,
    };
    this.persist();
    return { success: true, data: this.session };
  }

  async requestMagicLink(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _email: string,
  ): Promise<AuthApiResult<{ message: string }>> {
    return {
      success: true,
      data: {
        message:
          "تم إرسال رابط الدخول الآمن إلى بريدك الإلكتروني إذا كان مسجلاً لدينا.",
      },
    };
  }

  async verifyMagicLink(token: string): Promise<AuthApiResult<SessionState>> {
    if (token === "invalid-token") {
      return {
        success: false,
        error: "رابط الدخول غير صالح أو انتهت صلاحيته",
      };
    }

    this.session = {
      user: { ...DEFAULT_TEST_USER },
      store: { ...DEFAULT_TEST_STORE },
      token: `hesba-magic-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      pinEnabled: this.hasLocalPin(),
      isOfflineExpired: false,
    };
    this.persist();

    return {
      success: true,
      data: this.session,
    };
  }

  async requestAccountRecovery(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _input: AccountRecoveryRequestInput | string,
  ): Promise<AuthApiResult<{ message: string }>> {
    return {
      success: true,
      data: {
        message: "إذا كان البريد مسجلاً لدينا، تم إرسال رابط الاسترداد.",
      },
    };
  }

  async verifyRecoveryToken(token: string): Promise<
    AuthApiResult<{
      email: string;
      passkeyOptions?: PasskeyRegistrationOptions;
      session?: SessionState;
    }>
  > {
    if (token === "invalid-token") {
      return {
        success: false,
        error: "رابط الاسترداد غير صالح أو انتهت صلاحيته",
      };
    }

    this.session = {
      user: { ...DEFAULT_TEST_USER },
      store: { ...DEFAULT_TEST_STORE },
      token: `hesba-recovery-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      pinEnabled: this.hasLocalPin(),
      isOfflineExpired: false,
    };
    this.persist();

    return {
      success: true,
      data: {
        email: DEFAULT_TEST_USER.email,
        session: this.session,
        passkeyOptions: {
          challenge: "fixture-recovery-challenge",
          rp: { id: "localhost", name: "حسبة" },
          user: {
            id: DEFAULT_TEST_USER.id,
            name: DEFAULT_TEST_USER.email,
            displayName: DEFAULT_TEST_USER.name,
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        },
      },
    };
  }

  async completeAccountRecovery(
    _input: AccountRecoveryConfirmInput,
    _credential?: PasskeyCredentialResponse,
  ): Promise<AuthApiResult<SessionState>> {
    void _input;
    void _credential;
    this.session = {
      user: { ...DEFAULT_TEST_USER },
      store: { ...DEFAULT_TEST_STORE },
      token: `hesba-recovered-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      pinEnabled: this.hasLocalPin(),
      isOfflineExpired: false,
    };
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
    return { success: true, data: { success: true } };
  }

  async reauthenticateWithPasskey(): Promise<
    AuthApiResult<{ verified: boolean }>
  > {
    return { success: true, data: { verified: true } };
  }

  async verifyEmail(
    token: string,
  ): Promise<AuthApiResult<{ success: boolean }>> {
    if (token === "invalid-token") {
      return {
        success: false,
        error: "رمز تأكيد البريد غير صالح أو منتهي الصلاحية",
      };
    }
    if (this.session) {
      this.session.user.emailVerified = true;
      this.persist();
    }
    return { success: true, data: { success: true } };
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
    if (this.session) {
      this.session.user.name = profile.ownerName;
      this.session.user.phone = profile.phone;
      this.session.user.email = profile.email;
      this.session.store.name = profile.storeName;
      this.session.store.shopType = profile.shopType;
      this.session.store.governorate = profile.governorate;
      this.session.store.area = profile.area;
      this.persist();
    }
    return { success: true, data: profile };
  }

  async revokeOtherSessions(): Promise<AuthApiResult<{ message: string }>> {
    return {
      success: true,
      data: { message: "تم تسجيل الخروج من الأجهزة الأخرى" },
    };
  }

  hasLocalPin(): boolean {
    return !!this.pin;
  }

  getPinLockoutRemainingSeconds(): number {
    const until = parseInt(this.getItem(LOCKOUT_KEY) || "0", 10);
    const now = Date.now();
    return until > now ? Math.ceil((until - now) / 1000) : 0;
  }

  recordFailedPinAttempt(): number {
    const count = parseInt(this.getItem(ATTEMPTS_KEY) || "0", 10) + 1;
    this.setItem(ATTEMPTS_KEY, String(count));
    if (count >= 5) {
      this.setItem(LOCKOUT_KEY, String(Date.now() + 30000));
    }
    return count;
  }

  resetPinAttempts(): void {
    this.removeItem(ATTEMPTS_KEY);
    this.removeItem(LOCKOUT_KEY);
  }

  async resetPinWithReauth(): Promise<AuthApiResult<{ allowed: boolean }>> {
    await this.setPin(null);
    return { success: true, data: { allowed: true } };
  }

  async verifyPin(pin: string): Promise<boolean> {
    if (this.getPinLockoutRemainingSeconds() > 0) return false;
    if (!this.pin) return true;
    if (pin === this.pin) {
      this.resetPinAttempts();
      return true;
    }
    this.recordFailedPinAttempt();
    return false;
  }

  async setPin(pin: string | null): Promise<void> {
    this.pin = pin;
    this.resetPinAttempts();
    if (this.session) {
      this.session.pinEnabled = !!pin;
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
