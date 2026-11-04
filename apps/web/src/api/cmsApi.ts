import { toApiError } from '@/lib/api/error';
import { apiUrl } from '@/lib/api/base-url';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  StationDetails,
  PaginatedResult,
  StationQueryParams,
  StationStatusResult,
  ActiveSession,
  CmsCommandResult,
  ChargingHubDetails,
  HubQueryParams,
} from '@pithcharge/cms-adapters';

const API_BASE = { toString: apiUrl };

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    throw await toApiError(res, `HTTP error ${res.status}`);
  }
  return res.json();
}

// ------------------------------------------
// Hooks
// ------------------------------------------

const PAGE_SIZE = 100;

// Walks every page so lists are not silently truncated at the page size.
async function fetchAllPages<T>(
  base: string,
  params: URLSearchParams,
): Promise<PaginatedResult<T>> {
  const items: T[] = [];
  let total = 0;
  for (let page = 1; page <= 50; page += 1) {
    const query = new URLSearchParams(params);
    query.set('page', String(page));
    query.set('limit', String(PAGE_SIZE));
    const result = await fetchJson<PaginatedResult<T>>(`${base}?${query.toString()}`);
    items.push(...result.data);
    total = result.total;
    if (result.data.length < PAGE_SIZE || items.length >= total) break;
  }
  return { data: items, total: Math.max(total, items.length), page: 1, limit: items.length };
}

export function useStations(params?: StationQueryParams & { all?: boolean }) {
  const queryParams = new URLSearchParams();
  if (params?.search) queryParams.set('search', params.search);
  if (params?.status) queryParams.set('status', params.status);
  if (params?.connectorType) queryParams.set('connectorType', params.connectorType);
  if (params?.page) queryParams.set('page', String(params.page));
  if (params?.limit) queryParams.set('limit', String(params.limit));

  return useQuery<PaginatedResult<StationDetails>>({
    queryKey: ['stations', params],
    queryFn: () => params?.all
      ? fetchAllPages<StationDetails>(`${API_BASE}/stations`, queryParams)
      : fetchJson(`${API_BASE}/stations?${queryParams.toString()}`),
    refetchInterval: 10_000,
  });
}

export function useHubs(params?: HubQueryParams & { all?: boolean }) {
  const queryParams = new URLSearchParams();
  if (params?.search) queryParams.set('search', params.search);
  if (params?.accessType) queryParams.set('accessType', params.accessType);
  if (params?.connectorType) queryParams.set('connectorType', params.connectorType);
  if (params?.page) queryParams.set('page', String(params.page));
  if (params?.limit) queryParams.set('limit', String(params.limit));

  return useQuery<PaginatedResult<ChargingHubDetails>>({
    queryKey: ['hubs', params],
    queryFn: () => params?.all
      ? fetchAllPages<ChargingHubDetails>(`${API_BASE}/hubs`, queryParams)
      : fetchJson(`${API_BASE}/hubs?${queryParams.toString()}`),
    refetchInterval: 10_000,
  });
}

export function useHubDetails(hubId: string) {
  return useQuery<ChargingHubDetails>({
    queryKey: ['hub', hubId],
    queryFn: () => fetchJson(`${API_BASE}/hubs/${encodeURIComponent(hubId)}`),
    enabled: !!hubId,
    refetchInterval: 10_000,
  });
}

export function useStationsMap(params?: StationQueryParams) {
  const queryParams = new URLSearchParams();
  if (params?.hubId) queryParams.set('hubId', params.hubId);
  if (params?.search) queryParams.set('search', params.search);
  if (params?.status) queryParams.set('status', params.status);
  if (params?.connectorType) queryParams.set('connectorType', params.connectorType);
  if (params?.page) queryParams.set('page', String(params.page));
  if (params?.limit) queryParams.set('limit', String(params.limit));

  return useQuery<PaginatedResult<StationDetails>>({
    queryKey: ['stations', params],
    queryFn: () => fetchJson(`${API_BASE}/stations?${queryParams.toString()}`),
    refetchInterval: 10_000,
  });
}

export function useStationStatus(stationId: string) {
  return useQuery<StationStatusResult>({
    queryKey: ['station-status', stationId],
    queryFn: () => fetchJson(`${API_BASE}/stations/${stationId}/status`),
    refetchInterval: 5_000, // 5s poll for real-time telemetry
    enabled: !!stationId,
  });
}

export function useActiveSessions(stationId?: string) {
  return useQuery<ActiveSession[]>({
    queryKey: ['sessions', stationId],
    queryFn: () => fetchJson(`${API_BASE}/sessions${stationId ? `?stationId=${stationId}` : ''}`),
    refetchInterval: 5_000,
  });
}

export type StartResult = CmsCommandResult & { sessionId?: string };

export function useRemoteStart() {
  const queryClient = useQueryClient();
  return useMutation<
    StartResult,
    Error,
    { stationId: string; evseId: number; connectorId?: number; idToken?: string; limitKw?: number; idempotencyKey?: string }
  >({
    mutationFn: ({ stationId, evseId, connectorId, idToken, limitKw, idempotencyKey }) =>
      fetchJson(`${API_BASE}/stations/${stationId}/remote-start`, {
        method: 'POST',
        body: JSON.stringify({ evseId, connectorId, idToken, limitKw, idempotencyKey }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['stations'] });
      queryClient.invalidateQueries({ queryKey: ['station-status', variables.stationId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useRemoteStop() {
  const queryClient = useQueryClient();
  return useMutation<
    CmsCommandResult,
    Error,
    { stationId: string; transactionId?: string; sessionId?: string }
  >({
    mutationFn: ({ stationId, transactionId, sessionId }) =>
      fetchJson(`${API_BASE}/stations/${stationId}/remote-stop`, {
        method: 'POST',
        body: JSON.stringify({ transactionId, sessionId }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['stations'] });
      queryClient.invalidateQueries({ queryKey: ['station-status', variables.stationId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export type SessionStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'FAILED';

export interface SessionDetails {
  session: {
    id: string;
    status: SessionStatus;
    stationId: string;
    evseId: number;
    connectorId: number;
    transactionId: string | null;
    startTime: string;
    endTime: string | null;
    totalKwh: number;
    totalCost: string | null;
    costHidden: boolean;
    estimatedCost: string | null;
    currency: string;
    ratePerKwh: string | null;
    ratePerMinute: string | null;
    pricing: {
      timezone: string;
      currentRule: string | null;
      currentRates: { ratePerKwh: number; ratePerMinute: number; sessionFee: number; idleFeePerMinute: number };
      breakdown: Array<{ label: string; ruleId: string | null; minutes: number; kwh: number; amount: number }>;
    } | null;
    sessionFee: string | null;
    idleFeePerMinute: string | null;
    billed: boolean;
    organizationId: string | null;
  };
  telemetry: {
    timestamp: string;
    powerKw?: number;
    energyKwh: number;
    currentAmps?: number;
    voltage?: number;
    socPercent?: number;
  } | null;
  canControl: boolean;
}

export interface MyActiveSession {
  id: string;
  stationId: string;
  evseId: number;
  connectorId: number;
  status: 'PENDING' | 'ACTIVE';
  startTime: string;
}

export function useMyActiveSessions(stationId?: string) {
  return useQuery<MyActiveSession[]>({
    queryKey: ['my-active-sessions', stationId],
    queryFn: () =>
      fetchJson(`${API_BASE}/sessions/active${stationId ? `?stationId=${encodeURIComponent(stationId)}` : ''}`),
    refetchInterval: 5_000,
  });
}

export function useSessionDetails(sessionId: string) {
  return useQuery<SessionDetails>({
    queryKey: ['session-details', sessionId],
    queryFn: () => fetchJson(`${API_BASE}/sessions/${sessionId}`),
    enabled: !!sessionId,
    // Poll while the session is live, stop once it has ended.
    refetchInterval: (query) => {
      const status = query.state.data?.session.status;
      return status === 'COMPLETED' || status === 'FAILED' ? false : 4_000;
    },
  });
}

export function useStopSession() {
  const queryClient = useQueryClient();
  return useMutation<CmsCommandResult, Error, { sessionId: string }>({
    mutationFn: ({ sessionId }) =>
      fetchJson(`${API_BASE}/sessions/${sessionId}/stop`, { method: 'POST', body: '{}' }),
    onSuccess: (_, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['session-details', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['my-active-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['stations'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useStationDetails(stationId: string) {
  return useQuery<StationDetails | null>({
    queryKey: ['station-details', stationId],
    queryFn: () => fetchJson(`${API_BASE}/stations/${stationId}`),
    enabled: !!stationId,
  });
}

export function useUnlockConnector() {
  const queryClient = useQueryClient();
  return useMutation<
    CmsCommandResult,
    Error,
    { stationId: string; evseId: number; connectorId: number }
  >({
    mutationFn: ({ stationId, evseId, connectorId }) =>
      fetchJson(`${API_BASE}/stations/${stationId}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ evseId, connectorId }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['station-details', variables.stationId] });
      queryClient.invalidateQueries({ queryKey: ['station-status', variables.stationId] });
    },
  });
}

export function useResetStation() {
  const queryClient = useQueryClient();
  return useMutation<
    CmsCommandResult,
    Error,
    { stationId: string; type?: 'Hard' | 'Soft' }
  >({
    mutationFn: ({ stationId, type = 'Soft' }) =>
      fetchJson(`${API_BASE}/hubs/${stationId}/reset`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['station-details', variables.stationId] });
      queryClient.invalidateQueries({ queryKey: ['station-status', variables.stationId] });
    },
  });
}
