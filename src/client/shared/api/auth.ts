export interface SignupInput {
  ownerName: string;
  phone: string;
  email?: string;
  password?: string;
  storeName: string;
  shopType: string;
  governorate: string;
  area?: string;
  openedOn: string;
  workersCount: number;
  withDemoData?: boolean;
}

export interface LoginInput {
  phone: string;
  password?: string;
}

export interface OtpVerifyInput {
  phone: string;
  code: string;
}

export interface UserSession {
  id: string;
  name: string;
  phone: string;
  email?: string;
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
  email?: string;
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
  requiresOtp?: boolean;
}

export interface AuthApi {
  signup(data: SignupInput): Promise<AuthApiResult<SessionState>>;
  login(creds: LoginInput): Promise<AuthApiResult<SessionState>>;
  requestOtp(phone: string): Promise<AuthApiResult<{ message: string }>>;
  verifyOtp(data: OtpVerifyInput): Promise<AuthApiResult<SessionState>>;
  getSession(): Promise<SessionState | null>;
  logout(): Promise<void>;
  updateProfile(profile: StoreProfile): Promise<AuthApiResult<StoreProfile>>;
  verifyPin(pin: string): Promise<boolean>;
  setPin(pin: string | null): Promise<void>;
  simulateOfflineExpiry(): Promise<void>;
}
