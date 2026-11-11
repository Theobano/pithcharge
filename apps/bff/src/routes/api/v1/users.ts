import { FastifyPluginAsync } from 'fastify';
import { db, Prisma } from '@pithcharge/db';
import { syncTokenToCms } from '../../../services/token-sync.service';
import { createAppOcppIdToken } from '../../../services/charging/id-token';
import { sessionScope } from '../../../services/charging/sessions';
import { concurrentSessionsAllowed } from '../../../services/charging/policy';

const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/users/idtoken',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const token = await db.$transaction(async (transaction: Prisma.TransactionClient) => {
        await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "user" WHERE "id" = ${request.user.id}::uuid FOR UPDATE
        `;
        const existing = await transaction.userOcppToken.findFirst({
          where: {
            userId: request.user.id,
            status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
          },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        });
        if (existing) return existing;

        return transaction.userOcppToken.create({
          data: {
            userId: request.user.id,
            idToken: createAppOcppIdToken('APP'),
            tokenType: 'Central',
            status: 'PENDING_ACTIVATION',
            isDefault: true,
            nickname: 'App token',
          },
        });
      });

      // Real-time sync on every login: registers new tokens and keeps the CMS status aligned.
      let syncedStatus: 'ACTIVE' | 'BLOCKED' | 'PENDING_ACTIVATION' | 'DELETED';
      try {
        ({ status: syncedStatus } = await syncTokenToCms(fastify.cms, {
          ...token,
          status: 'ACTIVE',
          concurrentTransaction: concurrentSessionsAllowed(request.isAnonymous),
        }));
      } catch (error) {
        fastify.log.error(
          { err: error, userId: request.user.id, tokenId: token.id },
          'Charging token synchronization on login failed',
        );
        if (token.status === 'ACTIVE') {
          // Already registered earlier; a transient CMS error must not block sign-in.
          return reply.send({ success: true, idToken: token.idToken });
        }
        return reply.code(503).send({
          error: 'Your charging token could not be registered with the charging network. Please try again shortly.',
          code: 'TOKEN_SYNC_UNAVAILABLE',
        });
      }

      if (syncedStatus !== token.status) {
        await db.userOcppToken.updateMany({
          where: { id: token.id },
          data: { status: syncedStatus },
        });
      }
      if (syncedStatus === 'BLOCKED') {
        return reply.code(403).send({
          error: 'Your charging token is blocked on the charging network.',
          code: 'TOKEN_BLOCKED',
        });
      }
      return reply.send({ success: true, idToken: token.idToken });
    },
  );

  fastify.get('/users/sessions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const sessions = await db.chargingSession.findMany({
      where: await sessionScope({ id: request.user.id, organizationId: request.user.organizationId }),
      orderBy: { startTime: 'desc' },
      take: 50,
      select: {
        id: true,
        stationId: true,
        evseId: true,
        connectorId: true,
        status: true,
        startTime: true,
        endTime: true,
        totalKwh: true,
        totalCost: true,
        currency: true,
      },
    });
    const hideCost =
      Boolean(request.user.organizationId) &&
      ['user', 'member'].includes(request.user.organizationRole ?? 'user');
    return reply.send({
      success: true,
      data: sessions.map((s: { totalCost: unknown }) => ({ ...s, totalCost: hideCost ? null : s.totalCost })),
    });
  });
};

export default userRoutes;
