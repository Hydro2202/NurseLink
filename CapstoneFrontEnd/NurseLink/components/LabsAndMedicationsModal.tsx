import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { X, FlaskConical } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { KardexLabsAndMedications } from './KardexLabsAndMedications';
import type { Patient } from '../types/domain';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
}

/**
 * A dedicated jump-straight-there entry point for a patient's Laboratories/
 * Medication Intake — skips Edit Patient (Kardex) / Kardex History
 * entirely, for whoever just wants to check or update labs/meds without
 * touching the rest of the Kardex form. Same KardexLabsAndMedications used
 * by both of those, so behavior (permissions, validation) is identical.
 */
export function LabsAndMedicationsModal({ open, onOpenChange, patient }: Props) {
  if (!patient) return null;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <FlaskConical size={20} color={Colors.blue600} />
              <Text style={styles.title}>Laboratories &amp; Medication Intake</Text>
            </View>
            <Pressable onPress={() => onOpenChange(false)} hitSlop={8}>
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            {patient.name} · {patient.id}
          </Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            <KardexLabsAndMedications patientId={patient.id} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 720,
    maxHeight: '88%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 13, color: Colors.mutedForeground, marginTop: 2, marginBottom: 12 },
  scroll: { flexGrow: 0 },
});
