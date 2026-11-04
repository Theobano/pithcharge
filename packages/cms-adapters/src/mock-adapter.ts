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
  CmsTransaction,
  CmsWebhookEvent,
  StationDetails,
  StationQueryParams,
  PaginatedResult,
  EvseDetails,
  MapClusterQueryParams,
  MapClusterResult,
  MapClusterItem,
  MapPointHub,
  MapPointCluster,
  ChargingHubDetails,
  HubQueryParams,
  ConnectorType,
  GeoLocation,
  SyncIdTokenParams,
  SyncIdTokenResult,
  CmsAuthorization,
  CmsTariff,
  CmsAuthorizationInput,
  AuthorizationQueryParams,
} from './types';

const MOCK_HUBS: ChargingHubDetails[] = [
  {
    id: 'hub-ng-01',
    name: 'Victoria Island Hub',
    description: 'Downtown Lagos EV charging hub',
    location: {
      latitude: 6.4281,
      longitude: 3.4219,
      address: 'Ahmadu Bello Way, Victoria Island',
      city: 'Lagos',
      country: 'Nigeria',
    },
    accessType: 'Public',
    stations: [
      {
        id: 'STATION-NG-01',
        hubId: 'hub-ng-01',
        ocppConnectionName: 'victoria-island-hub',
        label: 'Victoria Island Hub',
        vendor: 'ABB',
        model: 'Terra 184',
        firmwareVersion: 'v3.2.1',
        ocppVersion: '2.0.1',
        isOnline: true,
        lastHeartbeat: new Date().toISOString(),
        evses: [
          {
            evseId: 1,
            status: 'Available',
            connectors: [
              { connectorId: 1, type: 'CCS2', status: 'Available', maxPowerKw: 150, tariffPerKwh: 250, currency: 'NGN' },
              { connectorId: 2, type: 'CCS2', status: 'Available', maxPowerKw: 150, tariffPerKwh: 250, currency: 'NGN' },
            ],
          },
          {
            evseId: 2,
            status: 'Charging',
            activeTransactionId: 'tx_mock_102',
            connectors: [
              { connectorId: 1, type: 'Type2', status: 'Charging', maxPowerKw: 22, tariffPerKwh: 120, currency: 'NGN' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'hub-ng-02',
    name: 'Ikeja City Mall Charger',
    description: 'Shopping-centre fast-charge location',
    location: {
      latitude: 6.6018,
      longitude: 3.3515,
      address: 'Obafemi Awolowo Way, Ikeja',
      city: 'Lagos',
      country: 'Nigeria',
    },
    accessType: 'Public',
    stations: [
      {
        id: 'STATION-NG-02',
        hubId: 'hub-ng-02',
        ocppConnectionName: 'ikeja-city-mall',
        label: 'Ikeja City Mall Charger',
        vendor: 'Tritium',
        model: 'PKM150',
        firmwareVersion: 'v2.1.0',
        ocppVersion: '2.0.1',
        isOnline: true,
        lastHeartbeat: new Date().toISOString(),
        evses: [
          {
            evseId: 1,
            status: 'Available',
            connectors: [
              { connectorId: 1, type: 'CCS2', status: 'Available', maxPowerKw: 60, tariffPerKwh: 200, currency: 'NGN' },
            ],
          },
          {
            evseId: 2,
            status: 'Available',
            connectors: [
              { connectorId: 1, type: 'Type2', status: 'Available', maxPowerKw: 100, tariffPerKwh: 100, currency: 'NGN' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'hub-ng-03',
    name: 'Lekki Phase 1 Charging Hub',
    description: 'Mixed-connector coastal charging site',
    location: {
      latitude: 6.4474,
      longitude: 3.4723,
      address: 'Admiralty Way, Lekki Phase 1',
      city: 'Lagos',
      country: 'Nigeria',
    },
    accessType: 'Public',
    stations: [
      {
        id: 'STATION-NG-03',
        hubId: 'hub-ng-03',
        ocppConnectionName: 'lekki-phase1-hub',
        label: 'Lekki Phase 1 Charging Hub',
        vendor: 'Schneider Electric',
        model: 'EVlink DC',
        firmwareVersion: 'v1.4.0',
        ocppVersion: '2.0.1',
        isOnline: true,
        lastHeartbeat: new Date().toISOString(),
        evses: [
          {
            evseId: 1,
            status: 'Available',
            connectors: [
              { connectorId: 1, type: 'CCS2', status: 'Available', maxPowerKw: 180, tariffPerKwh: 280, currency: 'NGN' },
              { connectorId: 2, type: 'CHAdeMO', status: 'Available', maxPowerKw: 50, tariffPerKwh: 220, currency: 'NGN' },
            ],
          },
        ],
      },
    ],
  },
];

export class MockCmsAdapter implements ICmsAdapter {
  readonly providerName = 'MockCSMS';

  private hubs = new Map<string, ChargingHubDetails>(MOCK_HUBS.map((hub) => [hub.id, hub]));
  private stations = new Map<string, StationDetails>(
    MOCK_HUBS.flatMap((hub) => hub.stations.map((station) => [station.id, station] as const)),
  );
  private sessions = new Map<string, ActiveSession>();

  private findStation(stationId: string): StationDetails | undefined {
    return this.stations.get(stationId);
  }

  private transformToMapPointHub(hub: ChargingHubDetails, userLat?: number, userLng?: number): MapPointHub {
    let totalChargers = 0;
    let availableChargers = 0;
    let onlineStations = 0;
    const connectorSummaryMap = new Map<string, { type: ConnectorType; count: number; maxPowerKw: number }>();

    hub.stations.forEach((station) => {
      if (station.isOnline) onlineStations += 1;

      station.evses.forEach((evse) => {
        const connectors = evse.connectors.length > 0 ? evse.connectors : [{ connectorId: 1, type: 'CCS2', status: evse.status || 'Available', maxPowerKw: 150, tariffPerKwh: 250, currency: 'NGN' }];

        connectors.forEach((connector) => {
          totalChargers += 1;
          if (connector.status === 'Available' || evse.status === 'Available') {
            availableChargers += 1;
          }

          const typeKey = connector.type || 'CCS2';
          const existingSummary = connectorSummaryMap.get(typeKey);
          if (existingSummary) {
            existingSummary.count += 1;
            existingSummary.maxPowerKw = Math.max(existingSummary.maxPowerKw, connector.maxPowerKw || 0);
          } else {
            connectorSummaryMap.set(typeKey, {
              type: typeKey,
              count: 1,
              maxPowerKw: connector.maxPowerKw || 150,
            });
          }
        });
      });
    });

    let distanceKm: number | undefined;
    if (userLat !== undefined && userLng !== undefined && hub.location) {
      const latDiff = hub.location.latitude - userLat;
      const lngDiff = hub.location.longitude - userLng;
      distanceKm = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111.32;
    }

    return {
      type: 'hub',
      id: hub.id,
      name: hub.name,
      location: hub.location,
      totalStations: hub.stations.length,
      onlineStations,
      totalChargers,
      availableChargers,
      connectorSummary: Array.from(connectorSummaryMap.values()),
      distanceKm,
      stations: hub.stations,
    };
  }

  async listHubs(params?: HubQueryParams): Promise<PaginatedResult<ChargingHubDetails>> {
    let results = Array.from(this.hubs.values());

    if (params?.search) {
      const term = params.search.toLowerCase();
      results = results.filter(
        (hub) =>
          hub.id.toLowerCase().includes(term) ||
          hub.name.toLowerCase().includes(term) ||
          hub.location.address?.toLowerCase().includes(term) ||
          hub.location.city?.toLowerCase().includes(term),
      );
    }

    if (params?.accessType) {
      results = results.filter((hub) => hub.accessType === params.accessType);
    }

    if (params?.connectorType) {
      results = results.filter((hub) =>
        hub.stations.some((station) =>
          station.evses.some((evse) => evse.connectors.some((connector) => connector.type === params.connectorType)),
        ),
      );
    }

    const limit = params?.limit || 20;
    const page = params?.page || 1;
    const start = (page - 1) * limit;

    return {
      data: results.slice(start, start + limit),
      total: results.length,
      page,
      limit,
    };
  }

  async getHubDetails(hubId: string): Promise<ChargingHubDetails | null> {
    return this.hubs.get(hubId) || null;
  }

  async listStations(params?: StationQueryParams): Promise<PaginatedResult<StationDetails>> {
    let results = Array.from(this.stations.values());

    if (params?.hubId) {
      results = results.filter((station) => station.hubId === params.hubId);
    }

    if (params?.search) {
      const term = params.search.toLowerCase();
      results = results.filter(
        (station) =>
          station.id.toLowerCase().includes(term) ||
          station.label?.toLowerCase().includes(term) ||
          station.ocppConnectionName.toLowerCase().includes(term),
      );
    }

    if (params?.status) {
      results = results.filter((station) => station.evses.some((evse) => evse.status === params.status));
    }

    if (params?.connectorType) {
      results = results.filter((station) =>
        station.evses.some((evse) => evse.connectors.some((connector) => connector.type === params.connectorType)),
      );
    }

    const limit = params?.limit || 20;
    const page = params?.page || 1;
    const start = (page - 1) * limit;

    return {
      data: results.slice(start, start + limit),
      total: results.length,
      page,
      limit,
    };
  }

  async getStationDetails(stationId: string): Promise<StationDetails | null> {
    return this.findStation(stationId) || null;
  }

  async getConnectorTariff(): Promise<CmsTariff | null> {
    return { id: 'mock', currency: 'NGN', pricePerKwh: 150, pricePerMinute: 0, pricePerSession: 0 };
  }

  async getEvseDetails(stationId: string, evseId: number): Promise<EvseDetails | null> {
    const station = this.findStation(stationId);
    if (!station) return null;
    return station.evses.find((evse) => evse.evseId === evseId) || null;
  }

  async getMapClusters(params: MapClusterQueryParams): Promise<MapClusterResult> {
    let hubs = Array.from(this.hubs.values());

    if (
      params.bbox?.swLat !== undefined &&
      params.bbox?.swLng !== undefined &&
      params.bbox?.neLat !== undefined &&
      params.bbox?.neLng !== undefined
    ) {
      hubs = hubs.filter((hub) => {
        const { latitude, longitude } = hub.location;
        return (
          latitude >= params.bbox!.swLat &&
          latitude <= params.bbox!.neLat &&
          longitude >= params.bbox!.swLng &&
          longitude <= params.bbox!.neLng
        );
      });
    }

    const pointHubs = hubs.map((hub) => this.transformToMapPointHub(hub, params.userLat, params.userLng));

    const zoom = params.zoom ?? 12;
    if (zoom >= 14) {
      return {
        items: pointHubs,
        totalHubsCount: pointHubs.length,
        userLocationApplied: params.userLat !== undefined && params.userLng !== undefined,
      };
    }

    const gridSize = 360 / Math.pow(2, zoom) / 4;
    const clusterBuckets = new Map<string, MapPointHub[]>();

    pointHubs.forEach((hub) => {
      const { latitude, longitude } = hub.location;
      const cellX = Math.floor(longitude / gridSize);
      const cellY = Math.floor(latitude / gridSize);
      const key = `${cellX}:${cellY}`;

      const bucket = clusterBuckets.get(key) || [];
      bucket.push(hub);
      clusterBuckets.set(key, bucket);
    });

    const items: MapClusterItem[] = [];

    clusterBuckets.forEach((bucket, key) => {
      if (bucket.length === 1) {
        items.push(bucket[0]!);
        return;
      }

      const pointCount = bucket.length;
      const latitudes = bucket.map((hub) => hub.location.latitude);
      const longitudes = bucket.map((hub) => hub.location.longitude);
      const totalChargers = bucket.reduce((sum, hub) => sum + hub.totalChargers, 0);

      const clusterPoint: MapPointCluster = {
        type: 'cluster',
        id: `cluster-${key}`,
        latitude: latitudes.reduce((sum, value) => sum + value, 0) / pointCount,
        longitude: longitudes.reduce((sum, value) => sum + value, 0) / pointCount,
        pointCount,
        totalChargers,
        bounds: {
          swLat: Math.min(...latitudes),
          swLng: Math.min(...longitudes),
          neLat: Math.max(...latitudes),
          neLng: Math.max(...longitudes),
        },
      };

      items.push(clusterPoint);
    });

    return {
      items,
      totalHubsCount: pointHubs.length,
      userLocationApplied: params.userLat !== undefined && params.userLng !== undefined,
    };
  }

  private authorizations: CmsAuthorization[] = [];
  private nextAuthorizationId = 1;

  async syncIdToken(params: SyncIdTokenParams): Promise<SyncIdTokenResult> {
    const existing = this.authorizations.find((auth) => auth.idToken === params.idToken);
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

  async listAuthorizations(
    params: AuthorizationQueryParams = {},
  ): Promise<PaginatedResult<CmsAuthorization>> {
    const page = Math.max(params.page ?? 1, 1);
    const limit = Math.min(Math.max(params.pageSize ?? 25, 1), 200);
    const filtered = this.authorizations.filter(
      (auth) =>
        (!params.idToken || auth.idToken.includes(params.idToken)) &&
        (!params.status || auth.status === params.status),
    );
    return {
      data: filtered.slice((page - 1) * limit, page * limit),
      total: filtered.length,
      page,
      limit,
    };
  }

  async getAuthorization(id: number): Promise<CmsAuthorization | null> {
    return this.authorizations.find((auth) => auth.id === id) ?? null;
  }

  async createAuthorization(input: CmsAuthorizationInput): Promise<CmsAuthorization> {
    const now = new Date().toISOString();
    const created: CmsAuthorization = {
      concurrentTransaction: false,
      ...input,
      id: this.nextAuthorizationId++,
      createdAt: now,
      updatedAt: now,
    };
    this.authorizations.push(created);
    return created;
  }

  async updateAuthorization(
    id: number,
    input: Partial<CmsAuthorizationInput>,
  ): Promise<CmsAuthorization> {
    const index = this.authorizations.findIndex((auth) => auth.id === id);
    if (index < 0) throw new Error(`Authorization ${id} not found`);
    const current = this.authorizations[index];
    if (!current) throw new Error(`Authorization ${id} not found`);
    const updated: CmsAuthorization = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    this.authorizations[index] = updated;
    return updated;
  }

  async deleteAuthorization(id: number): Promise<CmsAuthorization | null> {
    const index = this.authorizations.findIndex((auth) => auth.id === id);
    if (index < 0) return null;
    return this.authorizations.splice(index, 1)[0] ?? null;
  }

  async remoteStartTransaction(params: RemoteStartParams): Promise<CmsCommandResult> {
    const transactionId = `tx_mock_${Date.now()}`;
    const station = this.findStation(params.stationId);
    const newSession: ActiveSession = {
      transactionId,
      hubId: params.hubId || station?.hubId,
      stationId: params.stationId,
      evseId: params.evseId,
      connectorId: params.connectorId,
      idToken: params.idToken,
      startTime: new Date().toISOString(),
      meterStartKwh: 12.4,
      currentMeterKwh: 12.4,
      latestTelemetry: {
        timestamp: new Date().toISOString(),
        powerKw: params.chargingProfile?.limitKw || 50,
        energyKwh: 12.4,
        currentAmps: 72,
        voltage: 400,
        socPercent: 35,
      },
    };

    this.sessions.set(transactionId, newSession);

    return {
      success: true,
      status: 'Accepted',
      message: `Mock RemoteStart queued transaction ${transactionId}`,
      rawResponse: { transactionId },
    };
  }

  async remoteStopTransaction(params: RemoteStopParams): Promise<CmsCommandResult> {
    const session = this.sessions.get(params.transactionId);
    if (!session) {
      return { success: false, status: 'Rejected', message: 'Transaction ID not found' };
    }

    this.sessions.delete(params.transactionId);
    return { success: true, status: 'Accepted', message: 'Transaction stopped cleanly' };
  }

  async resetStation(_params: ResetParams): Promise<CmsCommandResult> {
    return { success: true, status: 'Accepted', message: 'Mock hard reset acknowledged' };
  }

  async unlockConnector(_params: UnlockConnectorParams): Promise<CmsCommandResult> {
    return { success: true, status: 'Accepted', message: 'Connector solenoid disengaged' };
  }

  async changeAvailability(_params: ChangeAvailabilityParams): Promise<CmsCommandResult> {
    return { success: true, status: 'Accepted' };
  }

  async setChargingProfile(_params: SetChargingProfileParams): Promise<CmsCommandResult> {
    return { success: true, status: 'Accepted' };
  }

  async triggerMessage(_params: TriggerMessageParams): Promise<CmsCommandResult> {
    return { success: true, status: 'Accepted' };
  }

  async getStationStatus(stationId: string): Promise<StationStatusResult> {
    const station = this.findStation(stationId);

    return {
      stationId,
      hubId: station?.hubId,
      ocppVersion: station?.ocppVersion || '2.0.1',
      isOnline: station?.isOnline ?? true,
      lastHeartbeat: station?.lastHeartbeat || new Date().toISOString(),
      firmwareVersion: station?.firmwareVersion,
      model: station?.model,
      vendor: station?.vendor,
      evses: station?.evses || [
        {
          evseId: 1,
          status: 'Available',
          connectors: [{ connectorId: 1, type: 'CCS2', status: 'Available', maxPowerKw: 150 }],
        },
      ],
    };
  }

  async getActiveSession(transactionId: string): Promise<ActiveSession | null> {
    return this.sessions.get(transactionId) || null;
  }

  async getTransaction(_stationId: string, transactionId: string): Promise<CmsTransaction | null> {
    const session = this.sessions.get(transactionId);
    return session ? { ...session, isActive: true } : null;
  }

  async findTransactionsSince(stationId: string, idToken: string, since: string): Promise<CmsTransaction[]> {
    const from = new Date(since).getTime();
    return Array.from(this.sessions.values())
      .filter(
        (session) =>
          session.stationId === stationId &&
          session.idToken === idToken &&
          new Date(session.startTime).getTime() >= from,
      )
      .map((session) => ({ ...session, isActive: true }));
  }

  async listActiveSessions(stationId?: string): Promise<ActiveSession[]> {
    const list = Array.from(this.sessions.values());
    return stationId ? list.filter((session) => session.stationId === stationId) : list;
  }

  async parseWebhookEvent(_headers: Record<string, string>, body: unknown): Promise<CmsWebhookEvent> {
    return {
      eventType: 'StatusNotification',
      stationId: 'STATION-NG-01',
      timestamp: new Date().toISOString(),
      payload: (body as Record<string, unknown>) || {},
    };
  }
}