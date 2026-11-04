import { db, Prisma } from '@pithcharge/db';
import {
  getOrCreateLedgerAccount,
  money,
  postBalancedLedgerTransaction,
} from './financial.service';
import { createUserNotification } from './notification.service';

export type WalletAdjustmentResult =
  | { ok: true; duplicate: boolean; balance: string }
  | { ok: false; status: number; message: string };

/**
 * Manually credits (positive amount) or debits (negative amount) an organization wallet. Posts a
 * balanced ledger transaction against the platform adjustment account and is idempotent per key.
 */
export async function adjustWallet(input: {
  organizationId: string;
  walletId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  actorId: string;
}): Promise<WalletAdjustmentResult> {
  const amount = money(Math.abs(input.amount));
  if (amount.lte(0)) return { ok: false, status: 400, message: 'Adjustment amount must be non-zero.' };
  const isCredit = input.amount > 0;
  const ledgerKey = `admin-adjustment:${input.walletId}:${input.idempotencyKey}`;

  const outcome = await db.$transaction(async (transaction: Prisma.TransactionClient) => {
    const wallet = await transaction.wallet.findFirst({
      where: { id: input.walletId, organizationId: input.organizationId },
    });
    if (!wallet) return { ok: false, status: 404, message: 'Wallet not found.' } as const;
    if (wallet.status === 'CLOSED') {
      return { ok: false, status: 409, message: 'Closed wallets cannot be adjusted.' } as const;
    }

    const existing = await transaction.ledgerTransaction.findUnique({ where: { idempotencyKey: ledgerKey } });
    if (existing) return { ok: true, duplicate: true, wallet, isCredit } as const;

    if (isCredit) {
      await transaction.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } });
    } else {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        UPDATE "Wallet"
        SET "balance" = "balance" - ${amount}
        WHERE "id" = ${wallet.id}
          AND "balance" - "reservedBalance" >= ${amount}
        RETURNING "id"
      `;
      if (rows.length !== 1) {
        return { ok: false, status: 409, message: 'Insufficient available balance for this debit.' } as const;
      }
    }

    const walletAccount = await getOrCreateLedgerAccount(transaction, {
      organizationId: input.organizationId,
      currency: wallet.currency,
      code: `WALLET_${wallet.id}`,
      type: 'WALLET_LIABILITY',
      walletId: wallet.id,
    });
    const adjustmentAccount = await getOrCreateLedgerAccount(transaction, {
      organizationId: input.organizationId,
      currency: wallet.currency,
      code: 'ADMIN_ADJUSTMENTS',
      type: 'PLATFORM_EQUITY',
    });
    await postBalancedLedgerTransaction(transaction, {
      idempotencyKey: ledgerKey,
      organizationId: input.organizationId,
      referenceType: 'ADMIN_ADJUSTMENT',
      referenceId: wallet.id,
      description: `Administrator ${isCredit ? 'credit' : 'debit'}: ${input.reason}`,
      currency: wallet.currency,
      entries: [
        { accountId: adjustmentAccount.id, direction: isCredit ? 'DEBIT' : 'CREDIT', amount },
        { accountId: walletAccount.id, direction: isCredit ? 'CREDIT' : 'DEBIT', amount },
      ],
    });
    await transaction.auditLog.create({
      data: {
        actorId: input.actorId,
        organizationId: input.organizationId,
        action: isCredit ? 'admin.wallet.credited' : 'admin.wallet.debited',
        targetType: 'Wallet',
        targetId: wallet.id,
        metadata: {
          amount: amount.toString(),
          currency: wallet.currency,
          reason: input.reason,
          byPlatformAdmin: true,
        },
      },
    });
    return { ok: true, duplicate: false, wallet, isCredit } as const;
  });

  if (!outcome.ok) return outcome;

  const fresh = await db.wallet.findUniqueOrThrow({ where: { id: input.walletId } });
  if (!outcome.duplicate) {
    await notifyWalletHolders(input.organizationId, outcome.wallet.userId, {
      currency: fresh.currency,
      amount: amount.toString(),
      isCredit,
      reason: input.reason,
    });
  }
  return { ok: true, duplicate: outcome.duplicate, balance: fresh.balance.toString() };
}

async function notifyWalletHolders(
  organizationId: string,
  walletUserId: string | null,
  info: { currency: string; amount: string; isCredit: boolean; reason: string },
) {
  try {
    const recipients = walletUserId
      ? [walletUserId]
      : (
          await db.member.findMany({
            where: { organizationId, role: { in: ['owner', 'admin'] } },
            select: { userId: true },
          })
        ).map((member: { userId: string }) => member.userId);
    await Promise.all(
      recipients.map((userId: string) =>
        createUserNotification({
          userId,
          organizationId,
          eventKey: info.isCredit ? 'wallet.credited' : 'wallet.debited',
          title: info.isCredit ? 'Wallet credited' : 'Wallet debited',
          body: `${info.amount} ${info.currency} was ${info.isCredit ? 'added to' : 'deducted from'} the wallet by an administrator. Reason: ${info.reason}`,
          category: 'paymentUpdates',
        }),
      ),
    );
  } catch {
    // Notification delivery must never fail a completed ledger posting.
  }
}
