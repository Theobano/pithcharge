import { randomUUID } from "node:crypto";
import { db } from "@pithcharge/db";
import { BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  admin,
  anonymous,
  organization,
  phoneNumber,
} from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { passkey } from "@better-auth/passkey";
import { isEmailConfigured, renderEmail, sendEmail } from "@pithcharge/notifications";

const isProduction = process.env.NODE_ENV === "production";
// Verification only makes sense when mail can actually be delivered, otherwise nobody could sign in.
const emailVerificationRequired =
  process.env.EMAIL_REQUIRE_VERIFICATION === "true" && isEmailConfigured();
const authSecret = process.env.BETTER_AUTH_SECRET;
const organizationStatements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;
const organizationAccess = createAccessControl(organizationStatements);
const ownerRole = organizationAccess.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
});
const adminRole = organizationAccess.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
});
const userRole = organizationAccess.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
});
const auditorRole = organizationAccess.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
});

if (isProduction && !authSecret) {
  throw new Error("BETTER_AUTH_SECRET must be configured in production.");
}

export type TokenRegistrar = (token: {
  idToken: string;
  tokenType: string;
  concurrentTransaction?: boolean;
}) => Promise<{ accepted: boolean }>;

let tokenRegistrar: TokenRegistrar | undefined;

/** Registers the callback used to push newly generated tokens to the OCPP CMS at account creation. */
export function setTokenRegistrar(registrar: TokenRegistrar | undefined) {
  tokenRegistrar = registrar;
}

export const authConfig: BetterAuthOptions = {
  appName: process.env.APP_NAME || "Pithcharge",
  secret: authSecret || "development-only-better-auth-secret",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:4000", // Base URL of your app
  basePath: "/api/v1/auth", // Base path for auth routes,
  database: prismaAdapter(db, {
    provider: "postgresql", // or "mysql", "sqlite", ...etc
  }),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          console.log("Creating OCPP token for user:", user);
          const isAnonymous = Boolean((user as { isAnonymous?: boolean }).isAnonymous);
          const existingToken = await db.userOcppToken.findFirst({
            where: { userId: user.id },
            select: { id: true },
          });
          if (existingToken) return;

          const idToken = `${isAnonymous ? "GUEST" : "APP"}_${randomUUID().replaceAll("-", "").toUpperCase()}`;
          const token = await db.userOcppToken.create({
            data: {
              userId: user.id,
              idToken,
              tokenType: "Central",
              status: "PENDING_ACTIVATION",
              isDefault: true,
              nickname: isAnonymous ? "Guest token" : "App token",
            },
          });

          // Register in real time. If the CMS is unreachable the token stays pending and is
          // re-synced on the user's next login or session start.
          if (!tokenRegistrar) return;
          try {
            const { accepted } = await tokenRegistrar({
              idToken,
              tokenType: "Central",
              concurrentTransaction: !isAnonymous,
            });
            await db.userOcppToken.updateMany({
              where: { id: token.id, status: "PENDING_ACTIVATION" },
              data: { status: accepted ? "ACTIVE" : "BLOCKED" },
            });
          } catch (error) {
            console.error("OCPP token registration at account creation failed; will retry on login", error);
          }
        },
      },
    },
    session: {
      create: {
        // Log users into the organization they last used, as long as they are still a member.
        before: async (session) => {
          // Impersonated sessions start as the target would see public mode and never reuse their last org.
          if ((session as { impersonatedBy?: string | null }).impersonatedBy) return;
          const user = await db.user.findUnique({
            where: { id: session.userId },
            select: { lastActiveOrganizationId: true, isAnonymous: true },
          });
          const orgId = user?.lastActiveOrganizationId;
          if (!orgId || user?.isAnonymous) return;
          const membership = await db.member.findFirst({
            where: { userId: session.userId, organizationId: orgId },
            select: { id: true },
          });
          if (!membership) return;
          return { data: { ...session, activeOrganizationId: orgId } };
        },
        after: async (session) => {
          const impersonatedBy = (session as { impersonatedBy?: string | null }).impersonatedBy;
          if (!impersonatedBy) return;
          await db.auditLog
            .create({
              data: {
                actorId: impersonatedBy,
                action: "admin.impersonation.started",
                targetType: "User",
                targetId: session.userId,
                metadata: { sessionId: session.id, byPlatformAdmin: true },
              },
            })
            .catch((error: unknown) => console.error("Failed to audit impersonation", error));
        },
      },
      update: {
        // Remember the active organization (null = public mode) for the next login.
        after: async (session) => {
          if ((session as { impersonatedBy?: string | null }).impersonatedBy) return;
          if (!("activeOrganizationId" in session)) return;
          const activeOrganizationId =
            (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
          await db.user.updateMany({
            where: { id: session.userId, isAnonymous: { not: true } },
            data: { lastActiveOrganizationId: activeOrganizationId },
          });
        },
      },
    },
  },
  // In development any private-network origin is trusted so the app can be opened from a phone on the LAN.
  trustedOrigins: isProduction
    ? (process.env.TRUSTED_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim())
    : [
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://192.168.*.*:*",
        "http://10.*.*.*:*",
        "http://172.*.*.*:*",
        ...(process.env.TRUSTED_ORIGINS || "")
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ],

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: emailVerificationRequired,
    resetPasswordTokenExpiresIn: 3600,
    sendResetPassword: async ({ user, url }) => {
      if (!isEmailConfigured()) {
        console.warn("Password reset requested but email delivery is not configured.");
        return;
      }
      const { html, text } = renderEmail({
        heading: "Reset your password",
        body: "We received a request to reset your password. This link expires in one hour. If you did not ask for this, you can ignore this email.",
        action: { label: "Reset password", url },
      });
      // Not awaited so response timing does not reveal whether the account exists.
      void sendEmail({ to: user.email, subject: "Reset your password", text, html }).catch((error) =>
        console.error("Failed to send password reset email", error),
      );
    },
  },
  emailVerification: {
    sendOnSignUp: emailVerificationRequired,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (!isEmailConfigured() || (user as { isAnonymous?: boolean }).isAnonymous) return;
      const { html, text } = renderEmail({
        heading: "Verify your email address",
        body: "Confirm your email address to finish setting up your account.",
        action: { label: "Verify email", url },
      });
      void sendEmail({ to: user.email, subject: "Verify your email address", text, html }).catch((error) =>
        console.error("Failed to send verification email", error),
      );
    },
  },
  // Google sign-in is enabled once GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
  socialProviders:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  plugins: [
    admin({
      impersonationSessionDuration: 60 * 60,
      allowImpersonatingAdmins: false,
    }),
    anonymous(),
    phoneNumber({
      sendOTP: async ({ phoneNumber, code }, request) => {
        // Integrate your SMS provider here (e.g. Twilio, Termii, Infobip)
        console.log(`Sending OTP ${code} to ${phoneNumber}`);
      },
    }),
    passkey(),
    organization({
      ac: organizationAccess,
      roles: {
        owner: ownerRole,
        admin: adminRole,
        user: userRole,
        member: userRole,
        auditor: auditorRole,
      },
    }),
  ],
};
