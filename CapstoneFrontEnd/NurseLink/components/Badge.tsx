import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Colors, Radius } from '../constants/colors';

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'info'
  | 'outline';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const variantBg: Record<BadgeVariant, string> = {
  default: Colors.primary,
  secondary: Colors.muted,
  destructive: Colors.destructive,
  success: Colors.success,
  warning: Colors.warning,
  info: Colors.info,
  outline: Colors.white,
};

const variantText: Record<BadgeVariant, string> = {
  default: Colors.white,
  secondary: Colors.foreground,
  destructive: Colors.white,
  success: Colors.white,
  warning: Colors.white,
  info: Colors.white,
  outline: Colors.foreground,
};

export function Badge({ children, variant = 'default', style, textStyle }: BadgeProps) {
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: variantBg[variant],
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: Colors.border,
        },
        style,
      ]}
    >
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text style={[styles.text, { color: variantText[variant] }, textStyle]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
  },
});
