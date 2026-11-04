-- Monthly range partitioning for the two append-only, fast-growing tables.
-- The primary key becomes (id, "createdAt") because a partition key must be part of every unique key.
-- Nothing references either table, so the swap is transparent to the application.

CREATE OR REPLACE FUNCTION ensure_monthly_partition(parent text, month_start date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  first_day date := date_trunc('month', month_start)::date;
  child text := format('%s_y%sm%s', parent, to_char(first_day, 'YYYY'), to_char(first_day, 'MM'));
BEGIN
  IF to_regclass(format('public.%I', child)) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
      child, parent, first_day, (first_day + interval '1 month')::date
    );
  END IF;
END $$;

-- AuditLog ---------------------------------------------------------------------------------------
ALTER TABLE "AuditLog" RENAME TO "AuditLog_legacy";
ALTER TABLE "AuditLog_legacy" RENAME CONSTRAINT "AuditLog_pkey" TO "AuditLog_legacy_pkey";
ALTER TABLE "AuditLog_legacy" RENAME CONSTRAINT "AuditLog_actorId_fkey" TO "AuditLog_legacy_actorId_fkey";
ALTER TABLE "AuditLog_legacy" RENAME CONSTRAINT "AuditLog_organizationId_fkey" TO "AuditLog_legacy_organizationId_fkey";
ALTER INDEX "AuditLog_organizationId_createdAt_idx" RENAME TO "AuditLog_legacy_organizationId_createdAt_idx";
ALTER INDEX "AuditLog_actorId_createdAt_idx" RENAME TO "AuditLog_legacy_actorId_createdAt_idx";

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" UUID,
  "organizationId" UUID,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

CREATE TABLE "AuditLog_default" PARTITION OF "AuditLog" DEFAULT;
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- LedgerEntry ------------------------------------------------------------------------------------
ALTER TABLE "LedgerEntry" RENAME TO "LedgerEntry_legacy";
ALTER TABLE "LedgerEntry_legacy" RENAME CONSTRAINT "LedgerEntry_pkey" TO "LedgerEntry_legacy_pkey";
ALTER TABLE "LedgerEntry_legacy" RENAME CONSTRAINT "LedgerEntry_transactionId_fkey" TO "LedgerEntry_legacy_transactionId_fkey";
ALTER TABLE "LedgerEntry_legacy" RENAME CONSTRAINT "LedgerEntry_accountId_fkey" TO "LedgerEntry_legacy_accountId_fkey";
ALTER INDEX "LedgerEntry_accountId_createdAt_idx" RENAME TO "LedgerEntry_legacy_accountId_createdAt_idx";
ALTER INDEX "LedgerEntry_transactionId_idx" RENAME TO "LedgerEntry_legacy_transactionId_idx";

CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "direction" "LedgerEntryDirection" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

CREATE TABLE "LedgerEntry_default" PARTITION OF "LedgerEntry" DEFAULT;
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partitions: from the oldest existing row through three months ahead, then backfill -------------
DO $$
DECLARE
  tbl text;
  oldest date;
  cursor_month date;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['AuditLog', 'LedgerEntry'] LOOP
    EXECUTE format('SELECT date_trunc(''month'', min("createdAt"))::date FROM %I', tbl || '_legacy') INTO oldest;
    cursor_month := LEAST(COALESCE(oldest, date_trunc('month', now())::date), date_trunc('month', now())::date);
    WHILE cursor_month <= (date_trunc('month', now()) + interval '3 months')::date LOOP
      PERFORM ensure_monthly_partition(tbl, cursor_month);
      cursor_month := (cursor_month + interval '1 month')::date;
    END LOOP;
  END LOOP;
END $$;

INSERT INTO "AuditLog" SELECT "id", "actorId", "organizationId", "action", "targetType", "targetId", "metadata", "createdAt" FROM "AuditLog_legacy";
INSERT INTO "LedgerEntry" SELECT "id", "transactionId", "accountId", "direction", "amount", "currency", "createdAt" FROM "LedgerEntry_legacy";

DO $$
BEGIN
  IF (SELECT count(*) FROM "AuditLog") <> (SELECT count(*) FROM "AuditLog_legacy")
     OR (SELECT count(*) FROM "LedgerEntry") <> (SELECT count(*) FROM "LedgerEntry_legacy") THEN
    RAISE EXCEPTION 'Partition backfill row count mismatch; aborting migration';
  END IF;
END $$;

DROP TABLE "AuditLog_legacy";
DROP TABLE "LedgerEntry_legacy";
