import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { ArrowRight, X, BedDouble } from 'lucide-react-native';
import { Input } from './Input';
import { Colors, Radius, Shadows } from '../constants/colors';
import { updatePatient, ApiError } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import type { Patient } from '../types/domain';

/**
 * Room Transfer — move a patient to a new room/bed. Writes through the normal
 * patient update, so the change persists, syncs across every screen (the
 * shared `patients` live revision), and is recorded in the patient's Activity
 * History as a Room change (before -> after).
 */
export function RoomTransferModal({
  open,
  onOpenChange,
  patient,
  onTransferred,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onTransferred: (updated: Patient) => void;
}) {
  const toast = useToast();
  const [room, setRoom] = useState('');
  const [bed, setBed] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset the form to the patient's current room each time the dialog opens
  // for a (different) patient — React's "adjust state during render" pattern,
  // so there's no setState-in-effect.
  const openKey = open && patient ? patient.id : null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (openKey !== lastKey) {
    setLastKey(openKey);
    if (open && patient) {
      setRoom(patient.room || '');
      setBed(patient.bedNumber || '');
      setError('');
    }
  }

  const changed = patient ? room.trim() !== (patient.room || '') || bed.trim() !== (patient.bedNumber || '') : false;

  const submit = async () => {
    if (!patient) return;
    if (!room.trim()) {
      setError('A room is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await updatePatient(patient.id, {
        room: room.trim(),
        bedNumber: bed.trim(),
      } as Partial<Patient>);
      onTransferred(updated);
      toast.success('Patient transferred', {
        description: `${patient.name} moved to Room ${room.trim()}${bed.trim() ? ` · Bed ${bed.trim()}` : ''}.`,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not transfer the patient. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <BedDouble size={16} color={Colors.blue700} />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.title}>Room Transfer</Text>
              {patient ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {patient.name} · {patient.id}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => onOpenChange(false)} hitSlop={8} accessibilityLabel="Close">
              <X size={20} color={Colors.gray500} />
            </Pressable>
          </View>

          <View style={styles.body}>
            {patient ? (
              <View style={styles.currentRow}>
                <Text style={styles.currentLabel}>Current</Text>
                <Text style={styles.currentValue}>
                  Room {patient.room || '—'}
                  {patient.bedNumber ? ` · Bed ${patient.bedNumber}` : ''}
                </Text>
                <ArrowRight size={14} color={Colors.gray400} />
                <Text style={styles.newValue}>
                  Room {room.trim() || '—'}
                  {bed.trim() ? ` · Bed ${bed.trim()}` : ''}
                </Text>
              </View>
            ) : null}

            <Input label="New Room *" value={room} onChangeText={setRoom} placeholder="e.g. 310" autoFocus />
            <Input label="Bed Number" value={bed} onChangeText={setBed} placeholder="Optional" />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              <Pressable onPress={() => onOpenChange(false)} style={[styles.btn, styles.cancelBtn]}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={saving || !changed || !room.trim()}
                style={[styles.btn, styles.confirmBtn, (saving || !changed || !room.trim()) && styles.btnDisabled]}
              >
                {saving ? <ActivityIndicator size="small" color={Colors.white} /> : (
                  <Text style={styles.confirmText}>Transfer</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { width: '100%', maxWidth: 440, backgroundColor: Colors.white, borderRadius: Radius.xl, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerIcon: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.blue50, alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '800', color: Colors.foreground },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 1 },
  body: { padding: 16, gap: 12 },
  currentRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, backgroundColor: Colors.gray50, borderRadius: Radius.md, padding: 10 },
  currentLabel: { fontSize: 11, fontWeight: '700', color: Colors.mutedForeground, textTransform: 'uppercase' },
  currentValue: { fontSize: 13, color: Colors.foreground, fontWeight: '600' },
  newValue: { fontSize: 13, color: Colors.blue700, fontWeight: '700' },
  error: { fontSize: 12.5, color: Colors.red700 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  cancelText: { fontSize: 14, fontWeight: '700', color: Colors.gray700 },
  confirmBtn: { backgroundColor: Colors.blue600 },
  confirmText: { fontSize: 14, fontWeight: '700', color: Colors.white },
  btnDisabled: { opacity: 0.5 },
});
