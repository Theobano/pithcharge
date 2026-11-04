import { PgBoss, type Queue } from 'pg-boss';

export { PgBoss };

export const QUEUES = {
  invoiceSweep: 'invoice-sweep',
  invoiceOrganization: 'invoice-organization',
  invoiceManual: 'invoice-manual',
  invoiceDeadLetter: 'invoice-dead-letter',
  maintenancePartitions: 'maintenance-partitions',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type InvoiceOrganizationPayload = { organizationId: string };
export type InvoiceManualPayload = { organizationId: string; issuedBy: string };
export type InvoiceManualResult = {
  status: 'ISSUED' | 'EXISTING' | 'NOTHING_TO_INVOICE';
  invoiceId?: string;
};

export const SCHEDULES = {
  invoiceSweep: '5 * * * *',
  maintenancePartitions: '15 2 * * *',
} as const;

export const QUEUE_OPTIONS: Record<QueueName, Omit<Queue, 'name'>> = {
  [QUEUES.invoiceDeadLetter]: { retentionSeconds: 90 * 24 * 3600 },
  [QUEUES.invoiceSweep]: { retryLimit: 1, retryDelay: 30, expireInSeconds: 600 },
  [QUEUES.invoiceOrganization]: {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 900,
    deadLetter: QUEUES.invoiceDeadLetter,
  },
  [QUEUES.invoiceManual]: {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: QUEUES.invoiceDeadLetter,
  },
  [QUEUES.maintenancePartitions]: { retryLimit: 2, retryDelay: 300, expireInSeconds: 3600 },
};

/** Idempotent: safe to call from every process on startup. */
export async function ensureQueues(boss: PgBoss) {
  // Dead letter queue first; other queues reference it.
  const ordered = [
    QUEUES.invoiceDeadLetter,
    ...Object.values(QUEUES).filter((name) => name !== QUEUES.invoiceDeadLetter),
  ];
  for (const name of ordered) {
    await boss.createQueue(name, QUEUE_OPTIONS[name]);
  }
}

export function jobsConnectionString(env: NodeJS.ProcessEnv = process.env) {
  const url = env.JOBS_DATABASE_URL || env.DATABASE_URL;
  if (!url) throw new Error('JOBS_DATABASE_URL or DATABASE_URL is required for the job queue.');
  return url;
}

/** A publish-only client for API processes: it never runs workers, cron or maintenance. */
export async function createJobPublisher(instanceName = 'api', env: NodeJS.ProcessEnv = process.env) {
  const boss = new PgBoss({
    connectionString: jobsConnectionString(env),
    instanceName,
    supervise: false,
    schedule: false,
    max: 3,
  });
  boss.on('error', (error) => console.error(`[jobs:${instanceName}]`, error));
  await boss.start();
  await ensureQueues(boss);
  return boss;
}

export type ManualInvoiceJobView = {
  id: string;
  organizationId: string;
  state: 'queued' | 'running' | 'completed' | 'failed';
  result?: InvoiceManualResult;
  error?: string;
};

/** Returns null when an identical request was queued moments ago (duplicate click). */
export async function enqueueManualInvoice(boss: PgBoss, payload: InvoiceManualPayload) {
  return boss.send(QUEUES.invoiceManual, payload, {
    singletonKey: `manual:${payload.organizationId}`,
    singletonSeconds: 10,
  });
}

export async function getManualInvoiceJob(boss: PgBoss, jobId: string): Promise<ManualInvoiceJobView | null> {
  const job = await boss.getJobById<InvoiceManualPayload>(QUEUES.invoiceManual, jobId);
  if (!job) return null;
  const output = (job.output ?? {}) as { message?: string } & Partial<InvoiceManualResult>;
  const state =
    job.state === 'completed'
      ? 'completed'
      : job.state === 'failed' || job.state === 'cancelled'
        ? 'failed'
        : job.state === 'active'
          ? 'running'
          : 'queued';
  return {
    id: job.id,
    organizationId: job.data.organizationId,
    state,
    ...(state === 'completed' ? { result: output as InvoiceManualResult } : {}),
    ...(state === 'failed' ? { error: output.message ?? 'Invoice generation failed.' } : {}),
  };
}
