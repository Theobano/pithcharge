import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { processOutboxBatch } from '../services/outbox.service';

const outboxPlugin: FastifyPluginAsync = async (fastify) => {
  const timer = setInterval(() => {
    void processOutboxBatch({
      info: (context, message) => fastify.log.info(context, message),
      error: (context, message) => fastify.log.error(context, message),
    }, 10, fastify.cms).catch((error: unknown) => {
      fastify.log.error({ err: error }, 'Integration outbox polling failed');
    });
  }, 2_000);
  timer.unref();

  fastify.addHook('onClose', async () => {
    clearInterval(timer);
  });
};

export default fp(outboxPlugin, { name: 'integration-outbox' });
