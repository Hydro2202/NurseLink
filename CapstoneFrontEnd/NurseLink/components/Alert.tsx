import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react-native';
import { Colors, Radius } from '../constants/colors';

type AlertVariant = 'default' | 'destructive' | 'warning' | 'success' | 'info';

interface AlertProps {
  children: React.ReactNode;
  variant?: AlertVariant;
  style?: ViewStyle;
}

const config: Record<
  AlertVariant,
  { bg: string; border: string; icon: typeof AlertCircle; iconColor: string }
> = {
  default: {
    bg: Colors.blue50,
    border: Colors.primary,
    icon: Info,
    iconColor: Colors.primary,
  },
  destructive: {
    bg: Colors.destructiveLight,
    border: Colors.destructive,
    icon: AlertCircle,
    iconColor: Colors.destructive,
  },
  warning: {
    bg: Colors.warningLight,
    border: Colors.warning,
    icon: AlertTriangle,
    iconColor: Colors.warning,
  },
  success: {
    bg: Colors.successLight,
    border: Colors.success,
    icon: CheckCircle,
    iconColor: Colors.success,
  },
  info: {
    bg: Colors.infoLight,
    border: Colors.info,
    icon: Info,
    iconColor: Colors.info,
  },
};

export function Alert({ children, variant = 'default', style }: AlertProps) {
  const c = config[variant];
  const Icon = c.icon;
  return (
    <View style={[styles.alert, { backgroundColor: c.bg, borderLeftColor: c.border }, style]}>
      <Icon size={18} color={c.iconColor} style={{ marginTop: 2 }} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

export function AlertTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function AlertDescription({ children }: { children: React.ReactNode }) {
  return <Text style={styles.description}>{children}</Text>;
}

const styles = StyleSheet.create({
  alert: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: Radius.md,
    borderLeftWidth: 4,
  },
  content: { flex: 1, gap: 4 },
  title: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  description: { fontSize: 13, color: Colors.mutedForeground, lineHeight: 18 },
});
