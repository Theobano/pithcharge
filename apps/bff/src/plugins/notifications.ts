import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { processNotificationDeliveries } from '../services/notification.service';
import { isEmailConfigured } from '@pithcharge/notifications';

const notificationPlugin: FastifyPluginAsync = async (fastify) => {
  if (
    process.env.NOTIFICATION_EMAIL_WEBHOOK_URL &&
    !process.env.NOTIFICATION_EMAIL_WEBHOOK_SECRET
  ) {
    throw new Error('NOTIFICATION_EMAIL_WEBHOOK_SECRET is required when the email webhook is configured.');
  }
  if (
    process.env.NOTIFICATION_PUSH_WEBHOOK_URL &&
    !process.env.NOTIFICATION_PUSH_WEBHOOK_SECRET
  ) {
    throw new Error('NOTIFICATION_PUSH_WEBHOOK_SECRET is required when the push webhook is configured.');
  }
  if (
    process.env.NOTIFICATION_WEBHOOK_URL &&
    !process.env.NOTIFICATION_WEBHOOK_SECRET
  ) {
    throw new Error('NOTIFICATION_WEBHOOK_SECRET is required when the notification webhook is configured.');
  }

  if (process.env.NODE_ENV === 'production' && !isEmailConfigured()) {
    fastify.log.warn('Email is disabled because neither SMTP_HOST nor an email relay is configured.');
  }
  if (process.env.NODE_ENV === 'production' && !process.env.NOTIFICATION_PUSH_WEBHOOK_URL) {
    fastify.log.warn('Push notifications are disabled because no push delivery webhook is configured.');
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await processNotificationDeliveries({
        error: (context, message) => fastify.log.error(context, message),
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Notification delivery polling failed');
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), 5_000);
  timer.unref();
  fastify.addHook('onClose', async () => clearInterval(timer));
};

export default fp(notificationPlugin, { name: 'notification-delivery' });
