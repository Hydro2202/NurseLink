// I change this by rai
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Colors } from '../../constants/colors';

type RingStatus = 'scanning' | 'success' | 'failed';

type Props = {
  percent: number;
  status: RingStatus;
  size?: number;
};

const STROKE_WIDTH = 5;

const STATUS_COLOR: Record<RingStatus, string> = {
  scanning: Colors.blue500,
  success: Colors.green600,
  failed: Colors.red600,
};

export function FaceScanRing({ percent, status, size = 210 }: Props) {
  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={STATUS_COLOR[status]}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          fill="none"
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: '18%',
    left: '50%',
    marginLeft: -105,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
