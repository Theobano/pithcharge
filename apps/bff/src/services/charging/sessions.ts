import type { CmsTransaction, ICmsAdapter } from '@pithcharge/cms-adapters';
import { db, Prisma } from '@pithcharge/db';
import { processCitrineosWebhook } from '../cms-webhook.service';
import { getPublicNetworkOrganizationId } from '../public-network.service';
import { computeCharge, readSnapshot, resolveRate } from '../rate-engine.service';
import { ChargingStartError } from './types';

type Logger = {
  info: (context: object, message: string) => void;
  warn: (context: object, message: string) => void;
  error: (context: object, message: string) => void;
};

export interface SessionDeps {
  cms: ICmsAdapter;
  log: Logger;
}

export interface SessionViewer {
  id: string;
  role?: string | null;
  organizationId?: string | null;
  organizationRole?: string | null;
}

export interface SessionLookup {
  id?: string;
  transactionId?: string;
}

type SessionRecord = NonNullable<Awaited<ReturnType<typeof db.chargingSession.findFirst>>>;

/**
 * Sessions are private to the account that started them and scoped to the organization that was
 * active at the time (or to public mode when none was).
 */
export async function sessionScope(viewer: Pick<SessionViewer, 'id' | 'organizationId'>) {
  if (viewer.organizationId) return { userId: viewer.id, organizationId: viewer.organizationId };
  // Paid public sessions are recorded under the public-network organization, free ones under none.
  const publicOrganizationId = await getPublicNetworkOrganizationId();
  return {
    userId: viewer.id,
    OR: [{ organizationId: null }, { organizationId: publicOrganizationId }],
  };
}

export async function canViewSession(viewer: SessionViewer, session: SessionRecord) {
  if (session.userId !== viewer.id) return false;
  if (viewer.organizationId) return session.organizationId === viewer.organizationId;
  return (
    !session.organizationId ||
    session.organizationId === (await getPublicNetworkOrganizationId())
  );
}

export async function canControlSession(viewer: SessionViewer, session: SessionRecord) {
  return canViewSession(viewer, session);
}

export async function findSession(viewer: SessionViewer, lookup: SessionLookup) {
  const session = lookup.id
    ? await db.chargingSession.findUnique({ where: { id: lookup.id } })
    : lookup.transactionId
      ? await db.chargingSession.findUnique({ where: { ocppTransactionId: lookup.transactionId } })
      : null;
  // Hide existence of sessions the viewer cannot see.
  if (!session || !(await canViewSession(viewer, session))) {
    throw new ChargingStartError(404, 'SESSION_NOT_FOUND', 'Charging session not found.');
  }
  return session;
}

// The CMS assigns the transaction ID only once the charger reports it, so a pending session is
// matched on station, token and start time (active or already ended). The CMS EVSE key differs
// from the OCPP EVSE id, so it is not compared.
async function findPendingTransaction(deps: SessionDeps, session: SessionRecord) {
  const candidates = await deps.cms.findTransactionsSince(
    session.stationId,
    session.idTokenValue,
    new Date(session.createdAt.getTime() - 60_000).toISOString(),
  );
  const claimed = new Set(
    (
      await db.chargingSession.findMany({
        where: { stationId: session.stationId, ocppTransactionId: { not: null } },
        select: { ocppTransactionId: true },
      })
    ).map((item: { ocppTransactionId: string | null }) => item.ocppTransactionId),
  );
  return candidates.find((candidate) => !claimed.has(candidate.transactionId)) ?? null;
}

/**
 * Brings the local session in line with the CMS: links the transaction once it exists, keeps
 * running totals, and stores the final details when the CMS reports it ended.
 */
async function reconcile(deps: SessionDeps, session: SessionRecord): Promise<{
  session: SessionRecord;
  live: CmsTransaction | null;
}> {
  if (session.status !== 'PENDING' && session.status !== 'ACTIVE') return { session, live: null };

  try {
    let tx: CmsTransaction | null = null;
    if (session.ocppTransactionId) {
      tx = await deps.cms.getTransaction(session.stationId, session.ocppTransactionId);
    } else {
      tx = await findPendingTransaction(deps, session);
    }
    if (!tx) return { session, live: null };

    if (!tx.isActive) {
      await settleFromCms(deps, session, tx);
      return {
        session: await db.chargingSession.findUniqueOrThrow({ where: { id: session.id } }),
        live: null,
      };
    }

    const energy = tx.sessionEnergyKwh ?? Math.max(0, tx.currentMeterKwh - tx.meterStartKwh);
    void enforceSpendLimit(deps, session, energy);
    // Persist the transaction link and running totals so history survives a CMS outage.
    await db.chargingSession.updateMany({
      where: { id: session.id, status: { in: ['PENDING', 'ACTIVE'] } },
      data: {
        ocppTransactionId: tx.transactionId,
        status: 'ACTIVE',
        startTime: new Date(tx.startTime),
        totalKwh: energy,
        lastMeterKwh: session.startMeterKwh + energy,
      },
    });
    return {
      session: await db.chargingSession.findUniqueOrThrow({ where: { id: session.id } }),
      live: tx,
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { session, live: null };
    }
    deps.log.warn({ err: error, sessionId: session.id }, 'Unable to read live session from the CMS');
    return { session, live: null };
  }
}

/** Stores the final transaction details (and settles billing) once the CMS reports it ended. */
async function settleFromCms(deps: SessionDeps, session: SessionRecord, tx: CmsTransaction) {
  await db.chargingSession.updateMany({
    where: { id: session.id, ocppTransactionId: null },
    data: { ocppTransactionId: tx.transactionId },
  });
  const totalKwh = tx.sessionEnergyKwh ?? Math.max(0, tx.currentMeterKwh - tx.meterStartKwh);
  await processCitrineosWebhook(
    {
      eventType: 'TransactionEnded',
      stationId: session.stationId,
      timestamp: tx.endTime ?? new Date().toISOString(),
      payload: { transactionId: tx.transactionId, totalKwh },
    },
    deps.cms,
  );
}

const stopRequestedAt = new Map<string, number>();

/**
 * Stops a running session once its cost reaches what the wallet can cover (balance, other holds
 * and any permitted negative balance), so users cannot charge beyond their funds.
 */
export async function enforceSpendLimit(deps: SessionDeps, session: SessionRecord, energyKwh: number) {
  try {
    if (!session.walletId || !session.ocppTransactionId || session.status === 'COMPLETED') return;
    const cost = estimateCost(session, energyKwh)?.total ?? (() => {
      const estimate = estimatedTotal(session, energyKwh);
      return estimate ? new Prisma.Decimal(estimate) : null;
    })();
    if (!cost || cost.lte(0)) return;

    const [wallet, hold] = await Promise.all([
      db.wallet.findUnique({ where: { id: session.walletId } }),
      session.paymentHoldId
        ? db.paymentHold.findUnique({ where: { id: session.paymentHoldId }, select: { amount: true } })
        : Promise.resolve(null),
    ]);
    if (!wallet) return;
    const credit = session.allowNegativeBalance ? (session.negativeBalanceLimit ?? new Prisma.Decimal(0)) : new Prisma.Decimal(0);
    const otherReservations = wallet.reservedBalance.minus(hold?.amount ?? 0);
    const limit = wallet.balance.minus(otherReservations).plus(credit);
    if (cost.lt(limit)) return;

    const last = stopRequestedAt.get(session.id) ?? 0;
    if (Date.now() - last < 30_000) return;
    stopRequestedAt.set(session.id, Date.now());

    deps.log.warn(
      { sessionId: session.id, cost: cost.toString(), limit: limit.toString() },
      'Session reached the wallet spending limit; stopping it',
    );
    await deps.cms.remoteStopTransaction({
      stationId: session.stationId,
      transactionId: session.ocppTransactionId,
    });
    await db.auditLog.create({
      data: {
        actorId: session.userId,
        organizationId: session.organizationId,
        action: 'charging.session.limit_stop',
        targetType: 'ChargingSession',
        targetId: session.id,
        metadata: { cost: cost.toString(), limit: limit.toString() },
      },
    });
  } catch (error) {
    deps.log.warn({ err: error, sessionId: session.id }, 'Unable to enforce the session spending limit');
  }
}

/** Checks every running wallet-funded session; called on a timer so limits hold without anyone watching. */
export async function enforceSpendLimits(deps: SessionDeps) {
  const sessions = await db.chargingSession.findMany({
    where: { status: 'ACTIVE', walletId: { not: null }, ocppTransactionId: { not: null } },
    take: 200,
  });
  for (const session of sessions) {
    const tx = await deps.cms.getTransaction(session.stationId, session.ocppTransactionId!).catch(() => null);
    if (!tx?.isActive) continue;
    await enforceSpendLimit(deps, session, tx.sessionEnergyKwh ?? Math.max(0, tx.currentMeterKwh - tx.meterStartKwh));
  }
}

function energyOf(session: SessionRecord, live: CmsTransaction | null) {
  if (!live) return session.totalKwh;
  return live.sessionEnergyKwh ?? Math.max(0, live.currentMeterKwh - live.meterStartKwh);
}

function estimateCost(session: SessionRecord, energyKwh: number) {
  const snapshot = readSnapshot(session.pricingSnapshot);
  if (snapshot) {
    return computeCharge({
      snapshot,
      stationId: session.stationId,
      startTime: session.startTime,
      endTime: new Date(),
      totalKwh: energyKwh,
    });
  }
  return null;
}

function pricingView(session: SessionRecord, energyKwh: number) {
  const snapshot = readSnapshot(session.pricingSnapshot);
  if (!snapshot) return null;
  const now = session.status === 'COMPLETED' && session.endTime ? session.endTime : new Date();
  const current = resolveRate(snapshot, now, session.stationId);
  const estimate = estimateCost(session, energyKwh);
  return {
    timezone: snapshot.timezone,
    source: snapshot.source ?? null,
    currentRule: current.rule?.name ?? null,
    currentRates: current.rates,
    breakdown: estimate?.lines ?? [],
  };
}

function estimatedTotal(session: SessionRecord, energyKwh: number) {
  const charge = estimateCost(session, energyKwh);
  if (charge) return charge.total.toString();
  if (!session.ratePerKwh) return null;
  return new Prisma.Decimal(energyKwh)
    .mul(session.ratePerKwh)
    .plus(session.sessionFee ?? 0)
    .toDecimalPlaces(2)
    .toString();
}

export async function getSessionDetails(
  deps: SessionDeps,
  viewer: SessionViewer,
  lookup: SessionLookup,
) {
  const found = await findSession(viewer, lookup);
  const { session, live } = await reconcile(deps, found);
  const energyKwh = energyOf(session, live);
  // Regular organization members must not see rates or cost; those belong to org admins and auditors.
  const hideCost =
    Boolean(viewer.organizationId) &&
    Boolean(session.organizationId) &&
    ['user', 'member'].includes(viewer.organizationRole ?? 'user');

  return {
    session: {
      id: session.id,
      status: session.status,
      stationId: session.stationId,
      evseId: session.evseId,
      connectorId: live?.connectorId ?? session.connectorId,
      transactionId: session.ocppTransactionId,
      startTime: session.startTime,
      endTime: session.endTime,
      totalKwh: energyKwh,
      costHidden: hideCost,
      totalCost: hideCost ? null : session.totalCost.toString(),
      estimatedCost: hideCost || session.status === 'COMPLETED' ? null : estimatedTotal(session, energyKwh),
      currency: session.currency,
      ratePerKwh: hideCost ? null : (session.ratePerKwh?.toString() ?? null),
      ratePerMinute: hideCost ? null : (session.ratePerMinute?.toString() ?? null),
      pricing: hideCost ? null : pricingView(session, energyKwh),
      sessionFee: hideCost ? null : (session.sessionFee?.toString() ?? null),
      idleFeePerMinute: hideCost ? null : (session.idleFeePerMinute?.toString() ?? null),
      billed: Boolean(session.billedAt),
      organizationId: session.organizationId,
    },
    telemetry: live?.latestTelemetry ?? null,
    canControl: await canControlSession(viewer, session),
  };
}

export async function stopCharging(
  deps: SessionDeps,
  viewer: SessionViewer,
  lookup: SessionLookup,
) {
  const found = await findSession(viewer, lookup);
  if (!(await canControlSession(viewer, found))) {
    throw new ChargingStartError(403, 'SESSION_CONTROL_FORBIDDEN', 'You cannot stop this charging session.');
  }

  const { session } = await reconcile(deps, found);
  if (session.status === 'COMPLETED' || session.status === 'FAILED') {
    throw new ChargingStartError(409, 'SESSION_NOT_ACTIVE', 'This charging session has already ended.');
  }
  if (!session.ocppTransactionId) {
    throw new ChargingStartError(
      409,
      'SESSION_NOT_STARTED',
      'Charging has not started yet. Plug in your vehicle, or try again in a moment.',
    );
  }

  deps.log.info(
    { userId: viewer.id, sessionId: session.id, stationId: session.stationId, transactionId: session.ocppTransactionId },
    'Remote stop requested',
  );
  const result = await deps.cms.remoteStopTransaction({
    stationId: session.stationId,
    transactionId: session.ocppTransactionId,
  });
  if (!result.success) {
    deps.log.warn({ sessionId: session.id, status: result.status }, 'Remote stop rejected');
    throw new ChargingStartError(
      502,
      'REMOTE_STOP_REJECTED',
      result.message ?? 'The charger did not accept the stop request.',
    );
  }

  await db.auditLog.create({
    data: {
      actorId: viewer.id,
      organizationId: session.organizationId,
      action: 'charging.session.stop_requested',
      targetType: 'ChargingSession',
      targetId: session.id,
      metadata: { transactionId: session.ocppTransactionId, stationId: session.stationId },
    },
  });
  return { ...result, sessionId: session.id };
}
