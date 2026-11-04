import { Prisma } from '@pithcharge/db';
import { money } from './financial.service';

export interface RateComponents {
  ratePerKwh: number;
  ratePerMinute: number;
  sessionFee: number;
  idleFeePerMinute: number;
}

export interface SnapshotRule extends Partial<RateComponents> {
  id: string;
  name: string;
  priority: number;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  stationIds: string[];
  validFrom: string | null;
  validUntil: string | null;
  ratePerKwh: number;
}

export interface PricingSnapshot {
  version: 1;
  timezone: string;
  /** Where the standard rate came from: the organization's general price or the CSMS tariff. */
  source?: 'policy' | 'csms' | 'none';
  base: RateComponents;
  rules: SnapshotRule[];
}

export interface ChargeBreakdownLine {
  label: string;
  ruleId: string | null;
  minutes: number;
  kwh: number;
  ratePerKwh: number;
  ratePerMinute: number;
  amount: number;
}

export interface ChargeResult {
  total: Prisma.Decimal;
  energyCost: number;
  timeCost: number;
  sessionFee: number;
  idleCost: number;
  lines: ChargeBreakdownLine[];
}

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

const num = (value: DecimalLike, fallback = 0): number =>
  value === null || value === undefined ? fallback : Number(value);

export interface PolicyLike {
  timezone: string;
  ratePerKwh: DecimalLike;
  ratePerMinute: DecimalLike;
  sessionFee: DecimalLike;
  idleFeePerMinute: DecimalLike;
}

export interface RuleLike {
  id: string;
  name: string;
  priority: number;
  active: boolean;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  stationIds: string[];
  validFrom: Date | null;
  validUntil: Date | null;
  ratePerKwh: DecimalLike;
  ratePerMinute: DecimalLike;
  sessionFee: DecimalLike;
  idleFeePerMinute: DecimalLike;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export interface CsmsTariffLike {
  pricePerKwh: number;
  pricePerMinute: number;
  pricePerSession: number;
}

/**
 * The organization's general price (when set) overrides the CSMS tariff. Time-band rules still
 * take precedence over both while they match.
 */
export function buildPricingSnapshot(
  policy: PolicyLike,
  rules: RuleLike[],
  csmsTariff?: CsmsTariffLike | null,
): PricingSnapshot {
  const source = policy.ratePerKwh !== null && policy.ratePerKwh !== undefined
    ? 'policy'
    : csmsTariff ? 'csms' : 'none';
  return {
    version: 1,
    timezone: policy.timezone,
    source,
    base: {
      ratePerKwh: num(policy.ratePerKwh, csmsTariff?.pricePerKwh ?? 0),
      ratePerMinute: num(policy.ratePerMinute, csmsTariff?.pricePerMinute ?? 0),
      sessionFee: num(policy.sessionFee, csmsTariff?.pricePerSession ?? 0),
      idleFeePerMinute: num(policy.idleFeePerMinute),
    },
    rules: rules
      .filter((rule) => rule.active)
      .map((rule) => ({
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        daysOfWeek: rule.daysOfWeek,
        startTime: rule.startTime,
        endTime: rule.endTime,
        stationIds: rule.stationIds,
        validFrom: rule.validFrom?.toISOString() ?? null,
        validUntil: rule.validUntil?.toISOString() ?? null,
        ratePerKwh: num(rule.ratePerKwh),
        ratePerMinute: rule.ratePerMinute === null ? undefined : num(rule.ratePerMinute),
        sessionFee: rule.sessionFee === null ? undefined : num(rule.sessionFee),
        idleFeePerMinute: rule.idleFeePerMinute === null ? undefined : num(rule.idleFeePerMinute),
      })),
  };
}

/** Rebuilds a snapshot for legacy sessions that only stored flat rates. */
export function legacySnapshot(
  session: { ratePerKwh: DecimalLike; ratePerMinute?: DecimalLike; sessionFee: DecimalLike; idleFeePerMinute: DecimalLike },
  policy: PolicyLike,
): PricingSnapshot {
  return {
    version: 1,
    timezone: policy.timezone,
    base: {
      ratePerKwh: num(session.ratePerKwh, num(policy.ratePerKwh)),
      ratePerMinute: num(session.ratePerMinute, num(policy.ratePerMinute)),
      sessionFee: num(session.sessionFee, num(policy.sessionFee)),
      idleFeePerMinute: num(session.idleFeePerMinute, num(policy.idleFeePerMinute)),
    },
    rules: [],
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(date: Date, timezone: string): { day: number; minutes: number } {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timezone, formatter);
  }
  let weekday = 'Sun';
  let hour = 0;
  let minute = 0;
  for (const part of formatter.formatToParts(date)) {
    if (part.type === 'weekday') weekday = part.value;
    if (part.type === 'hour') hour = Number(part.value) % 24;
    if (part.type === 'minute') minute = Number(part.value);
  }
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  return { day: day < 0 ? 0 : day, minutes: hour * 60 + minute };
}

function toMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function ruleMatches(rule: SnapshotRule, at: Date, stationId: string, timezone: string): boolean {
  if (rule.validFrom && at < new Date(rule.validFrom)) return false;
  if (rule.validUntil && at >= new Date(rule.validUntil)) return false;
  if (rule.stationIds.length > 0 && !rule.stationIds.includes(stationId)) return false;

  const { day, minutes } = localParts(at, timezone);
  let windowDay = day;
  if (rule.startTime && rule.endTime) {
    const start = toMinutes(rule.startTime);
    const end = toMinutes(rule.endTime);
    if (start < end) {
      if (minutes < start || minutes >= end) return false;
    } else if (start > end) {
      // Overnight window: the early-morning part belongs to the day the window started.
      if (minutes >= start) windowDay = day;
      else if (minutes < end) windowDay = (day + 6) % 7;
      else return false;
    }
  }
  return rule.daysOfWeek.length === 0 || rule.daysOfWeek.includes(windowDay);
}

export function resolveRate(
  snapshot: PricingSnapshot,
  at: Date,
  stationId: string,
): { rule: SnapshotRule | null; rates: RateComponents } {
  let best: SnapshotRule | null = null;
  for (const rule of snapshot.rules) {
    if (!ruleMatches(rule, at, stationId, snapshot.timezone)) continue;
    if (!best || rule.priority > best.priority) best = rule;
  }
  const base = snapshot.base;
  return {
    rule: best,
    rates: {
      ratePerKwh: best ? best.ratePerKwh : base.ratePerKwh,
      ratePerMinute: best?.ratePerMinute ?? base.ratePerMinute,
      sessionFee: best?.sessionFee ?? base.sessionFee,
      idleFeePerMinute: best?.idleFeePerMinute ?? base.idleFeePerMinute,
    },
  };
}

const MAX_STEPS = 10_080;
const MINUTE_MS = 60_000;

/**
 * Prices a session against a pricing snapshot. Energy is spread evenly over the session duration,
 * so each time slice is billed at whichever rule applies when it starts.
 */
export function computeCharge(input: {
  snapshot: PricingSnapshot;
  stationId: string;
  startTime: Date;
  endTime: Date;
  totalKwh: number;
  idleMinutes?: number;
}): ChargeResult {
  const { snapshot, stationId, startTime, endTime } = input;
  const totalKwh = Math.max(0, input.totalKwh);
  const duration = Math.max(0, endTime.getTime() - startTime.getTime());
  const step = Math.max(MINUTE_MS, Math.ceil(duration / MAX_STEPS));

  const slices: Array<{ at: Date; ms: number }> = [];
  if (duration === 0) slices.push({ at: startTime, ms: 0 });
  for (let offset = 0; offset < duration; offset += step) {
    slices.push({ at: new Date(startTime.getTime() + offset), ms: Math.min(step, duration - offset) });
  }

  const grouped = new Map<string, ChargeBreakdownLine>();
  let energyCost = 0;
  let timeCost = 0;
  for (const slice of slices) {
    const share = duration === 0 ? 1 : slice.ms / duration;
    const { rule, rates } = resolveRate(snapshot, slice.at, stationId);
    const kwh = totalKwh * share;
    const minutes = slice.ms / MINUTE_MS;
    const amount = kwh * rates.ratePerKwh + minutes * rates.ratePerMinute;
    energyCost += kwh * rates.ratePerKwh;
    timeCost += minutes * rates.ratePerMinute;

    const key = rule?.id ?? 'base';
    const line = grouped.get(key) ?? {
      label: rule?.name ?? 'Standard rate',
      ruleId: rule?.id ?? null,
      minutes: 0,
      kwh: 0,
      ratePerKwh: rates.ratePerKwh,
      ratePerMinute: rates.ratePerMinute,
      amount: 0,
    };
    line.minutes += minutes;
    line.kwh += kwh;
    line.amount += amount;
    grouped.set(key, line);
  }

  const startRates = resolveRate(snapshot, startTime, stationId).rates;
  const endRates = resolveRate(snapshot, endTime, stationId).rates;
  const sessionFee = startRates.sessionFee;
  const idleCost = Math.max(0, input.idleMinutes ?? 0) * endRates.idleFeePerMinute;

  const lines = [...grouped.values()].map((line) => ({
    ...line,
    minutes: Math.round(line.minutes * 100) / 100,
    kwh: Math.round(line.kwh * 1000) / 1000,
    amount: Math.round(line.amount * 10000) / 10000,
  }));
  return {
    total: money(energyCost + timeCost + sessionFee + idleCost),
    energyCost,
    timeCost,
    sessionFee,
    idleCost,
    lines,
  };
}

export function readSnapshot(value: unknown): PricingSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PricingSnapshot>;
  if (candidate.version !== 1 || !candidate.base || !Array.isArray(candidate.rules)) return null;
  return candidate as PricingSnapshot;
}
