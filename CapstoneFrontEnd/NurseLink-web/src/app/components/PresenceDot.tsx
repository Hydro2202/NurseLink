import type { NursePresence } from '../types/domain';
import { PRESENCE_COLORS, presenceLabel } from '../utils/presence';

interface PresenceDotProps {
  presence?: NursePresence;
  lastSeenAt?: string | null;
  /** Shows "Active now" / "Away" / "Last active X ago" next to the dot;
   * off for tight rows that only have room for the dot itself (the same
   * text is still exposed via aria-label either way). */
  showLabel?: boolean;
  size?: number;
  className?: string;
}

export function PresenceDot({
  presence = 'offline',
  lastSeenAt,
  showLabel = false,
  size = 8,
  className = '',
}: PresenceDotProps) {
  const label = presenceLabel(presence, lastSeenAt);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} role="text" aria-label={label}>
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: PRESENCE_COLORS[presence],
          border: '1px solid rgba(255,255,255,0.8)',
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {showLabel ? <span className="text-xs text-gray-500 font-medium">{label}</span> : null}
    </span>
  );
}
