import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { enforceSpendLimits } from '../services/charging/sessions';

const spendLimitPlugin: FastifyPluginAsync = async (fastify) => {
  let running = false;
  const timer = setInterval(() => {
    if (running || process.env.NODE_ENV === 'test') return;
    running = true;
    void enforceSpendLimits({ cms: fastify.cms, log: fastify.log })
      .catch((error: unknown) => fastify.log.error({ err: error }, 'Spend limit enforcement failed'))
      .finally(() => {
        running = false;
      });
  }, 15_000);
  timer.unref();

  fastify.addHook('onClose', async () => {
    clearInterval(timer);
  });
};

export default fp(spendLimitPlugin, { name: 'spend-limit', dependencies: ['cms-adapter'] });
