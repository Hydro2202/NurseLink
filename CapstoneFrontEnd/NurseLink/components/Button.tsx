import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  ActivityIndicator,
  View,
} from 'react-native';
import { Colors, Radius } from '../constants/colors';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary' | 'success' | 'link';
type Size = 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm';

interface ButtonProps {
  children?: React.ReactNode;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export function Button({
  children,
  onPress,
  variant = 'default',
  size = 'default',
  disabled = false,
  loading = false,
  style,
  textStyle,
  accessibilityLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        variantStyles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={
            variant === 'outline' || variant === 'ghost' || variant === 'link'
              ? Colors.primary
              : Colors.white
          }
        />
      ) : typeof children === 'string' ? (
        <Text style={[styles.text, variantTextStyles[variant], sizeTextStyles[size], textStyle]}>
          {children}
        </Text>
      ) : (
        <View style={styles.row}>{children}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Matches the web app's rounded-lg buttons (styles/theme.css) — the web
    // app is this project's design reference.
    borderRadius: Radius.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
});

// Matches web's button.tsx size scale (h-11/h-9/h-12/icon/icon-sm) — 44px is
// also the minimum touch target size, which the default height fell short
// of before (40px).
const sizeStyles: Record<Size, ViewStyle> = {
  default: { height: 44, paddingHorizontal: 20 },
  sm: { height: 36, paddingHorizontal: 14 },
  lg: { height: 48, paddingHorizontal: 32 },
  icon: { width: 44, height: 44, paddingHorizontal: 0 },
  'icon-sm': { width: 36, height: 36, paddingHorizontal: 0 },
};

const sizeTextStyles: Record<Size, TextStyle> = {
  default: { fontSize: 14 },
  sm: { fontSize: 12 },
  lg: { fontSize: 16 },
  icon: { fontSize: 14 },
  'icon-sm': { fontSize: 12 },
};

const variantStyles: Record<Variant, ViewStyle> = {
  // Colors.primary (#3B82F6), not blue600 (#2563EB) — blue600 is web's
  // *hover* color for this exact button (--primary-hover); its resting
  // state is Colors.primary.
  default: { backgroundColor: Colors.primary },
  outline: {
    backgroundColor: Colors.white,
    // 2px, matching web's border-2 outline buttons.
    borderWidth: 2,
    borderColor: Colors.border,
  },
  ghost: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: Colors.destructive },
  // Kept as a subtle/muted button rather than remapping to web's solid
  // secondary (#8B5CF6, purple) — 11 existing screens use this variant for
  // a deliberately low-emphasis action, and repainting them bold purple
  // would be a much bigger, riskier visual change than this task asked
  // for. success/link below are new and don't have that problem.
  secondary: { backgroundColor: Colors.muted },
  success: { backgroundColor: Colors.success },
  link: { backgroundColor: 'transparent' },
};

const variantTextStyles: Record<Variant, TextStyle> = {
  default: { color: Colors.white },
  outline: { color: Colors.foreground },
  ghost: { color: Colors.foreground },
  destructive: { color: Colors.white },
  secondary: { color: Colors.foreground },
  success: { color: Colors.white },
  link: { color: Colors.primary, textDecorationLine: 'underline' },
};
