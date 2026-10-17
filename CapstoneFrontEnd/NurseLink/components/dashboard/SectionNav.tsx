import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { Colors, Radius, Shadows } from '../../constants/colors';

export interface DashboardSection {
  key: string;
  label: string;
}

interface SectionNavProps {
  sections: DashboardSection[];
  activeKey: string;
  onSelect: (key: string) => void;
}

/**
 * "Alerts · Overview · Workload · Analytics" — jumps to that section of the
 * long head nurse dashboard instead of making it all scroll-and-hunt.
 * Sticky at the top on web (desktop and phone-width browser alike;
 * react-native-web maps position:'sticky' straight to CSS); a plain
 * horizontal scroll row on native, where there is no sticky-within-a-
 * ScrollView primitive to stick it to.
 */
export function SectionNav({ sections, activeKey, onSelect }: SectionNavProps) {
  return (
    <View style={[styles.wrap, Platform.OS === 'web' && styles.sticky]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {sections.map((section) => {
          const active = section.key === activeKey;
          return (
            <Pressable
              key={section.key}
              onPress={() => onSelect(section.key)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{section.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sticky: {
    position: 'sticky' as any,
    top: 0,
    zIndex: 20,
    ...Shadows.sm,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.foreground,
  },
  chipTextActive: {
    color: Colors.white,
  },
});
