import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Search,
  User,
  MapPin,
  Calendar,
  Stethoscope,
  AlertCircle,
  Activity,
  Eye,
  UserPlus,
  Edit2,
  Trash2,
} from 'lucide-react-native';
import { fetchPatients, deletePatient, ApiError } from '../../services/api';
import type { Patient } from '../../types/domain';
import { Card, CardContent } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { TaskAssignmentModal } from '../../components/TaskAssignmentModal';
import { PatientKardexModal } from '../../components/PatientKardexModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Colors, Radius } from '../../constants/colors';
import { useToast } from '../../contexts/ToastContext';

function getAttendingPhysician(patient: Patient) {
  return patient.attendingPhysician || 'Not Assigned';
}

export default function AllPatientsPage() {
  const router = useRouter();
  const toast = useToast();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Patient | null>(null);

  const loadPatients = async () => {
    try {
      const data = await fetchPatients();
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

  const uniqueRooms = useMemo(
    () => Array.from(new Set(patients.map((p) => p.room.split('-')[0]))),
    [patients]
  );

  const filteredPatients = patients.filter((patient) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      patient.name.toLowerCase().includes(q) ||
      patient.id.toLowerCase().includes(q) ||
      patient.room.toLowerCase().includes(q);
    const matchesRoom = roomFilter === 'all' || patient.room.startsWith(roomFilter);
    const matchesRisk = riskFilter === 'all' || patient.riskLevel === riskFilter;
    return matchesSearch && matchesRoom && matchesRisk;
  });

  const riskVariant = (risk: string) => {
    if (risk === 'high') return 'destructive' as const;
    if (risk === 'medium') return 'default' as const;
    return 'outline' as const;
  };

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>All Patients</Text>
            <Text style={styles.subtitle}>
              Supervisor view — {filteredPatients.length} of {patients.length} patients
              {loading ? ' (loading...)' : ''}
            </Text>
          </View>
          <Button
            size="sm"
            onPress={() => {
              setFormMode('add');
              setEditingPatient(null);
              setFormOpen(true);
            }}
          >
            <UserPlus size={16} color={Colors.white} />
            <Text style={{ color: Colors.white, fontWeight: '600' }}>Add Patient</Text>
          </Button>
        </View>

        <Input
          placeholder="Search by name, patient ID, or room..."
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
              ...uniqueRooms.map((room) => ({ label: room, value: room })),
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

        <View style={styles.statsGrid}>
          <Card style={styles.statCard}>
            <CardContent style={styles.statContent}>
              <Text style={styles.statLabel}>Total</Text>
              <Text style={styles.statValue}>{patients.length}</Text>
              <User size={18} color={Colors.blue600} />
            </CardContent>
          </Card>
          <Card style={styles.statCard}>
            <CardContent style={styles.statContent}>
              <Text style={styles.statLabel}>High Risk</Text>
              <Text style={[styles.statValue, { color: Colors.red600 }]}>
                {patients.filter((p) => p.riskLevel === 'high').length}
              </Text>
              <AlertCircle size={18} color={Colors.red600} />
            </CardContent>
          </Card>
          <Card style={styles.statCard}>
            <CardContent style={styles.statContent}>
              <Text style={styles.statLabel}>Medium</Text>
              <Text style={[styles.statValue, { color: Colors.warning }]}>
                {patients.filter((p) => p.riskLevel === 'medium').length}
              </Text>
              <Activity size={18} color={Colors.warning} />
            </CardContent>
          </Card>
          <Card style={styles.statCard}>
            <CardContent style={styles.statContent}>
              <Text style={styles.statLabel}>Low Risk</Text>
              <Text style={[styles.statValue, { color: Colors.green600 }]}>
                {patients.filter((p) => p.riskLevel === 'low').length}
              </Text>
              <Activity size={18} color={Colors.green600} />
            </CardContent>
          </Card>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.blue600} />
          </View>
        ) : filteredPatients.length === 0 ? (
          <Card>
            <CardContent style={styles.center}>
              <Text style={styles.muted}>No patients found</Text>
            </CardContent>
          </Card>
        ) : (
          filteredPatients.map((patient) => (
            <Card key={patient.id} style={styles.patientCard}>
              <CardContent style={styles.cardBody}>
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

                <View style={styles.diagnosisBox}>
                  <Text style={styles.diagnosisText}>
                    <Text style={styles.bold}>Diagnosis: </Text>
                    {patient.diagnosis}
                  </Text>
                  <View style={styles.physicianRow}>
                    <Stethoscope size={14} color={Colors.blue700} />
                    <Text style={styles.physician}>
                      {getAttendingPhysician(patient)}
                    </Text>
                  </View>
                </View>

                <View style={styles.vitalsGrid}>
                  <View style={styles.vitalBox}>
                    <Text style={styles.vitalLabel}>HR</Text>
                    <Text style={styles.vitalValue}>{patient.vitalSigns.heartRate}</Text>
                  </View>
                  <View style={styles.vitalBox}>
                    <Text style={styles.vitalLabel}>BP</Text>
                    <Text style={styles.vitalValue}>{patient.vitalSigns.bloodPressure}</Text>
                  </View>
                  <View style={styles.vitalBox}>
                    <Text style={styles.vitalLabel}>Temp</Text>
                    <Text style={styles.vitalValue}>{patient.vitalSigns.temperature}°C</Text>
                  </View>
                  <View style={styles.vitalBox}>
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

                <View style={styles.actions}>
                  <Button
                    variant="outline"
                    size="sm"
                    style={styles.actionBtn}
                    onPress={() => {
                      setFormMode('edit');
                      setEditingPatient(patient);
                      setFormOpen(true);
                    }}
                  >
                    <Edit2 size={14} color={Colors.blue700} />
                    <Text style={styles.outlineBtnText}>Edit</Text>
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
                    <Text style={[styles.outlineBtnText, { color: Colors.red600 }]}>Delete</Text>
                  </Button>
                  <Button
                    size="sm"
                    style={styles.actionBtn}
                    onPress={() => {
                      setSelectedPatient(patient);
                      setTaskModalOpen(true);
                    }}
                  >
                    <UserPlus size={14} color={Colors.white} />
                    <Text style={styles.primaryBtnText}>Assign Task</Text>
                  </Button>
                </View>
              </CardContent>
            </Card>
          ))
        )}
      </ScrollView>

      <TaskAssignmentModal
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        patient={selectedPatient}
      />
      <PatientKardexModal
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        patient={editingPatient}
        onSaved={loadPatients}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Patient"
        description={
          toDelete
            ? `Delete ${toDelete.name}? Related kardex, tasks, and assignments will be removed.`
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
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  header: {
    gap: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 13, color: Colors.mutedForeground },
  filterRow: { flexDirection: 'row', gap: 10 },
  filterSelect: { flex: 1 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', flexGrow: 1, minWidth: 140 },
  statContent: { padding: 12, gap: 4 },
  statLabel: { fontSize: 11, color: Colors.mutedForeground },
  statValue: { fontSize: 22, fontWeight: '700', color: Colors.foreground },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  muted: { color: Colors.mutedForeground, fontSize: 14 },
  patientCard: { borderWidth: 1, borderColor: Colors.border },
  cardBody: { gap: 12, padding: 14 },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  patientName: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: Colors.mutedForeground },
  diagnosisBox: {
    backgroundColor: Colors.gray50,
    borderRadius: Radius.md,
    padding: 10,
    gap: 6,
  },
  diagnosisText: { fontSize: 13, color: Colors.foreground, lineHeight: 18 },
  bold: { fontWeight: '700' },
  physicianRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  physician: { fontSize: 12, color: Colors.blue700, fontWeight: '600' },
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vitalBox: {
    width: '22%',
    flexGrow: 1,
    minWidth: 64,
    backgroundColor: Colors.blue50,
    borderRadius: Radius.sm,
    padding: 8,
    alignItems: 'center',
  },
  vitalLabel: { fontSize: 10, color: Colors.mutedForeground },
  vitalValue: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
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
  actions: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  actionBtn: { flex: 1 },
  outlineBtnText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  primaryBtnText: { fontSize: 13, fontWeight: '600', color: Colors.white },
});
