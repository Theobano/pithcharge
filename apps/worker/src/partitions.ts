export const PARTITIONED_TABLES = ['AuditLog', 'LedgerEntry'] as const;
export type PartitionedTable = (typeof PARTITIONED_TABLES)[number];

/** Parses `FOR VALUES FROM ('2026-01-01 00:00:00') TO ('2026-02-01 00:00:00')`. Returns null for DEFAULT. */
export function parsePartitionBounds(bound: string): { from: Date; to: Date } | null {
  const match = /FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(bound);
  if (!match) return null;
  const toDate = (value: string) => new Date(`${value.replace(' ', 'T')}Z`.replace(/(\+\d\d)Z$/, '$1:00'));
  const from = toDate(match[1]!);
  const to = toDate(match[2]!);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { from, to };
}

export function startOfMonthUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** The first day of each month from `at`'s month through `monthsAhead` months later. */
export function monthsToEnsure(at: Date, monthsAhead: number): Date[] {
  const start = startOfMonthUtc(at);
  return Array.from(
    { length: monthsAhead + 1 },
    (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)),
  );
}

/** A partition is expired once its whole range lies before the retention cutoff. */
export function isExpired(bounds: { to: Date }, retentionDays: number, at: Date) {
  return bounds.to.getTime() <= at.getTime() - retentionDays * 86_400_000;
}
