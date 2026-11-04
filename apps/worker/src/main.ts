import {
  generateDueInvoicesForOrganization,
  issueInvoiceNow,
  listOrganizationsDueForInvoicing,
} from '@pithcharge/billing-core';
import {
  ensureQueues,
  jobsConnectionString,
  PgBoss,
  QUEUES,
  SCHEDULES,
  type InvoiceManualPayload,
  type InvoiceManualResult,
  type InvoiceOrganizationPayload,
} from '@pithcharge/jobs';
import { logger } from './logger';
import { enforceAuditRetention, ensureFuturePartitions } from './maintenance';

async function main() {
  const boss = new PgBoss({
    connectionString: jobsConnectionString(),
    instanceName: process.env.WORKER_NAME ?? 'worker',
    max: Number(process.env.WORKER_DB_POOL ?? 5),
  });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();
  await ensureQueues(boss);

  // Fan out: one job per organization so a failure only retries that organization.
  await boss.work(QUEUES.invoiceSweep, async () => {
    const organizationIds = await listOrganizationsDueForInvoicing();
    for (const organizationId of organizationIds) {
      await boss.send(
        QUEUES.invoiceOrganization,
        { organizationId } satisfies InvoiceOrganizationPayload,
        { singletonKey: organizationId, singletonSeconds: 300 },
      );
    }
    logger.info({ organizations: organizationIds.length }, 'Invoice sweep enqueued organizations');
    return { organizations: organizationIds.length };
  });

  await boss.work<InvoiceOrganizationPayload>(
    QUEUES.invoiceOrganization,
    { localConcurrency: Number(process.env.INVOICE_CONCURRENCY ?? 3) },
    async ([job]) => {
      const result = await generateDueInvoicesForOrganization(job!.data.organizationId, logger);
      logger.info({ organizationId: job!.data.organizationId, ...result }, 'Organization invoicing completed');
      return result;
    },
  );

  await boss.work<InvoiceManualPayload>(QUEUES.invoiceManual, async ([job]) => {
    const outcome = await issueInvoiceNow(job!.data.organizationId, job!.data.issuedBy);
    const result: InvoiceManualResult = {
      status: outcome.status,
      ...('invoice' in outcome ? { invoiceId: outcome.invoice.id } : {}),
    };
    logger.info({ organizationId: job!.data.organizationId, ...result }, 'Manual invoice completed');
    return result;
  });

  await boss.work(QUEUES.maintenancePartitions, async () => {
    await ensureFuturePartitions(logger);
    return enforceAuditRetention(logger);
  });

  await boss.schedule(QUEUES.invoiceSweep, SCHEDULES.invoiceSweep);
  await boss.schedule(QUEUES.maintenancePartitions, SCHEDULES.maintenancePartitions);
  logger.info({}, 'Worker started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Worker shutting down');
    await boss.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});
