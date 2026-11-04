'use client';

import { useState } from 'react';
import { useAdminAudit, type Row } from '@/api/adminApi';
import { DataTable, Pager, formatDate } from '@/components/admin/admin-ui';
import { Input } from '@/components/ui/input';

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, isLoading } = useAdminAudit({ page, action: action.trim() || undefined });

  return (
    <div className="space-y-4">
      <Input placeholder="Filter by action, e.g. admin.wallet" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="sm:max-w-xs" />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <DataTable head={['When', 'Action', 'Target', 'Actor', 'Details']} empty={!data?.data.length}>
            {data?.data.map((log: Row) => (
              <tr key={log.id}>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(log.createdAt)}</td>
                <td className="px-3 py-2 font-mono text-xs">{log.action}</td>
                <td className="px-3 py-2 text-xs">{log.targetType}{log.targetId ? ` · ${String(log.targetId).slice(0, 8)}` : ''}</td>
                <td className="px-3 py-2 font-mono text-xs">{log.actorId ? String(log.actorId).slice(0, 8) : 'system'}</td>
                <td className="max-w-xs truncate px-3 py-2 text-xs text-muted-foreground" title={JSON.stringify(log.metadata)}>{log.metadata ? JSON.stringify(log.metadata) : '—'}</td>
              </tr>
            ))}
          </DataTable>
          {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
        </>
      )}
    </div>
  );
}
