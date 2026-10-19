import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Building2,
  FlaskConical,
  ListChecks,
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { fetchPatients, deletePatient, ApiError } from '../../services/api';
import type { Patient } from '../../types/domain';
import { Card, CardContent } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { RiskBadge } from '../../components/RiskBadge';
import { PatientKardexModal } from '../../components/PatientKardexModal';
import { LabsAndMedicationsModal } from '../../components/LabsAndMedicationsModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Colors, Radius } from '../../constants/colors';
import { useToast } from '../../contexts/ToastContext';
import { Pagination, usePagination } from '../../components/Pagination';

function getAttendingPhysician(patient: Patient): string {
  return patient.attendingPhysician || patient.assignedNurseName || 'Not Assigned';
}

/** Groups a patient's Kardex-assigned doctors by department, so a card with
 * "Cardiology: Dr. A, Dr. B" reads as one line per department rather than
 * one line per doctor. */
function groupDoctorsByDepartment(patient: Patient) {
  const groups = new Map<string, string[]>();
  for (const doctor of patient.assignedDoctors || []) {
    const dept = doctor.departmentName || 'Unassigned Department';
    const names = groups.get(dept) || [];
    names.push(doctor.name);
    groups.set(dept, names);
  }
  return Array.from(groups.entries()).map(([department, doctors]) => ({ department, doctors }));
}

export default function MyPatientsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ viewPatient?: string; highlightId?: string }>();
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
  const [labsMedsOpen, setLabsMedsOpen] = useState(false);
  const [labsMedsPatient, setLabsMedsPatient] = useState<Patient | null>(null);

  const loadPatients = useCallback(async () => {
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
  }, [toast]);

  useEffect(() => {
    (async () => {
      await loadPatients();
    })();
  }, [loadPatients]);

  useEffect(() => {
    const id =
      typeof params.viewPatient === 'string'
        ? params.viewPatient
        : typeof params.highlightId === 'string'
          ? params.highlightId
          : null;
    if (!id) return;
    if (loading) return; // wait for the real, permission-scoped list first

    // fetchPatients({mine:true}) already scopes this to patients this nurse
    // can see — if the patient isn't in that list, there is nothing valid
    // to highlight (deleted, discharged-and-reassigned, or not actually
    // theirs), so say so instead of silently doing nothing.
    if (!patients.some((p) => p.id === id)) {
      toast.error('Patient not found', {
        description: 'This patient is no longer available, or you do not have access to them.',
      });
      return;
    }

    (() => {
      setHighlightedId(id);
      // A leftover search/room/risk filter from a previous visit could hide
      // the exact patient this link was supposed to surface — clear them so
      // "View Patient" from a notification always actually shows up.
      setSearchQuery('');
      setRoomFilter('all');
      setRiskFilter('all');
    })();
    const timer = setTimeout(() => setHighlightedId(null), 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.viewPatient, params.highlightId, loading]);

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

  // 10 per page; Next/Prev jumps back to the top.
  const scrollRef = useRef<ScrollView>(null);
  const paged = usePagination(filteredPatients, {
    scrollRef,
    resetKey: `${searchQuery}|${roomFilter}|${riskFilter}`,
  });
  // A patient opened from a notification may sit on a later page: go there.
  const { setPage: goToPage, pageSize } = paged;
  useEffect(() => {
    if (!highlightedId) return;
    const index = filteredPatients.findIndex((p) => p.id === highlightedId);
    if (index >= 0) goToPage(Math.floor(index / pageSize) + 1);
  }, [highlightedId, filteredPatients, goToPage, pageSize]);

  return (
    <ScrollView
      ref={scrollRef}
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
              { label: 'Critical Risk', value: 'critical' },
              { label: 'High Risk', value: 'high' },
              { label: 'Moderate Risk', value: 'medium' },
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
        paged.pageItems.map((patient) => (
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
                    <RiskBadge level={patient.riskLevel} size="sm" />
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

              {patient.assignedDoctors && patient.assignedDoctors.length > 0 ? (
                <View style={styles.medicalTeamBox}>
                  <Text style={styles.medicalTeamLabel}>Medical Team</Text>
                  {groupDoctorsByDepartment(patient).map(({ department, doctors }) => (
                    <View key={department} style={styles.medicalTeamRow}>
                      <Building2 size={13} color={Colors.blue700} />
                      <Text style={styles.medicalTeamText} numberOfLines={1}>
                        <Text style={styles.medicalTeamDept}>{department}: </Text>
                        {doctors.join(', ')}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

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
                <Button
                  variant="outline"
                  size="sm"
                  style={styles.actionBtn}
                  onPress={() => {
                    setLabsMedsPatient(patient);
                    setLabsMedsOpen(true);
                  }}
                >
                  <FlaskConical size={14} color={Colors.blue700} />
                  <Text style={styles.actionText}>Labs &amp; Meds</Text>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  style={styles.actionBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/tasks',
                      params: { patientId: patient.id, scrollToPatient: 'true' },
                    } as any)
                  }
                >
                  <ListChecks size={14} color={Colors.blue700} />
                  <Text style={styles.actionText}>View Tasks</Text>
                </Button>
              </View>
            </CardContent>
          </Card>
        ))
      )}
      <Pagination
        page={paged.page}
        totalPages={paged.totalPages}
        onPageChange={paged.setPage}
        total={paged.total}
      />

      <PatientKardexModal
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        patient={editingPatient}
        onSaved={loadPatients}
      />
      <LabsAndMedicationsModal
        open={labsMedsOpen}
        onOpenChange={setLabsMedsOpen}
        patient={labsMedsPatient}
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
  medicalTeamBox: {
    backgroundColor: Colors.blue50,
    borderRadius: Radius.md,
    padding: 10,
    gap: 4,
  },
  medicalTeamLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.blue700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  medicalTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  medicalTeamText: {
    flex: 1,
    fontSize: 12,
    color: Colors.foreground,
  },
  medicalTeamDept: {
    fontWeight: '700',
  },
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
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  actionBtn: { minHeight: 36 },
  actionText: { fontSize: 12, fontWeight: '600', color: Colors.blue700 },
});
