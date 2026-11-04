import { db, Prisma } from '@pithcharge/db';
import type { ICmsAdapter } from '@pithcharge/cms-adapters';
import type { PricingSnapshot, RateComponents } from './rate-engine.service';

type Decimalish = Prisma.Decimal | number | string | null | undefined;
const toNumber = (value: Decimalish): number | null => (value === null || value === undefined ? null : Number(value));

export type RateSource = 'station' | 'hub' | 'platform' | 'csms' | 'none';

export interface ResolvedRate {
  source: RateSource;
  currency: string;
  base: RateComponents;
}

export interface RateTarget {
  stationId: string;
  evseId: number;
  connectorId: number;
}

const DEFAULT_CURRENCY = 'NGN';

/**
 * Public-network price for a connector: station override, then hub override, then the platform
 * rate, then the CSMS tariff. A CSMS-source row uses the tariff as-is; a manual row's blank fields
 * fall back to the tariff.
 */
export async function resolveChargingRate(
  cms: Pick<ICmsAdapter, 'getConnectorTariff' | 'getStationDetails'>,
  target: RateTarget,
): Promise<ResolvedRate> {
  const station = await cms.getStationDetails(target.stationId).catch(() => null);
  const rows = await db.chargingRate.findMany({
    where: {
      OR: [
        { scope: 'STATION', scopeId: target.stationId },
        ...(station?.hubId ? [{ scope: 'HUB' as const, scopeId: station.hubId }] : []),
        { scope: 'PLATFORM', scopeId: '' },
      ],
    },
  });
  const row = rows.find((r: { scope: string }) => r.scope === 'STATION') ??
    rows.find((r: { scope: string }) => r.scope === 'HUB') ??
    rows.find((r: { scope: string }) => r.scope === 'PLATFORM');

  const manual = row && row.source === 'MANUAL' ? row : null;
  const needsTariff = !manual ||
    manual.ratePerKwh === null || manual.ratePerMinute === null || manual.sessionFee === null;
  const tariff = needsTariff
    ? await cms.getConnectorTariff(target.stationId, target.evseId, target.connectorId).catch(() => null)
    : null;

  const base: RateComponents = {
    ratePerKwh: toNumber(manual?.ratePerKwh) ?? tariff?.pricePerKwh ?? 0,
    ratePerMinute: toNumber(manual?.ratePerMinute) ?? tariff?.pricePerMinute ?? 0,
    sessionFee: toNumber(manual?.sessionFee) ?? tariff?.pricePerSession ?? 0,
    idleFeePerMinute: toNumber(manual?.idleFeePerMinute) ?? 0,
  };
  const source: RateSource = manual
    ? (manual.scope.toLowerCase() as RateSource)
    : tariff ? 'csms' : 'none';
  return { source, currency: manual?.currency ?? tariff?.currency ?? DEFAULT_CURRENCY, base };
}

export function publicSnapshot(rate: ResolvedRate): PricingSnapshot {
  return { version: 1, timezone: 'UTC', source: rate.source === 'csms' ? 'csms' : 'policy', base: rate.base, rules: [] };
}
