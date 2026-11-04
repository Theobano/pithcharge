import { createHash, timingSafeEqual } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { db, Prisma } from '@pithcharge/db';
import { IgnoredWebhookEvent } from '@pithcharge/cms-adapters';

function isDuplicateKey(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/webhooks/citrineos',
    { bodyLimit: 1_048_576 },
    async (request, reply) => {
      const configuredSecret = process.env.CITRINEOS_WEBHOOK_SECRET;
      // CitrineOS subscriptions only carry a URL, so the secret may also arrive as ?secret=
      const querySecret = (request.query as { secret?: unknown } | undefined)?.secret;
      const providedSecret =
        request.headers['x-citrineos-webhook-secret'] ??
        (typeof querySecret === 'string' ? querySecret : undefined);
      if (!configuredSecret || typeof providedSecret !== 'string') {
        return reply.code(401).send({ error: 'Webhook authentication failed.' });
      }
      const expected = Buffer.from(configuredSecret);
      const supplied = Buffer.from(providedSecret);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        return reply.code(401).send({ error: 'Webhook authentication failed.' });
      }

      const headers = Object.fromEntries(
        Object.entries(request.headers).filter((entry): entry is [string, string] =>
          typeof entry[1] === 'string',
        ),
      );
      let event;
      try {
        event = await fastify.cms.parseWebhookEvent(headers, request.body);
      } catch (error) {
        if (error instanceof IgnoredWebhookEvent) {
          return reply.code(202).send({ success: true, ignored: true });
        }
        fastify.log.warn({ err: error }, 'Rejected invalid CitrineOS webhook');
        return reply.code(400).send({ error: 'Invalid CitrineOS webhook event.' });
      }

      const eventPayload = JSON.stringify(event);
      if (eventPayload.length > 1_000_000) {
        return reply.code(413).send({ error: 'CitrineOS webhook event is too large.' });
      }
      const digest = createHash('sha256').update(eventPayload).digest('hex');
      try {
        const queued = await db.integrationOutbox.create({
          data: {
            eventType: 'CITRINEOS_WEBHOOK_PROCESS',
            aggregateId: event.stationId,
            idempotencyKey: `citrineos-webhook:${digest}`,
            payload: JSON.parse(eventPayload) as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        fastify.log.info(
          { eventId: queued.id, eventType: event.eventType, stationId: event.stationId },
          'CitrineOS webhook queued for reconciliation',
        );
      } catch (error) {
        if (isDuplicateKey(error)) {
          return reply.code(202).send({ success: true, duplicate: true });
        }
        fastify.log.error({ err: error, eventType: event.eventType }, 'Unable to queue CitrineOS webhook');
        throw error;
      }

      return reply.code(202).send({ success: true, queued: true });
    },
  );
};

export default webhookRoutes;
