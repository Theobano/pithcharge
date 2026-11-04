-- New organizations default to NGN and West Africa Time (Africa/Lagos).
ALTER TABLE "BillingPolicy" ALTER COLUMN "currency" SET DEFAULT 'NGN';
ALTER TABLE "BillingPolicy" ALTER COLUMN "timezone" SET DEFAULT 'Africa/Lagos';
ALTER TABLE "Wallet" ALTER COLUMN "currency" SET DEFAULT 'NGN';
ALTER TABLE "ChargingSession" ALTER COLUMN "currency" SET DEFAULT 'NGN';
