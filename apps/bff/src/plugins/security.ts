import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { fromNodeHeaders } from "@pithcharge/auth";
import { auth } from "@pithcharge/auth";
import { db } from "@pithcharge/db";
import { Action, ResourceAttributes, RemoteStartContext } from "../types";

export interface SystemUser {
  id: string;
  email: string;
  name?: string;
  role: string; // From Admin plugin ('user' | 'admin')
  organizationRole?: string;
  organizationId?: string; // Active organization of the session (Better Auth organization plugin)
  idToken?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SystemUser;
    /** True when the request carries a valid Better Auth session, including anonymous (guest) accounts. */
    isAuthenticated: boolean;
    /** True when the authenticated account is an anonymous (guest) account. Never true without a session. */
    isAnonymous: boolean;
  }
  interface FastifyInstance {
    /** Requires any session: registered or anonymous (guest). Use for endpoints guests may use, e.g. charging. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Requires a registered (non-anonymous) account. Use for billing, organizations, notifications, hardware commands. */
    requireRegistered: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Requires a platform administrator (Better Auth admin role). Use for /admin routes. */
    requirePlatformAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (
      action: Action,
      getResourceAttrs: (req: FastifyRequest) => Promise<ResourceAttributes> | ResourceAttributes,
      getContext?: (req: FastifyRequest) => Promise<RemoteStartContext> | RemoteStartContext
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Global ABAC Evaluator remains clean and typed
export function evaluateAbacPolicy(
  action: Action,
  user: SystemUser,
  isAnonymous: boolean,
  resource?: ResourceAttributes,
  context?: RemoteStartContext
): { allowed: boolean; reason?: string } {
  if (user.organizationRole === "auditor" && action !== "station:Read") {
    return { allowed: false, reason: "Auditors have view-only access." };
  }

  if (action === "station:Read") return { allowed: true };

  if (action === "organization:ManageMembers") {
    const isOrganizationAdmin =
      user.role === "admin" || user.organizationRole === "admin";
    return isOrganizationAdmin
      ? { allowed: true }
      : { allowed: false, reason: "Organization administrator access is required." };
  }

  // Starting/stopping a charging session is open to every authenticated account, anonymous included.
  if (action === "session:Control") return { allowed: true };

  if (action === "station:Write") {
    if (isAnonymous) {
      return { allowed: false, reason: "Sign in to control a charging station." };
    }
    return { allowed: true };
  }

  if (action === "ocpp:ResetHardware" || action === "ocpp:GetDiagnostics") {
    const isStaff = ["admin", "operator", "support"].includes(user.role);
    if (!isStaff) {
      return { allowed: false, reason: "Insufficient role for hardware commands." };
    }

    if (resource?.ownerOrganizationId && user.organizationId && user.organizationId !== resource.ownerOrganizationId) {
      return {
        allowed: false,
        reason: `Access denied. Hardware belongs to organization ${resource.ownerOrganizationId}.`,
      };
    }

    return { allowed: true };
  }

  if (action === "ocpp:RemoteStart") {
    // Any authenticated account (guests included) may start a session. Live station/connector state,
    // wallet funding and guest limits are enforced in the route handler against real CMS data.
    if (resource && resource.isOnline === false) {
      return { allowed: false, reason: "Hardware offline. Remote start unavailable." };
    }
    if (context?.billingMode === "SUPPORT_OVERRIDE" && user.role !== "admin") {
      return { allowed: false, reason: "Unauthorized for support override session." };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: "Action forbidden by default policy." };
}

const securityPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    console.log("Authenticating request:", req.id);
    if (!req.isAuthenticated) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Authentication required for this endpoint.",
        code: "UNAUTHENTICATED",
      });
    }
  });

  fastify.decorate("requireRegistered", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.isAuthenticated) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Authentication required for this endpoint.",
        code: "UNAUTHENTICATED",
      });
    }
    if (req.isAnonymous) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Create an account or sign in to use this feature.",
        code: "REGISTERED_ACCOUNT_REQUIRED",
      });
    }
  });

  fastify.decorate("requirePlatformAdmin", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.isAuthenticated) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Authentication required for this endpoint.",
        code: "UNAUTHENTICATED",
      });
    }
    if (req.isAnonymous || req.user.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Platform administrator access is required.",
        code: "PLATFORM_ADMIN_REQUIRED",
      });
    }
  });

  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionContext = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!sessionContext?.user) {
      req.user = { id: "", email: "", role: "none" };
      req.isAuthenticated = false;
      req.isAnonymous = false;
      return;
    }

    const { user, session } = sessionContext;
    const isAnon = Boolean((user as { isAnonymous?: boolean }).isAnonymous);
    const activeOrganizationId = (session as { activeOrganizationId?: string })
      .activeOrganizationId;
    const [membership, activeToken] = await Promise.all([
      activeOrganizationId && !isAnon
        ? db.member.findFirst({
            where: {
              organizationId: activeOrganizationId,
              userId: user.id,
            },
            select: { role: true },
          })
        : Promise.resolve(null),
      db.userOcppToken.findFirst({
        where: { userId: user.id, status: "ACTIVE" },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: { idToken: true },
      }),
    ]);
    const organizationRole =
      membership?.role === "owner"
        ? "admin"
        : membership?.role === "member"
          ? "user"
          : membership?.role;

    req.user = {
      id: user.id,
      email: user.email || "",
      name: user.name,
      role: (user as { role?: string }).role || "user",
      organizationRole,
      organizationId: membership ? activeOrganizationId : undefined,
      idToken: activeToken?.idToken,
    };
    req.isAuthenticated = true;
    req.isAnonymous = isAnon;
  });

  fastify.decorate("authorize", (action, getResourceAttrs, getContext) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const resourceAttrs = await getResourceAttrs(req);
      const context = getContext ? await getContext(req) : undefined;

      const decision = evaluateAbacPolicy(
        action,
        req.user,
        req.isAnonymous,
        resourceAttrs,
        context
      );

      if (!decision.allowed) {
        reply.status(403).send({
          error: "Forbidden",
          message: decision.reason,
          code: "ABAC_POLICY_VIOLATION",
        });
      }
    };
  });
};

export default fp(securityPlugin);