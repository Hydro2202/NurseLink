import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NursePresence } from '../types/domain';
import { PRESENCE_COLORS, presenceLabel } from '../utils/presence';

interface PresenceDotProps {
  presence?: NursePresence;
  lastSeenAt?: string | null;
  /** Shows "Active now" / "Away" / "Last active X ago" next to the dot;
   * off for tight rows that only have room for the dot itself (the same
   * text is still read out via accessibilityLabel either way). */
  showLabel?: boolean;
  size?: number;
}

export function PresenceDot({ presence = 'offline', lastSeenAt, showLabel = false, size = 8 }: PresenceDotProps) {
  const label = presenceLabel(presence, lastSeenAt);
  return (
    <View style={styles.row} accessibilityLabel={label} accessibilityRole="text">
      <View
        style={[
          styles.dot,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: PRESENCE_COLORS[presence] },
        ]}
      />
      {showLabel ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' },
  label: { fontSize: 11.5, color: '#6B7280', fontWeight: '500' },
});
