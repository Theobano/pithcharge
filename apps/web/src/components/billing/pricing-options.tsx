'use client';

import { useMemo } from 'react';
import { NativeSelect } from '@/components/admin/admin-ui';

export const DEFAULT_CURRENCY = 'NGN';
export const DEFAULT_TIMEZONE = 'Africa/Lagos';

const CURRENCIES: Array<[string, string]> = [
  ['NGN', 'Nigerian naira'],
  ['USD', 'US dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'Pound sterling'],
  ['GHS', 'Ghanaian cedi'],
  ['KES', 'Kenyan shilling'],
  ['ZAR', 'South African rand'],
  ['XOF', 'West African CFA franc'],
  ['XAF', 'Central African CFA franc'],
  ['EGP', 'Egyptian pound'],
  ['MAD', 'Moroccan dirham'],
  ['TZS', 'Tanzanian shilling'],
  ['UGX', 'Ugandan shilling'],
  ['AED', 'UAE dirham'],
  ['CAD', 'Canadian dollar'],
  ['INR', 'Indian rupee'],
  ['CNY', 'Chinese yuan'],
];

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

export function CurrencySelect({ value, onChange, ...props }: SelectProps) {
  const options = CURRENCIES.some(([code]) => code === value) || !value ? CURRENCIES : [[value, value] as [string, string], ...CURRENCIES];
  return (
    <NativeSelect {...props} value={value || DEFAULT_CURRENCY} onChange={(e) => onChange(e.target.value)}>
      {options.map(([code, name]) => (
        <option key={code} value={code}>{code} · {name}</option>
      ))}
    </NativeSelect>
  );
}

function allTimezones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list?.length) return list;
  } catch {
    // fall through to the static list
  }
  return ['UTC', 'Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai'];
}

function offsetLabel(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return part === 'GMT' ? 'UTC+0' : (part ?? '').replace('GMT', 'UTC');
  } catch {
    return '';
  }
}

export function TimezoneSelect({ value, onChange, ...props }: SelectProps) {
  const zones = useMemo(() => {
    const rest = allTimezones().filter((z) => z !== DEFAULT_TIMEZONE);
    return [DEFAULT_TIMEZONE, ...rest].map((zone) => ({
      zone,
      label: zone === DEFAULT_TIMEZONE ? `WAT (UTC+1) · ${zone}` : `${zone} (${offsetLabel(zone)})`,
    }));
  }, []);
  const current = value || DEFAULT_TIMEZONE;
  const options = zones.some((z) => z.zone === current) ? zones : [{ zone: current, label: current }, ...zones];
  return (
    <NativeSelect {...props} value={current} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.zone} value={o.zone}>{o.label}</option>
      ))}
    </NativeSelect>
  );
}
