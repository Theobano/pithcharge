export type AuthProviderType = "mock" | "jwt" ;

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  roles: string[]; // e.g. ['driver', 'operator', 'admin']
  idToken?: string;  // OCPP ID Token (RFID tag UID or Virtual Driver ID)
  tenantId?: string; // Optional station/org tenant context
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: TokenPair;
}

export interface LoginInput {
  email: string;
  password?: string;
}

export interface SignupInput {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
}

export interface GuestMigrateInput extends SignupInput {
  guestId: string;
}

export interface ResetPasswordInput {
  resetToken: string;
  newPassword?: string;
}

export interface RequestPasswordResetInput {
  email: string;
}

export interface ChangePasswordInput {
  currentPassword?: string;
  newPassword?: string;
}

export interface AuthSession {
  user: AuthUser;
  expiresAt: Date;
  token: string;
}

export interface AuthAdapterConfig {
  provider: AuthProviderType;
  issuerUrl?: string;
  secret?: string;
  audience?: string;
}

export interface AuthAdapter {
  readonly providerName: string;
  verifyToken(token: string): Promise<AuthUser | null>;
  getDriverIdToken(userId: string): Promise<string | undefined>;
  login(input: LoginInput): Promise<AuthResponse>;
  signup(input: SignupInput): Promise<AuthResponse>;
  refreshToken(refreshToken: string): Promise<TokenPair>;
  registerAndMigrateGuest(input: GuestMigrateInput): Promise<AuthResponse>;
  logout(userId: string): Promise<void>;
  requestPasswordReset(input: RequestPasswordResetInput): Promise<{ success: boolean; message: string }>;
  resetPassword(input: ResetPasswordInput): Promise<{ success: boolean }>;
  changePassword(userId: string, input: ChangePasswordInput): Promise<{ success: boolean }>;
}