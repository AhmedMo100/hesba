import type { OperatingMode } from "@/domain/operating-mode";
import type { StoreAccessView } from "@/domain/subscription";

export interface SignupInput {
  ownerName: string;
  phone: string;
  email?: string;
  password: string;
  storeName: string;
  shopType: string;
  governorate: string;
  area?: string;
  openedOn?: string;
  workersCount?: number;
  withDemoData?: boolean;
  /** Optional influencer/referral code (checked on the server). */
  referralCode?: string;
  /** إدارة المحل or الكاشير الذكي — chosen by the owner, never by default (ADR-0033). */
  operatingMode?: OperatingMode;
}

export interface LoginInput {
  /** Phone number or email address. */
  identifier: string;
  password: string;
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
  /** 'simple' | 'pos' (ADR-0033). */
  operatingMode?: string;
  /** The subscription as the server read it (the server enforces it; the screen shows it). */
  subscription?: StoreAccessView["subscription"];
}

export interface SessionState {
  user: UserSession;
  store: StoreSession;
  token?: string;
  expiresAt: string;
  isOfflineExpired?: boolean;
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
  openedOn?: string;
  workersCount: number;
}

export interface AuthApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  /** The form field the server's validation error is about, when it names one. */
  field?: string;
}

export interface AuthApi {
  // Phone or Email + Password Authentication
  login(credentials: LoginInput): Promise<AuthApiResult<SessionState>>;
  signup(data: SignupInput): Promise<AuthApiResult<SessionState>>;

  // Forgot Password via 6-Digit Email Code
  requestPasswordReset(
    email: string,
  ): Promise<AuthApiResult<{ message: string }>>;
  resetPassword(data: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<AuthApiResult<{ message: string }>>;

  // Session & Profile
  getSession(): Promise<SessionState | null>;
  logout(): Promise<void>;
  updateProfile(profile: StoreProfile): Promise<AuthApiResult<StoreProfile>>;
  revokeOtherSessions?(): Promise<AuthApiResult<{ message: string }>>;

  // Offline Simulation
  simulateOfflineExpiry(): Promise<void>;
}
