import { AuthAdapter, AuthProviderType } from "./types";
import { MockAuthAdapter } from "./providers/mock.adapter";
import { JwtAuthAdapter } from "./providers/jwt.adapter";


export interface CreateAuthAdapterConfig {
  provider: AuthProviderType;
  secret?: string;
  refreshSecret?: string;
  issuerUrl?: string;
  accessTokenExpiresIn?: number;
}

export function createAuthAdapter(config: CreateAuthAdapterConfig): AuthAdapter {
  switch (config.provider) {
    case "jwt":
      if (!config.secret) {
        throw new Error("AUTH_SECRET environment variable is required for JWT auth provider.");
      }
      return new JwtAuthAdapter({
        secret: config.secret,
        refreshSecret: config.refreshSecret,
        issuer: config.issuerUrl,
        accessTokenExpiresIn: config.accessTokenExpiresIn,
      });

    case "mock":
    default:
      return new MockAuthAdapter();
  }
}