export interface OpeningPeriod {
  /** ISO weekday, 1 = Monday ... 7 = Sunday */
  weekday: number;
  /** "HH:MM" local to the hub's time zone */
  periodBegin: string;
  periodEnd: string;
}

export interface OpeningException {
  /** ISO 8601 timestamps */
  periodBegin: string;
  periodEnd: string;
}

export interface OpeningHours {
  twentyfourSeven: boolean;
  regularHours: OpeningPeriod[];
  exceptionalOpenings: OpeningException[];
  exceptionalClosings: OpeningException[];
}

export interface OpenStatus {
  isOpen: boolean;
  /** True when the hub is open around the clock, so no schedule applies */
  alwaysOpen: boolean;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function toMinutes(value: unknown): number | null {
  const match = typeof value === 'string' ? TIME_RE.exec(value.trim()) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeExceptions(value: unknown): OpeningException[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        item &&
        typeof item.periodBegin === 'string' &&
        typeof item.periodEnd === 'string' &&
        !Number.isNaN(Date.parse(item.periodBegin)) &&
        !Number.isNaN(Date.parse(item.periodEnd)),
    )
    .map((item) => ({ periodBegin: item.periodBegin, periodEnd: item.periodEnd }));
}

/** Defensively converts the OCPI-style JSON stored by CitrineOS. Returns undefined when nothing usable exists. */
export function normalizeOpeningHours(raw: unknown): OpeningHours | undefined {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;

  const regularHours = (Array.isArray(source.regularHours) ? source.regularHours : [])
    .map((item: any) => ({
      weekday: Number(item?.weekday),
      periodBegin: String(item?.periodBegin ?? ''),
      periodEnd: String(item?.periodEnd ?? ''),
    }))
    .filter(
      (item) =>
        Number.isInteger(item.weekday) &&
        item.weekday >= 1 &&
        item.weekday <= 7 &&
        toMinutes(item.periodBegin) !== null &&
        toMinutes(item.periodEnd) !== null,
    );

  const twentyfourSeven = source.twentyfourSeven === true;
  if (!twentyfourSeven && regularHours.length === 0) return undefined;

  return {
    twentyfourSeven,
    regularHours,
    exceptionalOpenings: normalizeExceptions(source.exceptionalOpenings),
    exceptionalClosings: normalizeExceptions(source.exceptionalClosings),
  };
}

function localParts(date: Date, timeZone: string): { weekday: number; minutes: number } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function inside(exceptions: OpeningException[], at: number): boolean {
  return exceptions.some(
    (item) => Date.parse(item.periodBegin) <= at && at < Date.parse(item.periodEnd),
  );
}

/** Computes whether a hub is open at `now`, honoring time zone, overnight spans and exceptions. */
export function getOpenStatus(
  hours: OpeningHours | undefined,
  timeZone = 'UTC',
  now: Date = new Date(),
): OpenStatus | undefined {
  if (!hours) return undefined;
  const at = now.getTime();
  if (inside(hours.exceptionalClosings, at)) return { isOpen: false, alwaysOpen: false };
  if (inside(hours.exceptionalOpenings, at)) return { isOpen: true, alwaysOpen: false };
  if (hours.twentyfourSeven) return { isOpen: true, alwaysOpen: true };

  const { weekday, minutes } = localParts(now, timeZone);
  const previousDay = weekday === 1 ? 7 : weekday - 1;
  const isOpen = hours.regularHours.some((period) => {
    const begin = toMinutes(period.periodBegin)!;
    const end = toMinutes(period.periodEnd)!;
    const overnight = end <= begin && !(begin === 0 && end === 0);
    if (begin === 0 && end === 0) return period.weekday === weekday;
    if (!overnight) return period.weekday === weekday && minutes >= begin && minutes < end;
    return (
      (period.weekday === weekday && minutes >= begin) ||
      (period.weekday === previousDay && minutes < end)
    );
  });
  return { isOpen, alwaysOpen: false };
}
