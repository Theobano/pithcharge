import { db } from '@pithcharge/db';
import { ICmsAdapter } from '@pithcharge/cms-adapters';
import { processCitrineosWebhook } from './cms-webhook.service';

const staleLockBefore = () => new Date(Date.now() - 5 * 60_000);
// Token registration is synchronous (signup, login, session start); the outbox only carries webhook processing.
const OUTBOX_EVENT_TYPE = 'CITRINEOS_WEBHOOK_PROCESS';

export async function processOutboxBatch(
  logger: { error: (context: object, message: string) => void; info: (context: object, message: string) => void },
  batchSize = 10,
  cms?: ICmsAdapter,
) {
  if (!cms) return;
  const now = new Date();
  const events = await db.integrationOutbox.findMany({
    where: {
      eventType: OUTBOX_EVENT_TYPE,
      OR: [
        { status: { in: ['PENDING', 'FAILED'] }, attemptCount: { lt: 20 }, nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', lockedAt: { lte: staleLockBefore() } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  for (const event of events) {
    const claimed = await db.integrationOutbox.updateMany({
      where: {
        id: event.id,
        OR: [
          { status: { in: ['PENDING', 'FAILED'] }, attemptCount: { lt: 20 }, nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', lockedAt: { lte: staleLockBefore() } },
        ],
      },
      data: { status: 'PROCESSING', lockedAt: now },
    });
    if (claimed.count !== 1) continue;

    try {
      await processCitrineosWebhook(event.payload, cms);
      await db.integrationOutbox.update({
        where: { id: event.id },
        data: { status: 'DELIVERED', deliveredAt: new Date(), lockedAt: null, lastError: null },
      });
      logger.info({ eventId: event.id, eventType: event.eventType }, 'Integration outbox event delivered');
    } catch (error) {
      const attemptCount = event.attemptCount + 1;
      const retryDelayMs = Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attemptCount, 12));
      const message = error instanceof Error ? error.message : 'Unknown outbox delivery failure.';
      await db.integrationOutbox.update({
        where: { id: event.id },
        data: {
          status: attemptCount >= 20 ? 'FAILED' : 'PENDING',
          attemptCount,
          nextAttemptAt: new Date(Date.now() + retryDelayMs),
          lockedAt: null,
          lastError: message.slice(0, 1000),
        },
      });
      logger.error(
        { err: error, eventId: event.id, eventType: event.eventType, attemptCount },
        'Integration outbox delivery failed',
      );
    }
  }
}
