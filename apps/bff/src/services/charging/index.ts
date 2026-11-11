import type { ICmsAdapter } from '@pithcharge/cms-adapters';
import { db } from '@pithcharge/db';
import { createUserNotification } from '../notification.service';
import { OrganizationBillingStrategy } from './billing/organization-billing';
import { PublicBillingStrategy } from './billing/public-billing';
import { resolveChargingTarget } from './target';
import { resolveChargingToken } from './token';
import type {
  BillingStrategy,
  ChargingActor,
  StartChargingInput,
  StartChargingResult,
} from './types';

export { ChargingStartError } from './types';
export type { ChargingActor, StartChargingInput, StartChargingResult } from './types';
export { concurrentSessionsAllowed } from './policy';

type Logger = {
  info: (context: object, message: string) => void;
  warn: (context: object, message: string) => void;
  error: (context: object, message: string) => void;
};

export interface ChargingDeps {
  cms: ICmsAdapter;
  log: Logger;
}

/**
 * Billing follows the session's active organization. Without one (or for anonymous accounts,
 * which cannot belong to organizations) the public model applies.
 */
export function selectBillingStrategy(actor: ChargingActor): BillingStrategy {
  return actor.organizationId && !actor.isAnonymous
    ? new OrganizationBillingStrategy(actor.organizationId)
    : new PublicBillingStrategy();
}

export async function startCharging(
  deps: ChargingDeps,
  input: StartChargingInput,
): Promise<StartChargingResult> {
  const { actor, stationId, evseId, limitKw } = input;

  const station = await deps.cms.getStationDetails(stationId);
  const target = resolveChargingTarget(station, stationId, evseId, input.connectorId);
  const token = await resolveChargingToken(deps, actor, input.idToken);

  const strategy = selectBillingStrategy(actor);
  const preparation = await strategy.prepare({
    cms: deps.cms,
    actor,
    target,
    token,
    idempotencyKey: input.idempotencyKey,
  });
  if (preparation.kind === 'replay') {
    return { accepted: true, replayed: true, body: preparation.body };
  }

  const logContext = { userId: actor.userId, billing: strategy.name, ...target };
  deps.log.info(logContext, 'Remote start requested');
  const result = await deps.cms.remoteStartTransaction({
    ...target,
    idToken: token.idToken,
    tokenType: token.tokenType,
    chargingProfile: limitKw ? { limitKw } : undefined,
  });

  if (!result.success) {
    try {
      await preparation.rollback();
    } catch (error) {
      deps.log.error(
        { ...logContext, err: error, sessionId: preparation.sessionId },
        'Unable to roll back billing after remote-start rejection',
      );
    }
    deps.log.warn({ ...logContext, status: result.status, result }, 'Remote start rejected');
    return { accepted: false, replayed: false, body: { ...result } };
  }

  await persistTransactionId(deps, preparation.sessionId, result.rawResponse);
  if (!actor.isAnonymous) await notifyStarted(deps, actor, stationId, evseId, preparation.sessionId);

  deps.log.info({ ...logContext, status: result.status }, 'Remote start accepted');
  return {
    accepted: true,
    replayed: false,
    body: { ...result, sessionId: preparation.sessionId, ...preparation.responseExtras },
  };
}

async function persistTransactionId(
  deps: ChargingDeps,
  sessionId: string,
  rawResponse: Record<string, unknown> | undefined,
): Promise<void> {
  const transactionId = rawResponse?.transactionId;
  if (typeof transactionId !== 'string' && typeof transactionId !== 'number') return;
  try {
    await db.chargingSession.update({
      where: { id: sessionId },
      data: { ocppTransactionId: String(transactionId) },
    });
  } catch (error) {
    deps.log.error(
      { err: error, sessionId, transactionId },
      'Charger accepted start request but transaction ID could not be persisted',
    );
  }
}

async function notifyStarted(
  deps: ChargingDeps,
  actor: ChargingActor,
  stationId: string,
  evseId: number,
  sessionId: string,
): Promise<void> {
  try {
    await createUserNotification({
      userId: actor.userId,
      eventKey: `session-start-request:${sessionId}`,
      title: 'Charging request accepted',
      body: `Your charging request at charger ${stationId} was accepted.`,
      category: 'sessionUpdates',
      data: { stationId, evseId, sessionId },
    });
  } catch (error) {
    deps.log.error(
      { err: error, userId: actor.userId, stationId, sessionId },
      'Unable to record charging-start notification',
    );
  }
}
