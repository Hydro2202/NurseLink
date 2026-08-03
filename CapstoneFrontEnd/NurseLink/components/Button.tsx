import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  View,
  StyleProp,
} from 'react-native';
import { Colors, Radius } from '../constants/colors';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
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
          color={variant === 'outline' || variant === 'ghost' ? Colors.primary : Colors.white}
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
    borderRadius: Radius.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
});

const sizeStyles: Record<Size, ViewStyle> = {
  default: { height: 40, paddingHorizontal: 16 },
  sm: { height: 36, paddingHorizontal: 12 },
  lg: { height: 48, paddingHorizontal: 24 },
  icon: { width: 40, height: 40, paddingHorizontal: 0 },
  'icon-sm': { width: 32, height: 32, paddingHorizontal: 0 },
};

const sizeTextStyles: Record<Size, TextStyle> = {
  default: { fontSize: 14 },
  sm: { fontSize: 13 },
  lg: { fontSize: 16 },
  icon: { fontSize: 14 },
  'icon-sm': { fontSize: 12 },
};

const variantStyles: Record<Variant, ViewStyle> = {
  default: { backgroundColor: Colors.blue600 },
  outline: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ghost: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: Colors.destructive },
  secondary: { backgroundColor: Colors.muted },
};

const variantTextStyles: Record<Variant, TextStyle> = {
  default: { color: Colors.white },
  outline: { color: Colors.foreground },
  ghost: { color: Colors.foreground },
  destructive: { color: Colors.white },
  secondary: { color: Colors.foreground },
};
