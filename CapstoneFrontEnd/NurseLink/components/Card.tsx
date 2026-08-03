import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Colors, Shadows, Radius } from '../constants/colors';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export function Card({ children, style }: CardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function CardHeader({ children, style }: CardProps) {
  return <View style={[styles.header, style]}>{children}</View>;
}

export function CardTitle({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: TextStyle;
}) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function CardDescription({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: TextStyle;
}) {
  return <Text style={[styles.description, style]}>{children}</Text>;
}

export function CardContent({ children, style }: CardProps) {
  return <View style={[styles.content, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadows.sm,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
  },
  description: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginTop: 4,
  },
  content: {
    padding: 16,
  },
});
