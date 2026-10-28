export interface SignupInput {
  ownerName: string;
  phone: string;
  email: string;
  storeName: string;
  shopType: string;
  governorate: string;
  area?: string;
  openedOn: string;
  workersCount: number;
  withDemoData?: boolean;
}

export interface UserSession {
  id: string;
  name: string;
  phone: string;
  email: string;
  emailVerified?: boolean;
}

export interface StoreSession {
  id: string;
  name: string;
  shopType: string;
  governorate: string;
  area?: string;
  openedOn: string;
  workersCount: number;
}

export interface SessionState {
  user: UserSession;
  store: StoreSession;
  token: string;
  expiresAt: string;
  isOfflineExpired?: boolean;
  pinEnabled?: boolean;
}

export interface StoreProfile {
  ownerName: string;
  phone: string;
  email: string;
  emailVerified?: boolean;
  storeName: string;
  shopType: string;
  governorate: string;
  area?: string;
  openedOn: string;
  workersCount: number;
}

export interface AuthApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AuthApi {
  // Registration (3-step)
  signup(data: SignupInput): Promise<AuthApiResult<SessionState>>;

  // Magic Link Login for New Devices
  requestMagicLink(email: string): Promise<AuthApiResult<{ message: string }>>;
  verifyMagicLink(token: string): Promise<AuthApiResult<SessionState>>;

  // Account Recovery via Email Link
  requestAccountRecovery(
    email: string,
  ): Promise<AuthApiResult<{ message: string }>>;
  verifyRecoveryToken(token: string): Promise<AuthApiResult<SessionState>>;

  // Email Verification
  verifyEmail(token: string): Promise<AuthApiResult<{ success: boolean }>>;

  // Session & Profile
  getSession(): Promise<SessionState | null>;
  logout(): Promise<void>;
  updateProfile(profile: StoreProfile): Promise<AuthApiResult<StoreProfile>>;
  revokeOtherSessions(): Promise<AuthApiResult<{ message: string }>>;

  // Local Device Screen Lock (PIN)
  verifyPin(pin: string): Promise<boolean>;
  setPin(pin: string | null): Promise<void>;
  hasLocalPin(): boolean;
  getPinLockoutRemainingSeconds(): number;
  recordFailedPinAttempt(): number;
  resetPinAttempts(): void;

  // Offline Simulation
  simulateOfflineExpiry(): Promise<void>;
}
