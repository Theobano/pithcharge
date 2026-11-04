import { FastifyPluginAsync } from 'fastify';
import { db } from '@pithcharge/db';
import { ChargingStartError } from '../../../services/charging';
import { getSessionDetails, sessionScope, stopCharging } from '../../../services/charging/sessions';

interface RequestUser {
  id: string;
  role?: string | null;
  organizationId?: string | null;
  organizationRole?: string | null;
}

const viewerOf = (user: RequestUser) => ({
  id: user.id,
  role: user.role,
  organizationId: user.organizationId,
  organizationRole: user.organizationRole,
});

const sessionRoutes: FastifyPluginAsync = async (fastify) => {
  const deps = () => ({ cms: fastify.cms, log: fastify.log });

  // GET /api/sessions - The caller's own live CMS transactions
  fastify.get<{
    Querystring: { stationId?: string };
  }>('/sessions', { preHandler: [fastify.authenticate] }, async (request) => {
    const sessions = await fastify.cms.listActiveSessions(request.query.stationId);

    const own = await db.chargingSession.findMany({
      where: {
        ...(await sessionScope(viewerOf(request.user))),
        status: { in: ['PENDING', 'ACTIVE'] },
        ocppTransactionId: { not: null },
      },
      select: { ocppTransactionId: true },
    });
    const transactionIds = new Set(own.map((item: { ocppTransactionId: string | null }) => item.ocppTransactionId));
    return sessions.filter((session) => transactionIds.has(session.transactionId));
  });

  // GET /api/sessions/active - The caller's own unfinished sessions, optionally for one station
  fastify.get<{
    Querystring: { stationId?: string };
  }>('/sessions/active', { preHandler: [fastify.authenticate] }, async (request) => {
    const sessions = await db.chargingSession.findMany({
      where: {
        ...(await sessionScope(viewerOf(request.user))),
        status: { in: ['PENDING', 'ACTIVE'] },
        ...(request.query.stationId ? { stationId: request.query.stationId } : {}),
      },
      orderBy: { startTime: 'desc' },
      select: { id: true, stationId: true, evseId: true, connectorId: true, status: true, startTime: true },
    });
    return sessions;
  });

  // GET /api/sessions/:id - Session details with live telemetry
  fastify.get<{
    Params: { id: string };
  }>('/sessions/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      return await getSessionDetails(deps(), viewerOf(request.user), { id: request.params.id });
    } catch (error) {
      if (error instanceof ChargingStartError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  // POST /api/sessions/:id/stop - Stop a charging session
  fastify.post<{
    Params: { id: string };
  }>('/sessions/:id/stop', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      return await stopCharging(deps(), viewerOf(request.user), { id: request.params.id });
    } catch (error) {
      if (error instanceof ChargingStartError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });
};

export default sessionRoutes;
