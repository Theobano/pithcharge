import type { ICmsAdapter, OcppIdTokenType } from '@pithcharge/cms-adapters';

export class ChargingStartError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChargingStartError';
  }
}

export interface ChargingActor {
  userId: string;
  isAnonymous: boolean;
  /** Active organization of the session; ignored for anonymous accounts. */
  organizationId?: string;
  /** Default token of the account, used when the request names none. */
  defaultIdToken?: string;
}

export interface ChargingTarget {
  stationId: string;
  evseId: number;
  connectorId: number;
}

export interface ChargingToken {
  id: string;
  idToken: string;
  tokenType: OcppIdTokenType;
}

export interface StartChargingInput {
  actor: ChargingActor;
  stationId: string;
  evseId: number;
  connectorId?: number;
  idToken?: string;
  limitKw?: number;
  idempotencyKey?: string;
}

export interface BillingContext {
  cms: ICmsAdapter;
  actor: ChargingActor;
  target: ChargingTarget;
  token: ChargingToken;
  idempotencyKey?: string;
}

export type BillingPreparation =
  /** The request was already processed; return this body unchanged. */
  | { kind: 'replay'; body: Record<string, unknown> }
  /** Billing is set up and the session row exists; the charger may now be asked to start. */
  | {
      kind: 'ready';
      sessionId: string;
      /** Fields merged into the successful response. */
      responseExtras: Record<string, unknown>;
      /** Undo billing state and mark the session failed after the charger rejects the start. */
      rollback: () => Promise<void>;
    };

/** One implementation per billing model: organization wallet or public (no wallet). */
export interface BillingStrategy {
  readonly name: 'organization' | 'public';
  prepare(context: BillingContext): Promise<BillingPreparation>;
}

export interface StartChargingResult {
  /** False when the charger rejected the start; the body is then the CMS result. */
  accepted: boolean;
  /** True when an earlier identical request is being replayed. */
  replayed: boolean;
  body: Record<string, unknown>;
}
