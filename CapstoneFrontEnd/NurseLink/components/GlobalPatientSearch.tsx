import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Search, X } from 'lucide-react-native';
import { Input } from './Input';
import { fetchPatients } from '../services/api';
import type { Patient } from '../types/domain';

const MAX_RESULTS = 8;

/**
 * Top-bar patient search for head nurses. Matches name, patient ID or room —
 * the same fields as the All Patients search box — and picking a result
 * opens All Patients filtered to that patient, on the tab that holds them
 * (Active or Discharged). Enter searches All Patients across every record.
 *
 * The patient list is re-fetched each time the box gains focus, so results
 * never lag behind an admission or discharge made elsewhere.
 */
export function GlobalPatientSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [loading, setLoading] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = query.trim().toLowerCase();
  const results = q && patients
    ? patients
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.id.toLowerCase().includes(q) ||
            p.room.toLowerCase().includes(q)
        )
        .slice(0, MAX_RESULTS)
    : [];

  const handleFocus = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
    setLoading(true);
    fetchPatients()
      .then(setPatients)
      .catch(() => setPatients((prev) => prev ?? []))
      .finally(() => setLoading(false));
  };

  // Delayed so a tap on a result registers before the list unmounts.
  const handleBlur = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };

  const openAllPatients = (search: string, view: 'active' | 'discharged' | 'all') => {
    setOpen(false);
    setQuery('');
    router.push({ pathname: '/(app)/all-patients', params: { q: search, view } });
  };

  return (
    <View style={styles.wrap}>
      <Input
        value={query}
        onChangeText={setQuery}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSubmitEditing={() => q && openAllPatients(query.trim(), 'all')}
        placeholder="Search patients by name, ID or room"
        returnKeyType="search"
        accessibilityLabel="Search patients"
        leftIcon={<Search size={16} color="#5B6B82" />}
        rightIcon={
          query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <X size={15} color="#5B6B82" />
            </Pressable>
          ) : undefined
        }
        inputWrapperStyle={styles.inputWrapper}
      />
      {open && q ? (
        <View style={styles.panel}>
          {loading && !patients ? (
            <View style={styles.stateRow}>
              <ActivityIndicator size="small" color="#1D4ED8" />
            </View>
          ) : results.length === 0 ? (
            <Text style={styles.stateText}>No patients match “{query.trim()}”.</Text>
          ) : (
            results.map((p) => {
              const discharged = p.status === 'discharged';
              return (
                <Pressable
                  key={p.id}
                  onPress={() => openAllPatients(p.id, discharged ? 'discharged' : 'active')}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.result,
                    (pressed || hovered) && styles.resultActive,
                  ]}
                >
                  <View style={styles.resultText}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={styles.resultMeta} numberOfLines={1}>
                      {p.id} · Room {p.room}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, discharged && styles.statusPillDischarged]}>
                    <Text style={[styles.statusText, discharged && styles.statusTextDischarged]}>
                      {discharged ? 'Discharged' : 'Active'}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 340, maxWidth: '100%', flexShrink: 1, zIndex: 100 },
  inputWrapper: { backgroundColor: '#F4F6FB', borderColor: '#E3E8F0', borderRadius: 10, minHeight: 42 },
  panel: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3E8F0',
    borderRadius: 12,
    paddingVertical: 6,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  stateRow: { paddingVertical: 14, alignItems: 'center' },
  stateText: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, color: '#5B6B82' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9 },
  resultActive: { backgroundColor: '#F4F6FB' },
  resultText: { flex: 1, minWidth: 0 },
  resultName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  resultMeta: { fontSize: 12, color: '#5B6B82' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#EAF0FF' },
  statusPillDischarged: { backgroundColor: '#EEF1F6' },
  statusText: { fontSize: 11, fontWeight: '700', color: '#1D4ED8' },
  statusTextDischarged: { color: '#475569' },
});
