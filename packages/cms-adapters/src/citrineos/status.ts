import type { ConnectorStatus } from "../types";

const STATUS_MAP: Record<string, ConnectorStatus> = {
  Available: "Available",
  Occupied: "Occupied",
  // OCPP 1.6 values
  Preparing: "Occupied",
  Finishing: "Occupied",
  SuspendedEV: "Occupied",
  SuspendedEVSE: "Occupied",
  Charging: "Charging",
  Reserved: "Reserved",
  Faulted: "Faulted",
  Unavailable: "Unavailable",
};

const EVSE_PRIORITY: ConnectorStatus[] = [
  "Charging",
  "Occupied",
  "Reserved",
  "Available",
  "Faulted",
  "Unavailable",
];

interface ResolveInput {
  isOnline: boolean;
  /** Most recent StatusNotification reported by the charger. */
  latest?: { connectorStatus?: string | null };
  /** Connector row status, which can lag behind the latest notification. */
  storedStatus?: string | null;
  activeTransaction?: { chargingState?: string | null };
}

/**
 * The latest StatusNotification is the live truth; the stored connector status is only a fallback.
 * A leftover active transaction never makes an Available connector look busy.
 */
export function resolveConnectorStatus(input: ResolveInput): ConnectorStatus {
  if (!input.isOnline) return "Unavailable";
  const raw = input.latest?.connectorStatus ?? input.storedStatus;
  const status = (raw && STATUS_MAP[raw]) || "Unavailable";
  if (status === "Occupied" && input.activeTransaction?.chargingState === "Charging") {
    return "Charging";
  }
  return status;
}

export function aggregateEvseStatus(statuses: ConnectorStatus[]): ConnectorStatus {
  return EVSE_PRIORITY.find((candidate) => statuses.includes(candidate)) ?? "Unavailable";
}
