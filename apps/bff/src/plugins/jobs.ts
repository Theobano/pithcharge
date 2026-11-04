import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { createJobPublisher, type PgBoss } from '@pithcharge/jobs';

declare module 'fastify' {
  interface FastifyInstance {
    /** Publish-only job queue client, connected on first use so the API still boots without it. */
    jobs: () => Promise<PgBoss>;
  }
}

const jobsPlugin: FastifyPluginAsync = async (fastify) => {
  let pending: Promise<PgBoss> | null = null;

  fastify.decorate('jobs', () => {
    pending ??= createJobPublisher(process.env.JOBS_INSTANCE_NAME ?? 'api').catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  });

  fastify.addHook('onClose', async () => {
    if (!pending) return;
    const boss = await pending.catch(() => null);
    await boss?.stop({ graceful: false });
  });
};

export default fp(jobsPlugin, { name: 'jobs' });
