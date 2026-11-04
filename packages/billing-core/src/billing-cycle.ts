export type CycleUnit = 'DAY' | 'WEEK' | 'MONTH';

export interface CycleSettings {
  unit: CycleUnit;
  interval: number;
  /** Explicit start of the first cycle. Defaults to the calendar boundary of `createdAt`. */
  anchor: Date | null;
  createdAt: Date;
  /** End of the last cycle that was already processed. */
  cursor: Date | null;
}

export interface BillingCycle {
  start: Date;
  end: Date;
}

const DAY_MS = 86_400_000;

export const MAX_CYCLES_PER_RUN = 12;

export function defaultAnchor(unit: CycleUnit, createdAt: Date): Date {
  const day = Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate());
  if (unit === 'DAY') return new Date(day);
  if (unit === 'WEEK') {
    const sinceMonday = (createdAt.getUTCDay() + 6) % 7;
    return new Date(day - sinceMonday * DAY_MS);
  }
  return new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), 1));
}

function addMonths(anchor: Date, months: number): Date {
  const total = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(anchor.getUTCDate(), lastDay),
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
  ));
}

/** Start of cycle `index`, computed from the anchor so month-end anchors never drift. */
export function cycleStart(anchor: Date, unit: CycleUnit, interval: number, index: number): Date {
  if (unit === 'MONTH') return addMonths(anchor, index * interval);
  const days = unit === 'WEEK' ? 7 : 1;
  return new Date(anchor.getTime() + index * interval * days * DAY_MS);
}

/** Index of the cycle containing `at`; -1 when `at` is before the anchor. */
export function cycleIndexContaining(anchor: Date, unit: CycleUnit, interval: number, at: Date): number {
  if (at < anchor) return -1;
  let index: number;
  if (unit === 'MONTH') {
    const months = (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (at.getUTCMonth() - anchor.getUTCMonth());
    index = Math.floor(months / interval);
  } else {
    const span = interval * (unit === 'WEEK' ? 7 : 1) * DAY_MS;
    index = Math.floor((at.getTime() - anchor.getTime()) / span);
  }
  while (index > 0 && cycleStart(anchor, unit, interval, index) > at) index -= 1;
  while (cycleStart(anchor, unit, interval, index + 1) <= at) index += 1;
  return index;
}

export function cycleAt(settings: CycleSettings, index: number): BillingCycle {
  const anchor = resolveAnchor(settings);
  return {
    start: cycleStart(anchor, settings.unit, settings.interval, index),
    end: cycleStart(anchor, settings.unit, settings.interval, index + 1),
  };
}

export function resolveAnchor(settings: CycleSettings): Date {
  return settings.anchor ?? defaultAnchor(settings.unit, settings.createdAt);
}

/**
 * Cycles that have fully elapsed and are not yet processed, oldest first.
 * Without a cursor, billing begins at the last completed cycle (never before the policy existed),
 * so enabling cycles on an old organization does not back-bill its entire history.
 */
export function dueCycles(settings: CycleSettings, now: Date, limit = MAX_CYCLES_PER_RUN): BillingCycle[] {
  const anchor = resolveAnchor(settings);
  const { unit, interval } = settings;
  const lastComplete = cycleIndexContaining(anchor, unit, interval, now) - 1;
  if (lastComplete < 0) return [];

  let first: number;
  if (settings.cursor) {
    const containing = cycleIndexContaining(anchor, unit, interval, settings.cursor);
    first = containing < 0
      ? 0
      : cycleStart(anchor, unit, interval, containing).getTime() === settings.cursor.getTime()
        ? containing
        : containing + 1;
  } else {
    const created = Math.max(0, cycleIndexContaining(anchor, unit, interval, settings.createdAt));
    first = Math.max(created, lastComplete);
  }

  const cycles: BillingCycle[] = [];
  for (let index = first; index <= lastComplete && cycles.length < limit; index += 1) {
    cycles.push(cycleAt(settings, index));
  }
  return cycles;
}

export function describeCycle(unit: CycleUnit, interval: number): string {
  const noun = unit === 'DAY' ? 'day' : unit === 'WEEK' ? 'week' : 'month';
  if (interval === 1) return { DAY: 'Daily', WEEK: 'Weekly', MONTH: 'Monthly' }[unit];
  return `Every ${interval} ${noun}s`;
}
