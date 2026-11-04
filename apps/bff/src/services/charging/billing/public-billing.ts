import { db, Prisma } from '@pithcharge/db';
import { publicSnapshot, resolveChargingRate } from '../../charging-rate.service';
import { getPublicNetworkOrganizationId } from '../../public-network.service';
import { OrganizationBillingStrategy } from './organization-billing';
import {
  ANONYMOUS_MAX_LIVE_SESSIONS,
  liveSessionFilter,
} from '../policy';
import {
  ChargingStartError,
  type BillingContext,
  type BillingPreparation,
  type BillingStrategy,
} from '../types';

/**
 * Billing for sessions without an active organization. Free chargers need no wallet; paid chargers
 * reserve from the user's personal wallet (see public-network.service). Anonymous accounts are
 * limited to one live session and can only use free chargers.
 */
export class PublicBillingStrategy implements BillingStrategy {
  readonly name = 'public' as const;

  async prepare(context: BillingContext): Promise<BillingPreparation> {
    const { actor, target, token, cms } = context;
    const connectorKey = `${target.stationId}:${target.evseId}:${target.connectorId}`;
    const rate = await resolveChargingRate(cms, target).catch(() => null);
    const isFree = !rate || [
      rate.base.ratePerKwh,
      rate.base.ratePerMinute,
      rate.base.sessionFee,
      rate.base.idleFeePerMinute,
    ].every((value) => !value || Number(value) === 0);

    // Paid chargers need a funded personal wallet; free chargers need none.
    if (!isFree) {
      if (actor.isAnonymous) {
        throw new ChargingStartError(
          402,
          'WALLET_TOPUP_REQUIRED',
          'This charger is not free. Sign in or create an account and top up your wallet to charge.',
        );
      }
      const organizationId = await getPublicNetworkOrganizationId();
      return new OrganizationBillingStrategy(organizationId, true).prepare(context);
    }

    const pricing = rate
      ? {
          currency: rate.currency,
          ratePerKwh: rate.base.ratePerKwh,
          ratePerMinute: rate.base.ratePerMinute,
          sessionFee: rate.base.sessionFee,
          idleFeePerMinute: rate.base.idleFeePerMinute,
          pricingSnapshot: publicSnapshot(rate) as unknown as Prisma.InputJsonValue,
        }
      : {};

    const sessionId = await db.$transaction(async (transaction: Prisma.TransactionClient) => {
      // Serialises competing starts on the same connector, since public sessions hold no wallet reservation.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${connectorKey}))`;

      if (actor.isAnonymous) {
        await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "user" WHERE "id" = ${actor.userId}::uuid FOR UPDATE
        `;
        const liveSessions = await transaction.chargingSession.count({
          where: { userId: actor.userId, ...liveSessionFilter() },
        });
        if (liveSessions >= ANONYMOUS_MAX_LIVE_SESSIONS) {
          throw new ChargingStartError(
            409,
            'GUEST_SESSION_LIMIT',
            'Guest accounts can run one charging session at a time. Sign in to start more.',
          );
        }
      }

      const onConnector = await transaction.chargingSession.findFirst({
        where: { ...target, ...liveSessionFilter() },
        select: { id: true },
      });
      if (onConnector) {
        throw new ChargingStartError(
          409,
          'CONNECTOR_RESERVED',
          'A charging session is already pending or active on this connector.',
        );
      }

      const created = await transaction.chargingSession.create({
        data: {
          userId: actor.userId,
          tokenId: token.id,
          idTokenValue: token.idToken,
          ...target,
          ...pricing,
        },
        select: { id: true },
      });
      return created.id;
    });

    return {
      kind: 'ready',
      sessionId,
      responseExtras: {},
      rollback: async () => {
        await db.chargingSession.update({
          where: { id: sessionId },
          data: { status: 'FAILED', endTime: new Date() },
        });
      },
    };
  }
}
