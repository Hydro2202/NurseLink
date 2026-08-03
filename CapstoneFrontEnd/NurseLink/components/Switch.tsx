import React from 'react';
import { Pressable, View, StyleSheet, Animated } from 'react-native';
import { Colors } from '../constants/colors';

interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Switch({ value, onValueChange, disabled = false }: SwitchProps) {
  const translateX = React.useRef(new Animated.Value(value ? 16 : 0)).current;

  React.useEffect(() => {
    Animated.spring(translateX, {
      toValue: value ? 16 : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start();
  }, [value, translateX]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[
        styles.track,
        { backgroundColor: value ? Colors.primary : Colors.switchBackground },
        disabled && styles.disabled,
      ]}
    >
      <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 32,
    height: 18.4,
    borderRadius: 999,
    padding: 1,
    justifyContent: 'center',
  },
  thumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.card,
  },
  disabled: {
    opacity: 0.5,
  },
});
