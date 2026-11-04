import jwt, { SignOptions, JwtPayload } from "jsonwebtoken";
import crypto from "node:crypto";
import {
  AuthAdapter,
  AuthUser,
  AuthResponse,
  TokenPair,
  LoginInput,
  SignupInput,
  GuestMigrateInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
  ChangePasswordInput,
} from "../types";

export interface JwtAdapterConfig {
  secret: string;
  refreshSecret?: string;
  issuer?: string;
  accessTokenExpiresIn?: number; // In seconds (default: 3600 = 1h)
  refreshTokenExpiresIn?: number; // In seconds (default: 604800 = 7d)
}

export interface JwtCustomClaims extends JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  tenantId?: string;
  idToken?: string;
  type?: "access" | "refresh";
}

export class JwtAuthAdapter implements AuthAdapter {
  readonly providerName = "jwt";
  private readonly secret: string;
  private readonly refreshSecret: string;
  private readonly issuer: string;
  private readonly accessTokenExpiresIn: number;
  private readonly refreshTokenExpiresIn: number;

  constructor(config: JwtAdapterConfig) {
    if (!config.secret) {
      throw new Error("JwtAuthAdapter requires a non-empty secret key.");
    }
    this.secret = config.secret;
    this.refreshSecret = config.refreshSecret || `${config.secret}_refresh`;
    this.issuer = config.issuer || "bff-charging-platform";
    this.accessTokenExpiresIn = config.accessTokenExpiresIn || 3600;
    this.refreshTokenExpiresIn = config.refreshTokenExpiresIn || 604800;
  }

  // ---------------------------------------------------------------------------
  // Core Token Verification & Resolution
  // ---------------------------------------------------------------------------

  async verifyToken(token: string): Promise<AuthUser | null> {
    try {
      const decoded = jwt.verify(token, this.secret, {
        issuer: this.issuer,
      }) as JwtCustomClaims;

      if (decoded.type && decoded.type !== "access") {
        return null;
      }

      return {
        id: decoded.sub,
        email: decoded.email,
        roles: decoded.roles || ["driver"],
        tenantId: decoded.tenantId,
        idToken: decoded.idToken || `OCPP_IDTAG_${decoded.sub.slice(-8).toUpperCase()}`,
      };
    } catch {
      return null;
    }
  }

  async getDriverIdToken(userId: string): Promise<string | undefined> {
    if (!userId) return undefined;
    return `OCPP_IDTAG_${userId.slice(-8).toUpperCase()}`;
  }

  // ---------------------------------------------------------------------------
  // Authentication Workflows
  // ---------------------------------------------------------------------------

  async login(input: LoginInput): Promise<AuthResponse> {
    // Note: In production, substitute this with your DB user credential lookup & bcrypt validation
    const userId = `usr_${crypto.createHash("sha256").update(input.email).digest("hex").slice(0, 10)}`;
    const user: AuthUser = {
      id: userId,
      email: input.email,
      roles: ["driver"],
      tenantId: "tenant_default",
      idToken: await this.getDriverIdToken(userId),
    };

    const tokens = this.generateTokenPair(user);
    return { user, tokens };
  }

  async signup(input: SignupInput): Promise<AuthResponse> {
    const userId = `usr_${crypto.randomUUID().slice(0, 8)}`;
    const user: AuthUser = {
      id: userId,
      email: input.email,
      roles: ["driver"],
      tenantId: "tenant_default",
      idToken: await this.getDriverIdToken(userId) ?? undefined,
    };

    const tokens = this.generateTokenPair(user);
    return { user, tokens };
  }

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    try {
      const decoded = jwt.verify(refreshToken, this.refreshSecret, {
        issuer: this.issuer,
      }) as JwtCustomClaims;

      if (decoded.type !== "refresh") {
        throw new Error("Invalid token type");
      }

      const user: AuthUser = {
        id: decoded.sub,
        email: decoded.email,
        roles: decoded.roles || ["driver"],
        tenantId: decoded.tenantId,
        idToken: decoded.idToken,
      };

      return this.generateTokenPair(user);
    } catch {
      throw new Error("Invalid or expired refresh token");
    }
  }

  async registerAndMigrateGuest(input: GuestMigrateInput): Promise<AuthResponse> {
    const userId = `usr_migrated_${input.guestId.replace("anon_", "").slice(-6)}`;
    const user: AuthUser = {
      id: userId,
      email: input.email,
      roles: ["driver"],
      tenantId: "tenant_default",
      idToken: await this.getDriverIdToken(userId) ?? undefined,
    };

    const tokens = this.generateTokenPair(user);
    return { user, tokens };
  }

  // ---------------------------------------------------------------------------
  // Session & Password Management
  // ---------------------------------------------------------------------------

  async logout(_userId: string): Promise<void> {
    // For stateless JWTs, client discards token. Optional Redis revocation store can be attached here.
    return;
  }

  async requestPasswordReset(_input: RequestPasswordResetInput): Promise<{ success: boolean; message: string }> {
    return {
      success: true,
      message: "If an account exists for this email, a password reset token has been dispatched.",
    };
  }

  async resetPassword(_input: ResetPasswordInput): Promise<{ success: boolean }> {
    return { success: true };
  }

  async changePassword(_userId: string, _input: ChangePasswordInput): Promise<{ success: boolean }> {
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private generateTokenPair(user: AuthUser): TokenPair {
    const options: SignOptions = {
      issuer: this.issuer,
      expiresIn: this.accessTokenExpiresIn,
    };

    const accessPayload: JwtCustomClaims = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      tenantId: user.tenantId,
      idToken: user.idToken,
      type: "access",
    };

    const refreshPayload: JwtCustomClaims = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      tenantId: user.tenantId,
      type: "refresh",
    };

    const accessToken = jwt.sign(accessPayload, this.secret, options);
    const refreshToken = jwt.sign(refreshPayload, this.refreshSecret, {
      issuer: this.issuer,
      expiresIn: this.refreshTokenExpiresIn,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTokenExpiresIn,
      tokenType: "Bearer",
    };
  }
}