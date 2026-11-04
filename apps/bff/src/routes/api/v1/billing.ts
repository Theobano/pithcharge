import { createHash, randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import { db, Prisma } from '@pithcharge/db';
import {
  getOrCreateLedgerAccount,
  getOrCreateWallet,
  money,
  postBalancedLedgerTransaction,
} from '../../../services/financial.service';
import { createUserNotification } from '../../../services/notification.service';
import { getPublicNetworkOrganizationId } from '../../../services/public-network.service';
import {
  createRateRule, deleteRateRule, listRateRules, updateRateRule,
  RateRuleInput, RateRulePatch, RateRuleInputType,
} from '../../../services/rate-rule.service';
import { enqueueManualInvoice, getManualInvoiceJob, QUEUES } from '@pithcharge/jobs';
import { updateBillingPolicy, PolicyUpdate, BillingPolicyChanges as PolicyUpdateInput } from '../../../services/billing-policy.service';

const TopUpRequest = Type.Object({
  amount: Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000 }),
  paymentToken: Type.String({ minLength: 4, maxLength: 256 }),
  idempotencyKey: Type.String({ minLength: 8, maxLength: 120 }),
}, { additionalProperties: false });

const CheckoutRequest = Type.Object({
  amount: Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000 }),
  provider: Type.String({ minLength: 2, maxLength: 32 }),
  idempotencyKey: Type.String({ minLength: 8, maxLength: 120 }),
}, { additionalProperties: false });

const CreateWallet = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
}, { additionalProperties: false });

const AssignWallet = Type.Object({
  walletId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
}, { additionalProperties: false });

type BillingContext = {
  organizationId: string;
  member: { id: string; billingWalletId: string | null } | null;
  canManage: boolean;
  /** True when the user has no active organization and uses a personal wallet on the public network. */
  publicNetwork: boolean;
};

async function getBillingContext(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<BillingContext | null> {
  const organizationId = request.user.organizationId;
  if (!organizationId) {
    return {
      organizationId: await getPublicNetworkOrganizationId(),
      member: null,
      canManage: false,
      publicNetwork: true,
    };
  }

  const member = await db.member.findFirst({
    where: { organizationId, userId: request.user.id },
    select: { id: true, billingWalletId: true },
  });
  if (!member && request.user.role !== 'admin') {
    reply.code(403).send({ error: 'You are not a member of this organization.' });
    return null;
  }
  return {
    organizationId,
    member,
    canManage: request.user.role === 'admin' || request.user.organizationRole === 'admin',
    publicNetwork: false,
  };
}

async function getPolicy(organizationId: string) {
  return db.billingPolicy.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}

function resolveWallet(
  transaction: Prisma.TransactionClient,
  context: BillingContext,
  userId: string,
  policy: {
    currency: string;
    walletSharingMode: 'SHARED' | 'INDIVIDUAL' | 'MIXED';
  },
) {
  return getOrCreateWallet(transaction, {
    organizationId: context.organizationId,
    userId,
    currency: policy.currency,
    sharingMode: policy.walletSharingMode,
    assignedWalletId: context.member?.billingWalletId,
  });
}

async function findWallet(
  context: BillingContext,
  userId: string,
  policy: {
    currency: string;
    walletSharingMode: 'SHARED' | 'INDIVIDUAL' | 'MIXED';
  },
) {
  if (policy.walletSharingMode === 'MIXED' && context.member?.billingWalletId) {
    return db.wallet.findFirst({
      where: {
        id: context.member.billingWalletId,
        organizationId: context.organizationId,
        currency: policy.currency,
        status: 'ACTIVE',
      },
    });
  }
  const scopeKey = policy.walletSharingMode === 'SHARED' ? 'shared' : userId;
  return db.wallet.findUnique({
    where: {
      organizationId_currency_scopeKey: {
        organizationId: context.organizationId,
        currency: policy.currency,
        scopeKey,
      },
    },
  });
}

async function settleTopUp(
  paymentId: string,
  amount: Prisma.Decimal,
  currency: string,
  providerReference: string,
) {
  return db.$transaction(async (transaction: Prisma.TransactionClient) => {
    const payment = await transaction.paymentTransaction.findUniqueOrThrow({
      where: { id: paymentId },
    });
    if (payment.status === 'CAPTURED') return payment;
    if (payment.status !== 'PENDING') {
      throw new Error('Only pending wallet top-ups can be settled.');
    }

    const wallet = await transaction.wallet.findFirstOrThrow({
      where: {
        id: payment.walletId,
        organizationId: payment.organizationId,
        status: 'ACTIVE',
      },
    });
    const walletAccount = await getOrCreateLedgerAccount(transaction, {
      organizationId: payment.organizationId,
      currency,
      code: `WALLET_${wallet.id}`,
      type: 'WALLET_LIABILITY',
      walletId: wallet.id,
    });
    const clearingAccount = await getOrCreateLedgerAccount(transaction, {
      organizationId: payment.organizationId,
      currency,
      code: `${payment.provider.toUpperCase()}_CLEARING`,
      type: 'PAYMENT_CLEARING',
    });

    await postBalancedLedgerTransaction(transaction, {
      idempotencyKey: `wallet-topup:${payment.id}`,
      organizationId: payment.organizationId,
      referenceType: 'WALLET_TOP_UP',
      referenceId: payment.id,
      description: 'Wallet top-up',
      currency,
      entries: [
        { accountId: clearingAccount.id, direction: 'DEBIT', amount },
        { accountId: walletAccount.id, direction: 'CREDIT', amount },
      ],
    });

    await transaction.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: amount } },
    });
    const captured = await transaction.paymentTransaction.update({
      where: { id: payment.id },
      data: { status: 'CAPTURED', providerReference },
    });
    await transaction.auditLog.create({
      data: {
        actorId: payment.userId,
        organizationId: payment.organizationId,
        action: 'billing.wallet.top_up',
        targetType: 'Wallet',
        targetId: wallet.id,
        metadata: { paymentId: payment.id, amount: amount.toString(), currency, providerReference },
      },
    });
    return captured;
  });
}

async function reconcileTopUp(
  fastify: FastifyInstance,
  payment: Awaited<ReturnType<typeof db.paymentTransaction.findUniqueOrThrow>>,
) {
  if (payment.status !== 'PENDING' || !payment.providerReference) {
    return { status: payment.status, message: undefined };
  }
  const adapter = fastify.billing.get(payment.provider);
  if (!adapter) {
    return { status: 'PENDING', message: `Payment provider ${payment.provider} is not enabled.` };
  }
  const verified = await adapter.verifyCharge(payment.providerReference);
  if (verified.status === 'PENDING') return { status: 'PENDING', message: undefined };
  if (verified.status === 'FAILED') {
    await db.paymentTransaction.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureMessage: 'Payment provider verification reported failure.' },
    });
    return { status: 'FAILED', message: 'Payment provider verification reported failure.' };
  }
  if (
    verified.amount === undefined ||
    verified.currency?.toUpperCase() !== payment.currency ||
    !money(verified.amount).equals(payment.amount)
  ) {
    fastify.log.error(
      {
        paymentId: payment.id,
        expectedAmount: payment.amount.toString(),
        verifiedAmount: verified.amount,
        expectedCurrency: payment.currency,
        verifiedCurrency: verified.currency,
      },
      'Verified payment does not match pending wallet top-up',
    );
    return {
      status: 'PENDING',
      message: 'Payment requires manual reconciliation due to provider amount mismatch.',
    };
  }
  await settleTopUp(payment.id, payment.amount, payment.currency, payment.providerReference);
  return { status: 'CAPTURED', message: undefined };
}

const billingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/billing/me', { preHandler: [fastify.requireRegistered] }, async (request, reply) => {
    const context = await getBillingContext(request, reply);
    if (!context) return;
    const policy = await getPolicy(context.organizationId);
    const wallet = context.canManage
      ? await findWallet(context, request.user.id, policy)
      : await db.$transaction((transaction: Prisma.TransactionClient) =>
          resolveWallet(transaction, context, request.user.id, policy),
        );
    return {
      success: true,
      data: {
        policy,
        wallet: {
          id: wallet?.id ?? null,
          currency: wallet?.currency ?? policy.currency,
          balance: wallet?.balance ?? new Prisma.Decimal(0),
          reservedBalance: wallet?.reservedBalance ?? new Prisma.Decimal(0),
          availableBalance: wallet ? wallet.balance.minus(wallet.reservedBalance) : new Prisma.Decimal(0),
          status: wallet?.status ?? 'ACTIVE',
        },
        rateRules: await listRateRules(context.organizationId),
        canManage: context.canManage,
        publicNetwork: context.publicNetwork,
        canSetBillingMode: request.user.role === 'admin',
        canTopUp: (wallet?.status ?? 'ACTIVE') === 'ACTIVE' && request.user.organizationRole !== 'auditor',
      },
    };
  });

  fastify.get('/billing/ledger', { preHandler: [fastify.requireRegistered] }, async (request, reply) => {
    const context = await getBillingContext(request, reply);
    if (!context) return;
    const policy = await getPolicy(context.organizationId);
    const wallet = context.canManage ? null : await findWallet(context, request.user.id, policy);
    if (!context.canManage && !wallet) return { success: true, data: [] };
    const walletFilter = context.canManage
      ? { organizationId: context.organizationId }
      : { id: wallet!.id };
    const rows = await db.ledgerTransaction.findMany({
      where: {
        organizationId: context.organizationId,
        entries: { some: { account: { wallet: walletFilter } } },
      },
      orderBy: { postedAt: 'desc' },
      take: 100,
      include: {
        entries: {
          where: { account: { wallet: walletFilter } },
          select: { direction: true, amount: true, currency: true },
        },
      },
    });
    return { success: true, data: rows };
  });

  fastify.patch(
    '/billing/policy',
    {
      preHandler: [fastify.requirePlatformAdmin],
      schema: { body: PolicyUpdate },
    },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      const result = await updateBillingPolicy(context.organizationId, request.body as PolicyUpdateInput, {
        id: request.user.id,
        isPlatformAdmin: request.user.role === 'admin',
      });
      if (!result.ok) return reply.code(result.status).send({ error: result.message });
      return { success: true, data: result.policy };
    },
  );

  const manageRules = { preHandler: [fastify.requirePlatformAdmin] };

  fastify.post('/billing/rate-rules', { ...manageRules, schema: { body: RateRuleInput } }, async (request, reply) => {
    const context = await getBillingContext(request, reply);
    if (!context) return;
    if (!context.canManage) return reply.code(403).send({ error: 'Organization administrator access is required.' });
    const result = await createRateRule(context.organizationId, request.body as RateRuleInputType, request.user.id);
    if (!result.ok) return reply.code(result.status).send({ error: result.message });
    return reply.code(201).send({ success: true, data: result.value });
  });

  fastify.patch(
    '/billing/rate-rules/:ruleId',
    { ...manageRules, schema: { body: RateRulePatch } },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      if (!context.canManage) return reply.code(403).send({ error: 'Organization administrator access is required.' });
      const { ruleId } = request.params as { ruleId: string };
      const result = await updateRateRule(context.organizationId, ruleId, request.body as Partial<RateRuleInputType>, request.user.id);
      if (!result.ok) return reply.code(result.status).send({ error: result.message });
      return { success: true, data: result.value };
    },
  );

  fastify.delete('/billing/rate-rules/:ruleId', manageRules, async (request, reply) => {
    const context = await getBillingContext(request, reply);
    if (!context) return;
    if (!context.canManage) return reply.code(403).send({ error: 'Organization administrator access is required.' });
    const { ruleId } = request.params as { ruleId: string };
    const result = await deleteRateRule(context.organizationId, ruleId, request.user.id);
    if (!result.ok) return reply.code(result.status).send({ error: result.message });
    return reply.code(204).send();
  });

  fastify.get('/billing/wallets', { preHandler: [fastify.requireRegistered] }, async (request, reply) => {
    const context = await getBillingContext(request, reply);
    if (!context) return;
    if (!context.canManage) return reply.code(403).send({ error: 'Organization administrator access is required.' });
    const wallets = await db.wallet.findMany({
      where: { organizationId: context.organizationId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: { select: { id: true, name: true, email: true } },
        members: { select: { userId: true } },
      },
    });
    return { success: true, data: wallets };
  });

  fastify.post(
    '/billing/wallets',
    {
      preHandler: [fastify.requireRegistered],
      schema: { body: CreateWallet },
    },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      if (!context.canManage) return reply.code(403).send({ error: 'Organization administrator access is required.' });
      const policy = await getPolicy(context.organizationId);
      if (policy.walletSharingMode !== 'MIXED') {
        return reply.code(409).send({ error: 'Additional wallets are only available in mixed wallet mode.' });
      }
      const wallet = await db.wallet.create({
        data: {
          organizationId: context.organizationId,
          label: (request.body as Static<typeof CreateWallet>).name ?? null,
          currency: policy.currency,
          scopeKey: `custom:${randomUUID()}`,
        },
      });
      await db.auditLog.create({
        data: {
          actorId: request.user.id,
          organizationId: context.organizationId,
          action: 'billing.wallet.created',
          targetType: 'Wallet',
          targetId: wallet.id,
          metadata: { name: (request.body as Static<typeof CreateWallet>).name ?? null },
        },
      });
      return reply.code(201).send({ success: true, data: wallet });
    },
  );

  fastify.patch(
    '/billing/members/:userId/wallet',
    {
      preHandler: [fastify.requireRegistered],
      schema: {
        params: Type.Object({ userId: Type.String({ minLength: 1 }) }),
        body: AssignWallet,
      },
    },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      if (!context.canManage) return reply.code(403).send({ error: 'Organization administrator access is required.' });
      const policy = await getPolicy(context.organizationId);
      if (policy.walletSharingMode !== 'MIXED') {
        return reply.code(409).send({ error: 'Member wallet assignments require mixed wallet mode.' });
      }
      const { walletId } = request.body as Static<typeof AssignWallet>;
      const { userId } = request.params as { userId: string };
      const member = await db.member.findFirst({
        where: { organizationId: context.organizationId, userId },
        select: { id: true },
      });
      if (!member) return reply.code(404).send({ error: 'Organization member not found.' });
      if (walletId) {
        const wallet = await db.wallet.findFirst({
          where: {
            id: walletId,
            organizationId: context.organizationId,
            currency: policy.currency,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        if (!wallet) return reply.code(404).send({ error: 'Active organization wallet not found.' });
      }
      const updated = await db.member.update({
        where: { id: member.id },
        data: { billingWalletId: walletId },
        select: { userId: true, billingWalletId: true },
      });
      await db.auditLog.create({
        data: {
          actorId: request.user.id,
          organizationId: context.organizationId,
          action: 'billing.wallet.assigned',
          targetType: 'Member',
          targetId: member.id,
          metadata: { billingWalletId: walletId },
        },
      });
      return { success: true, data: updated };
    },
  );

  fastify.post(
    '/billing/topups',
    {
      preHandler: [fastify.requireRegistered],
      schema: { body: TopUpRequest },
    },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      if (!context.member && !context.publicNetwork) return reply.code(403).send({ error: 'A member wallet is required to top up.' });
      if (request.user.organizationRole === 'auditor') {
        return reply.code(403).send({ error: 'Auditors have view-only access.' });
      }
      const body = request.body as Static<typeof TopUpRequest>;
      const policy = await getPolicy(context.organizationId);
      const amount = money(body.amount);
      if (!amount.equals(body.amount)) {
        return reply.code(400).send({ error: 'Top-up amount can have at most two decimal places.' });
      }
      const wallet = await db.$transaction((transaction: Prisma.TransactionClient) =>
        resolveWallet(transaction, context, request.user.id, policy),
      );
      if (wallet.status !== 'ACTIVE') return reply.code(409).send({ error: 'This wallet is not active.' });

      const digest = createHash('sha256')
        .update(`${context.organizationId}:${request.user.id}:${body.idempotencyKey}`)
        .digest('hex');
      const idempotencyKey = `topup:${digest}`;
      const providerReference = `evtopup-${digest.slice(0, 40)}`;
      let payment = await db.paymentTransaction.findUnique({ where: { idempotencyKey } });
      if (!payment) {
        try {
          payment = await db.paymentTransaction.create({
            data: {
              idempotencyKey,
              provider: fastify.billing.providerName,
              providerReference,
              userId: request.user.id,
              organizationId: context.organizationId,
              walletId: wallet.id,
              amount,
              currency: policy.currency,
              status: 'PENDING',
            },
          });
        } catch (error) {
          if (
            typeof error !== 'object' ||
            error === null ||
            !('code' in error) ||
            error.code !== 'P2002'
          ) throw error;
          payment = await db.paymentTransaction.findUniqueOrThrow({ where: { idempotencyKey } });
        }
      }

      if (
        payment.userId !== request.user.id ||
        payment.walletId !== wallet.id ||
        !payment.amount.equals(amount) ||
        payment.currency !== policy.currency
      ) {
        return reply.code(409).send({ error: 'Idempotency key was already used for a different top-up.' });
      }
      if (payment.status === 'CAPTURED') {
        return reply.send({ success: true, status: payment.status, paymentId: payment.id });
      }
      if (payment.status === 'FAILED') {
        return reply.code(402).send({ success: false, status: payment.status, error: payment.failureMessage ?? 'Payment failed.' });
      }

      const chargeClaim = await db.paymentTransaction.updateMany({
        where: { id: payment.id, status: 'PENDING', chargeAttemptedAt: null },
        data: { chargeAttemptedAt: new Date() },
      });
      if (chargeClaim.count !== 1) {
        try {
          const reconciled = await reconcileTopUp(fastify, payment);
          if (reconciled.status === 'CAPTURED') {
            return reply.send({ success: true, status: reconciled.status, paymentId: payment.id });
          }
          if (reconciled.status === 'FAILED') {
            return reply.code(402).send({
              success: false,
              status: reconciled.status,
              error: reconciled.message,
            });
          }
          return reply.code(202).send({
            success: true,
            status: reconciled.status,
            paymentId: payment.id,
            message: reconciled.message,
          });
        } catch (error) {
          fastify.log.error({ err: error, paymentId: payment.id }, 'Wallet top-up verification failed');
          return reply.code(202).send({ success: true, status: 'PENDING', paymentId: payment.id });
        }
      }

      const charge = await fastify.billing.default().charge({
        amount: Number(amount.toFixed(2)),
        currency: policy.currency,
        paymentToken: body.paymentToken,
        email: request.user.email,
        reference: payment.providerReference!,
      });
      if (charge.providerReference !== payment.providerReference) {
        fastify.log.error(
          {
            paymentId: payment.id,
            expectedReference: payment.providerReference,
            actualReference: charge.providerReference,
          },
          'Payment provider returned a different reference; top-up left pending',
        );
        return reply.code(202).send({ success: true, status: 'PENDING', paymentId: payment.id });
      }

      if (charge.status === 'FAILED') {
        const failed = await db.paymentTransaction.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failureMessage: charge.error ?? 'Provider declined the payment.' },
        });
        return reply.code(402).send({
          success: false,
          status: failed.status,
          error: failed.failureMessage,
        });
      }
      if (charge.status === 'PENDING') {
        return reply.code(202).send({ success: true, status: 'PENDING', paymentId: payment.id });
      }

      try {
        await settleTopUp(payment.id, amount, policy.currency, payment.providerReference!);
      } catch (error) {
        fastify.log.error(
          { err: error, paymentId: payment.id, providerReference: payment.providerReference },
          'Provider charge succeeded but wallet settlement is pending reconciliation',
        );
        return reply.code(202).send({ success: true, status: 'PENDING', paymentId: payment.id });
      }
      try {
        await createUserNotification({
          userId: request.user.id,
          organizationId: context.organizationId,
          eventKey: `wallet-topup:${payment.id}`,
          title: 'Wallet funded',
          body: `${amount.toLocaleString(undefined, {
            style: 'currency',
            currency: policy.currency,
            minimumFractionDigits: 2,
            maximumFractionDigits:2
          })} was added to your wallet.`,
          category: 'paymentUpdates',
          data: { paymentId: payment.id, amount: amount.toString(), currency: policy.currency },
        });
      } catch (error) {
        fastify.log.error({ err: error, paymentId: payment.id }, 'Unable to record wallet top-up notification');
      }
      return reply.send({ success: true, status: 'CAPTURED', paymentId: payment.id });
    },
  );

  fastify.post(
    '/billing/topups/:paymentId/reconcile',
    {
      preHandler: [fastify.requireRegistered],
      schema: { params: Type.Object({ paymentId: Type.String({ minLength: 1 }) }) },
    },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      if (request.user.organizationRole === 'auditor') {
        return reply.code(403).send({ error: 'Auditors have view-only access.' });
      }
      const { paymentId } = request.params as { paymentId: string };
      const payment = await db.paymentTransaction.findFirst({
        where: {
          id: paymentId,
          userId: request.user.id,
        },
      });
      if (!payment) return reply.code(404).send({ error: 'Wallet top-up not found.' });
      if (payment.status !== 'PENDING' || !payment.providerReference) {
        return reply.send({ success: true, status: payment.status });
      }
      try {
        const reconciled = await reconcileTopUp(fastify, payment);
        if (reconciled.status === 'FAILED') {
          return reply.send({ success: true, status: 'FAILED' });
        }
        if (reconciled.status !== 'CAPTURED') {
          return reply.code(202).send({
            success: true,
            status: reconciled.status,
            paymentId: payment.id,
            message: reconciled.message,
          });
        }
      } catch (error) {
        fastify.log.error({ err: error, paymentId: payment.id }, 'Wallet top-up reconciliation failed');
        return reply.code(202).send({ success: true, status: 'PENDING', paymentId: payment.id });
      }
      return reply.send({ success: true, status: 'CAPTURED', paymentId: payment.id });
    },
  );

  fastify.get('/billing/payment-providers', { preHandler: [fastify.requireRegistered] }, async () => ({
    success: true,
    data: fastify.billing.providers(),
  }));

  fastify.post(
    '/billing/topups/checkout',
    {
      preHandler: [fastify.requireRegistered],
      schema: { body: CheckoutRequest },
    },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      if (!context.member && !context.publicNetwork) return reply.code(403).send({ error: 'A member wallet is required to add funds.' });
      if (request.user.organizationRole === 'auditor') {
        return reply.code(403).send({ error: 'Auditors have view-only access.' });
      }
      const body = request.body as Static<typeof CheckoutRequest>;
      const adapter = fastify.billing.get(body.provider);
      if (!adapter) return reply.code(400).send({ error: `Payment provider ${body.provider} is not available.` });

      const policy = await getPolicy(context.organizationId);
      const amount = money(body.amount);
      if (!amount.equals(body.amount)) {
        return reply.code(400).send({ error: 'Amount can have at most two decimal places.' });
      }
      const wallet = await db.$transaction((transaction: Prisma.TransactionClient) =>
        resolveWallet(transaction, context, request.user.id, policy),
      );
      if (wallet.status !== 'ACTIVE') return reply.code(409).send({ error: 'This wallet is not active.' });

      const digest = createHash('sha256')
        .update(`${context.organizationId}:${request.user.id}:${body.idempotencyKey}`)
        .digest('hex');
      const idempotencyKey = `checkout:${digest}`;
      let payment = await db.paymentTransaction.findUnique({ where: { idempotencyKey } });
      if (payment) {
        return reply.code(409).send({
          error: 'This checkout was already started.',
          paymentId: payment.id,
          status: payment.status,
        });
      }
      payment = await db.paymentTransaction.create({
        data: {
          idempotencyKey,
          provider: adapter.providerName,
          providerReference: `evpay-${digest.slice(0, 40)}`,
          userId: request.user.id,
          organizationId: context.organizationId,
          walletId: wallet.id,
          amount,
          currency: policy.currency,
          status: 'PENDING',
          chargeAttemptedAt: new Date(),
        },
      });

      const webAppUrl = (process.env.WEB_APP_URL || 'http://localhost:3100').replace(/\/$/, '');
      try {
        const checkout = await adapter.initializeCheckout({
          amount: Number(amount.toFixed(2)),
          currency: policy.currency,
          email: request.user.email,
          name: request.user.name,
          reference: payment.providerReference!,
          callbackUrl: `${webAppUrl}/payments/return?payment=${payment.id}`,
        });
        return reply.code(201).send({ success: true, data: { paymentId: payment.id, ...checkout } });
      } catch (error) {
        fastify.log.error({ err: error, paymentId: payment.id, provider: adapter.providerName }, 'Checkout initialization failed');
        await db.paymentTransaction.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failureMessage: 'Unable to start checkout with the payment provider.' },
        });
        return reply.code(502).send({ error: 'Unable to start checkout with the payment provider.' });
      }
    },
  );

  // Providers call this when a payment completes. The payload is never trusted: it only triggers
  // a server-side verification of the pending payment it names.
  fastify.post<{ Params: { provider: string } }>('/billing/webhooks/:provider', async (request, reply) => {
    const body = (request.body ?? {}) as { data?: { reference?: string; tx_ref?: string }; txRef?: string; orderRef?: string };
    const reference = body.data?.reference ?? body.data?.tx_ref ?? body.txRef ?? body.orderRef;
    if (typeof reference !== 'string' || !reference) return reply.code(202).send({ received: true });
    const payment = await db.paymentTransaction.findFirst({
      where: { providerReference: reference, provider: request.params.provider, status: 'PENDING' },
    });
    if (payment) {
      try {
        await reconcileTopUp(fastify, payment);
      } catch (error) {
        fastify.log.error({ err: error, paymentId: payment.id }, 'Payment webhook verification failed');
        return reply.code(500).send({ received: false });
      }
    }
    return reply.code(202).send({ received: true });
  });

  fastify.get('/billing/invoices', { preHandler: [fastify.requireRegistered] }, async (request, reply) => {
    const context = await getBillingContext(request, reply);
    if (!context) return;
    const invoices = await db.monthlyInvoice.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { periodStart: 'desc' },
      take: 36,
    });
    return { success: true, data: invoices, canManage: context.canManage };
  });

  fastify.post(
    '/billing/invoices/:invoiceId/pay',
    {
      preHandler: [fastify.requireRegistered],
      schema: { params: Type.Object({ invoiceId: Type.String({ minLength: 1 }) }) },
    },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      if (!context.canManage) {
        return reply.code(403).send({ error: 'Organization administrator access is required.' });
      }
      if (!context.member) {
        return reply.code(403).send({ error: 'Organization membership is required to pay an invoice.' });
      }
      const { invoiceId } = request.params as { invoiceId: string };
      const policy = await getPolicy(context.organizationId);
      const wallet = await db.$transaction((transaction: Prisma.TransactionClient) =>
        resolveWallet(transaction, context, request.user.id, policy),
      );
      const outcome = await db.$transaction(async (transaction: Prisma.TransactionClient) => {
        const invoiceLock = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "MonthlyInvoice"
          WHERE "id" = ${invoiceId} AND "organizationId" = ${context.organizationId}
          FOR UPDATE
        `;
        if (invoiceLock.length !== 1) return { status: 'NOT_FOUND' as const };
        const invoice = await transaction.monthlyInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
        if (invoice.status === 'PAID') return { status: 'PAID' as const };
        if (invoice.status !== 'ISSUED') return { status: 'INVALID' as const };
        if (invoice.amountDue.isZero()) {
          await transaction.monthlyInvoice.update({
            where: { id: invoice.id },
            data: { status: 'PAID', paidAt: new Date() },
          });
          return { status: 'PAID' as const };
        }

        const walletLock = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE
        `;
        if (walletLock.length !== 1) throw new Error('Unable to lock the invoice payment wallet.');
        const currentWallet = await transaction.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        if (currentWallet.balance.minus(currentWallet.reservedBalance).lt(invoice.amountDue)) {
          return { status: 'INSUFFICIENT_FUNDS' as const };
        }

        const walletAccount = await getOrCreateLedgerAccount(transaction, {
          organizationId: context.organizationId,
          currency: invoice.currency,
          code: `WALLET_${currentWallet.id}`,
          type: 'WALLET_LIABILITY',
          walletId: currentWallet.id,
        });
        const receivableAccount = await getOrCreateLedgerAccount(transaction, {
          organizationId: context.organizationId,
          currency: invoice.currency,
          code: 'ACCOUNTS_RECEIVABLE',
          type: 'ACCOUNTS_RECEIVABLE',
        });
        await postBalancedLedgerTransaction(transaction, {
          idempotencyKey: `invoice-payment:${invoice.id}`,
          organizationId: context.organizationId,
          referenceType: 'INVOICE_PAYMENT',
          referenceId: invoice.id,
          description: `Payment of invoice ${invoice.id}`,
          currency: invoice.currency,
          entries: [
            { accountId: walletAccount.id, direction: 'DEBIT', amount: invoice.amountDue },
            { accountId: receivableAccount.id, direction: 'CREDIT', amount: invoice.amountDue },
          ],
        });
        await transaction.wallet.update({
          where: { id: currentWallet.id },
          data: { balance: { decrement: invoice.amountDue } },
        });
        await transaction.monthlyInvoice.update({
          where: { id: invoice.id },
          data: { status: 'PAID', paidAt: new Date() },
        });
        await transaction.auditLog.create({
          data: {
            actorId: request.user.id,
            organizationId: context.organizationId,
            action: 'billing.invoice.paid',
            targetType: 'MonthlyInvoice',
            targetId: invoice.id,
            metadata: { walletId: currentWallet.id, amount: invoice.amountDue.toString(), currency: invoice.currency },
          },
        });
        return { status: 'PAID' as const };
      });

      if (outcome.status === 'NOT_FOUND') return reply.code(404).send({ error: 'Invoice not found.' });
      if (outcome.status === 'INVALID') return reply.code(409).send({ error: 'Invoice cannot be paid in its current state.' });
      if (outcome.status === 'INSUFFICIENT_FUNDS') {
        return reply.code(402).send({ error: 'The available wallet balance is not enough to pay this invoice.' });
      }
      return reply.send({ success: true, status: 'PAID' });
    },
  );

  fastify.post(
    '/billing/invoices/trigger',
    { preHandler: [fastify.requireRegistered] },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      if (!context.canManage) {
        return reply.code(403).send({ error: 'Organization administrator access is required.' });
      }
      const boss = await fastify.jobs();
      const jobId = await enqueueManualInvoice(boss, {
        organizationId: context.organizationId,
        issuedBy: request.user.id,
      });
      if (!jobId) {
        return reply.code(409).send({ error: 'An invoice run was just requested for this organization.' });
      }
      return reply.code(202).send({ success: true, data: { jobId } });
    },
  );

  fastify.get<{ Params: { jobId: string } }>(
    '/billing/invoices/jobs/:jobId',
    { preHandler: [fastify.requireRegistered] },
    async (request, reply) => {
      const context = await getBillingContext(request, reply);
      if (!context) return;
      if (!context.canManage) {
        return reply.code(403).send({ error: 'Organization administrator access is required.' });
      }
      const job = await getManualInvoiceJob(await fastify.jobs(), request.params.jobId);
      if (!job || job.organizationId !== context.organizationId) {
        return reply.code(404).send({ error: 'Job not found.' });
      }
      return reply.send({ success: true, data: job });
    },
  );

  fastify.post(
    '/billing/invoices/generate',
    { preHandler: [fastify.requireRegistered] },
    async (request, reply) => {
      if (request.user.role !== 'admin') {
        return reply.code(403).send({ error: 'Platform administrator access is required.' });
      }
      const boss = await fastify.jobs();
      const jobId = await boss.send(QUEUES.invoiceSweep, {}, { singletonKey: 'manual-sweep', singletonSeconds: 60 });
      return reply.code(202).send({ success: true, data: { jobId } });
    },
  );
};

export default billingRoutes;
