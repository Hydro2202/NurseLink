import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius } from '../constants/colors';

interface ProgressProps {
  value: number;
  style?: ViewStyle;
  trackColor?: string;
  fillColor?: string;
  height?: number;
}

export function Progress({
  value,
  style,
  trackColor = Colors.muted,
  fillColor = Colors.primary,
  height = 8,
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <View style={[styles.track, { backgroundColor: trackColor, height, borderRadius: height }, style]}>
      <View
        style={[
          styles.fill,
          {
            width: `${clamped}%`,
            backgroundColor: fillColor,
            height,
            borderRadius: height,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {},
});
