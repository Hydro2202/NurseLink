import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Colors, Radius, Shadows } from '../../constants/colors';

export interface QuickAction {
  key: string;
  label: string;
  /** Read by screen readers; the tile itself shows only icon + label. */
  description: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  /** Soft background for the icon tile and the hover state. */
  tint: string;
  /** Icon + label color — one distinct accent per action. */
  accent: string;
  onPress: () => void;
}

/**
 * Icon-focused Quick Actions: compact white tiles with a thin border, a
 * colored icon centered above the label, one accent per action. Four across
 * on wide screens, two across on phones (flexBasis + minWidth wrap).
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <View style={styles.grid}>
      {actions.map(({ key, label, description, icon: Icon, tint, accent, onPress }) => (
        <Pressable
          key={key}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${description}`}
          style={(state) => {
            const hovered = (state as { hovered?: boolean }).hovered;
            return [
              styles.tile,
              hovered && { borderColor: accent, backgroundColor: tint },
              state.pressed && styles.pressed,
            ];
          }}
        >
          <View style={[styles.iconTile, { backgroundColor: tint }]}>
            <Icon size={22} color={accent} />
          </View>
          <Text style={[styles.label, { color: accent }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 130,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    ...Shadows.sm,
    ...(Platform.OS === 'web' ? ({ transition: 'background-color 120ms, border-color 120ms' } as object) : null),
  },
  pressed: { opacity: 0.85 },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, fontWeight: '600' },
});
