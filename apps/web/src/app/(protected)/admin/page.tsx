'use client';

import { useAdminOverview, type Row } from '@/api/adminApi';
import { DataTable, StatCard } from '@/components/admin/admin-ui';

export default function AdminOverviewPage() {
  const { data, isLoading, error } = useAdminOverview();
  const o = data?.data;

  return (
    <div className="space-y-5">
      {error &&  <p className="text-sm text-destructive" role="alert">{(error as Error).message}</p>}
      {isLoading || !o ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Users" value={o.users} />
            <StatCard label="Guests" value={o.guests} />
            <StatCard label="Organizations" value={o.organizations} />
            <StatCard label="Live sessions" value={o.activeSessions} />
            <StatCard label="Failed deliveries" value={o.failedOutbox + o.failedNotifications} hint="Notification outbox" />
          </div>
            <Section title="Last 30 days" head={['Currency', 'Sessions', 'Energy (kWh)', 'Revenue']} rows={o.usage30d.map((r: Row) => [r.currency, r.sessions, Number(r.kwh).toLocaleString(undefined, {
              minimumFractionDigits: 2, maximumFractionDigits: 2
            }), Number(r.revenue).toLocaleString(undefined, {
              style: 'currency', currency: r.currency,
              minimumFractionDigits: 2, maximumFractionDigits: 2
            })])} />
            <Section title="Wallet liabilities" head={['Currency', 'Balance', 'Reserved']} rows={o.walletLiabilities.map((r: Row) => [r.currency, Number(r.balance).toLocaleString(undefined, {
            style: 'currency', currency: r.currency,
            minimumFractionDigits: 2, maximumFractionDigits: 2
          }), Number(r.reserved).toLocaleString(undefined, {
            minimumFractionDigits: 2, maximumFractionDigits: 2
          })])} />
          <Section title="Outstanding invoices" head={['Currency', 'Invoices', 'Amount']} rows={o.outstandingInvoices.map((r: Row) => [r.currency, Number(r.count).toLocaleString(undefined, {
            minimumFractionDigits: 0, maximumFractionDigits: 0
          }), Number(r.amount).toLocaleString(undefined, {
            style: 'currency', currency: r.currency,
            minimumFractionDigits: 2, maximumFractionDigits: 2
          })  ])} />
        </>
      )}
    </div>
  );
}

function Section({ title, head, rows }: { title: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <DataTable head={head} empty={rows.length === 0}>
        {rows.map((row, index) => (
          <tr key={index}>{row.map((cell, i) => <td key={i} className="px-3 py-2 tabular-nums">{cell}</td>)}</tr>
        ))}
      </DataTable>
    </section>
  );
}
