-- AlterTable
ALTER TABLE "BillingPolicy" ADD COLUMN "ratePerMinute" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "ChargingSession" ADD COLUMN "ratePerMinute" DECIMAL(12,4),
ADD COLUMN "pricingSnapshot" JSONB;

-- CreateTable
CREATE TABLE "RateRule" (
    "id" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT,
    "endTime" TEXT,
    "stationIds" TEXT[],
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "ratePerKwh" DECIMAL(12,4) NOT NULL,
    "ratePerMinute" DECIMAL(12,4),
    "sessionFee" DECIMAL(12,2),
    "idleFeePerMinute" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateRule_organizationId_active_idx" ON "RateRule"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "RateRule" ADD CONSTRAINT "RateRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
