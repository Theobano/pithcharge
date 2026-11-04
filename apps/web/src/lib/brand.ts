export interface Brand {
  name: string;
  /** Absolute URL or a path under public/ (e.g. /branding/logo.svg). Empty means use the default mark. */
  /** Wide logo (already contains the name); shown when the sidebar is expanded. */
  logoUrl: string | null;
  /** Square mark; shown when collapsed, or next to the app name when no big logo is set. */
  logoSmallUrl: string | null;
  faviconUrl: string | null;
}

const DEFAULT_NAME = "Pithcharge";

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Read at request time so docker deployments can change branding without rebuilding the image.
export function getBrand(): Brand {
  return {
    name: clean(process.env.APP_NAME) ?? DEFAULT_NAME,
    logoUrl: clean(process.env.APP_LOGO_URL),
    logoSmallUrl: clean(process.env.APP_LOGO_SMALL_URL),
    faviconUrl: clean(process.env.APP_FAVICON_URL),
  };
}
