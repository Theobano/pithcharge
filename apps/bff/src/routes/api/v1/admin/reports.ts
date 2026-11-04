import { FastifyPluginAsync } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import { db, Prisma } from '@pithcharge/db';
import { PageQuery, pageArgs, paged, parseDateRange, toCsv } from '../../../../services/admin.service';

const RangeQuery = Type.Object({
  from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  organizationId: Type.Optional(Type.String()),
});

const ExportQuery = Type.Intersect([
  RangeQuery,
  Type.Object({ type: Type.Union([Type.Literal('sessions'), Type.Literal('ledger'), Type.Literal('invoices'), Type.Literal('audit')]) }),
]);

const SessionsQuery = Type.Intersect([
  PageQuery,
  Type.Object({ status: Type.Optional(Type.String()), organizationId: Type.Optional(Type.String()) }),
]);

const AuditQuery = Type.Intersect([
  PageQuery,
  Type.Object({ organizationId: Type.Optional(Type.String()), actorId: Type.Optional(Type.String()), action: Type.Optional(Type.String()) }),
]);

const EXPORT_LIMIT = 10_000;
const invalidRange = { code: 'INVALID_RANGE', message: 'Provide a valid date range where "from" is before "to".' };

const adminReportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requirePlatformAdmin);

  fastify.get('/overview', async () => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [users, guests, organizations, activeSessions, usage, liabilities, invoices, failedOutbox, failedNotifications] = await Promise.all([
      db.user.count({ where: { isAnonymous: { not: true } } }),
      db.user.count({ where: { isAnonymous: true } }),
      db.organization.count(),
      db.chargingSession.count({ where: { status: { in: ['PENDING', 'ACTIVE'] } } }),
      db.chargingSession.groupBy({
        by: ['currency'],
        where: { startTime: { gte: since } },
        _sum: { totalKwh: true, totalCost: true },
        _count: true,
      }),
      db.wallet.groupBy({ by: ['currency'], _sum: { balance: true, reservedBalance: true } }),
      db.monthlyInvoice.groupBy({ by: ['currency'], where: { status: 'ISSUED' }, _sum: { amountDue: true }, _count: true }),
      db.integrationOutbox.count({ where: { status: 'FAILED' } }),
      db.notificationDelivery.count({ where: { status: 'FAILED' } }),
    ]);
    return {
      data: {
        users,
        guests,
        organizations,
        activeSessions,
        usage30d: usage.map((row: any) => ({
          currency: row.currency,
          sessions: row._count,
          kwh: row._sum.totalKwh ?? 0,
          revenue: (row._sum.totalCost ?? 0).toString(),
        })),
        walletLiabilities: liabilities.map((row: any) => ({
          currency: row.currency,
          balance: (row._sum.balance ?? 0).toString(),
          reserved: (row._sum.reservedBalance ?? 0).toString(),
        })),
        outstandingInvoices: invoices.map((row: any) => ({
          currency: row.currency,
          count: row._count,
          amount: (row._sum.amountDue ?? 0).toString(),
        })),
        failedOutbox,
        failedNotifications,
      },
    };
  });

  fastify.get<{ Querystring: Static<typeof RangeQuery> }>(
    '/reports/summary',
    { schema: { querystring: RangeQuery } },
    async (request, reply) => {
      const range = parseDateRange(request.query);
      if (!range) return reply.code(400).send(invalidRange);
      const where: Prisma.ChargingSessionWhereInput = {
        startTime: { gte: range.from, lte: range.to },
        ...(request.query.organizationId ? { organizationId: request.query.organizationId } : {}),
      };
      const orgFilter = request.query.organizationId
        ? Prisma.sql`AND "organizationId" = ${request.query.organizationId}::uuid`
        : Prisma.empty;

      const [totals, byStatus, daily, topOrganizations, topStations] = await Promise.all([
        db.chargingSession.groupBy({ by: ['currency'], where, _sum: { totalKwh: true, totalCost: true }, _count: true }),
        db.chargingSession.groupBy({ by: ['status'], where, _count: true }),
        db.$queryRaw<Array<{ day: Date; sessions: bigint; kwh: number | null; revenue: Prisma.Decimal | null }>>`
          SELECT date_trunc('day', "startTime") AS day, COUNT(*) AS sessions,
                 COALESCE(SUM("totalKwh"), 0) AS kwh, COALESCE(SUM("totalCost"), 0) AS revenue
          FROM "ChargingSession"
          WHERE "startTime" >= ${range.from} AND "startTime" <= ${range.to} ${orgFilter}
          GROUP BY 1 ORDER BY 1`,
        db.chargingSession.groupBy({
          by: ['organizationId'],
          where: { ...where, organizationId: request.query.organizationId ?? { not: null } },
          _sum: { totalKwh: true, totalCost: true },
          _count: true,
          orderBy: { _sum: { totalCost: 'desc' } },
          take: 5,
        }),
        db.chargingSession.groupBy({
          by: ['stationId'],
          where,
          _sum: { totalKwh: true, totalCost: true },
          _count: true,
          orderBy: { _sum: { totalKwh: 'desc' } },
          take: 5,
        }),
      ]);

      const orgIds = topOrganizations.map((row: any) => row.organizationId).filter(Boolean) as string[];
      const orgs = await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
      const names = new Map<string, string>(orgs.map((org: { id: string; name: string }) => [org.id, org.name]));

      return {
        data: {
          range,
          totals: totals.map((row: any) => ({
            currency: row.currency,
            sessions: row._count,
            kwh: row._sum.totalKwh ?? 0,
            revenue: (row._sum.totalCost ?? 0).toString(),
          })),
          byStatus: byStatus.map((row: any) => ({ status: row.status, sessions: row._count })),
          daily: daily.map((row: { day: Date; sessions: bigint; kwh: number | null; revenue: Prisma.Decimal | null }) => ({
            day: row.day.toISOString().slice(0, 10),
            sessions: Number(row.sessions),
            kwh: Number(row.kwh ?? 0),
            revenue: Number(row.revenue ?? 0),
          })),
          topOrganizations: topOrganizations.map((row: any) => ({
            organizationId: row.organizationId,
            name: names.get(row.organizationId) ?? row.organizationId,
            sessions: row._count,
            kwh: row._sum.totalKwh ?? 0,
            revenue: (row._sum.totalCost ?? 0).toString(),
          })),
          topStations: topStations.map((row: any) => ({
            stationId: row.stationId,
            sessions: row._count,
            kwh: row._sum.totalKwh ?? 0,
            revenue: (row._sum.totalCost ?? 0).toString(),
          })),
        },
      };
    },
  );

  fastify.get<{ Querystring: Static<typeof ExportQuery> }>(
    '/reports/export',
    { schema: { querystring: ExportQuery } },
    async (request, reply) => {
      const range = parseDateRange(request.query, 31);
      if (!range) return reply.code(400).send(invalidRange);
      const { type, organizationId } = request.query;
      const org = organizationId ? { organizationId } : {};
      let rows: Array<Record<string, unknown>> = [];

      if (type === 'sessions') {
        rows = await db.chargingSession.findMany({
          where: { startTime: { gte: range.from, lte: range.to }, ...org },
          orderBy: { startTime: 'desc' },
          take: EXPORT_LIMIT,
        });
      } else if (type === 'ledger') {
        rows = await db.ledgerTransaction.findMany({
          where: { postedAt: { gte: range.from, lte: range.to }, ...org },
          orderBy: { postedAt: 'desc' },
          take: EXPORT_LIMIT,
        });
      } else if (type === 'invoices') {
        rows = await db.monthlyInvoice.findMany({
          where: { periodStart: { gte: range.from, lte: range.to }, ...org },
          orderBy: { periodStart: 'desc' },
          take: EXPORT_LIMIT,
        });
      } else {
        rows = await db.auditLog.findMany({
          where: { createdAt: { gte: range.from, lte: range.to }, ...org },
          orderBy: { createdAt: 'desc' },
          take: EXPORT_LIMIT,
        });
      }

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${type}-${range.from.toISOString().slice(0, 10)}.csv"`)
        .send(toCsv(rows));
    },
  );

  fastify.get<{ Querystring: Static<typeof AuditQuery> }>(
    '/audit-logs',
    { schema: { querystring: AuditQuery } },
    async (request) => {
      const args = pageArgs(request.query);
      const { organizationId, actorId, action, search } = request.query;
      const where: Prisma.AuditLogWhereInput = {
        ...(organizationId ? { organizationId } : {}),
        ...(actorId ? { actorId } : {}),
        ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}),
        ...(search ? { OR: [{ action: { contains: search, mode: 'insensitive' } }, { targetId: { contains: search } }] } : {}),
      };
      const [rows, total] = await Promise.all([
        db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: args.skip, take: args.take }),
        db.auditLog.count({ where }),
      ]);
      return paged(rows, total, args);
    },
  );

  fastify.get<{ Querystring: Static<typeof SessionsQuery> }>(
    '/sessions',
    { schema: { querystring: SessionsQuery } },
    async (request) => {
      const args = pageArgs(request.query);
      const { status, organizationId, search } = request.query;
      const where: Prisma.ChargingSessionWhereInput = {
        ...(status ? { status: status as any } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(search ? { OR: [{ stationId: { contains: search, mode: 'insensitive' } }, { ocppTransactionId: { contains: search } }] } : {}),
      };
      const [rows, total] = await Promise.all([
        db.chargingSession.findMany({ where, orderBy: { startTime: 'desc' }, skip: args.skip, take: args.take }),
        db.chargingSession.count({ where }),
      ]);
      return paged(rows, total, args);
    },
  );
};

export default adminReportRoutes;
