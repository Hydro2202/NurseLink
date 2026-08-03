import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { Colors, Radius } from '../constants/colors';
import { Badge } from './Badge';

export interface TabItem {
  value: string;
  label: string;
  badge?: string | number;
}

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: TabItem[];
  style?: ViewStyle;
}

export function Tabs({ value, onValueChange, tabs, style }: TabsProps) {
  return (
    <View style={[styles.list, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <Pressable
              key={tab.value}
              onPress={() => onValueChange(tab.value)}
              style={[styles.trigger, active && styles.triggerActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.triggerText, active && styles.triggerTextActive]}>
                {tab.label}
              </Text>
              {tab.badge !== undefined && tab.badge !== null && tab.badge !== '' ? (
                <Badge
                  variant={active ? 'default' : 'secondary'}
                  style={styles.badge}
                  textStyle={styles.badgeText}
                >
                  {String(tab.badge)}
                </Badge>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: Colors.muted,
    borderRadius: Radius.xl,
    padding: 3,
    alignSelf: 'stretch',
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 36,
  },
  triggerActive: {
    backgroundColor: Colors.card,
    borderColor: Colors.border,
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.mutedForeground,
  },
  triggerTextActive: {
    color: Colors.foreground,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
  },
  badgeText: {
    fontSize: 10,
  },
});
