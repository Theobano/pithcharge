"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { adminExportUrl, useAdminReport, type Row } from "@/api/adminApi";
import {
  DataTable,
  Field,
  NativeSelect,
  StatCard,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const day = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

export default function AdminReportsPage() {
  const [from, setFrom] = useState(day(30));
  const [to, setTo] = useState(day(0));
  const [exportType, setExportType] = useState("sessions");
  // Inclusive end of day so the selected "to" date is fully covered.
  const range = {
    from: new Date(`${from}T00:00:00`).toISOString(),
    to: new Date(`${to}T23:59:59`).toISOString(),
  };
  const { data, isLoading, error } = useAdminReport(range);
  const report = data?.data;
  const peak = Math.max(1, ...(report?.daily ?? []).map((d: Row) => d.kwh));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="From">
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Export">
          <NativeSelect
            value={exportType}
            onChange={(e) => setExportType(e.target.value)}
          >
            <option value="sessions">Sessions</option>
            <option value="ledger">Ledger</option>
            <option value="invoices">Invoices</option>
            <option value="audit">Audit log</option>
          </NativeSelect>
        </Field>
        <Button
          render={
            <a href={adminExportUrl({ type: exportType, ...range })} download />
          }
        >
          <Download className="size-4" /> CSV
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {(error as Error).message}
        </p>
      )}
      {isLoading || !report ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {report.totals.length === 0 && (
              <StatCard label="Sessions" value={0} />
            )}
            {report.totals.map((t: Row) => (
              <StatCard
                key={t.currency}
                label={`Revenue ${t.currency}`}
                value={Number(t.revenue).toLocaleString(undefined, {
                  style: "currency",
                  currency: t.currency,
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                hint={`${t.sessions} sessions · ${Number(t.kwh).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`}
              />
            ))}
            {report.byStatus.map((s: Row) => (
              <StatCard key={s.status} label={s.status} value={Number(s.sessions).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })} />
            ))}
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Daily energy (kWh)</h2>
            <div
              className="flex h-40 items-end gap-1 overflow-x-auto border p-3"
              role="img"
              aria-label="Daily energy chart"
            >
              {report.daily.length === 0 && (
                <p className="m-auto text-sm text-muted-foreground">
                  No sessions in this range.
                </p>
              )}
              {report.daily.map((d: Row) => (
                <div
                  key={d.day}
                  className="flex h-full min-w-3 flex-1 items-end"
                  title={`${d.day}: ${d.kwh.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh, ${d.sessions} sessions`}
                >
                  <div
                    className="w-full bg-primary/80"
                    style={{ height: `${Math.max(2, (d.kwh / peak) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="space-y-2">
              <h2 className="text-sm font-medium">Top organizations</h2>
              <DataTable
                head={["Organization", "Sessions", "kWh", "Revenue"]}
                empty={!report.topOrganizations.length}
              >
                {report.topOrganizations.map((o: Row) => (
                  <tr key={o.organizationId}>
                    <td className="px-3 py-2">{o.name}</td>
                    <td className="px-3 py-2 tabular-nums">{o.sessions}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {Number(o.kwh).toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{Number(o.revenue).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}</td>
                  </tr>
                ))}
              </DataTable>
            </section>
            <section className="space-y-2">
              <h2 className="text-sm font-medium">Top stations</h2>
              <DataTable
                head={["Station", "Sessions", "kWh", "Revenue"]}
                empty={!report.topStations.length}
              >
                {report.topStations.map((s: Row) => (
                  <tr key={s.stationId}>
                    <td className="px-3 py-2">{s.stationId}</td>
                    <td className="px-3 py-2 tabular-nums">{s.sessions}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {Number(s.kwh).toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{Number(s.revenue).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}</td>
                  </tr>
                ))}
              </DataTable>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
