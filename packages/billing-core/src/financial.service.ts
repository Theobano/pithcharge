import { randomUUID } from 'node:crypto';
import { db, Prisma } from '@pithcharge/db';

type DbTransaction = Prisma.TransactionClient;
type LedgerPosting = {
  idempotencyKey: string;
  organizationId: string;
  referenceType: string;
  referenceId: string;
  description: string;
  currency: string;
  entries: Array<{
    accountId: string;
    direction: 'DEBIT' | 'CREDIT';
    amount: Prisma.Decimal;
  }>;
};

export function money(value: string | number | Prisma.Decimal): Prisma.Decimal {
  const amount = new Prisma.Decimal(value).toDecimalPlaces(2);
  if (!amount.isFinite()) throw new Error('Amount must be finite.');
  return amount;
}

export async function getOrCreateWallet(
  transaction: DbTransaction,
  input: {
    organizationId: string;
    userId: string;
    currency: string;
    sharingMode: 'SHARED' | 'INDIVIDUAL' | 'MIXED';
    assignedWalletId?: string | null;
  },
) {
  if (input.sharingMode === 'MIXED' && input.assignedWalletId) {
    const assigned = await transaction.wallet.findFirst({
      where: {
        id: input.assignedWalletId,
        organizationId: input.organizationId,
        currency: input.currency,
        status: 'ACTIVE',
      },
    });
    if (!assigned) throw new Error('Assigned organization wallet is not active.');
    return assigned;
  }

  const isShared = input.sharingMode === 'SHARED';
  const scopeKey = isShared ? 'shared' : input.userId;
  const unique = {
    organizationId_currency_scopeKey: {
      organizationId: input.organizationId,
      currency: input.currency,
      scopeKey,
    },
  };
  return transaction.wallet.upsert({
    where: unique,
    create: {
      organizationId: input.organizationId,
      userId: isShared ? null : input.userId,
      currency: input.currency,
      scopeKey,
    },
    update: {},
  });
}

export async function reserveWalletAmount(
  transaction: DbTransaction,
  input: {
    walletId: string;
    organizationId: string;
    amount: Prisma.Decimal;
    allowNegativeBalance: boolean;
    negativeBalanceLimit: Prisma.Decimal;
  },
) {
  if (!input.amount.isFinite() || input.amount.lte(0)) {
    throw new Error('Wallet reservation amount must be finite and greater than zero.');
  }
  // Parameters are cast explicitly: Postgres cannot infer the type of a bare bound parameter next to
  // an operator (`-$1` raised "operator is not unique").
  const minimumAvailable = input.negativeBalanceLimit.neg();
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    UPDATE "Wallet"
    SET "reservedBalance" = "reservedBalance" + ${input.amount}::numeric
    WHERE "id" = ${input.walletId}
      AND "organizationId" = ${input.organizationId}::uuid
      AND "status" = 'ACTIVE'
      AND (
        (
          ${input.allowNegativeBalance}::boolean
          AND "balance" - "reservedBalance" - ${input.amount}::numeric >= ${minimumAvailable}::numeric
        )
        OR (
          NOT ${input.allowNegativeBalance}::boolean
          AND "balance" - "reservedBalance" >= ${input.amount}::numeric
        )
      )
    RETURNING "id"
  `;
  return rows.length === 1;
}

export async function releaseWalletReservation(
  transaction: DbTransaction,
  walletId: string,
  amount: Prisma.Decimal,
) {
  const result = await transaction.wallet.updateMany({
    where: { id: walletId, reservedBalance: { gte: amount } },
    data: { reservedBalance: { decrement: amount } },
  });
  if (result.count !== 1) {
    throw new Error('Wallet reservation is missing or smaller than the amount being released.');
  }
}

export async function getOrCreateLedgerAccount(
  transaction: DbTransaction,
  input: {
    organizationId: string;
    currency: string;
    code: string;
    type:
      | 'WALLET_LIABILITY'
      | 'ACCOUNTS_RECEIVABLE'
      | 'CHARGING_REVENUE'
      | 'PAYMENT_CLEARING'
      | 'REFUNDS_PAYABLE'
      | 'PLATFORM_EQUITY';
    walletId?: string;
  },
) {
  if (input.walletId) {
    const existing = await transaction.ledgerAccount.findUnique({
      where: { walletId: input.walletId },
    });
    if (existing) return existing;
    return transaction.ledgerAccount.create({
      data: {
        organizationId: input.organizationId,
        currency: input.currency,
        code: input.code,
        type: input.type,
        walletId: input.walletId,
      },
    });
  }

  const where = {
    organizationId_code_currency: {
      organizationId: input.organizationId,
      currency: input.currency,
      code: input.code,
    },
  };
  return transaction.ledgerAccount.upsert({
    where,
    create: {
      organizationId: input.organizationId,
      currency: input.currency,
      code: input.code,
      type: input.type,
    },
    update: {},
  });
}

export async function postBalancedLedgerTransaction(
  transaction: DbTransaction,
  posting: LedgerPosting,
) {
  const existing = await transaction.ledgerTransaction.findUnique({
    where: { idempotencyKey: posting.idempotencyKey },
    include: { entries: true },
  });
  if (existing) return existing;

  if (posting.entries.length < 2) {
    throw new Error('A ledger transaction requires at least two entries.');
  }
  const totalDebits = posting.entries
    .filter((entry) => entry.direction === 'DEBIT')
    .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
  const totalCredits = posting.entries
    .filter((entry) => entry.direction === 'CREDIT')
    .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
  if (totalDebits.lte(0) || !totalDebits.equals(totalCredits)) {
    throw new Error('Ledger debits and credits must be equal and greater than zero.');
  }
  if (posting.entries.some((entry) => !entry.amount.isFinite() || entry.amount.lte(0))) {
    throw new Error('Ledger entry amounts must be finite and greater than zero.');
  }

  return transaction.ledgerTransaction.create({
    data: {
      idempotencyKey: posting.idempotencyKey,
      organizationId: posting.organizationId,
      referenceType: posting.referenceType,
      referenceId: posting.referenceId,
      description: posting.description,
      currency: posting.currency,
      entries: {
        create: posting.entries.map((entry) => ({
          accountId: entry.accountId,
          direction: entry.direction,
          amount: entry.amount,
          currency: posting.currency,
        })),
      },
    },
  });
}

export async function recordAuditEvent(input: {
  actorId?: string;
  organizationId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return db.auditLog.create({
    data: {
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    },
  });
}

export function createIdempotencyKey(prefix: string, value?: string) {
  const key = value?.trim() || randomUUID();
  if (key.length < 8 || key.length > 120) {
    throw new Error('Idempotency keys must contain between 8 and 120 characters.');
  }
  return `${prefix}:${key}`;
}
