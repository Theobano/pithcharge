import {
  ICmsAdapter,
  RemoteStartParams,
  RemoteStopParams,
  ResetParams,
  UnlockConnectorParams,
  ChangeAvailabilityParams,
  SetChargingProfileParams,
  TriggerMessageParams,
  CmsCommandResult,
  StationStatusResult,
  ActiveSession,
  TelemetrySample,
  CmsTransaction,
  CmsWebhookEvent,
  StationQueryParams,
  HubQueryParams,
  PaginatedResult,
  ChargingHubDetails,
  StationDetails,
  EvseDetails,
  ConnectorStatus,
  ConnectorType,
  MapClusterQueryParams,
  MapClusterResult,
  MapClusterItem,
  MapPointCluster,
  MapPointHub,
  GeoLocation,
  SyncIdTokenParams,
  SyncIdTokenResult,
  CmsAuthorization,
  CmsTariff,
  CmsAuthorizationInput,
  AuthorizationQueryParams,
} from "../types";

export interface CitrineOsConfig {
  /** REST API Base URL (e.g. https://api.citrineos.io) */
  baseUrl: string;
  /** Hasura GraphQL Endpoint (defaults to `${baseUrl}/graphql`) */
  graphqlUrl?: string;
  /** Authorization Bearer Token */
  apiKey?: string;
  /** Hasura Admin Secret (if header auth is required) */
  adminSecret?: string;
  tenantId?: string;
}

// -----------------------------------------------------------------------------
// Geospatial Distance Helper
// -----------------------------------------------------------------------------

function calculateDistanceKm(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const earthRadiusKm = 6371;
  const deltaLatitude = ((latitude2 - latitude1) * Math.PI) / 180;
  const deltaLongitude = ((longitude2 - longitude1) * Math.PI) / 180;

  const haversineComponent =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos((latitude1 * Math.PI) / 180) *
      Math.cos((latitude2 * Math.PI) / 180) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);

  const angularDistance =
    2 * Math.atan2(Math.sqrt(haversineComponent), Math.sqrt(1 - haversineComponent));

  return earthRadiusKm * angularDistance;
}

import {
  CHARGING_STATIONS_LIST_QUERY,
  CHARGING_STATIONS_GET_BY_PK_QUERY,
  ACTIVE_TRANSACTIONS_QUERY,
  TRANSACTION_BY_ID_QUERY,
  TRANSACTIONS_SINCE_QUERY,
  LATEST_METER_VALUES_QUERY,
  LOCATIONS_LIST_QUERY,
  LOCATIONS_GET_QUERY,
} from "./queries/inventory";
import {
  AUTHORIZATIONS_LIST_QUERY,
  AUTHORIZATIONS_SHOW_QUERY,
  AUTHORIZATIONS_CREATE_MUTATION,
  AUTHORIZATIONS_EDIT_MUTATION,
  AUTHORIZATIONS_DELETE_MUTATION,
} from "./queries/authorizations";
import { CHARGING_STATION_SEQUENCES_GET_QUERY } from "./queries/charging.station.sequences";
import { TARIFF_GET_QUERY, TARIFFS_BY_IDS_QUERY } from "./queries/tariffs";
import { parseTelemetry } from "./telemetry";
import { aggregateEvseStatus, resolveConnectorStatus } from "./status";

// -----------------------------------------------------------------------------
// Adapter Implementation
// -----------------------------------------------------------------------------

export class CitrineOsAdapter implements ICmsAdapter {
  readonly providerName = "CitrineOS";
  private baseUrl: string;
  private graphqlUrl: string;
  private apiKey?: string;
  private adminSecret?: string;
  private tenantId?: string;

  constructor(config: CitrineOsConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.graphqlUrl = config.graphqlUrl || `${this.baseUrl}/graphql`;
    this.apiKey = config.apiKey;
    this.adminSecret = config.adminSecret;
    this.tenantId = config.tenantId;
  }

  async syncIdToken(params: SyncIdTokenParams): Promise<SyncIdTokenResult> {
    const found = await this.executeGraphQL<{ Authorizations: CmsAuthorization[] }>(
      AUTHORIZATIONS_LIST_QUERY,
      {
        offset: 0,
        limit: 1,
        where: { idToken: { _eq: params.idToken } },
      },
    );
    const existing = found.Authorizations[0];

    if (existing) {
      if (!params.force) {
        return { created: false, status: existing.status, idTokenType: existing.idTokenType };
      }
      const updated = await this.updateAuthorization(existing.id, {
        status: params.status,
        idTokenType: params.idTokenType,
      });
      return { created: false, status: updated.status, idTokenType: updated.idTokenType };
    }

    const created = await this.createAuthorization({
      idToken: params.idToken,
      idTokenType: params.idTokenType,
      status: params.status,
      concurrentTransaction: params.concurrentTransaction ?? false,
    });
    return { created: true, status: created.status, idTokenType: created.idTokenType };
  }

  // ---------------------------------------------------------------------------
  // Authorizations
  // ---------------------------------------------------------------------------

  async listAuthorizations(
    params: AuthorizationQueryParams = {},
  ): Promise<PaginatedResult<CmsAuthorization>> {
    const page = Math.max(params.page ?? 1, 1);
    const limit = Math.min(Math.max(params.pageSize ?? 25, 1), 200);
    const where: Record<string, unknown> = {};
    if (params.idToken) where.idToken = { _ilike: `%${params.idToken}%` };
    if (params.status) where.status = { _eq: params.status };

    const data = await this.executeGraphQL<{
      Authorizations: CmsAuthorization[];
      Authorizations_aggregate: { aggregate: { count: number } };
    }>(AUTHORIZATIONS_LIST_QUERY, {
      offset: (page - 1) * limit,
      limit,
      order_by: { createdAt: "desc" },
      where,
    });

    return {
      data: data.Authorizations,
      total: data.Authorizations_aggregate.aggregate.count,
      page,
      limit,
    };
  }

  async getAuthorization(id: number): Promise<CmsAuthorization | null> {
    const data = await this.executeGraphQL<{ Authorizations_by_pk: CmsAuthorization | null }>(
      AUTHORIZATIONS_SHOW_QUERY,
      { id },
    );
    return data.Authorizations_by_pk;
  }

  async createAuthorization(input: CmsAuthorizationInput): Promise<CmsAuthorization> {
    const now = new Date().toISOString();
    const object = {
      additionalInfo: null,
      concurrentTransaction: false,
      ...input,
      tenantId: Number(this.tenantId ?? "1"),
      createdAt: now,
      updatedAt: now,
    };
    const data = await this.executeGraphQL<{ insert_Authorizations_one: CmsAuthorization }>(
      AUTHORIZATIONS_CREATE_MUTATION,
      { object },
    );
    return data.insert_Authorizations_one;
  }

  async updateAuthorization(
    id: number,
    input: Partial<CmsAuthorizationInput>,
  ): Promise<CmsAuthorization> {
    const data = await this.executeGraphQL<{ update_Authorizations_by_pk: CmsAuthorization }>(
      AUTHORIZATIONS_EDIT_MUTATION,
      { id, object: { ...input, updatedAt: new Date().toISOString() } },
    );
    return data.update_Authorizations_by_pk;
  }

  async deleteAuthorization(id: number): Promise<CmsAuthorization | null> {
    const data = await this.executeGraphQL<{ delete_Authorizations_by_pk: CmsAuthorization | null }>(
      AUTHORIZATIONS_DELETE_MUTATION,
      { id },
    );
    return data.delete_Authorizations_by_pk;
  }

  /** Runs any CitrineOS Hasura document (see `citrineOsQueries`) with tenant headers applied. */
  query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.executeGraphQL<T>(document, variables);
  }
  // ---------------------------------------------------------------------------
  // HTTP & GraphQL Helpers
  // ---------------------------------------------------------------------------

  private get restHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    return headers;
  }

  private async executeGraphQL<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    if (this.adminSecret) {
      headers["x-hasura-admin-secret"] = this.adminSecret;
      headers["x-hasura-role"] = "admin";
    }
    headers["x-hasura-tenant-id"] = this.tenantId ?? "1";

    const response = await fetch(this.graphqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(
        `CitrineOS GraphQL request failed with status ${response.status}: ${response.statusText}`,
      );
    }

    const result = await response.json();
    if (result.errors && result.errors.length > 0) {
      throw new Error(`CitrineOS GraphQL Error: ${result.errors[0].message}`);
    }

    return result.data as T;
  }

  // ---------------------------------------------------------------------------
  // Inventory & Hub Queries
  // ---------------------------------------------------------------------------

  private tariffCache = new Map<number, { pricePerKwh: number; currency: string; expiresAt: number }>();

  // Resolves connector tariff ids to real prices so mapping stays synchronous.
  private async warmTariffs(rawStations: any[]): Promise<void> {
    const now = Date.now();
    const ids = new Set<number>();
    for (const station of rawStations) {
      const connectors = [
        ...(station?.evses || []).flatMap((evse: any) => evse.connectors || []),
        ...(station?.connectors || []),
      ];
      for (const connector of connectors) {
        const id = Number(connector?.tariffId);
        if (Number.isInteger(id) && (this.tariffCache.get(id)?.expiresAt ?? 0) <= now) ids.add(id);
      }
    }
    if (ids.size === 0) return;
    try {
      const result = await this.executeGraphQL<{ Tariffs: any[] }>(TARIFFS_BY_IDS_QUERY, {
        ids: [...ids],
      });
      for (const row of result.Tariffs || []) {
        this.tariffCache.set(Number(row.id), {
          pricePerKwh: Number(row.pricePerKwh ?? 0),
          currency: row.currency || "USD",
          expiresAt: now + 5 * 60_000,
        });
      }
    } catch {
      // Prices are informational here; fall back to "no tariff" rather than failing listings.
    }
  }

  private rawStationsOf(locations: any[]): any[] {
    return locations.flatMap((location) => location?.chargingStations || []);
  }

  async listHubs(
    params?: HubQueryParams,
  ): Promise<PaginatedResult<ChargingHubDetails>> {
    try {
      const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100);
      const page = Math.max(params?.page ?? 1, 1);
      const offset = (page - 1) * limit;

      const whereClause: Record<string, unknown> = {};
      if (params?.search) {
        whereClause["_or"] = [
          { name: { _ilike: `%${params.search}%` } },
          { address: { _ilike: `%${params.search}%` } },
          { city: { _ilike: `%${params.search}%` } },
        ];
      }

      const response = await this.executeGraphQL<{
        Locations: any[];
        Locations_aggregate: { aggregate: { count: number } };
      }>(LOCATIONS_LIST_QUERY, { offset, limit, where: whereClause });

      await this.warmTariffs(this.rawStationsOf(response.Locations));
      const hubs = response.Locations.map((rawLocation) =>
        this.mapHubDetails(rawLocation),
      );

      return {
        data: hubs,
        total:
          response.Locations_aggregate?.aggregate?.count ?? hubs.length,
        page,
        limit,
      };
    } catch (error) {
      throw new Error("Failed to list charging hubs from CitrineOS.", {
        cause: error,
      });
    }
  }

  async getHubDetails(hubId: string): Promise<ChargingHubDetails | null> {
    try {
      const numericHubId = parseInt(hubId, 10);
      if (isNaN(numericHubId)) return null;

      const response = await this.executeGraphQL<{ Locations_by_pk: any }>(
        LOCATIONS_GET_QUERY,
        { id: numericHubId },
      );

      if (!response.Locations_by_pk) return null;
      await this.warmTariffs(this.rawStationsOf([response.Locations_by_pk]));
      return this.mapHubDetails(response.Locations_by_pk);
    } catch (error) {
      throw new Error(`Failed to load charging hub ${hubId} from CitrineOS.`, {
        cause: error,
      });
    }
  }

  async listStations(
    params?: StationQueryParams,
  ): Promise<PaginatedResult<StationDetails>> {
    try {
      const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100);
      const page = Math.max(params?.page ?? 1, 1);
      const offset = (page - 1) * limit;

      const whereClause: Record<string, unknown> = {};
      if (params?.hubId) {
        const numericHubId = parseInt(params.hubId, 10);
        if (!isNaN(numericHubId)) {
          whereClause["locationId"] = { _eq: numericHubId };
        }
      }

      if (params?.search) {
        whereClause["_or"] = [
          { ocppConnectionName: { _ilike: `%${params.search}%` } },
          { chargePointVendor: { _ilike: `%${params.search}%` } },
          { chargePointModel: { _ilike: `%${params.search}%` } },
        ];
      }

      if (params?.status) {
        if (params.status === "Online") whereClause["isOnline"] = { _eq: true };
        if (params.status === "Offline") whereClause["isOnline"] = { _eq: false };
      }

      const response = await this.executeGraphQL<{
        ChargingStations: any[];
        ChargingStations_aggregate: { aggregate: { count: number } };
      }>(CHARGING_STATIONS_LIST_QUERY, { offset, limit, where: whereClause });

      await this.warmTariffs(response.ChargingStations);
      const stations = response.ChargingStations.map((rawStation) =>
        this.mapStationDetails(rawStation),
      );

      return {
        data: stations,
        total:
          response.ChargingStations_aggregate?.aggregate?.count ?? stations.length,
        page,
        limit,
      };
    } catch (error) {
      throw new Error("Failed to list charging stations from CitrineOS.", {
        cause: error,
      });
    }
  }

  async getStationDetails(stationId: string): Promise<StationDetails | null> {
    try {
      const numericStationId = parseInt(stationId, 10);
      if (isNaN(numericStationId)) return null;

      const response = await this.executeGraphQL<{ ChargingStations_by_pk: any }>(
        CHARGING_STATIONS_GET_BY_PK_QUERY,
        { id: numericStationId },
      );

      if (!response.ChargingStations_by_pk) return null;
      await this.warmTariffs([response.ChargingStations_by_pk]);
      return this.mapStationDetails(response.ChargingStations_by_pk);
    } catch (error) {
      throw new Error(
        `Failed to load charging station ${stationId} from CitrineOS.`,
        { cause: error },
      );
    }
  }

  async getConnectorTariff(
    stationId: string,
    evseId: number,
    connectorId: number,
  ): Promise<CmsTariff | null> {
    const numericStationId = parseInt(stationId, 10);
    if (isNaN(numericStationId)) return null;
    const station = await this.executeGraphQL<{ ChargingStations_by_pk: any }>(
      CHARGING_STATIONS_GET_BY_PK_QUERY,
      { id: numericStationId },
    );
    const raw = station.ChargingStations_by_pk;
    if (!raw) return null;
    const connectors: any[] = [
      ...(raw.evses || []).flatMap((evse: any) =>
        (evse.connectors || []).map((connector: any) => ({ ...connector, parentEvse: evse })),
      ),
      ...(raw.connectors || []),
    ];
    const connector = connectors.find((item) => {
      const sameConnector = (item.connectorId ?? item.id) === connectorId;
      const evse = item.parentEvse;
      const sameEvse = evse
        ? evse.evseTypeId === evseId || evse.evseId === evseId
        : item.evseId === evseId || !item.evseId;
      return sameConnector && sameEvse && item.tariffId;
    });
    if (!connector) return null;

    const tariff = await this.executeGraphQL<{ Tariffs_by_pk: any }>(TARIFF_GET_QUERY, {
      id: Number(connector.tariffId),
    });
    const row = tariff.Tariffs_by_pk;
    if (!row) return null;
    return {
      id: String(row.id),
      currency: row.currency || "USD",
      pricePerKwh: Number(row.pricePerKwh ?? 0),
      pricePerMinute: Number(row.pricePerMin ?? 0),
      pricePerSession: Number(row.pricePerSession ?? 0),
    };
  }

  async getEvseDetails(
    stationId: string,
    evseId: number,
  ): Promise<EvseDetails | null> {
    const station = await this.getStationDetails(stationId);
    if (!station) return null;
    return station.evses.find((e) => e.evseId === evseId) || null;
  }

  // ---------------------------------------------------------------------------
  // Map Clustering & Geospatial Query
  // ---------------------------------------------------------------------------

  async getMapClusters(
    params?: MapClusterQueryParams,
  ): Promise<MapClusterResult> {
    try {
      const userLocationApplied =
        params?.userLat !== undefined && params?.userLng !== undefined;

      const locationWhereClause: Record<string, unknown> = {};

      if (params?.bbox) {
        locationWhereClause["coordinates"] = {
          _st_within: {
            type: "Polygon",
            coordinates: [
              [
                [params.bbox.swLng, params.bbox.swLat],
                [params.bbox.neLng, params.bbox.swLat],
                [params.bbox.neLng, params.bbox.neLat],
                [params.bbox.swLng, params.bbox.neLat],
                [params.bbox.swLng, params.bbox.swLat],
              ],
            ],
            crs: { type: "name", properties: { name: "EPSG:4326" } },
          },
        };
      }

      const chargingStationsWhereClause: Record<string, unknown> = {};

      if (params?.connectorType) {
        chargingStationsWhereClause["evses"] = {
          connectors: { type: { _ilike: `%${params.connectorType}%` } },
        };
      }

      if (params?.status) {
        if (params.status === "Online") {
          chargingStationsWhereClause["isOnline"] = { _eq: true };
        } else if (params.status === "Offline") {
          chargingStationsWhereClause["isOnline"] = { _eq: false };
        }
      }

      const response = await this.executeGraphQL<{
        Locations: any[];
        Locations_aggregate: { aggregate: { count: number } };
      }>(LOCATIONS_LIST_QUERY, {
        limit: Math.min(Math.max(params?.zoom ?? 10, 4) * 10, 100),
        offset: 0,
        where: locationWhereClause,
        chargingStationsWhere: chargingStationsWhereClause,
      });

      await this.warmTariffs(this.rawStationsOf(response.Locations));
      const mapHubItems: MapClusterItem[] = response.Locations.map((rawLocation) => {
        const rawStations = rawLocation.chargingStations || [];
        const mappedStations = rawStations.map((station: any) =>
          this.mapStationDetails(station),
        );

        const latitude =
          rawLocation.coordinates?.coordinates?.[1] ?? rawLocation.latitude ?? 0;
        const longitude =
          rawLocation.coordinates?.coordinates?.[0] ?? rawLocation.longitude ?? 0;

        const hubLocation: GeoLocation = {
          latitude,
          longitude,
          address: rawLocation.address,
          city: rawLocation.city,
          state: rawLocation.state,
          postalCode: rawLocation.postalCode,
          country: rawLocation.country,
        };

        let distanceKm: number | undefined;
        if (
          userLocationApplied &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude)
        ) {
          distanceKm = calculateDistanceKm(
            params.userLat!,
            params.userLng!,
            latitude,
            longitude,
          );
        }

        let totalChargersCount = 0;
        let availableChargersCount = 0;
        let onlineStationsCount = 0;

        const connectorSummaryMap = new Map<
          string,
          { type: ConnectorType; count: number; maxPowerKw: number }
        >();

        mappedStations.forEach((station:any) => {
          if (station.isOnline) {
            onlineStationsCount += 1;
          }

          station.evses.forEach((evse:any) => {
            evse.connectors.forEach((connector:any) => {
              totalChargersCount += 1;
              if (connector.status === "Available") {
                availableChargersCount += 1;
              }

              const typeKey = connector.type || "Standard";
              const existingSummary = connectorSummaryMap.get(typeKey);
              if (existingSummary) {
                existingSummary.count += 1;
                existingSummary.maxPowerKw = Math.max(
                  existingSummary.maxPowerKw,
                  connector.maxPowerKw,
                );
              } else {
                connectorSummaryMap.set(typeKey, {
                  type: connector.type,
                  count: 1,
                  maxPowerKw: connector.maxPowerKw,
                });
              }
            });
          });
        });

        const mapPointHub: MapPointHub = {
          type: "hub",
          id: String(rawLocation.id),
          name: rawLocation.name || `Hub #${rawLocation.id}`,
          location: hubLocation,
          totalStations: mappedStations.length,
          onlineStations: onlineStationsCount,
          totalChargers: totalChargersCount,
          availableChargers: availableChargersCount,
          connectorSummary: Array.from(connectorSummaryMap.values()),
          distanceKm,
          stations: mappedStations,
        };

        return mapPointHub;
      });
      const zoom = params?.zoom ?? 10;
      const items = zoom < 12
        ? this.clusterMapHubs(mapHubItems.filter(
            (item): item is MapPointHub => item.type === "hub",
          ), zoom)
        : mapHubItems;

      return {
        items,
        totalHubsCount:
          response.Locations_aggregate?.aggregate?.count ?? mapHubItems.length,
        userLocationApplied,
      };
    } catch (error) {
      throw new Error("Failed to fetch map hubs from CitrineOS.", {
        cause: error,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // REST Command Operations
  // ---------------------------------------------------------------------------

  /**
   * Sends an OCPP command through the CitrineOS core REST API, mirroring the operator UI:
   * POST {core}/ocpp/{version}/{module}/{action}?identifier={ocppConnectionName}&tenantId={tenantId}.
   * The core answers with one MessageConfirmation ({ success, payload }) per request.
   */
  private async sendOcppCommand(
    stationId: string,
    build: (
      version: "1.6" | "2.0.1",
    ) => Promise<{ path: string; body: Record<string, unknown> }> | { path: string; body: Record<string, unknown> },
  ): Promise<CmsCommandResult> {
    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        return { success: false, status: "Failed", message: `Station ${stationId} not found in CitrineOS.` };
      }
      const version = String(station.ocppVersion).replace(/^ocpp/, "") === "1.6" ? "1.6" : "2.0.1";
      const { path, body } = await build(version);
      const query = new URLSearchParams({
        identifier: station.ocppConnectionName,
        tenantId: this.tenantId ?? "1",
      });

      const response = await fetch(`${this.baseUrl}/ocpp/${version}${path}?${query.toString()}`, {
        method: "POST",
        headers: this.restHeaders,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const data: unknown = await response.json().catch(() => undefined);
      const confirmations = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
        success?: boolean;
        payload?: { status?: string; statusInfo?: { reasonCode?: string } } | string;
      }>;
      const payload = confirmations[0]?.payload;
      const chargerRejected =
        typeof payload === "object" && payload !== null && payload.status === "Rejected";
      const accepted =
        response.ok && confirmations.every((item) => item?.success) && !chargerRejected;

      return {
        success: accepted,
        status: accepted ? "Accepted" : "Rejected",
        message:
          typeof payload === "object" && payload
            ? payload.statusInfo?.reasonCode ?? payload.status
            : typeof payload === "string"
              ? payload
              : response.ok
                ? undefined
                : `CitrineOS responded with status ${response.status}`,
        rawResponse: { confirmations },
      };
    } catch (error) {
      return {
        success: false,
        status: "Failed",
        message: error instanceof Error ? error.message : "Network error communicating with CitrineOS",
      };
    }
  }

  private async nextRemoteStartId(stationId: string): Promise<number> {
    const data = await this.executeGraphQL<{ ChargingStationSequences: Array<{ value: number }> }>(
      CHARGING_STATION_SEQUENCES_GET_QUERY,
      { stationId: Number(stationId), type: "remoteStartId" },
    );
    return data.ChargingStationSequences[0]?.value ?? 0;
  }

  async remoteStartTransaction(
    params: RemoteStartParams,
  ): Promise<CmsCommandResult> {
    return this.sendOcppCommand(params.stationId, async (version) => {
      if (version === "1.6") {
        return {
          path: "/evdriver/remoteStartTransaction",
          body: { connectorId: params.connectorId ?? params.evseId, idTag: params.idToken },
        };
      }
      return {
        path: "/evdriver/requestStartTransaction",
        body: {
          remoteStartId: await this.nextRemoteStartId(params.stationId),
          evseId: params.evseId,
          idToken: { idToken: params.idToken, type: params.tokenType ?? "Central" },
          ...(params.chargingProfile && {
            chargingProfile: {
              id: 1,
              stackLevel: 0,
              chargingProfilePurpose: "TxProfile",
              chargingProfileKind: "Absolute",
              chargingSchedule: [
                {
                  id: 1,
                  chargingRateUnit: "W",
                  chargingSchedulePeriod: [
                    { startPeriod: 0, limit: params.chargingProfile.limitKw * 1000 },
                  ],
                },
              ],
            },
          }),
        },
      };
    });
  }

  async remoteStopTransaction(
    params: RemoteStopParams,
  ): Promise<CmsCommandResult> {
    return this.sendOcppCommand(params.stationId, (version) => ({
      path: version === "1.6" ? "/evdriver/remoteStopTransaction" : "/evdriver/requestStopTransaction",
      // OCPP 1.6 transaction IDs are integers; 2.0.1 uses strings.
      body: {
        transactionId: version === "1.6" ? Number(params.transactionId) : params.transactionId,
      },
    }));
  }

  async resetStation(params: ResetParams): Promise<CmsCommandResult> {
    return this.sendOcppCommand(params.stationId, (version) => ({
      path: "/configuration/reset",
      body:
        version === "1.6"
          ? { type: params.type === "Hard" ? "Hard" : "Soft" }
          : { type: params.type === "Hard" ? "Immediate" : "OnIdle" },
    }));
  }

  async unlockConnector(
    params: UnlockConnectorParams,
  ): Promise<CmsCommandResult> {
    return this.sendOcppCommand(params.stationId, () => ({
      path: "/evdriver/unlockConnector",
      body: { evseId: params.evseId, connectorId: params.connectorId },
    }));
  }

  async changeAvailability(
    params: ChangeAvailabilityParams,
  ): Promise<CmsCommandResult> {
    return this.sendOcppCommand(params.stationId, (version) => ({
      path: "/configuration/changeAvailability",
      body:
        version === "1.6"
          ? {
              type: params.operationalStatus === "Operative" ? "Operative" : "Inoperative",
              connectorId: params.evseId ?? 0,
            }
          : {
              operationalStatus: params.operationalStatus,
              ...(params.evseId !== undefined && { evse: { id: params.evseId } }),
            },
    }));
  }

  async setChargingProfile(
    params: SetChargingProfileParams,
  ): Promise<CmsCommandResult> {
    return this.sendOcppCommand(params.stationId, () => ({
      path: "/smartcharging/setChargingProfile",
      body: {
        evseId: params.evseId,
        chargingProfile: {
          id: params.profileId,
          stackLevel: 0,
          chargingProfilePurpose: "TxDefaultProfile",
          chargingProfileKind: "Relative",
          chargingSchedule: [
            {
              id: params.profileId,
              chargingRateUnit: "W",
              chargingSchedulePeriod: [
                { startPeriod: params.startPeriodSec || 0, limit: params.limitKw * 1000 },
              ],
            },
          ],
        },
      },
    }));
  }

  async triggerMessage(
    params: TriggerMessageParams,
  ): Promise<CmsCommandResult> {
    return this.sendOcppCommand(params.stationId, (version) => ({
      path: "/configuration/triggerMessage",
      body:
        version === "1.6"
          ? {
              requestedMessage: params.requestedMessage,
              ...(params.evseId !== undefined && { connectorId: params.evseId }),
            }
          : {
              requestedMessage: params.requestedMessage,
              ...(params.evseId !== undefined && { evse: { id: params.evseId } }),
            },
    }));
  }

  // ---------------------------------------------------------------------------
  // Data & Status Queries
  // ---------------------------------------------------------------------------

  async getStationStatus(stationId: string): Promise<StationStatusResult> {
    const station = await this.getStationDetails(stationId);
    if (!station) {
      throw new Error(`Station ${stationId} not found in CitrineOS`);
    }

    return {
      stationId: station.id,
      hubId: station.hubId,
      ocppVersion: station.ocppVersion || "2.0.1",
      isOnline: station.isOnline,
      lastHeartbeat: station.lastHeartbeat,
      firmwareVersion: station.firmwareVersion,
      model: station.model,
      vendor: station.vendor,
      evses: station.evses,
    };
  }

  private mapActiveSession(tx: any, telemetry?: TelemetrySample): ActiveSession {
    const currentMeterKwh = telemetry?.energyKwh ?? tx.totalKwh ?? 0;
    return {
      transactionId: String(tx.transactionId),
      stationId: String(tx.stationId),
      evseId: tx.evseId,
      connectorId: tx.Connector?.connectorId ?? undefined,
      idToken: tx.Authorization?.idToken ?? "",
      startTime: tx.createdAt,
      meterStartKwh: 0,
      currentMeterKwh,
      sessionEnergyKwh: typeof tx.totalKwh === "number" ? tx.totalKwh : undefined,
      latestTelemetry: telemetry,
    };
  }

  // Best-effort: telemetry must never break session lookups.
  private async loadTelemetry(transactionDatabaseId: number): Promise<TelemetrySample | undefined> {
    try {
      const response = await this.executeGraphQL<{
        MeterValues: Array<{ timestamp: string; sampledValue: unknown }>;
      }>(LATEST_METER_VALUES_QUERY, { transactionDatabaseId, limit: 30 });
      return parseTelemetry(response.MeterValues);
    } catch {
      return undefined;
    }
  }

  async getTransaction(stationId: string, transactionId: string): Promise<CmsTransaction | null> {
    const numericStationId = parseInt(stationId, 10);
    try {
      const response = await this.executeGraphQL<{ Transactions: any[] }>(
        TRANSACTION_BY_ID_QUERY,
        {
          where: {
            transactionId: { _eq: transactionId },
            ...(isNaN(numericStationId) ? {} : { stationId: { _eq: numericStationId } }),
          },
        },
      );
      const tx = response.Transactions[0];
      if (!tx) return null;
      const telemetry = await this.loadTelemetry(tx.id);
      return {
        ...this.mapActiveSession(tx, telemetry),
        startTime: tx.startTime ?? tx.createdAt,
        isActive: Boolean(tx.isActive),
        endTime: tx.endTime ?? undefined,
        stoppedReason: tx.stoppedReason ?? undefined,
        chargingState: tx.chargingState ?? undefined,
      };
    } catch (error) {
      throw new Error(`Failed to load transaction ${transactionId} from CitrineOS.`, { cause: error });
    }
  }

  async findTransactionsSince(stationId: string, idToken: string, since: string): Promise<CmsTransaction[]> {
    const numericStationId = parseInt(stationId, 10);
    try {
      const response = await this.executeGraphQL<{ Transactions: any[] }>(TRANSACTIONS_SINCE_QUERY, {
        where: {
          createdAt: { _gte: since },
          Authorization: { idToken: { _eq: idToken } },
          ...(isNaN(numericStationId) ? {} : { stationId: { _eq: numericStationId } }),
        },
      });
      return Promise.all(
        response.Transactions.map(async (tx) => ({
          ...this.mapActiveSession(tx, await this.loadTelemetry(tx.id)),
          startTime: tx.startTime ?? tx.createdAt,
          isActive: Boolean(tx.isActive),
          endTime: tx.endTime ?? undefined,
          stoppedReason: tx.stoppedReason ?? undefined,
          chargingState: tx.chargingState ?? undefined,
        })),
      );
    } catch (error) {
      throw new Error(`Failed to search transactions on station ${stationId} in CitrineOS.`, { cause: error });
    }
  }

  async getActiveSession(transactionId: string): Promise<ActiveSession | null> {
    try {
      const response = await this.executeGraphQL<{ Transactions: any[] }>(
        ACTIVE_TRANSACTIONS_QUERY,
        {
          where: {
            transactionId: { _eq: transactionId },
            isActive: { _eq: true },
          },
        },
      );

      const tx = response.Transactions[0];
      if (!tx) return null;

      return this.mapActiveSession(tx, await this.loadTelemetry(tx.id));
    } catch (error) {
      throw new Error(
        `Failed to load active charging transaction ${transactionId} from CitrineOS.`,
        { cause: error },
      );
    }
  }

  async listActiveSessions(stationId?: string): Promise<ActiveSession[]> {
    try {
      const whereClause: Record<string, unknown> = { isActive: { _eq: true } };
      if (stationId) {
        const numericStationId = parseInt(stationId, 10);
        if (!isNaN(numericStationId)) whereClause["stationId"] = { _eq: numericStationId };
      }

      const response = await this.executeGraphQL<{ Transactions: any[] }>(
        ACTIVE_TRANSACTIONS_QUERY,
        { where: whereClause },
      );

      return Promise.all(
        response.Transactions.map(async (tx) =>
          this.mapActiveSession(tx, await this.loadTelemetry(tx.id)),
        ),
      );
    } catch (error) {
      throw new Error("Failed to list active charging transactions from CitrineOS.", {
        cause: error,
      });
    }
  }

  async parseWebhookEvent(
    _headers: Record<string, string>,
    body: unknown,
  ): Promise<CmsWebhookEvent> {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error('CitrineOS webhook body must be an object.');
    }
    const bodyRecord = body as Record<string, unknown>;
    const nestedPayload = bodyRecord.payload;
    const payload = nestedPayload && typeof nestedPayload === 'object' && !Array.isArray(nestedPayload)
      ? { ...bodyRecord, ...(nestedPayload as Record<string, unknown>) }
      : bodyRecord;
    const eventType = payload.action ?? payload.eventType;
    const allowedEventTypes: CmsWebhookEvent['eventType'][] = [
      'TransactionStarted',
      'TransactionEnded',
      'MeterValues',
      'StatusNotification',
      'Heartbeat',
    ];
    if (
      typeof eventType !== 'string' ||
      !allowedEventTypes.includes(eventType as CmsWebhookEvent['eventType'])
    ) {
      throw new Error('CitrineOS webhook contains an unsupported event type.');
    }
    const stationId = payload.stationId;
    if (typeof stationId !== 'string' || !stationId.trim()) {
      throw new Error('CitrineOS webhook is missing stationId.');
    }
    const timestamp = payload.timestamp;
    if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) {
      throw new Error('CitrineOS webhook contains an invalid timestamp.');
    }
    return {
      eventType: eventType as CmsWebhookEvent['eventType'],
      stationId,
      timestamp,
      payload,
    };
  }

  // ---------------------------------------------------------------------------
  // Data Mapper Helpers
  // ---------------------------------------------------------------------------

  private clusterMapHubs(hubs: MapPointHub[], zoom: number): MapClusterItem[] {
    const cellSize = 360 / 2 ** zoom;
    const groups = new Map<string, MapPointHub[]>();

    for (const hub of hubs) {
      const latitudeCell = Math.floor(hub.location.latitude / cellSize);
      const longitudeCell = Math.floor(hub.location.longitude / cellSize);
      const key = `${latitudeCell}:${longitudeCell}`;
      const group = groups.get(key);
      if (group) {
        group.push(hub);
      } else {
        groups.set(key, [hub]);
      }
    }

    const clusters: MapClusterItem[] = [];
    for (const [key, group] of groups) {
      if (group.length === 1) {
        const hub = group[0];
        if (hub) clusters.push(hub);
        continue;
      }

      const latitudes = group.map((hub) => hub.location.latitude);
      const longitudes = group.map((hub) => hub.location.longitude);
      const south = Math.min(...latitudes);
      const north = Math.max(...latitudes);
      const west = Math.min(...longitudes);
      const east = Math.max(...longitudes);
      const cluster: MapPointCluster = {
        type: "cluster",
        id: `cluster-${key}`,
        latitude: (south + north) / 2,
        longitude: (west + east) / 2,
        pointCount: group.length,
        totalChargers: group.reduce((sum, hub) => sum + hub.totalChargers, 0),
        bounds: {
          swLat: south,
          swLng: west,
          neLat: north,
          neLng: east,
        },
      };

      clusters.push(cluster);
    }

    return clusters;
  }

  private mapHubDetails(rawLocation: any): ChargingHubDetails {
    const rawStations = rawLocation.chargingStations || [];
    const mappedStations = rawStations.map((station: any) =>
      this.mapStationDetails(station),
    );

    const latitude =
      rawLocation.coordinates?.coordinates?.[1] ?? rawLocation.latitude ?? 0;
    const longitude =
      rawLocation.coordinates?.coordinates?.[0] ?? rawLocation.longitude ?? 0;

    return {
      id: String(rawLocation.id),
      name: rawLocation.name || `Hub #${rawLocation.id}`,
      description: rawLocation.parkingType ? `Parking: ${rawLocation.parkingType}` : undefined,
      location: {
        latitude,
        longitude,
        address: rawLocation.address,
        city: rawLocation.city,
        state: rawLocation.state,
        postalCode: rawLocation.postalCode,
        country: rawLocation.country,
      },
      accessType: "Public",
      stations: mappedStations,
    };
  }

  private mapStationDetails(rawStation: any): StationDetails {
    const rawEvses = rawStation.evses || [];
    const rawConnectors = rawStation.connectors || [];
    const isOnline = rawStation.isOnline ?? false;
    const latestNotifications: any[] = (rawStation.LatestStatusNotifications || [])
      .map((entry: any) => entry?.StatusNotification)
      .filter(Boolean);

    return {
      id: String(rawStation.id),
      hubId: String(rawStation.locationId || rawStation.location?.id || ""),
      ocppConnectionName: rawStation.ocppConnectionName,
      label: rawStation.chargePointModel
        ? `${rawStation.chargePointVendor || ""} ${rawStation.chargePointModel}`.trim()
        : rawStation.ocppConnectionName,
      vendor: rawStation.chargePointVendor,
      model: rawStation.chargePointModel,
      firmwareVersion: rawStation.firmwareVersion,
      ocppVersion: rawStation.protocol || "2.0.1",
      isOnline,
      lastHeartbeat: rawStation.updatedAt || new Date().toISOString(),
      evses: rawEvses.map((evse: any) => {
        // Connector.evseId references the Evse row id, not the OCPP evse id.
        const evseConnectors: any[] =
          evse.connectors ??
          rawConnectors.filter(
            (connector: any) => connector.evseId === evse.id || !connector.evseId,
          );
        const activeTransaction = (rawStation.transactions || []).find(
          (transaction: any) => transaction.evseId === evse.id,
        );

        const connectors = evseConnectors.map((connector: any) => {
          const tariff = connector.tariffId
            ? this.tariffCache.get(Number(connector.tariffId))
            : undefined;
          return {
          connectorId: connector.connectorId || connector.id,
          type: (connector.type || "CCS2") as ConnectorType,
          status: resolveConnectorStatus({
            isOnline,
            // StatusNotification ids are OCPP ids (evseTypeId / connectorId), not database row ids.
            latest: latestNotifications.find(
              (notification) =>
                notification.evseId === (evse.evseTypeId ?? evse.id) &&
                notification.connectorId ===
                  (connector.connectorId ?? connector.evseTypeConnectorId),
            ),
            storedStatus: connector.status,
            activeTransaction,
          }),
          maxPowerKw: connector.maximumPowerWatts
            ? connector.maximumPowerWatts / 1000
            : 150,
          tariffPerKwh: tariff && tariff.pricePerKwh > 0 ? tariff.pricePerKwh : undefined,
          currency: tariff?.currency ?? "NGN",
          };
        });
        const status = aggregateEvseStatus(connectors.map((connector: { status: ConnectorStatus }) => connector.status));

        return {
          evseId: evse.evseTypeId ?? evse.evseId ?? evse.id,
          status,
          physicalReference: evse.physicalReference || undefined,
          activeTransactionId:
            activeTransaction && (status === "Charging" || status === "Occupied")
              ? String(activeTransaction.transactionId)
              : undefined,
          connectors,
        };
      }),
    };
  }
}
