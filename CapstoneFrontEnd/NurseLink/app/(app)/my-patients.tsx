import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Search,
  MapPin,
  Calendar,
  Heart,
  Activity,
  Thermometer,
  AlertCircle,
  User,
  Edit2,
  Trash2,
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { fetchPatients, deletePatient, ApiError } from '../../services/api';
import type { Patient } from '../../types/domain';
import { Card, CardContent } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { PatientKardexModal } from '../../components/PatientKardexModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Colors, Radius } from '../../constants/colors';
import { useToast } from '../../contexts/ToastContext';

function getAttendingPhysician(patient: Patient): string {
  return patient.attendingPhysician || patient.assignedNurseName || 'Not Assigned';
}

export default function MyPatientsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ viewPatient?: string }>();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Patient | null>(null);

  const loadPatients = async () => {
    try {
      const data = await fetchPatients({ mine: true });
      setPatients(data);
    } catch (error) {
      setPatients([]);
      toast.error('Failed to load patients', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    const id = typeof params.viewPatient === 'string' ? params.viewPatient : null;
    if (!id) return;
    setHighlightedId(id);
    const timer = setTimeout(() => setHighlightedId(null), 3000);
    return () => clearTimeout(timer);
  }, [params.viewPatient]);

  const roomPrefixes = useMemo(() => {
    const prefixes = new Set(patients.map((p) => p.room.split('-')[0]));
    return Array.from(prefixes);
  }, [patients]);

  const filteredPatients = useMemo(() => {
    return patients.filter((p) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.room.toLowerCase().includes(q) ||
        p.diagnosis.toLowerCase().includes(q);
      const matchesRoom = roomFilter === 'all' || p.room.startsWith(roomFilter);
      const matchesRisk = riskFilter === 'all' || p.riskLevel === riskFilter;
      return matchesSearch && matchesRoom && matchesRisk;
    });
  }, [patients, searchQuery, roomFilter, riskFilter]);

  const riskVariant = (risk: string) => {
    if (risk === 'high') return 'destructive' as const;
    if (risk === 'medium') return 'default' as const;
    return 'outline' as const;
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Button
            variant="ghost"
            size="icon-sm"
            onPress={() => router.back()}
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={18} color={Colors.foreground} />
          </Button>
          <View style={styles.flex1}>
            <Text style={styles.title}>My Assigned Patients</Text>
            <Text style={styles.subtitle}>
              {filteredPatients.length} of {patients.length} patient
              {patients.length !== 1 ? 's' : ''} assigned to {user?.name || 'you'}
            </Text>
          </View>
        </View>

        <Input
          placeholder="Search by name, ID, room, or diagnosis..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          leftIcon={<Search size={16} color={Colors.gray500} />}
        />

        <View style={styles.filterRow}>
          <Select
            value={roomFilter}
            onValueChange={setRoomFilter}
            placeholder="All Rooms"
            style={styles.filterSelect}
            options={[
              { label: 'All Rooms', value: 'all' },
              ...roomPrefixes.map((p) => ({ label: p, value: p })),
            ]}
          />
          <Select
            value={riskFilter}
            onValueChange={setRiskFilter}
            placeholder="All Risk Levels"
            style={styles.filterSelect}
            options={[
              { label: 'All Risk Levels', value: 'all' },
              { label: 'High Risk', value: 'high' },
              { label: 'Medium Risk', value: 'medium' },
              { label: 'Low Risk', value: 'low' },
            ]}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.blue600} />
          <Text style={styles.muted}>Loading patients...</Text>
        </View>
      ) : filteredPatients.length === 0 ? (
        <Card>
          <CardContent style={styles.center}>
            <Text style={styles.muted}>No patients found</Text>
          </CardContent>
        </Card>
      ) : (
        filteredPatients.map((patient) => (
          <Card
            key={patient.id}
            style={{
              ...styles.patientCard,
              ...(highlightedId === patient.id ? styles.highlighted : {}),
            }}
          >
            <CardContent style={styles.cardBody}>
              <View style={styles.patientHeader}>
                <View style={styles.flex1}>
                  <View style={styles.nameRow}>
                    <Text style={styles.patientName}>{patient.name}</Text>
                    <Badge variant="outline">{patient.id}</Badge>
                    <Badge variant={riskVariant(patient.riskLevel)}>
                      {patient.riskLevel.toUpperCase()} RISK
                    </Badge>
                  </View>
                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <User size={14} color={Colors.mutedForeground} />
                      <Text style={styles.metaText}>
                        {patient.age}y · {patient.gender}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <MapPin size={14} color={Colors.mutedForeground} />
                      <Text style={styles.metaText}>{patient.room}</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Calendar size={14} color={Colors.mutedForeground} />
                      <Text style={styles.metaText}>
                        {new Date(patient.admissionDate).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.diagnosisBox}>
                <Text style={styles.diagnosisText}>
                  <Text style={styles.bold}>Diagnosis: </Text>
                  {patient.diagnosis}
                </Text>
                <Text style={styles.physician}>
                  Attending: {getAttendingPhysician(patient)}
                </Text>
              </View>

              <View style={styles.vitalsGrid}>
                <View style={styles.vitalBox}>
                  <Heart size={12} color={Colors.red600} />
                  <Text style={styles.vitalLabel}>HR</Text>
                  <Text style={styles.vitalValue}>{patient.vitalSigns.heartRate}</Text>
                </View>
                <View style={styles.vitalBox}>
                  <Activity size={12} color={Colors.blue600} />
                  <Text style={styles.vitalLabel}>BP</Text>
                  <Text style={styles.vitalValue}>{patient.vitalSigns.bloodPressure}</Text>
                </View>
                <View style={styles.vitalBox}>
                  <Thermometer size={12} color={Colors.orange600} />
                  <Text style={styles.vitalLabel}>Temp</Text>
                  <Text style={styles.vitalValue}>{patient.vitalSigns.temperature}°C</Text>
                </View>
                <View style={styles.vitalBox}>
                  <Activity size={12} color={Colors.teal600} />
                  <Text style={styles.vitalLabel}>SpO2</Text>
                  <Text style={styles.vitalValue}>{patient.vitalSigns.oxygenSaturation}%</Text>
                </View>
              </View>

              {patient.alerts.length > 0 ? (
                <View style={styles.alerts}>
                  {patient.alerts.map((alert, idx) => (
                    <View key={idx} style={styles.alertChip}>
                      <AlertCircle size={12} color={Colors.orange700} />
                      <Text style={styles.alertText}>{alert}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.actionsRow}>
                <Button
                  variant="outline"
                  size="sm"
                  style={styles.actionBtn}
                  onPress={() => {
                    setEditingPatient(patient);
                    setEditOpen(true);
                  }}
                >
                  <Edit2 size={14} color={Colors.blue700} />
                  <Text style={styles.actionText}>Edit</Text>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  style={styles.actionBtn}
                  onPress={() => {
                    setToDelete(patient);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 size={14} color={Colors.red600} />
                  <Text style={[styles.actionText, { color: Colors.red600 }]}>Delete</Text>
                </Button>
                <Pressable
                  style={styles.viewTasksBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/tasks',
                      params: { patientId: patient.id, scrollToPatient: 'true' },
                    } as any)
                  }
                >
                  <Text style={styles.viewTasksText}>View tasks</Text>
                </Pressable>
              </View>
            </CardContent>
          </Card>
        ))
      )}

      <PatientKardexModal
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        patient={editingPatient}
        onSaved={loadPatients}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Patient"
        description={
          toDelete
            ? `Delete ${toDelete.name}? This removes the patient and related kardex/tasks/assignments.`
            : 'Delete this patient?'
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deletePatient(toDelete.id);
            toast.success('Patient deleted');
            setToDelete(null);
            await loadPatients();
          } catch (error) {
            toast.error('Failed to delete patient', {
              description: error instanceof ApiError ? error.message : 'Please try again.',
            });
          }
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  header: { gap: 12, marginBottom: 4 },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex1: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 13, color: Colors.mutedForeground, marginTop: 2 },
  filterRow: { flexDirection: 'row', gap: 10 },
  filterSelect: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 10 },
  muted: { color: Colors.mutedForeground, fontSize: 14 },
  patientCard: { borderWidth: 1, borderColor: Colors.border },
  highlighted: { borderColor: Colors.blue500, backgroundColor: Colors.blue50 },
  cardBody: { gap: 12, padding: 14 },
  patientHeader: { flexDirection: 'row' },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  patientName: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: Colors.mutedForeground },
  diagnosisBox: {
    backgroundColor: Colors.gray50,
    borderRadius: Radius.md,
    padding: 10,
    gap: 4,
  },
  diagnosisText: { fontSize: 13, color: Colors.foreground, lineHeight: 18 },
  bold: { fontWeight: '700' },
  physician: { fontSize: 12, color: Colors.blue700, fontWeight: '600' },
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vitalBox: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: Colors.blue50,
    borderRadius: Radius.sm,
    padding: 10,
    alignItems: 'center',
    gap: 2,
  },
  vitalLabel: { fontSize: 11, color: Colors.mutedForeground },
  vitalValue: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  alerts: { gap: 6 },
  alertChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.orange50,
    borderWidth: 1,
    borderColor: Colors.orange100,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  alertText: { flex: 1, fontSize: 12, color: Colors.orange700 },
  viewTasksBtn: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 10,
    alignItems: 'center',
  },
  viewTasksText: { fontSize: 13, fontWeight: '600', color: Colors.blue600 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  actionBtn: { minHeight: 36 },
  actionText: { fontSize: 12, fontWeight: '600', color: Colors.blue700 },
});
