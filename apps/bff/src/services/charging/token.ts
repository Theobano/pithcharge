import { randomUUID } from 'node:crypto';
import type { ICmsAdapter } from '@pithcharge/cms-adapters';
import { db } from '@pithcharge/db';
import { syncTokenToCms } from '../token-sync.service';
import { concurrentSessionsAllowed } from './policy';
import { ChargingStartError, type ChargingActor, type ChargingToken } from './types';

type Logger = { error: (context: object, message: string) => void };

async function ensureAnonymousToken(userId: string): Promise<string> {
  const existing = await db.userOcppToken.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] } },
    orderBy: { createdAt: 'asc' },
    select: { idToken: true },
  });
  if (existing) return existing.idToken;

  const created = await db.userOcppToken.create({
    data: {
      userId,
      idToken: `GUEST_${randomUUID().replaceAll('-', '').toUpperCase()}`,
      tokenType: 'Central',
      status: 'PENDING_ACTIVATION',
      isDefault: true,
      nickname: 'Guest token',
    },
    select: { idToken: true },
  });
  return created.idToken;
}

/**
 * Picks the account's token, syncs it to the CMS (which stays the source of truth for its status)
 * and rejects blocked or foreign tokens. The CMS flag allowing concurrent sessions follows policy.
 */
export async function resolveChargingToken(
  deps: { cms: ICmsAdapter; log: Logger },
  actor: ChargingActor,
  requestedIdToken?: string,
): Promise<ChargingToken> {
  let idToken = requestedIdToken || actor.defaultIdToken;
  if (!idToken && actor.isAnonymous) idToken = await ensureAnonymousToken(actor.userId);
  if (!idToken) {
    throw new ChargingStartError(
      409,
      'CHARGING_TOKEN_REQUIRED',
      'Link and activate a charging token before starting a session.',
    );
  }

  const owned = await db.userOcppToken.findFirst({
    where: {
      userId: actor.userId,
      idToken,
      status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
    },
    select: { id: true, idToken: true, tokenType: true },
  });
  if (!owned) {
    throw new ChargingStartError(
      409,
      'CHARGING_TOKEN_NOT_OWNED',
      'The selected charging token is not active on this account.',
    );
  }

  try {
    const synced = await syncTokenToCms(deps.cms, {
      ...owned,
      status: 'ACTIVE',
      concurrentTransaction: concurrentSessionsAllowed(actor.isAnonymous),
    });
    await db.userOcppToken.updateMany({
      where: { id: owned.id, status: { not: synced.status } },
      data: { status: synced.status },
    });
    if (synced.status === 'BLOCKED') {
      throw new ChargingStartError(
        403,
        'CHARGING_TOKEN_BLOCKED',
        'This charging token is blocked on the charging network.',
      );
    }
  } catch (error) {
    if (error instanceof ChargingStartError) throw error;
    deps.log.error(
      { err: error, userId: actor.userId, tokenId: owned.id },
      'Charging token sync before session start failed',
    );
    throw new ChargingStartError(
      503,
      'TOKEN_SYNC_UNAVAILABLE',
      'Your charging token could not be synchronized with the charging network. Please try again shortly.',
    );
  }

  return owned;
}
