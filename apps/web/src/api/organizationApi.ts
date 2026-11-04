import { toApiError } from '@/lib/api/error';
import { apiUrl } from '@/lib/api/base-url';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paged, Row } from '@/api/adminApi';

const ORG = { toString: () => `${apiUrl()}/organizations/current` };

async function orgFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ORG}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw await toApiError(res, `HTTP error ${res.status}`);
  return res.json();
}

const qs = (params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') query.set(k, String(v));
  const text = query.toString();
  return text ? `?${text}` : '';
};

export const useOrganization = (organizationId?: string) =>
  useQuery({
    queryKey: ['org', organizationId, 'details'],
    queryFn: () => orgFetch<{ data: Row }>(''),
    enabled: Boolean(organizationId),
  });

export const useOrganizationMembers = (organizationId?: string) =>
  useQuery({
    queryKey: ['org', organizationId, 'members'],
    queryFn: () => orgFetch<{ data: Row[]; canManage: boolean }>('/members'),
    enabled: Boolean(organizationId),
  });

export const useOrganizationSessions = (organizationId: string | undefined, page: number) =>
  useQuery({
    queryKey: ['org', organizationId, 'sessions', page],
    queryFn: () => orgFetch<Paged<Row>>(`/sessions${qs({ page, pageSize: 10 })}`),
    enabled: Boolean(organizationId),
  });

export const useOrganizationAudit = (organizationId: string | undefined, page: number) =>
  useQuery({
    queryKey: ['org', organizationId, 'audit', page],
    queryFn: () => orgFetch<Paged<Row>>(`/audit-logs${qs({ page, pageSize: 10 })}`),
    enabled: Boolean(organizationId),
  });

export const useOrganizationInvitations = (organizationId: string | undefined, page: number) =>
  useQuery({
    queryKey: ['org', organizationId, 'invitations', page],
    queryFn: () => orgFetch<Paged<Row>>(`/invitations${qs({ page, pageSize: 10 })}`),
    enabled: Boolean(organizationId),
  });

export function useOrganizationMutation(organizationId: string | undefined, method: 'POST' | 'PATCH' | 'DELETE') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path = '', body }: { path?: string; body?: unknown }) =>
      orgFetch<Row>(path, { method, body: body === undefined ? (method === 'DELETE' ? undefined : '{}') : JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', organizationId] }),
  });
}
