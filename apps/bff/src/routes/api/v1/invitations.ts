import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { db } from '@pithcharge/db';
import {
  InvitationError,
  acceptInvitation,
  buildInviteLink,
  getInvitationPreview,
  invitationState,
  normalizeEmail,
} from '../../../services/invitation.service';

async function run<T>(reply: FastifyReply, work: () => Promise<T>) {
  try {
    return { data: await work() };
  } catch (error) {
    if (error instanceof InvitationError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    throw error;
  }
}

const invitationRoutes: FastifyPluginAsync = async (fastify) => {
  // Public: lets the invite landing and register pages show who invited the visitor.
  fastify.get<{ Params: { id: string } }>('/invitations/:id', async (request, reply) =>
    run(reply, () => getInvitationPreview(request.params.id)),
  );

  // Pending invitations addressed to the signed-in user's email.
  fastify.get('/invitations/mine', { preHandler: [fastify.requireRegistered] }, async (request) => {
    const rows = await db.invitation.findMany({
      where: {
        email: { equals: normalizeEmail(request.user.email), mode: 'insensitive' },
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        role: true,
        expiresAt: true,
        organization: { select: { id: true, name: true, logo: true } },
      },
    });
    return {
      data: rows.map((row: { id: string; role: string | null; expiresAt: Date; organization: unknown }) => ({
        ...row,
        status: invitationState({ status: 'pending', expiresAt: row.expiresAt }),
        link: buildInviteLink(row.id),
      })),
    };
  });

  fastify.post<{ Params: { id: string } }>(
    '/invitations/:id/accept',
    { preHandler: [fastify.requireRegistered] },
    async (request, reply) =>
      run(reply, () =>
        acceptInvitation(request.params.id, { id: request.user.id, email: request.user.email }),
      ),
  );
};

export default invitationRoutes;
