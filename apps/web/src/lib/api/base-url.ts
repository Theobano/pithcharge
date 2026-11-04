const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Rewrites a loopback URL to the host the page was opened from, so a phone on the LAN that
 * loads the dev server by IP talks to the API on the same machine instead of its own localhost.
 */
function resolveForBrowser(url: string): string {
  if (typeof window === 'undefined') return url;
  try {
    const parsed = new URL(url);
    if (LOOPBACK.has(parsed.hostname) && !LOOPBACK.has(window.location.hostname)) {
      parsed.hostname = window.location.hostname;
      return parsed.toString().replace(/\/$/, '');
    }
  } catch {
    // Relative or malformed URLs are used as configured.
  }
  return url;
}

export function bffUrl(): string {
  return resolveForBrowser(process.env.NEXT_PUBLIC_BFF_URL || 'http://localhost:4000');
}

export function apiUrl(): string {
  return resolveForBrowser(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1');
}
