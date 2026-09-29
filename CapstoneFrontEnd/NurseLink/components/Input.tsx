import React from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import { Colors, Radius } from '../constants/colors';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: ViewStyle;
  inputWrapperStyle?: ViewStyle;
}

export function Input({
  label,
  error,
  leftIcon,
  rightIcon,
  containerStyle,
  inputWrapperStyle,
  style,
  ...props
}: InputProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.wrapper,
          error ? styles.wrapperError : null,
          inputWrapperStyle,
        ]}
      >
        {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}
        <TextInput
          style={[
            styles.input,
            leftIcon ? { paddingLeft: 36 } : null,
            rightIcon ? { paddingRight: 40 } : null,
            style,
          ]}
          placeholderTextColor={Colors.mutedForeground}
          {...props}
        />
        {rightIcon ? <View style={styles.rightIcon}>{rightIcon}</View> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  wrapper: {
    position: 'relative',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.inputBackground,
    justifyContent: 'center',
  },
  wrapperError: {
    borderColor: Colors.destructive,
  },
  input: {
    // 44px, not web's 36px (h-9) — meets the 44x44 minimum touch target
    // size for a mobile input; web's own input is below that minimum,
    // which isn't worth reproducing here just for pixel parity.
    height: 44,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.foreground,
  },
  leftIcon: {
    position: 'absolute',
    left: 12,
    zIndex: 1,
  },
  rightIcon: {
    position: 'absolute',
    right: 12,
    zIndex: 1,
  },
  error: {
    fontSize: 12,
    color: Colors.destructive,
  },
});
