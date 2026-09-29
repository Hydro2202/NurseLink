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
  // Soft/light, not solid — matches web's badge.tsx ("info" is a light
  // primary chip, not a solid teal one; Colors.info is unused here now).
  info: Colors.primaryLight,
  outline: Colors.white,
};

const variantText: Record<BadgeVariant, string> = {
  default: Colors.white,
  secondary: Colors.foreground,
  destructive: Colors.white,
  success: Colors.white,
  // Dark text on the amber background for contrast — matches web, which
  // uses text-foreground (not white) for this variant specifically.
  warning: Colors.foreground,
  info: Colors.primary,
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
    // Matches web's badge.tsx (px-2.5 py-0.5 rounded-md, text-xs font-
    // semibold) — the web app is this project's design reference.
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.md,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
