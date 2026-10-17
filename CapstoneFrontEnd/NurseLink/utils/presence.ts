/**
 * Display helpers for NursePresence ('online' | 'away' | 'offline' — see
 * CapstoneBackEnd/api/presence.py, which is the source of truth for the
 * thresholds themselves). Every screen that shows a nurse's presence dot
 * or sorts a picker by it goes through here, so the colour/label/ordering
 * never drifts between Team, Workload, Duty Roster and the Assign pickers.
 */
import type { NursePresence } from '../types/domain';

export const PRESENCE_COLORS: Record<NursePresence, string> = {
  online: '#16A34A',
  away: '#D97706',
  offline: '#9CA3AF',
};

export const PRESENCE_DOT_EMOJI: Record<NursePresence, string> = {
  online: '🟢',
  away: '🟡',
  offline: '⚪',
};

function minutesAgo(lastSeenAt?: string | null): number | null {
  if (!lastSeenAt) return null;
  const then = new Date(lastSeenAt).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.round((Date.now() - then) / 60000));
}

function relativeTime(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Accessible text for the dot — "Active now" / "Away" / "Last active 25 min ago". */
export function presenceLabel(presence?: NursePresence, lastSeenAt?: string | null): string {
  if (presence === 'online') return 'Active now';
  if (presence === 'away') return 'Away';
  const minutes = minutesAgo(lastSeenAt);
  return minutes === null ? 'Offline' : `Last active ${relativeTime(minutes)}`;
}

/** Active (online, then away) nurses first, offline last; stable otherwise. */
export function sortByPresence<T extends { presence?: NursePresence }>(nurses: T[]): T[] {
  const rank: Record<NursePresence, number> = { online: 0, away: 1, offline: 2 };
  return [...nurses].sort((a, b) => (rank[a.presence ?? 'offline'] - rank[b.presence ?? 'offline']));
}
