import { FastifyPluginAsync } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import { db } from '@pithcharge/db';

const NotificationPreferences = Type.Object({
  sessionUpdates: Type.Optional(Type.Boolean()),
  paymentUpdates: Type.Optional(Type.Boolean()),
  chargerUpdates: Type.Optional(Type.Boolean()),
  lowCreditUpdates: Type.Optional(Type.Boolean()),
  emailEnabled: Type.Optional(Type.Boolean()),
  pushEnabled: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
type NotificationPreferencesInput = Static<typeof NotificationPreferences>;

const PushSubscription = Type.Object({
  endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
  keys: Type.Object({
    p256dh: Type.String({ minLength: 1, maxLength: 512 }),
    auth: Type.String({ minLength: 1, maxLength: 512 }),
  }),
}, { additionalProperties: false });

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/notifications/me',
    {
      preHandler: [fastify.requireRegistered],
      schema: {
        querystring: Type.Object({
          take: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
          unreadOnly: Type.Optional(Type.Boolean({ default: false })),
        }),
      },
    },
    async (request, reply) => {
      const { take = 50, unreadOnly = false } = request.query as {
        take?: number;
        unreadOnly?: boolean;
      };
      const notifications = await db.notification.findMany({
        where: {
          userId: request.user.id,
          ...(unreadOnly ? { readAt: null } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          title: true,
          body: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
      });
      return reply.send({ success: true, data: notifications });
    },
  );

  fastify.get(
    '/notifications/preferences',
    { preHandler: [fastify.requireRegistered] },
    async (request, reply) => {
      const preferences = await db.notificationPreference.upsert({
        where: { userId: request.user.id },
        create: { userId: request.user.id },
        update: {},
      });
      return reply.send({ success: true, data: preferences });
    },
  );

  fastify.patch(
    '/notifications/preferences',
    {
      preHandler: [fastify.requireRegistered],
      schema: { body: NotificationPreferences },
    },
    async (request, reply) => {
      const preferences = await db.notificationPreference.upsert({
        where: { userId: request.user.id },
        create: { userId: request.user.id, ...(request.body as NotificationPreferencesInput) },
        update: request.body as NotificationPreferencesInput,
      });
      return reply.send({ success: true, data: preferences });
    },
  );

  fastify.post(
    '/notifications/push-subscriptions',
    {
      preHandler: [fastify.requireRegistered],
      schema: { body: PushSubscription },
    },
    async (request, reply) => {
      const { endpoint, keys } = request.body as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      let parsedEndpoint: URL;
      try {
        parsedEndpoint = new URL(endpoint);
      } catch {
        return reply.code(400).send({ error: 'A valid push endpoint URL is required.' });
      }
      if (parsedEndpoint.protocol !== 'https:') {
        return reply.code(400).send({ error: 'Push endpoints must use HTTPS.' });
      }

      const subscription = await db.pushSubscription.upsert({
        where: { endpoint },
        create: {
          userId: request.user.id,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        update: {
          userId: request.user.id,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        select: { id: true },
      });
      return reply.code(201).send({ success: true, data: subscription });
    },
  );

  fastify.delete(
    '/notifications/push-subscriptions',
    {
      preHandler: [fastify.requireRegistered],
      schema: {
        querystring: Type.Object({ endpoint: Type.String({ minLength: 1, maxLength: 2048 }) }),
      },
    },
    async (request, reply) => {
      const { endpoint } = request.query as { endpoint: string };
      const removed = await db.pushSubscription.deleteMany({
        where: { endpoint, userId: request.user.id },
      });
      if (removed.count === 0) return reply.code(404).send({ error: 'Push subscription not found.' });
      return reply.code(204).send();
    },
  );

  fastify.post(
    '/notifications/:id/read',
    {
      preHandler: [fastify.requireRegistered],
      schema: { params: Type.Object({ id: Type.String({ minLength: 1 }) }) },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const updated = await db.notification.updateMany({
        where: { id, userId: request.user.id, readAt: null },
        data: { readAt: new Date() },
      });
      if (updated.count === 0) {
        const owned = await db.notification.findFirst({
          where: { id, userId: request.user.id },
          select: { id: true },
        });
        if (!owned) return reply.code(404).send({ error: 'Notification not found.' });
      }
      return reply.send({ success: true });
    },
  );
};

export default notificationRoutes;
