-- General price override is optional: NULL means "use the CSMS tariff".
ALTER TABLE "BillingPolicy" ALTER COLUMN "ratePerKwh" DROP NOT NULL,
ALTER COLUMN "ratePerKwh" DROP DEFAULT,
ALTER COLUMN "ratePerMinute" DROP NOT NULL,
ALTER COLUMN "ratePerMinute" DROP DEFAULT,
ALTER COLUMN "sessionFee" DROP NOT NULL,
ALTER COLUMN "sessionFee" DROP DEFAULT;
