import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors, Radius } from '../../constants/colors';

export interface QuickAction {
  key: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  /** Icon tile color pair — cool clinical tones from the brand palette. */
  tint: string;
  accent: string;
  onPress: () => void;
}

/**
 * Quick Actions as light cards: white surface, thin border, a tinted icon
 * tile per action (so the four don't look identical) and a short line saying
 * what each one does. Replaces the heavy solid-blue buttons.
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
              styles.card,
              hovered && { borderColor: accent, backgroundColor: tint },
              state.pressed && styles.pressed,
            ];
          }}
        >
          <View style={[styles.iconTile, { backgroundColor: tint }]}>
            <Icon size={20} color={accent} />
          </View>
          <View style={styles.text}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.description} numberOfLines={2}>{description}</Text>
          </View>
          <ChevronRight size={16} color={Colors.gray400} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    ...(Platform.OS === 'web' ? ({ transition: 'background-color 120ms, border-color 120ms' } as object) : null),
  },
  pressed: { opacity: 0.85 },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 14, fontWeight: '700', color: Colors.gray900 },
  description: { fontSize: 12, color: Colors.mutedForeground },
});
