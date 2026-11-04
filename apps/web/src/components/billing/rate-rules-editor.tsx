'use client';

import { useState } from 'react';
import { DataTable, Field, Modal } from '@/components/admin/admin-ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

export interface RateRule {
  id: string;
  name: string;
  priority: number;
  active: boolean;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  stationIds: string[];
  ratePerKwh: number | string;
  ratePerMinute: number | string | null;
  sessionFee: number | string | null;
  idleFeePerMinute: number | string | null;
}

type RuleBody = Record<string, unknown>;

interface Props {
  rules: RateRule[];
  currency: string;
  timezone: string;
  canEdit: boolean;
  onCreate: (body: RuleBody) => Promise<boolean>;
  onUpdate: (id: string, body: RuleBody) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const emptyForm = {
  name: '',
  priority: '10',
  active: true,
  days: [] as number[],
  allDay: true,
  startTime: '08:00',
  endTime: '18:00',
  stationIds: '',
  ratePerKwh: '0.30',
  ratePerMinute: '',
  sessionFee: '',
  idleFeePerMinute: '',
};
type Form = typeof emptyForm;

const optionalNumber = (value: string) => (value.trim() === '' ? null : Number(value));

function describeSchedule(rule: RateRule) {
  const days = rule.daysOfWeek.length === 0 || rule.daysOfWeek.length === 7
    ? 'Every day'
    : rule.daysOfWeek.map((day) => DAYS[day]).join(', ');
  const time = rule.startTime && rule.endTime ? `${rule.startTime}–${rule.endTime}` : 'All day';
  return `${days} · ${time}`;
}

export function RateRulesEditor({ rules, currency, timezone, canEdit, onCreate, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState<RateRule | 'new' | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [removing, setRemoving] = useState<RateRule | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (rule: RateRule | 'new') => {
    setEditing(rule);
    setForm(rule === 'new' ? emptyForm : {
      name: rule.name,
      priority: String(rule.priority),
      active: rule.active,
      days: rule.daysOfWeek,
      allDay: !rule.startTime || !rule.endTime,
      startTime: rule.startTime ?? '08:00',
      endTime: rule.endTime ?? '18:00',
      stationIds: rule.stationIds.join(', '),
      ratePerKwh: String(rule.ratePerKwh),
      ratePerMinute: rule.ratePerMinute === null ? '' : String(rule.ratePerMinute),
      sessionFee: rule.sessionFee === null ? '' : String(rule.sessionFee),
      idleFeePerMinute: rule.idleFeePerMinute === null ? '' : String(rule.idleFeePerMinute),
    });
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleDay = (day: number) =>
    set('days', form.days.includes(day) ? form.days.filter((item) => item !== day) : [...form.days, day]);

  const save = async () => {
    const body: RuleBody = {
      name: form.name.trim(),
      priority: Number(form.priority) || 0,
      active: form.active,
      daysOfWeek: form.days,
      startTime: form.allDay ? null : form.startTime,
      endTime: form.allDay ? null : form.endTime,
      stationIds: form.stationIds.split(',').map((item) => item.trim()).filter(Boolean),
      ratePerKwh: Number(form.ratePerKwh),
      ratePerMinute: optionalNumber(form.ratePerMinute),
      sessionFee: optionalNumber(form.sessionFee),
      idleFeePerMinute: optionalNumber(form.idleFeePerMinute),
    };
    setBusy(true);
    const ok = editing === 'new' ? await onCreate(body) : editing ? await onUpdate(editing.id, body) : false;
    setBusy(false);
    if (ok) setEditing(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Rules override the standard rate when they match. Higher priority wins. Times use the {timezone} timezone.
        </p>
        {canEdit && <Button onClick={() => open('new')}>Add rate rule</Button>}
      </div>

      <DataTable
        head={['Rule', 'Schedule', 'Rates', 'Priority', 'Status', '']}
        empty={rules.length === 0}
      >
        {rules.map((rule) => (
          <tr key={rule.id}>
            <td className="px-3 py-2 font-medium">
              {rule.name}
              {rule.stationIds.length > 0 && (
                <span className="block text-xs font-normal text-muted-foreground">{rule.stationIds.length} station(s)</span>
              )}
            </td>
            <td className="px-3 py-2 text-xs">{describeSchedule(rule)}</td>
            <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">
              {Number(rule.ratePerKwh)} {currency}/kWh
              {rule.ratePerMinute !== null && Number(rule.ratePerMinute) > 0 && ` + ${Number(rule.ratePerMinute)}/min`}
            </td>
            <td className="px-3 py-2 tabular-nums">{rule.priority}</td>
            <td className="px-3 py-2"><Badge variant={rule.active ? 'outline' : 'secondary'}>{rule.active ? 'Active' : 'Off'}</Badge></td>
            <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
              {canEdit && (
                <>
                  <Button size="sm" variant="outline" onClick={() => open(rule)}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => setRemoving(rule)}>Delete</Button>
                </>
              )}
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Add rate rule' : 'Edit rate rule'}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy || !form.name.trim() || form.ratePerKwh === ''}>
              {busy ? 'Saving…' : 'Save rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} placeholder="Off-peak" onChange={(e) => set('name', e.target.value)} /></Field>
          <div>
            <p className="mb-1 text-sm font-medium">Days</p>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((label, day) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant={form.days.includes(day) ? 'default' : 'outline'}
                  aria-pressed={form.days.includes(day)}
                  onClick={() => toggleDay(day)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Leave all unselected to apply every day.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.allDay} onCheckedChange={(v) => set('allDay', Boolean(v))} />
            All day
          </label>
          {!form.allDay && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><Input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} /></Field>
              <Field label="To" hint="An earlier end time wraps past midnight."><Input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} /></Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Rate per kWh (${currency})`}><Input type="number" min={0} step="0.0001" value={form.ratePerKwh} onChange={(e) => set('ratePerKwh', e.target.value)} /></Field>
            <Field label="Rate per minute" hint="Blank uses standard."><Input type="number" min={0} step="0.0001" value={form.ratePerMinute} onChange={(e) => set('ratePerMinute', e.target.value)} /></Field>
            <Field label="Session fee" hint="Blank uses standard."><Input type="number" min={0} step="0.01" value={form.sessionFee} onChange={(e) => set('sessionFee', e.target.value)} /></Field>
            <Field label="Idle fee per minute" hint="Blank uses standard."><Input type="number" min={0} step="0.0001" value={form.idleFeePerMinute} onChange={(e) => set('idleFeePerMinute', e.target.value)} /></Field>
          </div>
          <Field label="Stations" hint="Comma-separated station IDs. Blank applies to all stations.">
            <Input value={form.stationIds} onChange={(e) => set('stationIds', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Priority"><Input type="number" min={0} step="1" value={form.priority} onChange={(e) => set('priority', e.target.value)} /></Field>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Switch checked={form.active} onCheckedChange={(v) => set('active', Boolean(v))} />
              Active
            </label>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Delete rate rule?"
        description={`"${removing?.name ?? ''}" will no longer apply to new sessions. Sessions already in progress keep their rates.`}
        confirmLabel="Delete"
        destructive
        pending={busy}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          const ok = await onDelete(removing.id);
          setBusy(false);
          if (ok) setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
