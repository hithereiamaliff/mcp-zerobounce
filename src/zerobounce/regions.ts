/**
 * ZeroBounce API hosts and region handling.
 *
 * Real-time endpoints (validate, credits, finder, filters...) are available on
 * three hosts. Bulk/file endpoints only exist on a single global host.
 * Source: https://www.zerobounce.net/docs/api-dashboard/api-endpoints
 *
 * Regions are an allowlist on purpose: a user-supplied region can never make
 * this server send someone's API key to an arbitrary URL.
 */

export type ZeroBounceRegion = 'default' | 'us' | 'eu';

export const REGIONS: readonly ZeroBounceRegion[] = ['default', 'us', 'eu'];

/** Base URLs for real-time endpoints (already include /v2). */
export const REALTIME_HOSTS: Record<ZeroBounceRegion, string> = {
  // "Previous" endpoint; ZeroBounce now processes these requests in the EU (Frankfurt).
  default: 'https://api.zerobounce.net/v2',
  // US-only processing (New York).
  us: 'https://api-us.zerobounce.net/v2',
  // EU-only processing (Frankfurt).
  eu: 'https://api-eu.zerobounce.net/v2',
};

/** Single host for every bulk/file endpoint (no regional variants exist). */
export const BULK_HOST = 'https://bulkapi.zerobounce.net';

export const REGION_LABELS: Record<ZeroBounceRegion, string> = {
  default: 'Default (api.zerobounce.net)',
  us: 'US (api-us.zerobounce.net)',
  eu: 'EU (api-eu.zerobounce.net)',
};

export class InvalidRegionError extends Error {
  constructor(value: string) {
    super(`Unknown ZeroBounce region "${value}". Use one of: default, us, eu (or leave it blank).`);
    this.name = 'InvalidRegionError';
  }
}

/**
 * Turn whatever the user typed (portal field, header, env var) into a region.
 * Accepts blank, "default", "us", "eu", and also the host names themselves
 * (e.g. "api-us.zerobounce.net" or "https://api-eu.zerobounce.net/v2").
 */
export function parseRegion(input: string | null | undefined): ZeroBounceRegion {
  const value = (input ?? '').trim().toLowerCase();
  if (!value || value === 'default' || value === 'global' || value === 'auto') return 'default';
  if (value === 'us' || value === 'usa') return 'us';
  if (value === 'eu') return 'eu';

  // Allow host-style values, but only ZeroBounce's own hosts.
  const host = value.replace(/^https?:\/\//, '').split('/')[0];
  if (host === 'api.zerobounce.net') return 'default';
  if (host === 'api-us.zerobounce.net') return 'us';
  if (host === 'api-eu.zerobounce.net') return 'eu';

  throw new InvalidRegionError(input ?? '');
}
