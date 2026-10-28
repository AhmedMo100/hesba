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

export interface LoginInput {
  identifier?: string;
}

export interface PasskeyInfo {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface PasskeyRegistrationOptions {
  challenge: string;
  rp: {
    id: string;
    name: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  pubKeyCredParams: Array<{ type: string; alg: number }>;
  timeout?: number;
  attestation?: string;
  authenticatorSelection?: {
    authenticatorAttachment?: "platform" | "cross-platform";
    residentKey?: "required" | "preferred" | "discouraged";
    userVerification?: "required" | "preferred" | "discouraged";
  };
}

export interface PasskeyAuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout?: number;
  userVerification?: "required" | "preferred" | "discouraged";
  allowCredentials?: Array<{
    id: string;
    type: "public-key";
    transports?: string[];
  }>;
}

export interface PasskeyCredentialResponse {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    attestationObject?: string;
    authenticatorData?: string;
    signature?: string;
    userHandle?: string;
  };
}

export interface AccountRecoveryRequestInput {
  email: string;
}

export interface AccountRecoveryConfirmInput {
  token: string;
  passkeyLabel?: string;
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
  requiresPasskeyRegistration?: boolean;
}

export interface AuthApi {
  // Passkey Registration & Signup
  signup(data: SignupInput): Promise<
    AuthApiResult<{
      session: SessionState;
      passkeyOptions: PasskeyRegistrationOptions;
    }>
  >;
  completePasskeyRegistration(
    credential?: PasskeyCredentialResponse,
    label?: string,
  ): Promise<AuthApiResult<SessionState>>;

  // Passkey Authentication & Login
  getPasskeyAuthOptions(
    identifier?: string,
  ): Promise<AuthApiResult<PasskeyAuthenticationOptions>>;
  loginWithPasskey(
    credential?: PasskeyCredentialResponse,
  ): Promise<AuthApiResult<SessionState>>;

  // Account Recovery via Email Link
  requestAccountRecovery(
    input: AccountRecoveryRequestInput | string,
  ): Promise<AuthApiResult<{ message: string }>>;
  verifyRecoveryToken(token: string): Promise<
    AuthApiResult<{
      email: string;
      passkeyOptions?: PasskeyRegistrationOptions;
      session?: SessionState;
    }>
  >;
  completeAccountRecovery(
    input: AccountRecoveryConfirmInput,
    credential?: PasskeyCredentialResponse,
  ): Promise<AuthApiResult<SessionState>>;

  // Passkey Management
  listPasskeys(): Promise<AuthApiResult<PasskeyInfo[]>>;
  revokePasskey(
    passkeyId: string,
  ): Promise<AuthApiResult<{ success: boolean }>>;

  // Re-authentication for Security Sensitive Actions
  reauthenticateWithPasskey(): Promise<AuthApiResult<{ verified: boolean }>>;

  // Email Verification
  verifyEmail(token: string): Promise<AuthApiResult<{ success: boolean }>>;

  // Magic Link Support (fallback/complementary)
  requestMagicLink?(email: string): Promise<AuthApiResult<{ message: string }>>;
  verifyMagicLink?(token: string): Promise<AuthApiResult<SessionState>>;

  // Session & Profile
  getSession(): Promise<SessionState | null>;
  logout(): Promise<void>;
  updateProfile(profile: StoreProfile): Promise<AuthApiResult<StoreProfile>>;
  revokeOtherSessions?(): Promise<AuthApiResult<{ message: string }>>;

  // Local Application Screen Lock (PIN)
  verifyPin(pin: string): Promise<boolean>;
  setPin(pin: string | null): Promise<void>;
  hasLocalPin?(): boolean;
  getPinLockoutRemainingSeconds?(): number;
  recordFailedPinAttempt?(): number;
  resetPinAttempts?(): void;
  resetPinWithReauth?(): Promise<AuthApiResult<{ allowed: boolean }>>;

  // Offline Simulation
  simulateOfflineExpiry(): Promise<void>;
}
