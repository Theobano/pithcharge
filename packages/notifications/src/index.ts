import { db, Prisma } from '@pithcharge/db';
import { emailProvider, renderEmail, sendEmail } from './email';

export * from './email';

type Channel = 'EMAIL' | 'PUSH' | 'WEBHOOK';

function notificationChannels(preference: {
  emailEnabled: boolean;
  pushEnabled: boolean;
}): Channel[] {
  const channels: Channel[] = [];
  if (preference.emailEnabled && emailProvider() !== 'none') channels.push('EMAIL');
  if (
    preference.pushEnabled &&
    process.env.NOTIFICATION_PUSH_WEBHOOK_URL &&
    process.env.NOTIFICATION_PUSH_WEBHOOK_SECRET
  ) channels.push('PUSH');
  if (process.env.NOTIFICATION_WEBHOOK_URL && process.env.NOTIFICATION_WEBHOOK_SECRET) {
    channels.push('WEBHOOK');
  }
  return channels;
}

export async function createUserNotification(input: {
  userId: string;
  organizationId?: string;
  eventKey: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  category?: 'sessionUpdates' | 'paymentUpdates' | 'chargerUpdates' | 'lowCreditUpdates';
}) {
  const preference = await db.notificationPreference.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId },
    update: {},
  });
  if (input.category && !preference[input.category]) return null;
  const channels = notificationChannels(preference);

  try {
    return await db.notification.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        eventKey: input.eventKey,
        title: input.title,
        body: input.body,
        data: input.data,
        deliveries: {
          create: [
            { channel: 'IN_APP', status: 'SENT', sentAt: new Date() },
            ...channels.map((channel) => ({ channel, status: 'PENDING' as const })),
          ],
        },
      },
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      return db.notification.findFirstOrThrow({
        where: { userId: input.userId, eventKey: input.eventKey },
      });
    }
    throw error;
  }
}

async function deliver(channel: Channel, notification: {
  title: string;
  body: string;
  data: Prisma.JsonValue | null;
  user: { email: string } | null;
  userId: string | null;
}) {
  if (channel === 'EMAIL') {
    const to = notification.user?.email;
    if (!to) return;
    const { html, text } = renderEmail({ heading: notification.title, body: notification.body });
    await sendEmail({ to, subject: notification.title, text, html });
    return;
  }
  const endpoint = channel === 'PUSH'
    ? process.env.NOTIFICATION_PUSH_WEBHOOK_URL
    : process.env.NOTIFICATION_WEBHOOK_URL;
  const secret = channel === 'PUSH'
    ? process.env.NOTIFICATION_PUSH_WEBHOOK_SECRET
    : process.env.NOTIFICATION_WEBHOOK_SECRET;

  if (!endpoint || !secret) {
    throw new Error(`${channel} notification provider is not configured.`);
  }

  const subscriptions = channel === 'PUSH' && notification.userId
    ? await db.pushSubscription.findMany({
        where: { userId: notification.userId },
        select: { endpoint: true, p256dh: true, auth: true },
      })
    : [];
  if (channel === 'PUSH' && subscriptions.length === 0) return;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      channel,
      recipient: undefined,
      subscriptions: channel === 'PUSH' ? subscriptions : undefined,
      title: notification.title,
      body: notification.body,
      data: notification.data,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`${channel} notification provider returned HTTP ${response.status}.`);
  }
}

export async function processNotificationDeliveries(
  logger: { error: (context: object, message: string) => void },
  batchSize = 25,
) {
  const now = new Date();
  const staleLockBefore = new Date(Date.now() - 5 * 60_000);
  const deliveries = await db.notificationDelivery.findMany({
    where: {
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', lockedAt: { lte: staleLockBefore } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    include: {
      notification: {
        select: {
          title: true,
          body: true,
          data: true,
          userId: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  for (const delivery of deliveries) {
    const claimed = await db.notificationDelivery.updateMany({
      where: {
        id: delivery.id,
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', lockedAt: { lte: staleLockBefore } },
        ],
      },
      data: {
        status: 'PROCESSING',
        lockedAt: now,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) continue;

    try {
      await deliver(delivery.channel as Channel, delivery.notification);
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', sentAt: new Date(), lockedAt: null, lastError: null },
      });
    } catch (error) {
      const attempts = delivery.attemptCount + 1;
      const retryAt = new Date(Date.now() + Math.min(60 * 60_000, 2 ** attempts * 1_000));
      const message = error instanceof Error ? error.message : 'Unknown notification delivery failure.';
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: attempts >= 10 ? 'FAILED' : 'PENDING',
          attemptCount: attempts,
          lockedAt: null,
          nextAttemptAt: retryAt,
          lastError: message.slice(0, 1000),
        },
      });
      logger.error(
        {
          err: error,
          notificationId: delivery.notificationId,
          deliveryId: delivery.id,
          channel: delivery.channel,
          attempts,
        },
        'Notification delivery failed',
      );
    }
  }
}
