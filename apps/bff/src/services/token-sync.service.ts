import { OCPP_ID_TOKEN_TYPES, ICmsAdapter, OcppAuthorizationStatus, OcppAuthorizationStatusType, OcppIdTokenType } from '@pithcharge/cms-adapters';

export type TokenStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'BLOCKED' | 'DELETED';

export interface SyncTokenPayload {
  userId: string;
  idToken: string;
  status: TokenStatus;
  tokenType: OcppIdTokenType;
}

const AUTHORIZATION_STATUS: Record<TokenStatus, OcppAuthorizationStatus> = {
  PENDING_ACTIVATION: 'Accepted',
  ACTIVE: 'Accepted',
  BLOCKED: 'Blocked',
  DELETED: 'Invalid',
};

export function isOcppIdTokenType(value: unknown): value is OcppIdTokenType {
  return (OCPP_ID_TOKEN_TYPES as readonly string[]).includes(String(value));
}

/** Local token status implied by an authorization status held on the CMS. */
export function tokenStatusFromCms(status: OcppAuthorizationStatusType): TokenStatus {
  return status === 'Accepted' ? 'ACTIVE' : 'BLOCKED';
}

/**
 * Registers the token on the CMS when it is unknown there. An authorization that already exists
 * is never overwritten (the CMS is the source of truth); its status is returned as the local
 * status. Pass `force` only for explicit local actions such as blocking a token.
 */
export async function syncTokenToCms(
  cms: ICmsAdapter,
  token: {
    idToken: string;
    tokenType: OcppIdTokenType;
    status: TokenStatus;
    /** Registered accounts may run concurrent transactions; guest accounts may not. */
    concurrentTransaction?: boolean;
  },
  options: { force?: boolean } = {},
): Promise<{ status: TokenStatus; created: boolean }> {
  const result = await cms.syncIdToken({
    idToken: token.idToken,
    idTokenType: token.tokenType,
    status: AUTHORIZATION_STATUS[token.status],
    force: options.force,
    concurrentTransaction: token.concurrentTransaction,
  });
  return { status: tokenStatusFromCms(result.status), created: result.created };
}
