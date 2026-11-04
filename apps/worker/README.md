# @pithcharge/worker

Stand-alone background worker built on [pg-boss](https://github.com/timgit/pg-boss). It uses the same Postgres database as the API (queue tables live in the `pgboss` schema), so there is no extra infrastructure. Business logic lives in `@pithcharge/billing-core`; the queue contract is in `@pithcharge/jobs`.

## Jobs

| Queue | Trigger | Does |
| --- | --- | --- |
| `invoice-sweep` | cron `5 * * * *` (or platform admin) | Finds organizations with a due billing cycle and enqueues one `invoice-organization` job each |
| `invoice-organization` | sweep | Issues every due scheduled invoice for one organization. 5 retries with backoff, then `invoice-dead-letter` |
| `invoice-manual` | API (`202` + `jobId`) | Issues an invoice immediately for the organization |
| `maintenance-partitions` | cron `15 2 * * *` | Creates `AuditLog`/`LedgerEntry` monthly partitions 3 months ahead and applies audit-log retention |

Invoices are idempotent per organization and period, so retries and replicas never double-bill.

## Running

```bash
pnpm --filter @pithcharge/worker start
```

Set `DATABASE_URL` (or `JOBS_DATABASE_URL` to use a different connection, e.g. a direct non-pooled one). Run as many replicas as you like: pg-boss hands each job to exactly one worker, and cron schedules are deduplicated. `SIGTERM` finishes in-flight jobs (30 s) before exiting.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JOBS_DATABASE_URL` | `DATABASE_URL` | Queue database |
| `WORKER_NAME` | `worker` | Instance name in pg-boss |
| `WORKER_DB_POOL` | `5` | Connection pool size |
| `INVOICE_CONCURRENCY` | `3` | Parallel organization invoice jobs per replica |
| `AUDIT_RETENTION_DAYS` | unset (keep forever) | Archive then drop audit partitions entirely older than this |
| `ARCHIVE_DIR` | unset | Required for retention; partitions are written as `AuditLog_yYYYYmMM.ndjson.gz` and only dropped after the row count is verified |

Ledger, invoice and session data are never dropped. Mount `ARCHIVE_DIR` on durable storage (or sync it to object storage).

## Archive format

Archives are gzipped newline-delimited JSON. Parquet is not needed at this scale: ClickHouse reads these files directly (`SELECT * FROM file('AuditLog_*.ndjson.gz', JSONEachRow)`) and S3/Athena can query them. Revisit Parquet only if you move analytics to a warehouse and need columnar scans over billions of rows.

## Tests

```bash
pnpm --filter @pithcharge/worker test
```
