import { FastifyPluginAsync } from 'fastify';
import { db } from '@pithcharge/db';

const memberRoles = ['admin', 'user', 'auditor'] as const;
type MemberRole = (typeof memberRoles)[number];

const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/organizations/current/members',
    { preHandler: [fastify.requireRegistered] },
    async (request, reply) => {
      const organizationId = request.user.organizationId;
      if (!organizationId) {
        return reply.code(409).send({
          error: 'Select an organization before viewing its members.',
          code: 'ACTIVE_ORGANIZATION_REQUIRED',
        });
      }

      const membership = await db.member.findFirst({
        where: { organizationId, userId: request.user.id },
        select: { id: true, role: true },
      });
      if (!membership && request.user.role !== 'admin') {
        return reply.code(403).send({ error: 'You are not a member of this organization.' });
      }
      // The member list exposes emails and balance limits, so it is limited to admins and auditors.
      const memberRole = membership?.role === 'member' ? 'user' : membership?.role;
      if (request.user.role !== 'admin' && !['owner', 'admin', 'auditor'].includes(memberRole ?? '')) {
        return reply.code(403).send({ error: 'Only organization admins and auditors can view members.' });
      }

      const members = await db.member.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          allowNegativeBalance: true,
          negativeBalanceLimit: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      });

      return {
        data: members.map((member: {
          id: string;
          role: string;
          allowNegativeBalance: boolean;
          negativeBalanceLimit: unknown;
          createdAt: Date;
          user: { id: string; name: string; email: string };
        }) => ({
          ...member,
          role: member.role === 'member' ? 'user' : member.role,
        })),
        canManage:
          request.user.role === 'admin' ||
          request.user.organizationRole === 'admin',
      };
    },
  );

  fastify.patch<{
    Params: { memberId: string };
    Body: { role: string };
  }>(
    '/organizations/current/members/:memberId',
    {
      preHandler: [
        fastify.requireRegistered,
        fastify.authorize('organization:ManageMembers', () => ({
          stationId: '',
          isOnline: true,
          connectorStatus: 'Available',
          ownerOrganizationId: '',
        })),
      ],
    },
    async (request, reply) => {
      const organizationId = request.user.organizationId;
      if (!organizationId) {
        return reply.code(409).send({
          error: 'Select an organization before managing its members.',
          code: 'ACTIVE_ORGANIZATION_REQUIRED',
        });
      }

      if (!memberRoles.includes(request.body.role as MemberRole)) {
        return reply.code(400).send({
          error: 'Role must be admin, user, or auditor.',
        });
      }

      const member = await db.member.findFirst({
        where: { id: request.params.memberId, organizationId },
        select: { id: true, role: true },
      });
      if (!member) {
        return reply.code(404).send({ error: 'Organization member not found.' });
      }
      if (member.role === 'owner') {
        return reply.code(409).send({ error: 'The organization owner role cannot be changed here.' });
      }

      const updated = await db.member.update({
        where: { id: member.id },
        data: { role: request.body.role },
        select: { id: true, role: true },
      });

      fastify.log.info(
        {
          actorId: request.user.id,
          organizationId,
          memberId: updated.id,
          role: updated.role,
        },
        'Organization member role updated',
      );

      return { data: updated };
    },
  );
};

export default organizationRoutes;
