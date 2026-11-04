import { toApiError } from '@/lib/api/error';
import { apiUrl } from '@/lib/api/base-url';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// Resolved lazily (on each template interpolation) so the browser host is known.
const ADMIN = { toString: () => `${apiUrl()}/admin` };

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ADMIN}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw await toApiError(res, `HTTP error ${res.status}`);
  return res.json();
}

export function adminExportUrl(params: Record<string, string | undefined>) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return `${ADMIN}/reports/export?${query.toString()}`;
}

function qs(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Loosely typed on purpose: admin payloads are rendered, not computed on.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export const useAdminOverview = () =>
  useQuery({ queryKey: ['admin', 'overview'], queryFn: () => adminFetch<{ data: Row }>('/overview'), refetchInterval: 30_000 });

export const useAdminUsers = (params: { page: number; search?: string; type?: string }) =>
  useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => adminFetch<Paged<Row>>(`/users${qs({ ...params, pageSize: 20 })}`),
    placeholderData: (previous) => previous,
  });

export const useAdminUser = (id: string) =>
  useQuery({ queryKey: ['admin', 'user', id], queryFn: () => adminFetch<{ data: Row }>(`/users/${id}`) });

export const useAdminOrganizations = (params: { page: number; search?: string }) =>
  useQuery({
    queryKey: ['admin', 'organizations', params],
    queryFn: () => adminFetch<Paged<Row>>(`/organizations${qs({ ...params, pageSize: 20 })}`),
    placeholderData: (previous) => previous,
  });

export const useAdminOrganization = (id: string) =>
  useQuery({ queryKey: ['admin', 'organization', id], queryFn: () => adminFetch<{ data: Row }>(`/organizations/${id}`) });

export const useAdminOrgLedger = (id: string, page: number) =>
  useQuery({
    queryKey: ['admin', 'organization', id, 'ledger', page],
    queryFn: () => adminFetch<Paged<Row>>(`/organizations/${id}/ledger${qs({ page, pageSize: 15 })}`),
  });

export const useAdminOrgSessions = (id: string, page: number) =>
  useQuery({
    queryKey: ['admin', 'organization', id, 'sessions', page],
    queryFn: () => adminFetch<Paged<Row>>(`/organizations/${id}/sessions${qs({ page, pageSize: 15 })}`),
    placeholderData: (previous) => previous,
  });

export const useAdminOrgAudit = (id: string, page: number) =>
  useQuery({
    queryKey: ['admin', 'organization', id, 'audit', page],
    queryFn: () => adminFetch<Paged<Row>>(`/organizations/${id}/audit-logs${qs({ page, pageSize: 15 })}`),
    placeholderData: (previous) => previous,
  });

export const useAdminReport = (params: { from?: string; to?: string; organizationId?: string }) =>
  useQuery({
    queryKey: ['admin', 'report', params],
    queryFn: () => adminFetch<{ data: Row }>(`/reports/summary${qs(params)}`),
  });

export const useAdminAudit = (params: { page: number; action?: string }) =>
  useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: () => adminFetch<Paged<Row>>(`/audit-logs${qs({ ...params, pageSize: 25 })}`),
    placeholderData: (previous) => previous,
  });

export const useAdminChargingRates = () =>
  useQuery({
    queryKey: ['admin', 'charging-rates'],
    queryFn: () => adminFetch<{ data: { rates: Row[]; hubs: Array<{ id: string; name: string; stations: Array<{ id: string; label: string }> }> } }>('/charging-rates'),
  });

export const useAdminEmailSettings = () =>
  useQuery({
    queryKey: ['admin', 'email'],
    queryFn: () =>
      adminFetch<{
        provider: 'smtp' | 'webhook' | 'none';
        configured: boolean;
        from: string;
        replyTo: string | null;
        smtp: { host?: string; port: number; secure: boolean; authenticated: boolean } | null;
        verificationRequired: boolean;
      }>('/email'),
  });

export function useAdminMutation<TBody = unknown>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: TBody }) =>
      adminFetch<Row>(path, { method, body: body === undefined ? (method === 'DELETE' ? undefined : '{}') : JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}
