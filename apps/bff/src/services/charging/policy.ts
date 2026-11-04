/**
 * Account-level charging policy. The only differences between anonymous and registered
 * accounts are the concurrent-session limit, the absence of wallets and personalisation.
 * Billing is decided separately by the session's active organization (see `billing/`).
 */

/** An anonymous account may have at most one live session; registered accounts are unlimited. */
export const ANONYMOUS_MAX_LIVE_SESSIONS = 1;

/** Pending sessions older than this are treated as abandoned and no longer count as live. */
export const PENDING_SESSION_TTL_MS = 10 * 60 * 1000;

/** Value for the CMS authorization's `concurrentTransaction` flag. */
export function concurrentSessionsAllowed(isAnonymous: boolean): boolean {
  return !isAnonymous;
}

export function liveSessionFilter(now = Date.now()) {
  const staleBefore = new Date(now - PENDING_SESSION_TTL_MS);
  return {
    OR: [
      { status: 'ACTIVE' as const },
      { status: 'PENDING' as const, startTime: { gte: staleBefore } },
    ],
  };
}
