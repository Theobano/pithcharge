import { FastifyPluginAsync } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import { auth, fromNodeHeaders } from '@pithcharge/auth';
import { db, Prisma } from '@pithcharge/db';
import { syncTokenToCms } from '../../../../services/token-sync.service';
import { concurrentSessionsAllowed } from '../../../../services/charging/policy';
import { adjustWallet } from '../../../../services/wallet-adjustment.service';
import { getPublicNetworkOrganizationId } from '../../../../services/public-network.service';
import { PageQuery, auditAdminAction, pageArgs, paged } from '../../../../services/admin.service';

const ListQuery = Type.Intersect([
  PageQuery,
  Type.Object({
    type: Type.Optional(Type.Union([Type.Literal('registered'), Type.Literal('guest'), Type.Literal('all')])),
    role: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('admin')])),
    status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('banned')])),
  }),
]);

const CreateUser = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  email: Type.String({ format: 'email', maxLength: 254 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
  role: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('admin')])),
}, { additionalProperties: false });

const FundUserWallet = Type.Object({
  walletId: Type.Optional(Type.String({ minLength: 1 })),
  amount: Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000 }),
  reason: Type.String({ minLength: 3, maxLength: 300 }),
  idempotencyKey: Type.String({ minLength: 8, maxLength: 100 }),
}, { additionalProperties: false });

const UpdateUser = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  email: Type.Optional(Type.String({ format: 'email', maxLength: 254 })),
  role: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('admin')])),
}, { additionalProperties: false });

const BanUser = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 200 })),
  expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650 })),
}, { additionalProperties: false });

const TokenStatusUpdate = Type.Object({
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('BLOCKED')]),
}, { additionalProperties: false });

const userSummary = {
  id: true,
  name: true,
  email: true,
  role: true,
  banned: true,
  banReason: true,
  banExpires: true,
  isAnonymous: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const adminUserRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requirePlatformAdmin);

  /** Pushes a status to the CMS for every token of a user in the given status; failures are counted, not thrown. */
  async function syncUserTokens(userId: string, from: 'ACTIVE' | 'BLOCKED', to: 'ACTIVE' | 'BLOCKED', isAnonymous: boolean) {
    const tokens = await db.userOcppToken.findMany({ where: { userId, status: from } });
    let failed = 0;
    for (const token of tokens) {
      try {
        const result = await syncTokenToCms(
          fastify.cms,
          { ...token, status: to, concurrentTransaction: concurrentSessionsAllowed(isAnonymous) },
          { force: true },
        );
        await db.userOcppToken.update({ where: { id: token.id }, data: { status: result.status } });
      } catch (error) {
        failed += 1;
        fastify.log.error({ err: error, userId, tokenId: token.id }, 'Admin token sync failed');
      }
    }
    return { total: tokens.length, failed };
  }

  fastify.get<{ Querystring: Static<typeof ListQuery> }>(
    '/users',
    { schema: { querystring: ListQuery } },
    async (request) => {
      const { search, type = 'registered', role, status } = request.query;
      const args = pageArgs(request.query);
      const where: Prisma.UserWhereInput = {
        ...(type === 'registered' ? { isAnonymous: { not: true } } : type === 'guest' ? { isAnonymous: true } : {}),
        ...(role ? { role } : {}),
        ...(status === 'banned' ? { banned: true } : status === 'active' ? { banned: { not: true } } : {}),
        ...(search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: args.skip,
          take: args.take,
          select: {
            ...userSummary,
            members: { select: { role: true, organization: { select: { id: true, name: true } } } },
            _count: { select: { chargingSessions: true } },
          },
        }),
        db.user.count({ where }),
      ]);
      return paged(rows, total, args);
    },
  );

  fastify.post<{ Body: Static<typeof CreateUser> }>(
    '/users',
    { schema: { body: CreateUser } },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();
      if (await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) {
        return reply.code(409).send({ code: 'USER_EXISTS', message: 'A user with this email already exists.' });
      }
      // Better Auth hashes the password and its user-create hook issues and registers the charging token.
      const adminApi = auth.api as unknown as {
        createUser: (input: {
          body: { email: string; password: string; name: string; role: string };
          headers: Headers;
        }) => Promise<{ user: { id: string } }>;
      };
      const created = await adminApi.createUser({
        body: { email, password: request.body.password, name: request.body.name, role: request.body.role ?? 'user' },
        headers: fromNodeHeaders(request.headers),
      });
      await auditAdminAction({
        actorId: request.user.id,
        action: 'admin.user.created',
        targetType: 'User',
        targetId: created.user.id,
        metadata: { email, role: request.body.role ?? 'user' },
      });
      return reply.code(201).send({ data: { id: created.user.id, email, name: request.body.name } });
    },
  );

  fastify.get<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const user = await db.user.findUnique({
      where: { id: request.params.id },
      select: {
        ...userSummary,
        phoneNumber: true,
        emailVerified: true,
        members: {
          select: {
            id: true,
            role: true,
            allowNegativeBalance: true,
            negativeBalanceLimit: true,
            organization: { select: { id: true, name: true } },
          },
        },
        tokens: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, idToken: true, nickname: true, tokenType: true, status: true, isDefault: true, lastUsedAt: true },
        },
        chargingSessions: {
          orderBy: { startTime: 'desc' },
          take: 10,
          select: { id: true, stationId: true, status: true, startTime: true, endTime: true, totalKwh: true, totalCost: true, currency: true },
        },
      },
    });
    if (!user) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'User not found.' });

    const [wallets, totals, lastSession] = await Promise.all([
      db.wallet.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          organizationId: true,
          currency: true,
          balance: true,
          reservedBalance: true,
          status: true,
          organization: { select: { name: true, slug: true } },
        },
      }),
      db.chargingSession.aggregate({
        where: { userId: user.id },
        _count: true,
        _sum: { totalKwh: true, totalCost: true },
      }),
      db.session.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, ipAddress: true, userAgent: true },
      }),
    ]);
    return {
      data: {
        ...user,
        wallets,
        totals: { sessions: totals._count, kwh: totals._sum.totalKwh ?? 0, spend: totals._sum.totalCost ?? 0 },
        lastLogin: lastSession,
      },
    };
  });

  // Credits a user's personal wallet. Without a walletId it targets (and creates if needed) the
  // user's public network wallet.
  fastify.post<{ Params: { id: string }; Body: Static<typeof FundUserWallet> }>(
    '/users/:id/wallet/fund',
    { schema: { body: FundUserWallet } },
    async (request, reply) => {
      const user = await db.user.findUnique({ where: { id: request.params.id }, select: { id: true, isAnonymous: true } });
      if (!user) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'User not found.' });
      if (user.isAnonymous) return reply.code(409).send({ message: 'Guest users cannot hold a wallet.' });

      let wallet: { id: string; organizationId: string };
      if (request.body.walletId) {
        const found = await db.wallet.findFirst({
          where: { id: request.body.walletId, userId: user.id },
          select: { id: true, organizationId: true },
        });
        if (!found) return reply.code(404).send({ message: 'Wallet not found for this user.' });
        wallet = found;
      } else {
        const organizationId = await getPublicNetworkOrganizationId();
        const policy = await db.billingPolicy.findUniqueOrThrow({ where: { organizationId }, select: { currency: true } });
        wallet = await db.wallet.upsert({
          where: { organizationId_currency_scopeKey: { organizationId, currency: policy.currency, scopeKey: user.id } },
          create: { organizationId, userId: user.id, currency: policy.currency, scopeKey: user.id },
          update: {},
          select: { id: true, organizationId: true },
        });
      }

      const result = await adjustWallet({
        organizationId: wallet.organizationId,
        walletId: wallet.id,
        actorId: request.user.id,
        amount: Math.abs(request.body.amount),
        reason: request.body.reason,
        idempotencyKey: request.body.idempotencyKey,
      });
      if (!result.ok) return reply.code(result.status).send({ message: result.message });
      return { success: true, duplicate: result.duplicate, balance: result.balance };
    },
  );

  fastify.patch<{ Params: { id: string }; Body: Static<typeof UpdateUser> }>(
    '/users/:id',
    { schema: { body: UpdateUser } },
    async (request, reply) => {
      const { id } = request.params;
      if (id === request.user.id && request.body.role && request.body.role !== 'admin') {
        return reply.code(409).send({ code: 'CANNOT_DEMOTE_SELF', message: 'You cannot remove your own administrator role.' });
      }
      try {
        const updated = await db.user.update({
          where: { id },
          data: { ...request.body, ...(request.body.email ? { email: request.body.email.toLowerCase() } : {}) },
          select: userSummary,
        });
        await auditAdminAction({
          actorId: request.user.id,
          action: 'admin.user.updated',
          targetType: 'User',
          targetId: id,
          metadata: { ...request.body },
        });
        return { data: updated };
      } catch (error) {
        if ((error as { code?: string }).code === 'P2025') {
          return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'User not found.' });
        }
        if ((error as { code?: string }).code === 'P2002') {
          return reply.code(409).send({ code: 'USER_EXISTS', message: 'Another user already uses this email.' });
        }
        throw error;
      }
    },
  );

  fastify.post<{ Params: { id: string }; Body: Static<typeof BanUser> }>(
    '/users/:id/ban',
    { schema: { body: BanUser } },
    async (request, reply) => {
      const { id } = request.params;
      if (id === request.user.id) {
        return reply.code(409).send({ code: 'CANNOT_BAN_SELF', message: 'You cannot suspend your own account.' });
      }
      const target = await db.user.findUnique({ where: { id }, select: { id: true, isAnonymous: true } });
      if (!target) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'User not found.' });

      const expires = request.body.expiresInDays
        ? new Date(Date.now() + request.body.expiresInDays * 86_400_000)
        : null;
      await db.$transaction([
        db.user.update({ where: { id }, data: { banned: true, banReason: request.body.reason ?? null, banExpires: expires } }),
        db.session.deleteMany({ where: { userId: id } }),
      ]);
      // A suspended account must not be able to start sessions at a charger either.
      const tokens = await syncUserTokens(id, 'ACTIVE', 'BLOCKED', Boolean(target.isAnonymous));
      await auditAdminAction({
        actorId: request.user.id,
        action: 'admin.user.banned',
        targetType: 'User',
        targetId: id,
        metadata: { reason: request.body.reason ?? null, expires: expires?.toISOString() ?? null },
      });
      return { success: true, tokens };
    },
  );

  fastify.post<{ Params: { id: string } }>('/users/:id/unban', async (request, reply) => {
    const { id } = request.params;
    const target = await db.user.findUnique({ where: { id }, select: { id: true, isAnonymous: true } });
    if (!target) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    await db.user.update({ where: { id }, data: { banned: false, banReason: null, banExpires: null } });
    const tokens = await syncUserTokens(id, 'BLOCKED', 'ACTIVE', Boolean(target.isAnonymous));
    await auditAdminAction({ actorId: request.user.id, action: 'admin.user.unbanned', targetType: 'User', targetId: id });
    return { success: true, tokens };
  });

  fastify.post<{ Params: { id: string } }>('/users/:id/revoke-sessions', async (request) => {
    const result = await db.session.deleteMany({ where: { userId: request.params.id } });
    await auditAdminAction({
      actorId: request.user.id,
      action: 'admin.user.sessions_revoked',
      targetType: 'User',
      targetId: request.params.id,
      metadata: { count: result.count },
    });
    return { success: true, revoked: result.count };
  });

  fastify.patch<{ Params: { id: string; tokenId: string }; Body: Static<typeof TokenStatusUpdate> }>(
    '/users/:id/tokens/:tokenId',
    { schema: { body: TokenStatusUpdate } },
    async (request, reply) => {
      const token = await db.userOcppToken.findFirst({
        where: { id: request.params.tokenId, userId: request.params.id },
        include: { user: { select: { isAnonymous: true } } },
      });
      if (!token) return reply.code(404).send({ code: 'TOKEN_NOT_FOUND', message: 'Charging token not found.' });
      try {
        const result = await syncTokenToCms(
          fastify.cms,
          {
            idToken: token.idToken,
            tokenType: token.tokenType,
            status: request.body.status,
            concurrentTransaction: concurrentSessionsAllowed(Boolean(token.user.isAnonymous)),
          },
          { force: true },
        );
        await db.userOcppToken.update({ where: { id: token.id }, data: { status: result.status } });
        await auditAdminAction({
          actorId: request.user.id,
          action: 'admin.token.status_changed',
          targetType: 'UserOcppToken',
          targetId: token.id,
          metadata: { status: result.status },
        });
        return { data: { id: token.id, status: result.status } };
      } catch (error) {
        fastify.log.error({ err: error, tokenId: token.id }, 'Admin token status change failed');
        return reply.code(502).send({ code: 'TOKEN_SYNC_FAILED', message: 'The charging network rejected the token change.' });
      }
    },
  );
};

export default adminUserRoutes;
