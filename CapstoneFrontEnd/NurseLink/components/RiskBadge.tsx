import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ShieldCheck, AlertCircle, AlertTriangle, OctagonAlert } from 'lucide-react-native';
import { Colors, Radius } from '../constants/colors';
import type { RiskLevel } from '../utils/riskLevel';

const RISK_CONFIG: Record<
  RiskLevel,
  {
    label: string;
    description: string;
    icon: typeof ShieldCheck;
    bg: string;
    border: string;
    text: string;
  }
> = {
  low: {
    label: 'Low Risk',
    description: 'Stable patient condition.',
    icon: ShieldCheck,
    bg: Colors.green50,
    border: Colors.green200,
    text: Colors.green700,
  },
  medium: {
    label: 'Moderate Risk',
    description: 'Requires regular monitoring.',
    icon: AlertCircle,
    bg: Colors.orange50,
    border: Colors.orange100,
    text: Colors.orange700,
  },
  high: {
    label: 'High Risk',
    description: 'Requires increased monitoring.',
    icon: AlertTriangle,
    bg: Colors.orange100,
    border: Colors.orange300,
    text: Colors.orange700,
  },
  critical: {
    // Solid, not just an outline — this is the one risk level that should
    // never blend in at a glance across a long patient list.
    label: 'Critical Risk',
    description: 'Immediate attention required.',
    icon: OctagonAlert,
    bg: Colors.red600,
    border: Colors.red700,
    text: Colors.white,
  },
};

interface RiskBadgeProps {
  level: RiskLevel;
  /** Compact for tight rows (e.g. beside a patient name); default is the
   * everyday size used in list cards. */
  size?: 'sm' | 'md';
}

export function RiskBadge({ level, size = 'md' }: RiskBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const config = RISK_CONFIG[level];
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 11 : 13;

  return (
    <View>
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        style={[
          styles.badge,
          size === 'sm' && styles.badgeSm,
          { backgroundColor: config.bg, borderColor: config.border },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${config.label}. ${config.description} Tap for details.`}
      >
        <Icon size={iconSize} color={config.text} />
        <Text
          style={[styles.text, size === 'sm' && styles.textSm, { color: config.text }]}
          numberOfLines={1}
        >
          {config.label}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={[styles.tooltip, { borderColor: config.border }]}>
          <Text style={[styles.tooltipTitle, { color: config.text }]}>{config.label}</Text>
          <Text style={styles.tooltipText}>{config.description}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeSm: {
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
  textSm: {
    fontSize: 11,
  },
  tooltip: {
    marginTop: 4,
    padding: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    backgroundColor: Colors.card,
    maxWidth: 220,
  },
  tooltipTitle: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  tooltipText: {
    fontSize: 11,
    color: Colors.mutedForeground,
    lineHeight: 15,
  },
});
