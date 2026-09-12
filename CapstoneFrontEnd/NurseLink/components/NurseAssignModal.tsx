import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';

export interface AssignTarget {
  id: string;
  name: string;
  /** Shown alongside the name so a head nurse can confirm they have the
   * right account — several nurses on this ward share a display name. */
  email: string;
  department: string;
  shift: string;
}

interface NurseAssignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nurse: AssignTarget | null;
  onSave: (data: { department: string; shift: string }) => Promise<void>;
}

export function NurseAssignModal({ open, onOpenChange, nurse, onSave }: NurseAssignModalProps) {
  const [department, setDepartment] = useState('');
  const [shift, setShift] = useState('morning');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (nurse) {
      setDepartment(nurse.department || '');
      setShift(nurse.shift || 'morning');
      setError('');
    }
  }, [nurse, open]);

  const handleSubmit = async () => {
    if (!department.trim()) {
      setError('Department is required');
      return;
    }
    setLoading(true);
    try {
      await onSave({ department: department.trim(), shift });
      onOpenChange(false);
    } catch {
      // onSave's caller reports the error via toast; keep the dialog open.
    } finally {
      setLoading(false);
    }
  };

  if (!nurse) return null;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !loading && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Assign {nurse.name}</Text>
          {nurse.email ? <Text style={styles.emailConfirm}>{nurse.email}</Text> : null}
          <Text style={styles.description}>
            Change this nurse&apos;s department or shift. They will be notified.
          </Text>

          <View style={styles.form}>
            <Input
              label="Department *"
              placeholder="e.g., ICU"
              value={department}
              onChangeText={setDepartment}
              error={error}
            />
            <Select
              label="Shift"
              value={shift}
              onValueChange={setShift}
              options={[
                { label: 'Morning', value: 'morning' },
                { label: 'Afternoon', value: 'afternoon' },
                { label: 'Night', value: 'night' },
              ]}
            />
          </View>

          <View style={styles.footer}>
            <Button variant="outline" onPress={() => onOpenChange(false)} disabled={loading} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button onPress={handleSubmit} disabled={loading} loading={loading} style={{ flex: 1 }}>
              Save
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 420,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  emailConfirm: { fontSize: 12.5, color: Colors.blue700, fontWeight: '600', marginBottom: 8 },
  description: { fontSize: 13, color: Colors.mutedForeground, marginBottom: 16, lineHeight: 18 },
  form: { gap: 14 },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
