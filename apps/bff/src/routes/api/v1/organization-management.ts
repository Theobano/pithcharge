import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import { db, Prisma } from '@pithcharge/db';
import { PageQuery, pageArgs, paged } from '../../../services/admin.service';
import { recordAuditEvent } from '../../../services/financial.service';
import { currentBillingPeriod } from '../../../services/invoice.service';
import {
  InvitationError,
  buildInviteLink,
  createInvitation,
  invitationState,
} from '../../../services/invitation.service';

type OrgRole = 'owner' | 'admin' | 'user' | 'auditor';

interface OrgAccess {
  organizationId: string;
  memberId: string | null;
  role: OrgRole;
  isPlatformAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    orgAccess?: OrgAccess;
  }
}

const normalizeRole = (role: string): OrgRole => (role === 'member' ? 'user' : (role as OrgRole));

const Slug = Type.String({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', minLength: 2, maxLength: 48 });

const UpdateOrganization = Type.Object({
  name: Type.Optional(Type.String({ minLength: 2, maxLength: 80 })),
  slug: Type.Optional(Slug),
  logo: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 500 }), Type.Null()])),
}, { additionalProperties: false });

const AddMember = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  role: Type.Union([Type.Literal('admin'), Type.Literal('user'), Type.Literal('auditor')]),
}, { additionalProperties: false });

const TransferOwnership = Type.Object({ memberId: Type.String({ minLength: 1 }) }, { additionalProperties: false });

const SessionsQuery = Type.Intersect([
  PageQuery,
  Type.Object({ status: Type.Optional(Type.String()), userId: Type.Optional(Type.String()) }),
]);

const noOrg = {
  code: 'ACTIVE_ORGANIZATION_REQUIRED',
  message: 'Select an organization first.',
};

/** Loads the caller's membership in the active organization and enforces the allowed roles. */
function requireOrgRole(allowed: OrgRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const organizationId = request.user.organizationId;
    if (!organizationId) return reply.code(409).send(noOrg);

    const isPlatformAdmin = request.user.role === 'admin';
    const membership = await db.member.findFirst({
      where: { organizationId, userId: request.user.id },
      select: { id: true, role: true },
    });
    if (!membership && !isPlatformAdmin) {
      return reply.code(403).send({ code: 'NOT_A_MEMBER', message: 'You are not a member of this organization.' });
    }

    const role: OrgRole = membership ? normalizeRole(membership.role) : 'admin';
    if (!allowed.includes(role)) {
      return reply.code(403).send({
        code: 'ORGANIZATION_ROLE_REQUIRED',
        message: allowed.includes('admin')
          ? 'Organization administrator access is required.'
          : 'Organization owner access is required.',
      });
    }
    request.orgAccess = { organizationId, memberId: membership?.id ?? null, role, isPlatformAdmin };
  };
}

const manage = requireOrgRole(['owner', 'admin']);
const viewAll = requireOrgRole(['owner', 'admin', 'auditor']);
const anyMember = requireOrgRole(['owner', 'admin', 'user', 'auditor']);
const ownerOnly = requireOrgRole(['owner']);

const organizationManagementRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/organizations/current', { preHandler: [fastify.requireRegistered, anyMember] }, async (request) => {
    const { organizationId, role } = request.orgAccess!;
    const billingPolicy = await db.billingPolicy.findUnique({ where: { organizationId } });

    // Regular members only learn what they need to charge: no spend, usage, member count, slug or logo.
    if (role === 'user') {
      const organization = await db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { id: true, name: true },
      });
      return {
        data: {
          organization,
          policy: billingPolicy && {
            billingMode: billingPolicy.billingMode,
            walletSharingMode: billingPolicy.walletSharingMode,
            currency: billingPolicy.currency,
          },
          myRole: role,
          currentUserId: request.user.id,
          canManage: false,
          isOwner: false,
          restricted: true,
        },
      };
    }

    const period = currentBillingPeriod(billingPolicy);
    const policy = billingPolicy && {
      billingMode: billingPolicy.billingMode,
      walletSharingMode: billingPolicy.walletSharingMode,
      currency: billingPolicy.currency,
      billingCycleUnit: billingPolicy.billingCycleUnit,
      billingCycleInterval: billingPolicy.billingCycleInterval,
    };
    const [organization, memberCount, usage] = await Promise.all([
      db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { id: true, name: true, slug: true, logo: true, createdAt: true },
      }),
      db.member.count({ where: { organizationId } }),
      db.chargingSession.aggregate({
        where: { organizationId, startTime: { gte: period.start, lt: period.end } },
        _count: true,
        _sum: { totalKwh: true, totalCost: true },
      }),
    ]);
    return {
      data: {
        organization,
        policy,
        myRole: role,
        currentUserId: request.user.id,
        canManage: role === 'owner' || role === 'admin',
        isOwner: role === 'owner',
        memberCount,
        currentPeriod: {
          start: period.start,
          end: period.end,
          sessions: usage._count,
          kwh: usage._sum.totalKwh ?? 0,
          spend: (usage._sum.totalCost ?? 0).toString(),
        },
      },
    };
  });

  fastify.patch<{ Body: Static<typeof UpdateOrganization> }>(
    '/organizations/current',
    { schema: { body: UpdateOrganization }, preHandler: [fastify.requireRegistered, manage] },
    async (request, reply) => {
      const { organizationId } = request.orgAccess!;
      if (Object.keys(request.body).length === 0) {
        return reply.code(400).send({ code: 'NO_CHANGES', message: 'Provide at least one field to update.' });
      }
      try {
        const updated = await db.organization.update({
          where: { id: organizationId },
          data: request.body,
          select: { id: true, name: true, slug: true, logo: true },
        });
        await recordAuditEvent({
          actorId: request.user.id,
          organizationId,
          action: 'organization.updated',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { ...request.body },
        });
        return { data: updated };
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          return reply.code(409).send({ code: 'SLUG_TAKEN', message: 'This organization slug is already in use.' });
        }
        throw error;
      }
    },
  );

  fastify.post<{ Body: Static<typeof AddMember> }>(
    '/organizations/current/members',
    { schema: { body: AddMember }, preHandler: [fastify.requireRegistered, manage] },
    async (request, reply) => {
      const { organizationId } = request.orgAccess!;
      const user = await db.user.findFirst({
        where: { email: { equals: request.body.email, mode: 'insensitive' }, isAnonymous: { not: true } },
        select: { id: true, name: true, email: true },
      });
      if (!user) {
        return reply.code(404).send({
          code: 'USER_NOT_FOUND',
          message: 'No registered account uses this email. Ask them to sign up first, then add them.',
        });
      }
      if (await db.member.findFirst({ where: { organizationId, userId: user.id }, select: { id: true } })) {
        return reply.code(409).send({ code: 'ALREADY_MEMBER', message: 'This user is already a member.' });
      }
      const member = await db.member.create({
        data: { organizationId, userId: user.id, role: request.body.role, createdAt: new Date() },
        select: { id: true, role: true },
      });
      await recordAuditEvent({
        actorId: request.user.id,
        organizationId,
        action: 'organization.member.added',
        targetType: 'Member',
        targetId: member.id,
        metadata: { userId: user.id, role: request.body.role },
      });
      return reply.code(201).send({ data: { ...member, user } });
    },
  );

  fastify.delete<{ Params: { memberId: string } }>(
    '/organizations/current/members/:memberId',
    { preHandler: [fastify.requireRegistered, manage] },
    async (request, reply) => {
      const { organizationId, role: actorRole } = request.orgAccess!;
      const member = await db.member.findFirst({ where: { id: request.params.memberId, organizationId } });
      if (!member) return reply.code(404).send({ code: 'MEMBER_NOT_FOUND', message: 'Organization member not found.' });
      if (member.role === 'owner') {
        return reply.code(409).send({ code: 'OWNER_ROLE_LOCKED', message: 'The organization owner cannot be removed. Transfer ownership first.' });
      }
      if (member.userId === request.user.id) {
        return reply.code(409).send({ code: 'USE_LEAVE', message: 'Use "Leave organization" to remove yourself.' });
      }
      // Only the owner may remove other administrators.
      if (normalizeRole(member.role) === 'admin' && actorRole !== 'owner' && !request.orgAccess!.isPlatformAdmin) {
        return reply.code(403).send({ code: 'ORGANIZATION_ROLE_REQUIRED', message: 'Only the owner can remove administrators.' });
      }
      await db.$transaction([
        db.member.delete({ where: { id: member.id } }),
        db.session.updateMany({
          where: { userId: member.userId, activeOrganizationId: organizationId },
          data: { activeOrganizationId: null },
        }),
      ]);
      await recordAuditEvent({
        actorId: request.user.id,
        organizationId,
        action: 'organization.member.removed',
        targetType: 'Member',
        targetId: member.id,
        metadata: { userId: member.userId },
      });
      return { success: true };
    },
  );

  fastify.post(
    '/organizations/current/leave',
    { preHandler: [fastify.requireRegistered, anyMember] },
    async (request, reply) => {
      const { organizationId, memberId } = request.orgAccess!;
      if (!memberId) return reply.code(409).send({ code: 'NOT_A_MEMBER', message: 'You are not a member of this organization.' });
      const member = await db.member.findUniqueOrThrow({ where: { id: memberId } });
      if (member.role === 'owner') {
        return reply.code(409).send({ code: 'OWNER_ROLE_LOCKED', message: 'Transfer ownership before leaving the organization.' });
      }
      await db.$transaction([
        db.member.delete({ where: { id: memberId } }),
        db.session.updateMany({
          where: { userId: request.user.id, activeOrganizationId: organizationId },
          data: { activeOrganizationId: null },
        }),
      ]);
      await recordAuditEvent({
        actorId: request.user.id,
        organizationId,
        action: 'organization.member.left',
        targetType: 'Member',
        targetId: memberId,
      });
      return { success: true };
    },
  );

  fastify.post<{ Body: Static<typeof TransferOwnership> }>(
    '/organizations/current/transfer-ownership',
    { schema: { body: TransferOwnership }, preHandler: [fastify.requireRegistered, ownerOnly] },
    async (request, reply) => {
      const { organizationId, memberId } = request.orgAccess!;
      const target = await db.member.findFirst({ where: { id: request.body.memberId, organizationId } });
      if (!target) return reply.code(404).send({ code: 'MEMBER_NOT_FOUND', message: 'Organization member not found.' });
      if (target.id === memberId) {
        return reply.code(409).send({ code: 'ALREADY_OWNER', message: 'You already own this organization.' });
      }
      await db.$transaction([
        db.member.update({ where: { id: target.id }, data: { role: 'owner' } }),
        db.member.update({ where: { id: memberId! }, data: { role: 'admin' } }),
      ]);
      await recordAuditEvent({
        actorId: request.user.id,
        organizationId,
        action: 'organization.ownership.transferred',
        targetType: 'Member',
        targetId: target.id,
        metadata: { fromUserId: request.user.id, toUserId: target.userId },
      });
      return { success: true };
    },
  );

  fastify.get<{ Querystring: Static<typeof SessionsQuery> }>(
    '/organizations/current/sessions',
    { schema: { querystring: SessionsQuery }, preHandler: [fastify.requireRegistered, viewAll] },
    async (request) => {
      const { organizationId } = request.orgAccess!;
      const args = pageArgs(request.query);
      const where: Prisma.ChargingSessionWhereInput = {
        organizationId,
        ...(request.query.status ? { status: request.query.status as never } : {}),
        ...(request.query.userId ? { userId: request.query.userId } : {}),
        ...(request.query.search
          ? { stationId: { contains: request.query.search, mode: 'insensitive' } }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.chargingSession.findMany({
          where,
          orderBy: { startTime: 'desc' },
          skip: args.skip,
          take: args.take,
          select: {
            id: true, stationId: true, status: true, startTime: true, endTime: true,
            totalKwh: true, totalCost: true, currency: true,
            user: { select: { id: true, name: true, email: true } },
          },
        }),
        db.chargingSession.count({ where }),
      ]);
      return paged(rows, total, args);
    },
  );

  fastify.get<{ Querystring: Static<typeof PageQuery> }>(
    '/organizations/current/invitations',
    { schema: { querystring: PageQuery }, preHandler: [fastify.requireRegistered, viewAll] },
    async (request) => {
      const { organizationId } = request.orgAccess!;
      const args = pageArgs(request.query);
      const where: Prisma.InvitationWhereInput = {
        organizationId,
        ...(request.query.search ? { email: { contains: request.query.search, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        db.invitation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: args.skip,
          take: args.take,
          select: {
            id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true,
            user: { select: { name: true } },
          },
        }),
        db.invitation.count({ where }),
      ]);
      const canSeeLinks = request.orgAccess!.role !== 'auditor';
      return paged(
        rows.map(({ user, ...row }: { user: { name: string } | null; status: string; expiresAt: Date; id: string }) => ({
          ...row,
          status: invitationState(row),
          invitedBy: user?.name ?? null,
          link: canSeeLinks && invitationState(row) === 'pending' ? buildInviteLink(row.id) : null,
        })),
        total,
        args,
      );
    },
  );

  fastify.post<{ Body: Static<typeof AddMember> }>(
    '/organizations/current/invitations',
    { schema: { body: AddMember }, preHandler: [fastify.requireRegistered, manage] },
    async (request, reply) => {
      try {
        const result = await createInvitation({
          organizationId: request.orgAccess!.organizationId,
          inviter: { id: request.user.id, name: request.user.name || request.user.email },
          email: request.body.email,
          role: request.body.role,
        });
        return reply.code(201).send({
          data: { ...result.invitation, link: result.link, emailed: result.emailed },
        });
      } catch (error) {
        if (error instanceof InvitationError) {
          return reply.code(error.statusCode).send({ code: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  fastify.delete<{ Params: { invitationId: string } }>(
    '/organizations/current/invitations/:invitationId',
    { preHandler: [fastify.requireRegistered, manage] },
    async (request, reply) => {
      const { organizationId } = request.orgAccess!;
      const { invitationId } = request.params;
      const result = /^[0-9a-f-]{36}$/i.test(invitationId)
        ? await db.invitation.updateMany({
            where: { id: invitationId, organizationId, status: 'pending' },
            data: { status: 'canceled' },
          })
        : { count: 0 };
      if (result.count !== 1) {
        return reply.code(404).send({ code: 'INVITATION_NOT_FOUND', message: 'Pending invitation not found.' });
      }
      await recordAuditEvent({
        actorId: request.user.id,
        organizationId,
        action: 'organization.invitation.canceled',
        targetType: 'Invitation',
        targetId: invitationId,
      });
      return { data: { id: invitationId, status: 'canceled' } };
    },
  );

  fastify.get<{ Querystring: Static<typeof PageQuery> }>(
    '/organizations/current/audit-logs',
    { schema: { querystring: PageQuery }, preHandler: [fastify.requireRegistered, viewAll] },
    async (request) => {
      const { organizationId } = request.orgAccess!;
      const args = pageArgs(request.query);
      const where: Prisma.AuditLogWhereInput = {
        organizationId,
        ...(request.query.search ? { action: { contains: request.query.search, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        db.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: args.skip,
          take: args.take,
          select: {
            id: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true,
            actor: { select: { id: true, name: true, email: true } },
          },
        }),
        db.auditLog.count({ where }),
      ]);
      return paged(rows, total, args);
    },
  );
};

export default organizationManagementRoutes;
