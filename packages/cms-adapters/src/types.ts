// ==========================================
// Standard Enums & Types
// ==========================================

export type OcppVersion = '1.6J' | '2.0.1';

export type StationOperationalStatus =
  | 'Available'
  | 'Preparing'
  | 'Charging'
  | 'SuspendedEVSE'
  | 'SuspendedEV'
  | 'Finishing'
  | 'Reserved'
  | 'Unavailable'
  | 'Faulted'
  | 'Online'
  | 'Offline';

export type ResetType = 'Hard' | 'Soft';

export type UnlockStatus =
  | 'Unlocked'
  | 'UnlockFailed'
  | 'OngoingAuthorizedTransaction'
  | 'UnknownConnector';

export type CommandStatus = 'Accepted' | 'Rejected' | 'Scheduled' | 'NotSupported' | 'Failed';

export type ConnectorStatus =
  | 'Available'
  | 'Occupied'
  | 'Charging'
  | 'Reserved'
  | 'Unavailable'
  | 'Faulted';

export type ConnectorType = 'CCS2' | 'Type2' | 'CHAdeMO' | 'NACS' | 'Type1' | (string & {});

export interface CmsCommandResult {
  success: boolean;
  status: CommandStatus;
  message?: string;
  rawResponse?: Record<string, unknown>;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  postalCode?: string;
  state?: string;
  country?: string;
}

// ==========================================
// Domain Hierarchy: Hub (Location) > Station > EVSE > Connector
// ==========================================

// Level 4: Connector
export interface ConnectorInfo {
  connectorId: number;
  type: ConnectorType;
  status: ConnectorStatus;
  maxPowerKw: number;
  tariffPerKwh?: number;
  currency?: string;
}

// Level 3: EVSE
export interface EvseDetails {
  evseId: number;
  /** Label printed on the charger hardware, when the CSMS has one. */
  physicalReference?: string;
  status?: StationOperationalStatus;
  activeTransactionId?: string;
  connectors: ConnectorInfo[];
}

// Level 2: Charging Station (Physical hardware communicating via OCPP)
export interface StationDetails {
  id: string;
  hubId: string;
  ocppConnectionName: string;
  label?: string;
  vendor?: string;
  model?: string;
  firmwareVersion?: string;
  ocppVersion: OcppVersion;
  isOnline: boolean;
  lastHeartbeat: string;
  evses: EvseDetails[];
}

// Level 1: Charging Hub (Physical location grouping multiple stations)
export interface ChargingHubDetails {
  id: string;
  name: string;
  description?: string;
  location: GeoLocation;
  accessType?: 'Public' | 'Private' | 'Restricted';
  stations: StationDetails[];
}

// ==========================================
// Command Request Payloads
// ==========================================

export interface RemoteStartParams {
  hubId?: string;
  stationId: string;
  evseId: number;
  connectorId?: number;
  idToken: string;
  tokenType?: OcppIdTokenType;
  chargingProfile?: {
    limitKw: number;
    numberOfPhases?: number;
  };
}

export interface RemoteStopParams {
  stationId: string;
  transactionId: string;
  reason?: 'Local' | 'Remote' | 'DeAuthorized' | 'EmergencyStop';
}

export interface ResetParams {
  stationId: string;
  type: ResetType;
}

export interface UnlockConnectorParams {
  stationId: string;
  evseId: number;
  connectorId: number;
}

export interface ChangeAvailabilityParams {
  stationId: string;
  evseId: number;
  operationalStatus: 'Operative' | 'Inoperative';
}

export interface SetChargingProfileParams {
  stationId: string;
  evseId: number;
  profileId: number;
  limitKw: number;
  startPeriodSec?: number;
  durationSec?: number;
}

export interface TriggerMessageParams {
  stationId: string;
  requestedMessage:
    | 'BootNotification'
    | 'Heartbeat'
    | 'MeterValues'
    | 'StatusNotification'
    | 'DiagnosticsStatus';
  evseId?: number;
}

// ==========================================
// Query & Data Response Interfaces
// ==========================================

export interface StationStatusResult {
  stationId: string;
  hubId?: string;
  ocppVersion: OcppVersion;
  isOnline: boolean;
  lastHeartbeat: string;
  firmwareVersion?: string;
  model?: string;
  vendor?: string;
  evses: EvseDetails[];
}

export interface TelemetrySample {
  timestamp: string;
  powerKw?: number;
  energyKwh: number;
  currentAmps?: number;
  voltage?: number;
  socPercent?: number;
}

export interface ActiveSession {
  transactionId: string;
  hubId?: string;
  stationId: string;
  evseId: number;
  connectorId?: number;
  idToken: string;
  startTime: string;
  meterStartKwh: number;
  currentMeterKwh: number;
  /** Energy delivered in this session, when the CMS reports it directly. */
  sessionEnergyKwh?: number;
  latestTelemetry?: TelemetrySample;
}

export interface CmsTransaction extends ActiveSession {
  isActive: boolean;
  endTime?: string;
  stoppedReason?: string;
  chargingState?: string;
}

export interface CmsWebhookEvent {
  eventType:
    | 'TransactionStarted'
    | 'TransactionEnded'
    | 'MeterValues'
    | 'StatusNotification'
    | 'Heartbeat';
  stationId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// Query parameters for Hub & Station listings
export interface HubQueryParams {
  search?: string;
  connectorType?: ConnectorType;
  minPowerKw?: number;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  accessType?: 'Public' | 'Private' | 'Restricted';
  page?: number;
  limit?: number;
}

export interface StationQueryParams {
  hubId?: string;
  ocppConnectionName?: string;
  search?: string;
  status?: StationOperationalStatus;
  connectorType?: ConnectorType;
  minPowerKw?: number;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ==========================================
// Geospatial & Map Clustering Extensions
// ==========================================

export interface MapBoundingBox {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export interface MapClusterQueryParams {
  bbox?: MapBoundingBox;
  zoom: number;
  userLat?: number;
  userLng?: number;
  connectorType?: ConnectorType;
  minPowerKw?: number;
  status?: StationOperationalStatus;
  minChargers?: number;
}

// Map markers represent Charging Hubs (Locations)
export interface MapPointHub {
  type: 'hub';
  id: string;
  name: string;
  location: GeoLocation;
  totalStations: number;
  onlineStations: number;
  totalChargers: number;
  availableChargers: number;
  connectorSummary: Array<{
    type: ConnectorType;
    count: number;
    maxPowerKw: number;
  }>;
  distanceKm?: number;
  stations: StationDetails[];
}

export interface MapPointCluster {
  type: 'cluster';
  id: string;
  latitude: number;
  longitude: number;
  pointCount: number;
  totalChargers: number;
  bounds: MapBoundingBox;
}

export type MapClusterItem = MapPointHub | MapPointCluster;

export interface MapClusterResult {
  items: MapClusterItem[];
  totalHubsCount: number;
  userLocationApplied: boolean;
}

// ==========================================
// Master CMS Adapter Interface
// ==========================================

/** OCPP 2.0.1 IdTokenEnumType values. */
export const OCPP_ID_TOKEN_TYPES = [
  'Central',
  'eMAID',
  'ISO14443',
  'ISO15693',
  'KeyCode',
  'Local',
  'MacAddress',
  'NoAuthorization',
] as const;
export type OcppIdTokenType = (typeof OCPP_ID_TOKEN_TYPES)[number];

/** Subset of OCPP 2.0.1 AuthorizationStatusEnumType used for token lifecycle. */
export type OcppAuthorizationStatus = 'Accepted' | 'Blocked' | 'Invalid';

export interface SyncIdTokenParams {
  idToken: string;
  idTokenType: OcppIdTokenType;
  status: OcppAuthorizationStatus;
  /** Overwrite an authorization that already exists on the CMS. Defaults to false: the CMS is the source of truth. */
  force?: boolean;
  /** Whether the token may run several transactions at once (only applied when the authorization is created). */
  concurrentTransaction?: boolean;
}

export interface SyncIdTokenResult {
  /** True when the authorization was newly registered on the CMS. */
  created: boolean;
  /** Authorization status as held by the CMS after the sync. */
  status: OcppAuthorizationStatusType;
  idTokenType: OcppIdTokenType | null;
}

/** OCPP 2.0.1 AuthorizationStatusEnumType. */
export const OCPP_AUTHORIZATION_STATUSES = [
  'Accepted',
  'Blocked',
  'ConcurrentTx',
  'Expired',
  'Invalid',
  'NoCredit',
  'NotAllowedTypeEVSE',
  'NotAtThisLocation',
  'NotAtThisTime',
  'Unknown',
] as const;
export type OcppAuthorizationStatusType = (typeof OCPP_AUTHORIZATION_STATUSES)[number];

export interface CmsAuthorization {
  id: number;
  idToken: string;
  idTokenType: OcppIdTokenType | null;
  status: OcppAuthorizationStatusType;
  groupAuthorizationId?: number | null;
  additionalInfo?: unknown;
  concurrentTransaction?: boolean | null;
  chargingPriority?: number | null;
  language1?: string | null;
  language2?: string | null;
  personalMessage?: unknown;
  cacheExpiryDateTime?: string | null;
  allowedConnectorTypes?: string[] | null;
  disallowedEvseIdPrefixes?: string[] | null;
  realTimeAuth?: string | null;
  realTimeAuthUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Writable authorization fields; `tenantId` and timestamps are filled in by the adapter. */
export type CmsAuthorizationInput = Omit<CmsAuthorization, 'id' | 'createdAt' | 'updatedAt'>;

export interface AuthorizationQueryParams {
  page?: number;
  pageSize?: number;
  idToken?: string;
  status?: OcppAuthorizationStatusType;
}

export interface CmsTariff {
  id: string;
  currency: string;
  pricePerKwh: number;
  pricePerMinute: number;
  pricePerSession: number;
}

export interface ICmsAdapter {
  readonly providerName: string;

  /**
   * Registers an id token on the CMS. An authorization that already exists is left untouched
   * (the CMS is the source of truth) and its current status is returned, unless `force` is set.
   * Throws on failure.
   */
  syncIdToken(params: SyncIdTokenParams): Promise<SyncIdTokenResult>;

  // Authorizations (OCPP id tokens)
  listAuthorizations(params?: AuthorizationQueryParams): Promise<PaginatedResult<CmsAuthorization>>;
  getAuthorization(id: number): Promise<CmsAuthorization | null>;
  createAuthorization(input: CmsAuthorizationInput): Promise<CmsAuthorization>;
  updateAuthorization(id: number, input: Partial<CmsAuthorizationInput>): Promise<CmsAuthorization>;
  deleteAuthorization(id: number): Promise<CmsAuthorization | null>;

  // Charging Hub & Inventory Queries
  listHubs(params?: HubQueryParams): Promise<PaginatedResult<ChargingHubDetails>>;
  getHubDetails(hubId: string): Promise<ChargingHubDetails | null>;
  listStations(params?: StationQueryParams): Promise<PaginatedResult<StationDetails>>;
  getStationDetails(stationId: string): Promise<StationDetails | null>;
  getEvseDetails(stationId: string, evseId: number): Promise<EvseDetails | null>;
  /** The tariff the CSMS assigns to a connector, or null when none is configured. */
  getConnectorTariff(stationId: string, evseId: number, connectorId: number): Promise<CmsTariff | null>;

  // Geospatial Map & Clustering Query
  getMapClusters(params: MapClusterQueryParams): Promise<MapClusterResult>;

  // Remote Control Operations
  remoteStartTransaction(params: RemoteStartParams): Promise<CmsCommandResult>;
  remoteStopTransaction(params: RemoteStopParams): Promise<CmsCommandResult>;
  resetStation(params: ResetParams): Promise<CmsCommandResult>;
  unlockConnector(params: UnlockConnectorParams): Promise<CmsCommandResult>;
  changeAvailability(params: ChangeAvailabilityParams): Promise<CmsCommandResult>;
  setChargingProfile(params: SetChargingProfileParams): Promise<CmsCommandResult>;
  triggerMessage(params: TriggerMessageParams): Promise<CmsCommandResult>;

  // Data & Status Queries
  getStationStatus(stationId: string): Promise<StationStatusResult>;
  getActiveSession(transactionId: string): Promise<ActiveSession | null>;
  /** Looks up a transaction whether or not it is still active (null when the CMS does not know it). */
  getTransaction(stationId: string, transactionId: string): Promise<CmsTransaction | null>;
  /** Transactions (active or ended) started by a token on a station since the given ISO time. */
  findTransactionsSince(stationId: string, idToken: string, since: string): Promise<CmsTransaction[]>;
  listActiveSessions(stationId?: string): Promise<ActiveSession[]>;

  // Webhook & Integration Handling
  parseWebhookEvent(headers: Record<string, string>, body: unknown): Promise<CmsWebhookEvent>;
}