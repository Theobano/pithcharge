import type { StationDetails } from '@pithcharge/cms-adapters';
import { ChargingStartError, type ChargingTarget } from './types';

/** Validates the station, EVSE and connector and picks a connector when none was requested. */
export function resolveChargingTarget(
  station: StationDetails | null | undefined,
  stationId: string,
  evseId: number,
  requestedConnectorId?: number,
): ChargingTarget {
  if (!station) throw new ChargingStartError(404, 'STATION_NOT_FOUND', 'Station not found.');
  if (!station.isOnline) throw new ChargingStartError(409, 'STATION_OFFLINE', 'Station is offline.');

  const evse = station.evses.find((candidate) => candidate.evseId === evseId);
  if (!evse) throw new ChargingStartError(404, 'EVSE_NOT_FOUND', 'EVSE not found on this station.');

  const connector = requestedConnectorId === undefined
    ? evse.connectors.find((candidate) => candidate.status === 'Available')
    : evse.connectors.find((candidate) => candidate.connectorId === requestedConnectorId);
  if (!connector || connector.status !== 'Available') {
    throw new ChargingStartError(
      409,
      'CONNECTOR_UNAVAILABLE',
      'The selected connector is not available.',
    );
  }

  return { stationId, evseId, connectorId: connector.connectorId };
}
