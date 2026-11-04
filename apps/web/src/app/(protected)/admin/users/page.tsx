'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAdminMutation, useAdminUsers, type Row } from '@/api/adminApi';
import { DataTable, Field, Modal, NativeSelect, PageHeader, Pager, formatDate, runWithToast } from '@/components/admin/admin-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('registered');
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useAdminUsers({ page, search: search.trim() || undefined, type });

  return (
    <div className="space-y-4">
      <PageHeader
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New user</Button>}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search name or email"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          className="sm:max-w-xs"
        />
        <NativeSelect value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} className="sm:w-40" aria-label="Account type">
          <option value="registered">Registered</option>
          <option value="guest">Guests</option>
          <option value="all">All</option>
        </NativeSelect>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <DataTable head={['User', 'Role', 'Organizations', 'Sessions', 'Status', 'Joined']} empty={!data?.data.length}>
            {data?.data.map((user: Row) => (
              <tr key={user.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/admin/users/${user.id}`} className="font-medium hover:underline">{user.name || 'Unnamed'}</Link>
                  <div className="text-xs text-muted-foreground">{user.isAnonymous ? 'Guest' : user.email}</div>
                </td>
                <td className="px-3 py-2"><Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role ?? 'user'}</Badge></td>
                <td className="px-3 py-2 text-xs">{user.members.map((m: Row) => m.organization.name).join(', ') || '—'}</td>
                <td className="px-3 py-2 tabular-nums">{user._count.chargingSessions}</td>
                <td className="px-3 py-2">{user.banned ? <Badge variant="destructive">Banned</Badge> : <Badge variant="outline">Active</Badge>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatDate(user.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
          {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
        </>
      )}
      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useAdminMutation('POST');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'user' });
  const valid = form.name.trim() && form.email.includes('@') && form.password.length >= 8;

  const submit = async () => {
    const ok = await runWithToast(() => create.mutateAsync({ path: '/users', body: form }), 'User created.');
    if (ok) {
      setForm({ name: '', email: '', password: '', role: 'user' });
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title="Create user"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>Create</Button>
        </>
      }
    >
      <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label="Temporary password" hint="At least 8 characters. The user should change it after signing in.">
        <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
      <Field label="Platform role">
        <NativeSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="user">User</option>
          <option value="admin">Platform admin</option>
        </NativeSelect>
      </Field>
    </Modal>
  );
}
