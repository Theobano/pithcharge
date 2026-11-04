import { SessionDetails } from "@/api/cmsApi";
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

export function currentRateLabel(session: SessionDetails['session']) {
  const rates = session.pricing?.currentRates;
  const perKwh = rates?.ratePerKwh ?? (session.ratePerKwh ? Number(session.ratePerKwh) : 0);
  const perMinute = rates?.ratePerMinute ?? (session.ratePerMinute ? Number(session.ratePerMinute) : 0);
  if (!perKwh && !perMinute) return 'Free';
  const parts = [`${formatMoney(session.currency, perKwh)}/kWh`];
  if (perMinute) parts.push(`${formatMoney(session.currency, perMinute)}/min`);
  return parts.join(' + ');
}

export function formatMoney(currency: string, value: string | number | null) {
  return value === null ? '—' : `${Number(value).toLocaleString(undefined, {
    style: 'currency',
    currency,
  })}`;
}