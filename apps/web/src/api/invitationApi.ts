import { toApiError } from '@/lib/api/error';
import { apiUrl } from '@/lib/api/base-url';
import { useQuery } from '@tanstack/react-query';

const API_BASE = { toString: apiUrl };

export interface InvitationPreview {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'canceled' | 'rejected' | 'expired' | string;
  expiresAt: string;
  organization: { id: string; name: string; logo: string | null };
  invitedBy: string | null;
  accountExists: boolean;
}

export interface MyInvitation {
  id: string;
  role: string | null;
  expiresAt: string;
  organization: { id: string; name: string; logo: string | null };
}

async function invitationFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/invitations${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw await toApiError(res, `HTTP error ${res.status}`);
  return res.json();
}

export const useInvitationPreview = (id: string) =>
  useQuery({
    queryKey: ['invitation', id],
    queryFn: async () => (await invitationFetch<{ data: InvitationPreview }>(`/${id}`)).data,
    retry: false,
  });

export const useMyInvitations = (enabled: boolean) =>
  useQuery({
    queryKey: ['invitations', 'mine'],
    queryFn: async () => (await invitationFetch<{ data: MyInvitation[] }>('/mine')).data,
    enabled,
  });

export async function acceptInvitation(id: string) {
  const result = await invitationFetch<{ data: { organizationId: string; role: string } }>(
    `/${id}/accept`,
    { method: 'POST', body: '{}' },
  );
  return result.data;
}
