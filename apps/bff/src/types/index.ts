// apps/bff/src/types/index.ts

import { PaymentProviderType } from "@pithcharge/payment-adapters";

export type BillingMode =
  "WALLET" | "DIRECT_CARD" | "SUPPORT_OVERRIDE" | "FLEET_ACCOUNT";

export type Action =
  | "ocpp:RemoteStart"
  | "ocpp:ResetHardware"
  | "ocpp:GetDiagnostics"
  | "station:Read"
  | "station:Write"
  | "session:Control"
  | "organization:ManageMembers";

export interface ResourceAttributes {
  stationId: string;
  isOnline: boolean;
  connectorStatus: "Available" | "Charging" | "Faulted" | "Unavailable";
  ownerOrganizationId: string;
}

export interface RemoteStartContext {
  stationId: string;
  connectorId: number;
  billingMode: BillingMode;
  cardPreAuthValid?: boolean;
}
export interface DriverRemoteStartBody {
  connectorId: number;
  billingMode: BillingMode;
  // Gateway-specific payment instrument token passed from Driver UI
  paymentMethodId?: string; 
  paymentProvider?: PaymentProviderType;
}