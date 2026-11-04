import { createHash, randomUUID } from 'node:crypto';
import { db, Prisma } from '@pithcharge/db';
import {
  getOrCreateWallet,
  money,
  releaseWalletReservation,
  reserveWalletAmount,
} from '../../financial.service';
import { buildPricingSnapshot } from '../../rate-engine.service';
import { resolveChargingRate } from '../../charging-rate.service';
import {
  ChargingStartError,
  type BillingContext,
  type BillingPreparation,
  type BillingStrategy,
} from '../types';

const CONNECTOR_RESERVED = new ChargingStartError(
  409,
  'CONNECTOR_RESERVED',
  'A charging session is already pending or active on this connector.',
);

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/**
 * Billing for sessions started under an active organization. Follows the organization's policy:
 * the member's (or shared) wallet is reserved up front, or credit is allowed for postpaid billing.
 */
export class OrganizationBillingStrategy implements BillingStrategy {
  readonly name = 'organization' as const;

  /** `publicNetwork` marks the system organization that holds personal wallets of users without an organization. */
  constructor(
    private readonly organizationId: string,
    private readonly publicNetwork = false,
  ) {}

  async prepare(context: BillingContext): Promise<BillingPreparation> {
    const { actor, target, token } = context;
    const organizationId = this.organizationId;

    const member = this.publicNetwork
      ? { id: '', billingWalletId: null, allowNegativeBalance: false, negativeBalanceLimit: null }
      : await db.member.findFirst({
          where: { organizationId, userId: actor.userId },
          select: {
            id: true,
            billingWalletId: true,
            allowNegativeBalance: true,
            negativeBalanceLimit: true,
          },
        });
    if (!member) {
      throw new ChargingStartError(
        403,
        'ORGANIZATION_MEMBERSHIP_REQUIRED',
        'An active organization membership is required to charge.',
      );
    }

    const policy = await db.billingPolicy.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });
    const rateRules = await db.rateRule.findMany({ where: { organizationId, active: true } });
    const needsCsmsTariff = policy.ratePerKwh === null || policy.ratePerMinute === null || policy.sessionFee === null;
    // Unset organization prices fall back to the public-network rate (station, hub, platform, then CSMS).
    const publicRate = needsCsmsTariff
      ? await resolveChargingRate(context.cms, target).catch(() => null)
      : null;
    const csmsTariff = publicRate && publicRate.source !== 'none'
      ? {
          pricePerKwh: publicRate.base.ratePerKwh,
          pricePerMinute: publicRate.base.ratePerMinute,
          pricePerSession: publicRate.base.sessionFee,
        }
      : null;
    const snapshot = buildPricingSnapshot(policy, rateRules, csmsTariff);
    const pricingSnapshot = snapshot as unknown as Prisma.InputJsonValue;
    const sessionAuthorization = money(policy.sessionAuthorizationAmount);
    if (!sessionAuthorization.isFinite() || sessionAuthorization.lte(0)) {
      throw new ChargingStartError(
        409,
        'SESSION_AUTHORIZATION_NOT_CONFIGURED',
        'The organization session authorization amount is not configured.',
      );
    }

    const allowNegativeBalance =
      policy.billingMode === 'POSTPAID' &&
      (policy.allowNegativeBalance || member.allowNegativeBalance);
    const negativeBalanceLimit = member.allowNegativeBalance && member.negativeBalanceLimit
      ? money(member.negativeBalanceLimit)
      : money(policy.negativeBalanceLimit);
    const isFree = [
      snapshot.base.ratePerKwh,
      snapshot.base.ratePerMinute,
      snapshot.base.sessionFee,
      policy.idleFeePerMinute,
    ].every((value) => !value || new Prisma.Decimal(value).isZero());
    // Free chargers need no funds; postpaid organizations without credit reserve nothing and are billed on completion.
    const reservation = isFree || (policy.billingMode === 'POSTPAID' && !allowNegativeBalance)
      ? new Prisma.Decimal(0)
      : sessionAuthorization;

    const requestKey = context.idempotencyKey?.trim() || randomUUID();
    if (requestKey.length < 8 || requestKey.length > 120) {
      throw new ChargingStartError(
        400,
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency key must be between 8 and 120 characters.',
      );
    }
    const idempotencyKey = `remote-start:${createHash('sha256')
      .update(`${organizationId}:${actor.userId}:${requestKey}`)
      .digest('hex')}`;

    const replay = await this.findReplay(idempotencyKey);
    if (replay) return replay;

    const wallet = await db.$transaction((transaction: Prisma.TransactionClient) =>
      getOrCreateWallet(transaction, {
        organizationId,
        userId: actor.userId,
        currency: policy.currency,
        sharingMode: policy.walletSharingMode,
        assignedWalletId: member.billingWalletId,
      }),
    );

    const holdId = randomUUID();
    let sessionId: string;
    try {
      sessionId = await db.$transaction(async (transaction: Prisma.TransactionClient) => {
        const activeHold = await transaction.paymentHold.findFirst({
          where: { ...target, status: 'AUTHORIZED' },
          select: { id: true },
        });
        if (activeHold) throw CONNECTOR_RESERVED;

        const reserved = reservation.isZero() || await reserveWalletAmount(transaction, {
          walletId: wallet.id,
          organizationId,
          amount: reservation,
          allowNegativeBalance,
          negativeBalanceLimit,
        });
        if (!reserved) {
          throw this.publicNetwork
            ? new ChargingStartError(
                402,
                'WALLET_TOPUP_REQUIRED',
                'Your wallet balance is too low to start this session. Top up your wallet to continue.',
              )
            : new ChargingStartError(
                402,
                'INSUFFICIENT_WALLET_BALANCE',
                'Your organization wallet does not have enough balance for this session. Contact your organization administrator to top up the wallet.',
              );
        }

        const hold = await transaction.paymentHold.create({
          data: {
            id: holdId,
            provider: 'wallet',
            providerReference: `wallet-reserve:${holdId}`,
            idempotencyKey,
            userId: actor.userId,
            organizationId,
            walletId: wallet.id,
            ...target,
            amount: reservation,
            currency: policy.currency,
            status: 'AUTHORIZED',
          },
        });
        const session = await transaction.chargingSession.create({
          data: {
            userId: actor.userId,
            tokenId: token.id,
            idTokenValue: token.idToken,
            ...target,
            currency: policy.currency,
            ratePerKwh: snapshot.base.ratePerKwh,
            sessionFee: snapshot.base.sessionFee,
            idleFeePerMinute: policy.idleFeePerMinute,
            ratePerMinute: snapshot.base.ratePerMinute,
            pricingSnapshot,
            allowNegativeBalance,
            negativeBalanceLimit,
            organizationId,
            walletId: wallet.id,
            paymentHoldId: hold.id,
          },
          select: { id: true },
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.userId,
            organizationId,
            action: 'charging.session.start_requested',
            targetType: 'ChargingSession',
            targetId: session.id,
            metadata: {
              ...target,
              walletId: wallet.id,
              reservationAmount: reservation.toString(),
              currency: policy.currency,
              holdId: hold.id,
            },
          },
        });
        return session.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.findReplay(idempotencyKey);
        if (raced) return raced;
        const connectorHold = await db.paymentHold.findFirst({
          where: { ...target, status: 'AUTHORIZED' },
          select: { id: true },
        });
        if (connectorHold) throw CONNECTOR_RESERVED;
      }
      throw error;
    }

    return {
      kind: 'ready',
      sessionId,
      responseExtras: {
        holdId,
        reservedAmount: reservation.toString(),
        currency: policy.currency,
      },
      rollback: () =>
        db.$transaction(async (transaction: Prisma.TransactionClient) => {
          if (reservation.gt(0)) {
            await releaseWalletReservation(transaction, wallet.id, reservation);
          }
          await transaction.paymentHold.update({ where: { id: holdId }, data: { status: 'RELEASED' } });
          await transaction.chargingSession.update({
            where: { id: sessionId },
            data: { status: 'FAILED', endTime: new Date() },
          });
        }),
    };
  }

  private async findReplay(idempotencyKey: string): Promise<BillingPreparation | null> {
    const hold = await db.paymentHold.findUnique({ where: { idempotencyKey } });
    if (!hold) return null;
    return {
      kind: 'replay',
      body: {
        success: hold.status === 'AUTHORIZED',
        status: hold.status,
        holdId: hold.id,
        message: 'This idempotent charging request has already been processed.',
      },
    };
  }
}
