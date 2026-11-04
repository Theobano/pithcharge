// apps/web/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  organizationClient,
  anonymousClient,
  phoneNumberClient,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client"
import { bffUrl } from "@/lib/api/base-url"

export const authClient = createAuthClient({
    baseURL: `${bffUrl()}/api/v1/auth`,
  fetchOptions: {
    credentials: "include", // Enables cross-origin cookie sharing with Fastify BFF
  },
  plugins: [
    adminClient(),
    organizationClient(),
    anonymousClient(),
    passkeyClient(),
    phoneNumberClient(),
  ],
});

// Export convenience hooks and client methods
export const {
  useSession,
  signIn,
  signUp,
  signOut,
  useListOrganizations,
  useActiveOrganization,
} = authClient;