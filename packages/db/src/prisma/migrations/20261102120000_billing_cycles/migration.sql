-- Configurable billing cycles and usage invoices.
CREATE TYPE "BillingCycleUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

ALTER TABLE "BillingPolicy"
  ADD COLUMN "billingCycleUnit" "BillingCycleUnit" NOT NULL DEFAULT 'MONTH',
  ADD COLUMN "billingCycleInterval" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "billingCycleAnchor" TIMESTAMP(3),
  ADD COLUMN "autoInvoice" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "invoiceCursor" TIMESTAMP(3);

ALTER TABLE "MonthlyInvoice"
  ADD COLUMN "usageCharges" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "shortfallCharges" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "sessionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN "issuedBy" UUID;

-- Every pre-existing invoice was a minimum-spend shortfall invoice.
UPDATE "MonthlyInvoice" SET "shortfallCharges" = "amountDue";

DROP INDEX IF EXISTS "MonthlyInvoice_organizationId_periodStart_key";
CREATE INDEX "MonthlyInvoice_organizationId_periodStart_idx" ON "MonthlyInvoice"("organizationId", "periodStart");

ALTER TABLE "ChargingSession"
  ADD COLUMN "receivableAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "invoiceId" TEXT;

ALTER TABLE "ChargingSession"
  ADD CONSTRAINT "ChargingSession_invoiceId_fkey" FOREIGN KEY ("invoiceId")
  REFERENCES "MonthlyInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ChargingSession_invoiceId_idx" ON "ChargingSession"("invoiceId");

-- Recover unpaid session amounts recorded when sessions were settled.
UPDATE "ChargingSession" s
SET "receivableAmount" = (a."metadata"->>'receivable')::numeric
FROM "AuditLog" a
WHERE a."action" = 'billing.session.settled'
  AND a."targetId" = s."id"
  AND a."metadata"->>'receivable' IS NOT NULL
  AND (a."metadata"->>'receivable')::numeric > 0;
