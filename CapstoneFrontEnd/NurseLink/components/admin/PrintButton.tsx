import React, { useState } from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Printer } from 'lucide-react-native';
import { Colors, Radius } from '../../constants/colors';
import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/api';

interface Props {
  label?: string;
  /** Builds and prints the report; throw to show an error. */
  onPrint: () => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}

/** "Print" for admin lists and record details (see utils/print.ts). */
export function PrintButton({ label = 'Print', onPrint, disabled, compact }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onPrint();
    } catch (err) {
      toast.error('Could not print', {
        description: err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pressable
      onPress={run}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.btn, compact && styles.compact, (disabled || busy) && styles.disabled]}
    >
      {busy ? <ActivityIndicator size="small" color={Colors.blue700} /> : <Printer size={15} color={Colors.blue700} />}
      {compact ? null : <Text style={styles.text}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    height: 36,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.blue200,
    backgroundColor: Colors.white,
  },
  compact: { paddingHorizontal: 8, height: 30, borderWidth: 0 },
  disabled: { opacity: 0.5 },
  text: { fontSize: 13, fontWeight: '700', color: Colors.blue700 },
});
