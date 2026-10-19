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
import { useIsDesktop } from '../utils/useIsDesktop';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary' | 'success' | 'link';
type Size = 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm';

interface ButtonProps {
  children?: React.ReactNode;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to the full width of the parent — the few places that need it
   * (login/signup submit, a bottom sheet's action buttons on phone). Every
   * other button defaults to hugging its own label instead of stretching
   * to fill a column-flex parent (see `base.alignSelf` below). */
  fullWidth?: boolean;
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
  fullWidth = false,
  style,
  textStyle,
  accessibilityLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const isDesktop = useIsDesktop();

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        isDesktop && desktopSizeStyles[size],
        variantStyles[variant],
        fullWidth ? styles.fullWidth : null,
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
        <Text
          style={[
            styles.text,
            variantTextStyles[variant],
            sizeTextStyles[size],
            isDesktop && desktopSizeTextStyles[size],
            textStyle,
          ]}
        >
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
    // Without this, a flex:1 button (e.g. two side-by-side action buttons)
    // won't shrink below its label's unwrapped width — on a narrow phone
    // that pushes the button past the screen edge instead of wrapping the
    // text, clipping it. minWidth:0 lets Yoga shrink it to its flex share.
    minWidth: 0,
    paddingVertical: 6,
    // A View's cross-axis default is 'stretch' — inside the column-flex
    // parent most screens wrap a lone button in, that stretches it to the
    // parent's full width, which is the "buttons go edge-to-edge" bug this
    // fixes. 'flex-start' makes the button hug its own label instead;
    // `fullWidth` (above) or a caller's own width/flex style in `style`
    // (applied after this, so it always wins) opt back in where stretching
    // is actually wanted.
    alignSelf: 'flex-start',
  },
  fullWidth: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  text: { fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
});

// Matches web's button.tsx size scale (h-11/h-9/h-12/icon/icon-sm) — 44px is
// also the minimum touch target size, which the default height fell short
// of before (40px). This is the phone/native sizing; see desktopSizeStyles
// below for the compact desktop-web override.
const sizeStyles: Record<Size, ViewStyle> = {
  // minHeight, not height: if a label has to wrap to a second line on a
  // narrow screen (see `base.minWidth`), the button grows to fit it
  // instead of clipping it. Icon buttons stay fixed/square — they never
  // wrap.
  default: { minHeight: 44, paddingHorizontal: 20 },
  sm: { minHeight: 36, paddingHorizontal: 14 },
  lg: { minHeight: 48, paddingHorizontal: 32 },
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

// Desktop web only (see useIsDesktop) — a mouse pointer doesn't need a 44px
// touch target, and a page full of full-height buttons reads as oversized
// on a 1366/1920-wide screen. Phones keep sizeStyles above untouched.
const desktopSizeStyles: Record<Size, ViewStyle> = {
  default: { minHeight: 36, paddingHorizontal: 14 },
  sm: { minHeight: 30, paddingHorizontal: 10 },
  lg: { minHeight: 40, paddingHorizontal: 18 },
  icon: { width: 32, height: 32 },
  'icon-sm': { width: 28, height: 28 },
};

const desktopSizeTextStyles: Record<Size, TextStyle> = {
  default: { fontSize: 14 },
  sm: { fontSize: 12 },
  lg: { fontSize: 15 },
  icon: { fontSize: 14 },
  'icon-sm': { fontSize: 12 },
};

const variantStyles: Record<Variant, ViewStyle> = {
  // blue600 — the same blue every screen's primary action already used
  // (most passed it as an override), so all primary buttons now match.
  default: { backgroundColor: Colors.blue600 },
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
  link: { color: Colors.blue600, textDecorationLine: 'underline' },
};
