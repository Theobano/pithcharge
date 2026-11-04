import { Static, Type } from '@sinclair/typebox';
import { db, Prisma } from '@pithcharge/db';
import { isValidTimezone } from './rate-engine.service';

export const PolicyUpdate = Type.Object({
  billingMode: Type.Optional(Type.Union([Type.Literal('PREPAID'), Type.Literal('POSTPAID')])),
  walletSharingMode: Type.Optional(Type.Union([
    Type.Literal('SHARED'),
    Type.Literal('INDIVIDUAL'),
    Type.Literal('MIXED'),
  ])),
  currency: Type.Optional(Type.String({ pattern: '^[A-Z]{3}$' })),
  ratePerKwh: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
  ratePerMinute: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
  timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  sessionFee: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
  idleFeePerMinute: Type.Optional(Type.Number({ minimum: 0 })),
  sessionAuthorizationAmount: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  monthlyMinimumSpend: Type.Optional(Type.Number({ minimum: 0 })),
  paymentTermDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
  billingCycleUnit: Type.Optional(Type.Union([Type.Literal('DAY'), Type.Literal('WEEK'), Type.Literal('MONTH')])),
  billingCycleInterval: Type.Optional(Type.Integer({ minimum: 1, maximum: 52 })),
  billingCycleAnchor: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  autoInvoice: Type.Optional(Type.Boolean()),
  allowNegativeBalance: Type.Optional(Type.Boolean()),
  negativeBalanceLimit: Type.Optional(Type.Number({ minimum: 0 })),
  lowCreditThreshold: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
}, { additionalProperties: false });
export type BillingPolicyChanges = Static<typeof PolicyUpdate>;

export type PolicyUpdateResult =
  | { ok: true; policy: Awaited<ReturnType<typeof db.billingPolicy.upsert>> }
  | { ok: false; status: number; message: string };

type WalletMigrationRow = {
  id: string;
  scopeKey: string;
  balance: Prisma.Decimal;
  reservedBalance: Prisma.Decimal;
  ledgerAccounts: Array<{ entries: Array<{ id: string }> }>;
};

const fail = (status: number, message: string): PolicyUpdateResult => ({ ok: false, status, message });

export function getOrCreatePolicy(organizationId: string) {
  return db.billingPolicy.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}

/**
 * Validates and applies a billing policy change for one organization. Shared by the organization
 * admin route and the platform admin route so both enforce identical rules.
 */
export async function updateBillingPolicy(
  organizationId: string,
  changes: BillingPolicyChanges,
  actor: { id: string; isPlatformAdmin: boolean },
): Promise<PolicyUpdateResult> {
  const existing = await getOrCreatePolicy(organizationId);

  if (changes.timezone !== undefined && !isValidTimezone(changes.timezone)) {
    return fail(400, 'Timezone must be a valid IANA timezone such as "Europe/London".');
  }

  if (
    changes.billingMode !== undefined &&
    changes.billingMode !== existing.billingMode &&
    !actor.isPlatformAdmin
  ) {
    return fail(403, 'Only platform administrators can change an organization billing mode.');
  }

  const allowsNegative = changes.allowNegativeBalance ?? existing.allowNegativeBalance;
  const negativeLimit = changes.negativeBalanceLimit ?? existing.negativeBalanceLimit.toNumber();
  if (allowsNegative && negativeLimit <= 0) {
    return fail(400, 'A positive negative-balance limit is required when credit is enabled.');
  }
  if (
    changes.allowNegativeBalance === false &&
    changes.negativeBalanceLimit !== undefined &&
    changes.negativeBalanceLimit > 0
  ) {
    return fail(400, 'Negative-balance limit must be zero when negative balances are disabled.');
  }

  if (changes.walletSharingMode && changes.walletSharingMode !== existing.walletSharingMode) {
    const fundedWallet = await db.wallet.findFirst({
      where: {
        organizationId,
        OR: [{ balance: { not: 0 } }, { reservedBalance: { not: 0 } }],
      },
      select: { id: true },
    });
    if (fundedWallet) {
      return fail(409, 'Wallet sharing mode cannot change while organization wallets hold funds or reservations.');
    }
  }

  let walletIdsToMigrate: string[] = [];
  if (changes.currency && changes.currency !== existing.currency) {
    const wallets: WalletMigrationRow[] = await db.wallet.findMany({
      where: { organizationId, currency: existing.currency },
      select: {
        id: true,
        scopeKey: true,
        balance: true,
        reservedBalance: true,
        ledgerAccounts: { select: { entries: { take: 1, select: { id: true } } } },
      },
    });
    if (
      wallets.some(
        (item) =>
          !item.balance.isZero() ||
          !item.reservedBalance.isZero() ||
          item.ledgerAccounts.some((account) => account.entries.length > 0),
      )
    ) {
      return fail(409, 'Currency cannot change while wallets hold funds or have posted ledger entries.');
    }
    const scopeKeys = wallets.map((item) => item.scopeKey);
    const conflicting = scopeKeys.length
      ? await db.wallet.findFirst({
          where: { organizationId, currency: changes.currency, scopeKey: { in: scopeKeys } },
          select: { id: true },
        })
      : null;
    if (conflicting) return fail(409, 'A wallet already exists in the requested currency.');
    walletIdsToMigrate = wallets.map((item) => item.id);
  }

  const { billingCycleAnchor, ...rest } = changes;
  const data: Prisma.BillingPolicyUncheckedUpdateInput = { ...rest, updatedBy: actor.id };
  const cycleChanged =
    (changes.billingCycleUnit !== undefined && changes.billingCycleUnit !== existing.billingCycleUnit) ||
    (changes.billingCycleInterval !== undefined && changes.billingCycleInterval !== existing.billingCycleInterval);
  if (billingCycleAnchor !== undefined) {
    data.billingCycleAnchor = billingCycleAnchor === null ? null : new Date(billingCycleAnchor);
  } else if (cycleChanged) {
    // Re-base the new cycle grid on the last processed boundary so no period is skipped or billed twice.
    data.billingCycleAnchor = existing.invoiceCursor;
  }

  const policy = await db.$transaction(async (transaction: Prisma.TransactionClient) => {
    if (walletIdsToMigrate.length > 0 && changes.currency) {
      const migration = await transaction.wallet.updateMany({
        where: { id: { in: walletIdsToMigrate }, balance: 0, reservedBalance: 0 },
        data: { currency: changes.currency },
      });
      if (migration.count !== walletIdsToMigrate.length) {
        throw new Error('Wallet currency migration was interrupted by a concurrent balance change.');
      }
      await transaction.ledgerAccount.updateMany({
        where: { walletId: { in: walletIdsToMigrate } },
        data: { currency: changes.currency },
      });
    }
    const updated = await transaction.billingPolicy.upsert({
      where: { organizationId },
      create: { ...(data as Prisma.BillingPolicyUncheckedCreateInput), organizationId },
      update: data,
    });
    await transaction.auditLog.create({
      data: {
        actorId: actor.id,
        organizationId,
        action: 'billing.policy.updated',
        targetType: 'BillingPolicy',
        targetId: updated.id,
        metadata: { ...changes, byPlatformAdmin: actor.isPlatformAdmin },
      },
    });
    return updated;
  });

  return { ok: true, policy };
}
