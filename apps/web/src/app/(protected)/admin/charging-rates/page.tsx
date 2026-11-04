'use client';

import { useMemo, useState } from 'react';
import { useAdminChargingRates, useAdminMutation, type Row } from '@/api/adminApi';
import { DataTable, Field, NativeSelect, runWithToast } from '@/components/admin/admin-ui';
import { CurrencySelect, DEFAULT_CURRENCY } from '@/components/billing/pricing-options';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Scope = 'PLATFORM' | 'HUB' | 'STATION';

const blank = { scope: 'PLATFORM' as Scope, scopeId: '', source: 'MANUAL', currency: DEFAULT_CURRENCY, ratePerKwh: '', ratePerMinute: '', sessionFee: '', idleFeePerMinute: '' };

const optional = (value: string) => (value.trim() === '' ? null : Number(value));

export default function AdminChargingRatesPage() {
  const { data, isLoading, error } = useAdminChargingRates();
  const save = useAdminMutation('PUT');
  const remove = useAdminMutation('DELETE');
  const [form, setForm] = useState(blank);

  const hubs = useMemo(() => data?.data.hubs ?? [], [data]);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const hub of hubs) {
      map.set(`HUB:${hub.id}`, hub.name);
      for (const station of hub.stations) map.set(`STATION:${station.id}`, `${station.label} (${hub.name})`);
    }
    return map;
  }, [hubs]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive" role="alert">{(error as Error | null)?.message ?? 'Unable to load rates.'}</p>;

  const set = (key: keyof typeof blank, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const manual = form.source === 'MANUAL';
  const needsTarget = form.scope !== 'PLATFORM';
  const canSave = (!needsTarget || form.scopeId) &&
    (!manual || [form.ratePerKwh, form.ratePerMinute, form.sessionFee, form.idleFeePerMinute].some((v) => v.trim() !== ''));

  const submit = async () => {
    const ok = await runWithToast(
      () => save.mutateAsync({
        path: '/charging-rates',
        body: {
          scope: form.scope,
          scopeId: needsTarget ? form.scopeId : undefined,
          source: form.source,
          currency: form.currency.toUpperCase(),
          ratePerKwh: manual ? optional(form.ratePerKwh) : null,
          ratePerMinute: manual ? optional(form.ratePerMinute) : null,
          sessionFee: manual ? optional(form.sessionFee) : null,
          idleFeePerMinute: manual ? optional(form.idleFeePerMinute) : null,
        },
      }),
      'Rate saved.',
    );
    if (ok) setForm(blank);
  };

  const edit = (rate: Row) => setForm({
    scope: rate.scope,
    scopeId: rate.scopeId,
    source: rate.source,
    currency: rate.currency,
    ratePerKwh: rate.ratePerKwh ?? '',
    ratePerMinute: rate.ratePerMinute ?? '',
    sessionFee: rate.sessionFee ?? '',
    idleFeePerMinute: rate.idleFeePerMinute ?? '',
  });

  const money = (value: string | null) => (value === null ? '—' : Number(value));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Public network pricing</CardTitle>
          <CardDescription>
            Applies to sessions started without an organization. The most specific rate wins: charger, then hub, then the platform rate, then the CSMS tariff.
            Blank prices fall back to the CSMS tariff. Organizations without their own general price also use these rates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Applies to">
              <NativeSelect value={form.scope} onChange={(e) => setForm((c) => ({ ...c, scope: e.target.value as Scope, scopeId: '' }))}>
                <option value="PLATFORM">Whole platform</option>
                <option value="HUB">A hub</option>
                <option value="STATION">A charger</option>
              </NativeSelect>
            </Field>
            {form.scope === 'HUB' && (
              <Field label="Hub">
                <NativeSelect value={form.scopeId} onChange={(e) => set('scopeId', e.target.value)}>
                  <option value="">Select a hub</option>
                  {hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}
                </NativeSelect>
              </Field>
            )}
            {form.scope === 'STATION' && (
              <Field label="Charger">
                <NativeSelect value={form.scopeId} onChange={(e) => set('scopeId', e.target.value)}>
                  <option value="">Select a charger</option>
                  {hubs.map((hub) => (
                    <optgroup key={hub.id} label={hub.name}>
                      {hub.stations.map((station) => <option key={station.id} value={station.id}>{station.label}</option>)}
                    </optgroup>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field label="Price source">
              <NativeSelect value={form.source} onChange={(e) => set('source', e.target.value)}>
                <option value="MANUAL">Set manually</option>
                <option value="CSMS">Use CSMS tariff</option>
              </NativeSelect>
            </Field>
            <Field label="Currency"><CurrencySelect value={form.currency} onChange={(v) => set('currency', v)} /></Field>
            {manual && (
              <>
                <Field label="Price per kWh"><Input type="number" min={0} step="0.0001" value={form.ratePerKwh} onChange={(e) => set('ratePerKwh', e.target.value)} /></Field>
                <Field label="Price per minute"><Input type="number" min={0} step="0.0001" value={form.ratePerMinute} onChange={(e) => set('ratePerMinute', e.target.value)} /></Field>
                <Field label="Session fee"><Input type="number" min={0} step="0.01" value={form.sessionFee} onChange={(e) => set('sessionFee', e.target.value)} /></Field>
                <Field label="Idle fee per minute"><Input type="number" min={0} step="0.0001" value={form.idleFeePerMinute} onChange={(e) => set('idleFeePerMinute', e.target.value)} /></Field>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={!canSave}>Save rate</Button>
            <Button variant="outline" onClick={() => setForm(blank)}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <DataTable head={['Applies to', 'Source', 'Per kWh', 'Per minute', 'Session fee', 'Idle / min', '']} empty={!data.data.rates.length}>
        {data.data.rates.map((rate: Row) => (
          <tr key={rate.id}>
            <td className="px-3 py-2">
              {rate.scope === 'PLATFORM' ? 'Whole platform' : names.get(`${rate.scope}:${rate.scopeId}`) ?? rate.scopeId}
              <Badge variant="outline" className="ml-2">{rate.scope.toLowerCase()}</Badge>
            </td>
            <td className="px-3 py-2">{rate.source === 'CSMS' ? 'CSMS tariff' : 'Manual'}</td>
            <td className="px-3 py-2 tabular-nums">{money(rate.ratePerKwh)}</td>
            <td className="px-3 py-2 tabular-nums">{money(rate.ratePerMinute)}</td>
            <td className="px-3 py-2 tabular-nums">{money(rate.sessionFee)}</td>
            <td className="px-3 py-2 tabular-nums">{money(rate.idleFeePerMinute)}</td>
            <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
              <Button size="sm" variant="outline" onClick={() => edit(rate)}>Edit</Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => runWithToast(() => remove.mutateAsync({ path: `/charging-rates/${rate.id}` }), 'Rate removed.')}
              >
                Remove
              </Button>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
