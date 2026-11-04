import { Type, Static } from '@sinclair/typebox';
import { recordAuditEvent } from './financial.service';

export const PageQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  search: Type.Optional(Type.String({ maxLength: 100 })),
});
export type PageQueryInput = Static<typeof PageQuery>;

export function pageArgs(query: { page?: number; pageSize?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paged<T>(data: T[], total: number, args: { page: number; pageSize: number }) {
  return { data, total, page: args.page, pageSize: args.pageSize };
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Prefix formula triggers so spreadsheet apps do not execute exported user-controlled text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]) {
  const headers = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
}

/** Records a platform administrator action in the audit log. */
export function auditAdminAction(input: {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string;
  organizationId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  return recordAuditEvent({
    actorId: input.actorId,
    organizationId: input.organizationId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: { ...input.metadata, byPlatformAdmin: true },
  });
}

export function parseDateRange(query: { from?: string; to?: string }, defaultDays = 30) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - defaultDays * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
  return { from, to };
}
