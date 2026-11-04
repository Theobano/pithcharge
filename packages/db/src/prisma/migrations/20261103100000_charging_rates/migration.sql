-- Public-network charging rates with platform, hub and station scopes.
CREATE TYPE "ChargingRateScope" AS ENUM ('PLATFORM', 'HUB', 'STATION');
CREATE TYPE "ChargingRateSource" AS ENUM ('MANUAL', 'CSMS');

CREATE TABLE "ChargingRate" (
    "id" TEXT NOT NULL,
    "scope" "ChargingRateScope" NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "source" "ChargingRateSource" NOT NULL DEFAULT 'MANUAL',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "ratePerKwh" DECIMAL(12,4),
    "ratePerMinute" DECIMAL(12,4),
    "sessionFee" DECIMAL(12,2),
    "idleFeePerMinute" DECIMAL(12,4),
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargingRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChargingRate_scope_scopeId_key" ON "ChargingRate"("scope", "scopeId");
