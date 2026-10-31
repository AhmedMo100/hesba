export interface SignupInput {
  ownerName: string;
  phone: string;
  email: string;
  password: string;
  storeName: string;
  shopType: string;
  governorate: string;
  area?: string;
  openedOn?: string;
  workersCount?: number;
  withDemoData?: boolean;
}

export interface LoginInput {
  phone: string;
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
}

export interface AuthApi {
  // Mobile + Password Authentication
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
