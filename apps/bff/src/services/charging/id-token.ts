import { nanoid } from 'nanoid';

export type AppTokenPrefix = 'APP' | 'GUEST';

/** OCPP 1.6 limits idTag to 20 characters; keep application-issued tokens valid for both protocols. */
export function createAppOcppIdToken(prefix: AppTokenPrefix): string {
  const suffixLength = 20 - prefix.length - 1;
  return `${prefix}_${nanoid(suffixLength)}`;
}

export function isLegacyAppOcppIdToken(value: string): value is string {
  return value.length > 20 && (value.startsWith('APP_') || value.startsWith('GUEST_'));
}
