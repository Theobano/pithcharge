import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import { db, Prisma } from '@pithcharge/db';
import { PageQuery, auditAdminAction, pageArgs, paged, slugify } from '../../../../services/admin.service';
import { PolicyUpdate, getOrCreatePolicy, updateBillingPolicy } from '../../../../services/billing-policy.service';
import { currentBillingPeriod } from '../../../../services/invoice.service';
import { enqueueManualInvoice, getManualInvoiceJob } from '@pithcharge/jobs';
import { adjustWallet } from '../../../../services/wallet-adjustment.service';
import {
  createRateRule, deleteRateRule, listRateRules, updateRateRule,
  RateRuleInput, RateRulePatch, RateRuleInputType,
} from '../../../../services/rate-rule.service';

const MemberRole = Type.Union([Type.Literal('admin'), Type.Literal('user'), Type.Literal('auditor')]);

const CreateOrganization = Type.Object({
  name: Type.String({ minLength: 2, maxLength: 80 }),
  slug: Type.Optional(Type.String({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 48 })),
  ownerEmail: Type.Optional(Type.String({ format: 'email' })),
  policy: Type.Optional(PolicyUpdate),
}, { additionalProperties: false });

const UpdateOrganization = Type.Object({
  name: Type.Optional(Type.String({ minLength: 2, maxLength: 80 })),
  slug: Type.Optional(Type.String({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 48 })),
  logo: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
}, { additionalProperties: false });

const AddMember = Type.Object({
  email: Type.String({ format: 'email' }),
  role: MemberRole,
}, { additionalProperties: false });

const UpdateMember = Type.Object({
  role: Type.Optional(MemberRole),
  allowNegativeBalance: Type.Optional(Type.Boolean()),
  negativeBalanceLimit: Type.Optional(Type.Number({ minimum: 0, maximum: 1_000_000 })),
  billingWalletId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
}, { additionalProperties: false });

const AdjustWallet = Type.Object({
  amount: Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
  reason: Type.String({ minLength: 3, maxLength: 200 }),
  idempotencyKey: Type.String({ minLength: 8, maxLength: 120 }),
}, { additionalProperties: false });

const WalletStatusUpdate = Type.Object({
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('FROZEN'), Type.Literal('CLOSED')]),
}, { additionalProperties: false });

const notFound = { code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found.' };

const adminOrganizationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requirePlatformAdmin);

  fastify.get<{ Querystring: Static<typeof PageQuery> }>(
    '/organizations',
    { schema: { querystring: PageQuery } },
    async (request) => {
      const args = pageArgs(request.query);
      const where: Prisma.OrganizationWhereInput = request.query.search
        ? {
            OR: [
              { name: { contains: request.query.search, mode: 'insensitive' } },
              { slug: { contains: request.query.search, mode: 'insensitive' } },
            ],
          }
        : {};
      const [rows, total] = await Promise.all([
        db.organization.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: args.skip,
          take: args.take,
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            createdAt: true,
            _count: { select: { members: true } },
            billingPolicy: {
              select: { billingMode: true, walletSharingMode: true, currency: true, allowNegativeBalance: true, monthlyMinimumSpend: true },
            },
          },
        }),
        db.organization.count({ where }),
      ]);
      const balances = await db.wallet.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: rows.map((row: { id: string }) => row.id) } },
        _sum: { balance: true, reservedBalance: true },
      });
      const byOrganization = new Map<string, { balance: string; reserved: string }>(
        balances.map((item: { organizationId: string; _sum: { balance: Prisma.Decimal | null; reservedBalance: Prisma.Decimal | null } }) => [
          item.organizationId,
          { balance: (item._sum.balance ?? 0).toString(), reserved: (item._sum.reservedBalance ?? 0).toString() },
        ]),
      );
      return paged(
        rows.map((row: { id: string }) => ({ ...row, wallets: byOrganization.get(row.id) ?? { balance: '0', reserved: '0' } })),
        total,
        args,
      );
    },
  );

  fastify.post<{ Body: Static<typeof CreateOrganization> }>(
    '/organizations',
    { schema: { body: CreateOrganization } },
    async (request, reply) => {
      const { name, ownerEmail, policy } = request.body;
      const slug = request.body.slug ?? (`${slugify(name) || 'organization'}-${randomUUID().slice(0, 6)}`);
      if (await db.organization.findUnique({ where: { slug }, select: { id: true } })) {
        return reply.code(409).send({ code: 'SLUG_TAKEN', message: 'This organization slug is already in use.' });
      }
      const owner = ownerEmail
        ? await db.user.findFirst({
            where: { email: { equals: ownerEmail, mode: 'insensitive' }, isAnonymous: { not: true } },
            select: { id: true },
          })
        : null;
      if (ownerEmail && !owner) {
        return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'No registered user has this email address.' });
      }

      const organization = await db.$transaction(async (transaction: Prisma.TransactionClient) => {
        const created = await transaction.organization.create({
          data: { name, slug, createdAt: new Date() },
          select: { id: true, name: true, slug: true },
        });
        await transaction.billingPolicy.create({
          data: { organizationId: created.id, ...policy, updatedBy: request.user.id },
        });
        if (owner) {
          await transaction.member.create({
            data: { organizationId: created.id, userId: owner.id, role: 'owner', createdAt: new Date() },
          });
        }
        await transaction.auditLog.create({
          data: {
            actorId: request.user.id,
            organizationId: created.id,
            action: 'admin.organization.created',
            targetType: 'Organization',
            targetId: created.id,
            metadata: { name, ownerEmail: ownerEmail ?? null, byPlatformAdmin: true },
          },
        });
        return created;
      });
      return reply.code(201).send({ data: organization });
    },
  );

  fastify.get<{ Params: { id: string } }>('/organizations/:id', async (request, reply) => {
    const { id } = request.params;
    const organization = await db.organization.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, logo: true, createdAt: true },
    });
    if (!organization) return reply.code(404).send(notFound);

    const policy = await getOrCreatePolicy(id);
    const period = currentBillingPeriod(policy);
    const [members, wallets, usage, invoices] = await Promise.all([
      db.member.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          billingWalletId: true,
          allowNegativeBalance: true,
          negativeBalanceLimit: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, banned: true } },
        },
      }),
      db.wallet.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, label: true, scopeKey: true, currency: true, balance: true, reservedBalance: true, status: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      db.chargingSession.aggregate({
        where: { organizationId: id, startTime: { gte: period.start, lt: period.end } },
        _count: true,
        _sum: { totalKwh: true, totalCost: true },
      }),
      db.monthlyInvoice.findMany({ where: { organizationId: id }, orderBy: { periodStart: 'desc' }, take: 6 }),
    ]);
    return {
      data: {
        organization,
        policy,
        members,
        wallets,
        invoices,
        rateRules: await listRateRules(id),
        currentPeriod: { start: period.start, end: period.end, sessions: usage._count, kwh: usage._sum.totalKwh ?? 0, spend: (usage._sum.totalCost ?? 0).toString() },
      },
    };
  });

  fastify.patch<{ Params: { id: string }; Body: Static<typeof UpdateOrganization> }>(
    '/organizations/:id',
    { schema: { body: UpdateOrganization } },
    async (request, reply) => {
      try {
        const updated = await db.organization.update({
          where: { id: request.params.id },
          data: request.body,
          select: { id: true, name: true, slug: true, logo: true },
        });
        await auditAdminAction({
          actorId: request.user.id,
          organizationId: updated.id,
          action: 'admin.organization.updated',
          targetType: 'Organization',
          targetId: updated.id,
          metadata: { ...request.body },
        });
        return { data: updated };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'P2025') return reply.code(404).send(notFound);
        if (code === 'P2002') return reply.code(409).send({ code: 'SLUG_TAKEN', message: 'This organization slug is already in use.' });
        throw error;
      }
    },
  );

  fastify.delete<{ Params: { id: string } }>('/organizations/:id', async (request, reply) => {
    const { id } = request.params;
    if (!(await db.organization.findUnique({ where: { id }, select: { id: true } }))) {
      return reply.code(404).send(notFound);
    }
    const [ledger, openSessions, funded] = await Promise.all([
      db.ledgerTransaction.count({ where: { organizationId: id } }),
      db.chargingSession.count({ where: { organizationId: id, status: { in: ['PENDING', 'ACTIVE'] } } }),
      db.wallet.count({ where: { organizationId: id, OR: [{ balance: { not: 0 } }, { reservedBalance: { not: 0 } }] } }),
    ]);
    if (ledger > 0 || openSessions > 0 || funded > 0) {
      return reply.code(409).send({
        code: 'ORGANIZATION_HAS_ACTIVITY',
        message: 'Organizations with financial history, funded wallets or live sessions cannot be deleted. Remove the members instead.',
      });
    }
    await db.session.updateMany({ where: { activeOrganizationId: id }, data: { activeOrganizationId: null } });
    await db.organization.delete({ where: { id } });
    await auditAdminAction({ actorId: request.user.id, action: 'admin.organization.deleted', targetType: 'Organization', targetId: id });
    return { success: true };
  });

  fastify.patch<{ Params: { id: string }; Body: Static<typeof PolicyUpdate> }>(
    '/organizations/:id/policy',
    { schema: { body: PolicyUpdate } },
    async (request, reply) => {
      if (!(await db.organization.findUnique({ where: { id: request.params.id }, select: { id: true } }))) {
        return reply.code(404).send(notFound);
      }
      const result = await updateBillingPolicy(request.params.id, request.body, { id: request.user.id, isPlatformAdmin: true });
      if (!result.ok) return reply.code(result.status).send({ message: result.message });
      return { data: result.policy };
    },
  );

  fastify.post<{ Params: { id: string } }>('/organizations/:id/invoices', async (request, reply) => {
    if (!(await db.organization.findUnique({ where: { id: request.params.id }, select: { id: true } }))) {
      return reply.code(404).send(notFound);
    }
    const boss = await fastify.jobs();
    const jobId = await enqueueManualInvoice(boss, {
      organizationId: request.params.id,
      issuedBy: request.user.id,
    });
    if (!jobId) {
      return reply.code(409).send({ message: 'An invoice run was just requested for this organization.' });
    }
    return reply.code(202).send({ data: { jobId } });
  });

  fastify.get<{ Params: { id: string; jobId: string } }>(
    '/organizations/:id/invoices/jobs/:jobId',
    async (request, reply) => {
      const job = await getManualInvoiceJob(await fastify.jobs(), request.params.jobId);
      if (!job || job.organizationId !== request.params.id) return reply.code(404).send(notFound);
      return { data: job };
    },
  );

  fastify.post<{ Params: { id: string }; Body: RateRuleInputType }>(
    '/organizations/:id/rate-rules',
    { schema: { body: RateRuleInput } },
    async (request, reply) => {
      if (!(await db.organization.findUnique({ where: { id: request.params.id }, select: { id: true } }))) {
        return reply.code(404).send(notFound);
      }
      const result = await createRateRule(request.params.id, request.body, request.user.id);
      if (!result.ok) return reply.code(result.status).send({ message: result.message });
      return reply.code(201).send({ data: result.value });
    },
  );

  fastify.patch<{ Params: { id: string; ruleId: string }; Body: Partial<RateRuleInputType> }>(
    '/organizations/:id/rate-rules/:ruleId',
    { schema: { body: RateRulePatch } },
    async (request, reply) => {
      const result = await updateRateRule(request.params.id, request.params.ruleId, request.body, request.user.id);
      if (!result.ok) return reply.code(result.status).send({ message: result.message });
      return { data: result.value };
    },
  );

  fastify.delete<{ Params: { id: string; ruleId: string } }>(
    '/organizations/:id/rate-rules/:ruleId',
    async (request, reply) => {
      const result = await deleteRateRule(request.params.id, request.params.ruleId, request.user.id);
      if (!result.ok) return reply.code(result.status).send({ message: result.message });
      return reply.code(204).send();
    },
  );

  fastify.post<{ Params: { id: string }; Body: Static<typeof AddMember> }>(
    '/organizations/:id/members',
    { schema: { body: AddMember } },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await db.organization.findUnique({ where: { id }, select: { id: true } }))) {
        return reply.code(404).send(notFound);
      }
      const user = await db.user.findFirst({
        where: { email: { equals: request.body.email, mode: 'insensitive' }, isAnonymous: { not: true } },
        select: { id: true },
      });
      if (!user) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'No registered user has this email address.' });
      if (await db.member.findFirst({ where: { organizationId: id, userId: user.id }, select: { id: true } })) {
        return reply.code(409).send({ code: 'ALREADY_MEMBER', message: 'This user is already a member of the organization.' });
      }
      const member = await db.member.create({
        data: { organizationId: id, userId: user.id, role: request.body.role, createdAt: new Date() },
        select: { id: true, role: true },
      });
      await auditAdminAction({
        actorId: request.user.id,
        organizationId: id,
        action: 'admin.member.added',
        targetType: 'Member',
        targetId: member.id,
        metadata: { userId: user.id, role: request.body.role },
      });
      return reply.code(201).send({ data: member });
    },
  );

  fastify.patch<{ Params: { id: string; memberId: string }; Body: Static<typeof UpdateMember> }>(
    '/organizations/:id/members/:memberId',
    { schema: { body: UpdateMember } },
    async (request, reply) => {
      const { id, memberId } = request.params;
      const member = await db.member.findFirst({ where: { id: memberId, organizationId: id } });
      if (!member) return reply.code(404).send({ code: 'MEMBER_NOT_FOUND', message: 'Organization member not found.' });
      const changes = request.body;
      if (changes.role && member.role === 'owner') {
        return reply.code(409).send({ code: 'OWNER_ROLE_LOCKED', message: 'The organization owner role cannot be changed.' });
      }
      const allowNegative = changes.allowNegativeBalance ?? member.allowNegativeBalance;
      const limit = changes.negativeBalanceLimit ?? (member.negativeBalanceLimit?.toNumber() ?? 0);
      if (allowNegative && limit <= 0) {
        return reply.code(400).send({ code: 'LIMIT_REQUIRED', message: 'A positive negative-balance limit is required when credit is enabled.' });
      }
      if (changes.billingWalletId) {
        const wallet = await db.wallet.findFirst({
          where: { id: changes.billingWalletId, organizationId: id, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!wallet) return reply.code(404).send({ code: 'WALLET_NOT_FOUND', message: 'Active organization wallet not found.' });
      }
      const updated = await db.member.update({
        where: { id: memberId },
        data: { ...changes, ...(allowNegative ? {} : { negativeBalanceLimit: 0 }) },
        select: { id: true, role: true, allowNegativeBalance: true, negativeBalanceLimit: true, billingWalletId: true },
      });
      await auditAdminAction({
        actorId: request.user.id,
        organizationId: id,
        action: 'admin.member.updated',
        targetType: 'Member',
        targetId: memberId,
        metadata: { ...changes },
      });
      return { data: updated };
    },
  );

  fastify.delete<{ Params: { id: string; memberId: string } }>(
    '/organizations/:id/members/:memberId',
    async (request, reply) => {
      const { id, memberId } = request.params;
      const member = await db.member.findFirst({ where: { id: memberId, organizationId: id } });
      if (!member) return reply.code(404).send({ code: 'MEMBER_NOT_FOUND', message: 'Organization member not found.' });
      if (member.role === 'owner') {
        return reply.code(409).send({ code: 'OWNER_ROLE_LOCKED', message: 'The organization owner cannot be removed.' });
      }
      await db.$transaction([
        db.member.delete({ where: { id: memberId } }),
        db.session.updateMany({ where: { userId: member.userId, activeOrganizationId: id }, data: { activeOrganizationId: null } }),
      ]);
      await auditAdminAction({
        actorId: request.user.id,
        organizationId: id,
        action: 'admin.member.removed',
        targetType: 'Member',
        targetId: memberId,
        metadata: { userId: member.userId },
      });
      return { success: true };
    },
  );

  fastify.post<{ Params: { id: string; walletId: string }; Body: Static<typeof AdjustWallet> }>(
    '/organizations/:id/wallets/:walletId/adjust',
    { schema: { body: AdjustWallet } },
    async (request, reply) => {
      const result = await adjustWallet({
        organizationId: request.params.id,
        walletId: request.params.walletId,
        actorId: request.user.id,
        ...request.body,
      });
      if (!result.ok) return reply.code(result.status).send({ message: result.message });
      return { success: true, duplicate: result.duplicate, balance: result.balance };
    },
  );

  fastify.patch<{ Params: { id: string; walletId: string }; Body: Static<typeof WalletStatusUpdate> }>(
    '/organizations/:id/wallets/:walletId',
    { schema: { body: WalletStatusUpdate } },
    async (request, reply) => {
      const wallet = await db.wallet.findFirst({ where: { id: request.params.walletId, organizationId: request.params.id } });
      if (!wallet) return reply.code(404).send({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
      if (request.body.status === 'CLOSED' && (!wallet.balance.isZero() || !wallet.reservedBalance.isZero())) {
        return reply.code(409).send({ code: 'WALLET_NOT_EMPTY', message: 'Only empty wallets can be closed.' });
      }
      const updated = await db.wallet.update({
        where: { id: wallet.id },
        data: { status: request.body.status },
        select: { id: true, status: true },
      });
      await auditAdminAction({
        actorId: request.user.id,
        organizationId: request.params.id,
        action: 'admin.wallet.status_changed',
        targetType: 'Wallet',
        targetId: wallet.id,
        metadata: { status: request.body.status },
      });
      return { data: updated };
    },
  );

  fastify.get<{ Params: { id: string }; Querystring: Static<typeof PageQuery> }>(
    '/organizations/:id/ledger',
    { schema: { querystring: PageQuery } },
    async (request) => {
      const args = pageArgs(request.query);
      const where = { organizationId: request.params.id };
      const [rows, total] = await Promise.all([
        db.ledgerTransaction.findMany({
          where,
          orderBy: { postedAt: 'desc' },
          skip: args.skip,
          take: args.take,
          include: { entries: { select: { direction: true, amount: true, account: { select: { code: true, type: true } } } } },
        }),
        db.ledgerTransaction.count({ where }),
      ]);
      return paged(rows, total, args);
    },
  );

  fastify.get<{ Params: { id: string }; Querystring: Static<typeof PageQuery> }>(
    '/organizations/:id/sessions',
    { schema: { querystring: PageQuery } },
    async (request) => {
      const args = pageArgs(request.query);
      const where: Prisma.ChargingSessionWhereInput = {
        organizationId: request.params.id,
        ...(request.query.search ? { stationId: { contains: request.query.search, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        db.chargingSession.findMany({
          where,
          orderBy: { startTime: 'desc' },
          skip: args.skip,
          take: args.take,
          select: {
            id: true, stationId: true, status: true, startTime: true, endTime: true,
            totalKwh: true, totalCost: true, currency: true,
            user: { select: { id: true, name: true, email: true } },
          },
        }),
        db.chargingSession.count({ where }),
      ]);
      return paged(rows, total, args);
    },
  );

  fastify.get<{ Params: { id: string }; Querystring: Static<typeof PageQuery> }>(
    '/organizations/:id/audit-logs',
    { schema: { querystring: PageQuery } },
    async (request) => {
      const args = pageArgs(request.query);
      const where: Prisma.AuditLogWhereInput = {
        organizationId: request.params.id,
        ...(request.query.search ? { action: { contains: request.query.search, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        db.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: args.skip,
          take: args.take,
          select: {
            id: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true,
            actor: { select: { id: true, name: true, email: true } },
          },
        }),
        db.auditLog.count({ where }),
      ]);
      return paged(rows, total, args);
    },
  );
};

export default adminOrganizationRoutes;
