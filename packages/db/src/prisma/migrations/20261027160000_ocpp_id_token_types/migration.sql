-- Align TokenType with the OCPP 2.0.1 IdTokenEnumType.
CREATE TYPE "TokenType_new" AS ENUM ('Central', 'eMAID', 'ISO14443', 'ISO15693', 'KeyCode', 'Local', 'MacAddress', 'NoAuthorization');

ALTER TABLE "UserOcppToken" ALTER COLUMN "tokenType" DROP DEFAULT;
ALTER TABLE "UserOcppToken" ALTER COLUMN "tokenType" TYPE "TokenType_new" USING (
  CASE "tokenType"::text
    WHEN 'RFID_CARD' THEN 'ISO14443'
    WHEN 'KEY_FOB' THEN 'ISO15693'
    WHEN 'AUTO_CHARGE_MAC' THEN 'MacAddress'
    ELSE 'Central'
  END
)::"TokenType_new";
ALTER TABLE "UserOcppToken" ALTER COLUMN "tokenType" SET DEFAULT 'ISO14443';

DROP TYPE "TokenType";
ALTER TYPE "TokenType_new" RENAME TO "TokenType";

-- Pending outbox payloads carry the old token type names.
UPDATE "IntegrationOutbox"
SET "payload" = jsonb_set("payload", '{tokenType}', to_jsonb(
  CASE "payload"->>'tokenType'
    WHEN 'RFID_CARD' THEN 'ISO14443'
    WHEN 'KEY_FOB' THEN 'ISO15693'
    WHEN 'AUTO_CHARGE_MAC' THEN 'MacAddress'
    ELSE 'Central'
  END
))
WHERE "eventType" = 'CHARGING_TOKEN_SYNC' AND "payload"->>'tokenType' IN ('RFID_CARD', 'KEY_FOB', 'APP_VIRTUAL', 'APPLE_WALLET', 'GOOGLE_WALLET', 'AUTO_CHARGE_MAC');
