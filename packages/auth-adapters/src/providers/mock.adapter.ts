import {
  AuthAdapter,
  AuthUser,
  AuthResponse,
  LoginInput,
  SignupInput,
  GuestMigrateInput,
  TokenPair,
  RequestPasswordResetInput,
  ResetPasswordInput,
  ChangePasswordInput,
} from "../types";

export class MockAuthAdapter implements AuthAdapter {
  readonly providerName = "mock";

  async verifyToken(token: string): Promise<AuthUser | null> {
    if (token === "invalid-token") return null;
    return {
      id: "usr_mock_123",
      email: "driver@example.com",
      roles: ["driver"],
      tenantId: "tenant_default",
      idToken: `VIRTUAL_TAG_${token.slice(-6)}`,
    };
  }

  async getDriverIdToken(userId: string): Promise<string | undefined> {
    if (!userId) return undefined;
    return `OCPP_IDTAG_${userId.slice(-8).toUpperCase()}`;
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    return {
      user: {
        id: "usr_mock_123",
        email: input.email,
        roles: ["driver"],
        tenantId: "tenant_default",
        idToken: "OCPP_IDTAG_USR_123",
      },
      tokens: {
        accessToken: "mock_access_token_123",
        refreshToken: "mock_refresh_token_123",
        expiresIn: 3600,
        tokenType: "Bearer",
      },
    };
  }

  async signup(input: SignupInput): Promise<AuthResponse> {
    const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
    return {
      user: {
        id,
        email: input.email,
        roles: ["driver"],
        idToken: `OCPP_IDTAG_${id.slice(-8).toUpperCase()}`,
      },
      tokens: {
        accessToken: "mock_access_token_signup",
        refreshToken: "mock_refresh_token_signup",
        expiresIn: 3600,
        tokenType: "Bearer",
      },
    };
  }

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    if (!refreshToken) throw new Error("Invalid refresh token");
    return {
      accessToken: "mock_refreshed_access_token",
      refreshToken: "mock_refreshed_refresh_token",
      expiresIn: 3600,
      tokenType: "Bearer",
    };
  }

  async registerAndMigrateGuest(input: GuestMigrateInput): Promise<AuthResponse> {
    const id = `usr_migrated_${input.guestId.slice(-6)}`;
    return {
      user: {
        id,
        email: input.email,
        roles: ["driver"],
        idToken: `OCPP_IDTAG_${id.slice(-8).toUpperCase()}`,
      },
      tokens: {
        accessToken: "mock_access_token_migrated",
        refreshToken: "mock_refresh_token_migrated",
        expiresIn: 3600,
        tokenType: "Bearer",
      },
    };
  }

  async logout(_userId: string): Promise<void> {
    return;
  }

  async requestPasswordReset(_input: RequestPasswordResetInput): Promise<{ success: boolean; message: string }> {
    return {
      success: true,
      message: "If an account exists, a password reset email has been sent.",
    };
  }

  async resetPassword(_input: ResetPasswordInput): Promise<{ success: boolean }> {
    return { success: true };
  }

  async changePassword(_userId: string, _input: ChangePasswordInput): Promise<{ success: boolean }> {
    return { success: true };
  };
}