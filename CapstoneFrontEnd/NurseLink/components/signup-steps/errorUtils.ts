import { ApiError } from '../../services/api';

/**
 * Pulls a human-readable message out of an ApiError's response body, the
 * same shape every signup-v2 endpoint returns (`message`, `detail`, or a
 * DRF field-error object) — mirrors the equivalent helper in the legacy
 * signup wizard (app/_legacy/SignUpLegacy.tsx) so error copy stays
 * consistent, without importing from that archived, unrouted file.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as
      | { message?: string; detail?: string; [key: string]: unknown }
      | string
      | undefined;
    if (typeof data === 'string' && data.trim()) return data;
    if (data && typeof data === 'object') {
      if (typeof data.message === 'string' && data.message) return data.message;
      if (typeof data.detail === 'string' && data.detail) return data.detail;
      const nonField = data.non_field_errors;
      if (Array.isArray(nonField) && nonField[0]) return String(nonField[0]);
      const firstField = Object.values(data).find((v) => Array.isArray(v) && v[0]) as
        | string[]
        | undefined;
      if (firstField?.[0]) return String(firstField[0]);
    }
    if (err.message) return err.message;
  }
  return fallback;
}
