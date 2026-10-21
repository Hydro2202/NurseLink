import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import {
  Search,
  User,
  MapPin,
  Calendar,
  Stethoscope,
  Building2,
  AlertCircle,
  Activity,
  UserPlus,
  LogOut,
  ArrowUpDown,
  RotateCcw,
  History,
  Edit2,
  Heart,
  Thermometer,
  Droplet,
  FlaskConical,
  Users,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react-native';
import {
  fetchPatients,
  dischargePatient,
  fetchDepartments,
  updatePatient,
  ApiError,
} from '../../services/api';
import type { Department, Patient } from '../../types/domain';
import { vitalsMonitoringOrderLabel } from '../../components/tasks/taskLabels';
import { Card, CardContent } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { DatePicker, todayIso } from '../../components/DatePicker';
import { RiskBadge } from '../../components/RiskBadge';
import { TaskAssignmentModal } from '../../components/TaskAssignmentModal';
import { PatientKardexModal } from '../../components/PatientKardexModal';
import { DischargePlanModal } from '../../components/DischargePlanModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PatientVisitHistoryModal } from '../../components/PatientVisitHistoryModal';
import { ReadmitPatientModal } from '../../components/ReadmitPatientModal';
import { EditPatientModal } from '../../components/EditPatientModal';
import { LabsAndMedicationsModal } from '../../components/LabsAndMedicationsModal';
import { PatientAssignmentHistoryModal } from '../../components/PatientAssignmentHistoryModal';
import { Colors, Radius, Shadows } from '../../constants/colors';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { bmiCategory } from '../../utils/bmi';

function getAttendingPhysician(patient: Patient) {
  return patient.attendingPhysician || 'Not Assigned';
}

function getVitalsMonitoringOrderLabel(patient: Patient) {
  return vitalsMonitoringOrderLabel(patient.vitalsMonitoringOrder);
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

/**
 * "Ana Cruz (assigned by Mharon Reyes)" — the roster is shared, so a nurse
 * reading this list is usually looking at someone else's patient. Naming both
 * the assigned nurse and whoever assigned them is what makes that legible.
 */
function getAssignmentLabel(patient: Patient) {
  const nurse = patient.assignedNurseName?.trim();
  const by = patient.assignedBy?.trim();
  if (!nurse) return 'Unassigned';
  return by && by !== nurse ? `${nurse} · assigned by ${by}` : nurse;
}

/** Bare name only, for filter-matching and the unique-nurse dropdown list —
 * prefers who's actually on shift right now (see onDutyNurseName) over the
 * static day-to-day assignment. */
function getAssignedNurseName(patient: Patient): string {
  return patient.onDutyNurseName?.trim() || patient.assignedNurseName?.trim() || '';
}

/** Display string for the "Assigned Nurse" column/row — same preference as
 * getAssignedNurseName, but labelled so it's never mistaken for a live
 * reading when it's actually the (possibly stale) static assignment. */
function getAssignedNurseDisplay(patient: Patient): string {
  if (patient.onDutyNurseName) return patient.onDutyNurseName;
  if (patient.assignedNurseName) return `${patient.assignedNurseName} (off duty)`;
  return 'Unassigned';
}

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'info' | 'warning' | 'secondary' }
> = {
  admitted: { label: 'Admitted', variant: 'info' },
  observation: { label: 'Under Observation', variant: 'warning' },
  discharged: { label: 'Discharged', variant: 'secondary' },
};

// Rough adult reference ranges — good enough to flag "worth a second look"
// on a roster card, not a clinical decision aid. 0/blank means "not
// recorded" (this codebase's convention for an unset vital), never flagged.
type VitalSeverity = 'critical' | 'warning' | 'normal';

function heartRateSeverity(hr: number): VitalSeverity {
  if (!hr) return 'normal';
  if (hr < 40 || hr > 150) return 'critical';
  if (hr < 60 || hr > 100) return 'warning';
  return 'normal';
}
function temperatureSeverity(temp: number): VitalSeverity {
  if (!temp) return 'normal';
  if (temp >= 39.5 || temp < 35) return 'critical';
  if (temp >= 37.8 || temp < 36) return 'warning';
  return 'normal';
}
function spo2Severity(spo2: number): VitalSeverity {
  if (!spo2) return 'normal';
  if (spo2 < 90) return 'critical';
  if (spo2 < 95) return 'warning';
  return 'normal';
}
function bloodPressureSeverity(bp: string): VitalSeverity {
  const match = (bp || '').match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return 'normal';
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  if (systolic >= 180 || systolic < 90 || diastolic >= 120 || diastolic < 60) return 'critical';
  if (systolic >= 140 || diastolic >= 90) return 'warning';
  return 'normal';
}

const VITAL_SEVERITY_STYLE: Record<
  VitalSeverity,
  { bg: string; border: string; text: string }
> = {
  critical: { bg: Colors.red50, border: Colors.red300, text: Colors.red700 },
  warning: { bg: Colors.orange50, border: Colors.orange300, text: Colors.orange700 },
  normal: { bg: Colors.blue50, border: Colors.blue100, text: Colors.foreground },
};

const PATIENTS_PER_PAGE = 10;

type SortKey = 'name' | 'room' | 'nurse' | 'status';
// 'active' (the default) means not-discharged — a discharged patient's
// record is kept, never deleted, but stays out of the working list unless
// a head nurse explicitly asks to see it via 'discharged' or 'all'.
type StatusFilter = 'active' | 'admitted' | 'observation' | 'discharged' | 'all';

export default function AllPatientsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const isSupervisor = user?.role === 'head_nurse';
  const [patients, setPatients] = useState<Patient[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [nurseFilter, setNurseFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [dischargeDateFrom, setDischargeDateFrom] = useState('');
  const [dischargeDateTo, setDischargeDateTo] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [dischargeConfirmOpen, setDischargeConfirmOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [toDischarge, setToDischarge] = useState<Patient | null>(null);
  const [settingDeptFor, setSettingDeptFor] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPatient, setHistoryPatient] = useState<Patient | null>(null);
  const [readmitOpen, setReadmitOpen] = useState(false);
  const [readmitTarget, setReadmitTarget] = useState<Patient | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Patient | null>(null);
  const [labsMedsOpen, setLabsMedsOpen] = useState(false);
  const [labsMedsPatient, setLabsMedsPatient] = useState<Patient | null>(null);
  const [assignmentHistoryOpen, setAssignmentHistoryOpen] = useState(false);
  const [assignmentHistoryPatient, setAssignmentHistoryPatient] = useState<Patient | null>(null);
  const [currentPage, setCurrentPageState] = useState(1);
  const scrollRef = useRef<ScrollView>(null);
  // Changing page jumps back to the top so the nurse never scrolls up by hand.
  const setCurrentPage = useCallback((next: number | ((p: number) => number)) => {
    setCurrentPageState(next);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const loadPatients = useCallback(async () => {
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
  }, [toast]);

  useEffect(() => {
    (async () => {
      await loadPatients();
    })();
    fetchDepartments()
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [loadPatients]);

  const uniqueRooms = useMemo(
    () => Array.from(new Set(patients.map((p) => p.room.split('-')[0]))),
    [patients]
  );
  const uniqueNurses = useMemo(
    () =>
      Array.from(new Set(patients.map(getAssignedNurseName).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
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
    const matchesDept = deptFilter === 'all' || String(patient.departmentId ?? '') === deptFilter;
    const matchesNurse = nurseFilter === 'all' || getAssignedNurseName(patient) === nurseFilter;
    const patientStatus = patient.status || 'admitted';
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'active'
          ? patientStatus !== 'discharged'
          : patientStatus === statusFilter;
    // Discharge date range only means anything in the Discharged view —
    // an active patient has no dischargedAt to compare against.
    const dischargedDate = patient.dischargedAt ? patient.dischargedAt.slice(0, 10) : '';
    const matchesDischargeFrom =
      statusFilter !== 'discharged' || !dischargeDateFrom || (dischargedDate && dischargedDate >= dischargeDateFrom);
    const matchesDischargeTo =
      statusFilter !== 'discharged' || !dischargeDateTo || (dischargedDate && dischargedDate <= dischargeDateTo);
    return (
      matchesSearch && matchesRoom && matchesRisk && matchesDept && matchesNurse &&
      matchesStatus && matchesDischargeFrom && matchesDischargeTo
    );
  });

  const dischargedCount = useMemo(
    () => patients.filter((p) => p.status === 'discharged').length,
    [patients]
  );

  const sortedPatients = useMemo(() => {
    const sorters: Record<SortKey, (p: Patient) => string> = {
      name: (p) => p.name.toLowerCase(),
      room: (p) => p.room.toLowerCase(),
      nurse: (p) => getAssignedNurseName(p).toLowerCase() || '￿', // unassigned sorts last
      status: (p) => p.status || 'admitted',
    };
    const key = sorters[sortBy];
    const sorted = [...filteredPatients].sort((a, b) => key(a).localeCompare(key(b)));
    return sortDesc ? sorted.reverse() : sorted;
  }, [filteredPatients, sortBy, sortDesc]);

  // Back to page 1 whenever the result set itself changes — otherwise a
  // narrower filter/search could strand the view on a now-nonexistent page.
  useEffect(() => {
    (() => {
      // Plain reset (no scroll): typing in search shouldn't jump the page.
      setCurrentPageState(1);
    })();
  }, [searchQuery, roomFilter, riskFilter, deptFilter, nurseFilter, statusFilter, dischargeDateFrom, dischargeDateTo, sortBy, sortDesc]);

  // Risk has no place in the Discharged view (see the stats/filter/badge
  // changes below) — clear a leftover risk filter so it can't silently hide
  // discharged patients that don't match a risk picked while looking at a
  // different tab.
  useEffect(() => {
    (() => {
      if (statusFilter === 'discharged') setRiskFilter('all');
    })();
  }, [statusFilter]);

  // Computed once per mount, not re-read live — "this week"/"this month" on
  // the stat cards below don't need second-by-second precision, and
  // calling Date.now() directly in a memo's body is an impure render call
  // (react-hooks/purity); a useState initializer is the sanctioned
  // run-once-and-cache escape hatch for exactly this.
  const [nowMs] = useState(() => Date.now());

  // The Discharged tab's own count — honours search + discharge date range
  // (the filters relevant to browsing discharge history) but not
  // department/nurse/room, so the subtitle can call out when one of those
  // narrows the view further (see the "(showing X)" subtitle text below).
  const dischargedMatchingDateAndSearch = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return patients.filter((p) => {
      if (p.status !== 'discharged') return false;
      const matchesSearch =
        !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.room.toLowerCase().includes(q);
      const dischargedDate = p.dischargedAt ? p.dischargedAt.slice(0, 10) : '';
      const matchesFrom = !dischargeDateFrom || (dischargedDate && dischargedDate >= dischargeDateFrom);
      const matchesTo = !dischargeDateTo || (dischargedDate && dischargedDate <= dischargeDateTo);
      return matchesSearch && matchesFrom && matchesTo;
    }).length;
  }, [patients, searchQuery, dischargeDateFrom, dischargeDateTo]);

  // Ground-truth discharge counts for the Discharged tab's stat cards —
  // always computed over every patient regardless of the current filters,
  // so these three numbers never mix in a non-discharged patient and never
  // shrink just because a search/filter happens to be active.
  const dischargeStats = useMemo(() => {
    const weekAgo = nowMs - 7 * 86400000;
    const monthAgo = nowMs - 30 * 86400000;
    const discharged = patients.filter((p) => p.status === 'discharged');
    const thisWeek = discharged.filter((p) => p.dischargedAt && new Date(p.dischargedAt).getTime() >= weekAgo).length;
    const thisMonth = discharged.filter((p) => p.dischargedAt && new Date(p.dischargedAt).getTime() >= monthAgo).length;
    return { total: discharged.length, thisWeek, thisMonth };
  }, [patients, nowMs]);

  const totalPages = Math.max(1, Math.ceil(sortedPatients.length / PATIENTS_PER_PAGE));
  // Clamped rather than reset to 1 — covers the result set shrinking for a
  // reason other than the effect above (e.g. a patient discharged from
  // under the current page after a reload).
  const safePage = Math.min(currentPage, totalPages);
  const pagedPatients = sortedPatients.slice(
    (safePage - 1) * PATIENTS_PER_PAGE,
    safePage * PATIENTS_PER_PAGE
  );
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  const setPatientDepartment = async (patient: Patient, departmentId: string) => {
    setSettingDeptFor(patient.id);
    try {
      const updated = await updatePatient(patient.id, {
        departmentId: departmentId ? Number(departmentId) : null,
      } as Partial<Patient>);
      setPatients((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (error) {
      toast.error('Failed to set department', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setSettingDeptFor(null);
    }
  };

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>All Patients</Text>
            {statusFilter === 'discharged' ? (
              <Text style={styles.subtitle}>
                {dischargedMatchingDateAndSearch} discharged patient{dischargedMatchingDateAndSearch === 1 ? '' : 's'}
                {filteredPatients.length !== dischargedMatchingDateAndSearch ? ` (showing ${filteredPatients.length})` : ''}
                {loading ? ' (loading...)' : ''}
              </Text>
            ) : (
              <Text style={styles.subtitle}>
                Head nurse view — {filteredPatients.length} of {patients.length} patients
                {loading ? ' (loading...)' : ''}
                {statusFilter === 'active' ? ' · discharged patients hidden, switch filter to view' : ''}
              </Text>
            )}
          </View>
          {isSupervisor ? (
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
          ) : null}
        </View>

        <View style={styles.tabRow}>
          <Pressable
            onPress={() => setStatusFilter('active')}
            style={[styles.tabBtn, statusFilter !== 'discharged' && styles.tabBtnActive]}
          >
            <User size={14} color={statusFilter !== 'discharged' ? Colors.white : Colors.gray600} />
            <Text style={[styles.tabBtnText, statusFilter !== 'discharged' && styles.tabBtnTextActive]}>
              Active Patients
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setStatusFilter('discharged')}
            style={[styles.tabBtn, statusFilter === 'discharged' && styles.tabBtnActive]}
          >
            <LogOut size={14} color={statusFilter === 'discharged' ? Colors.white : Colors.gray600} />
            <Text style={[styles.tabBtnText, statusFilter === 'discharged' && styles.tabBtnTextActive]}>
              Discharged
            </Text>
            {dischargedCount > 0 ? (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{dischargedCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <Input
          placeholder={
            statusFilter === 'discharged'
              ? 'Search discharged patients by name or ID...'
              : 'Search by name, patient ID, or room...'
          }
          value={searchQuery}
          onChangeText={setSearchQuery}
          leftIcon={<Search size={16} color={Colors.gray500} />}
        />

        {statusFilter === 'discharged' ? (
          <View style={styles.filterRow}>
            <DatePicker
              label="Discharged From"
              value={dischargeDateFrom}
              onChange={setDischargeDateFrom}
              maxDate={dischargeDateTo || todayIso()}
              style={styles.filterSelect}
            />
            <DatePicker
              label="Discharged To"
              value={dischargeDateTo}
              onChange={setDischargeDateTo}
              minDate={dischargeDateFrom || undefined}
              maxDate={todayIso()}
              style={styles.filterSelect}
            />
          </View>
        ) : null}

        <View style={styles.filterRow}>
          <Select
            value={deptFilter}
            onValueChange={setDeptFilter}
            placeholder="All Departments"
            style={styles.filterSelect}
            searchable
            options={[
              { label: 'All Departments', value: 'all' },
              ...departments.map((d) => ({ label: d.name, value: String(d.id) })),
            ]}
          />
          <Select
            value={nurseFilter}
            onValueChange={setNurseFilter}
            placeholder="All Nurses"
            style={styles.filterSelect}
            searchable
            options={[
              { label: 'All Nurses', value: 'all' },
              ...uniqueNurses.map((name) => ({ label: name, value: name })),
            ]}
          />
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
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            placeholder="Active Patients"
            style={styles.filterSelect}
            options={[
              { label: 'Active Patients', value: 'active' },
              { label: 'Admitted', value: 'admitted' },
              { label: 'Under Observation', value: 'observation' },
              { label: 'Discharged', value: 'discharged' },
              { label: 'All Records', value: 'all' },
            ]}
          />
          {statusFilter !== 'discharged' ? (
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
          ) : null}
        </View>

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort by</Text>
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortKey)}
            style={styles.sortSelect}
            options={[
              { label: 'Patient Name', value: 'name' },
              { label: 'Room', value: 'room' },
              { label: 'Assigned Nurse', value: 'nurse' },
              { label: 'Status', value: 'status' },
            ]}
          />
          <Pressable
            onPress={() => setSortDesc((prev) => !prev)}
            style={styles.sortDirBtn}
            hitSlop={6}
            accessibilityLabel={sortDesc ? 'Sort descending' : 'Sort ascending'}
          >
            <ArrowUpDown size={14} color={Colors.gray600} />
            <Text style={styles.sortDirText}>{sortDesc ? 'Z–A' : 'A–Z'}</Text>
          </Pressable>
        </View>

        {statusFilter === 'discharged' ? (
          <View style={styles.statsGrid}>
            <Card style={styles.statCard}>
              <CardContent style={styles.statContent}>
                <Text style={styles.statLabel}>Total Discharged</Text>
                <Text style={[styles.statValue, { color: Colors.gray600 }]}>{dischargeStats.total}</Text>
                <LogOut size={18} color={Colors.gray600} />
              </CardContent>
            </Card>
            <Card style={styles.statCard}>
              <CardContent style={styles.statContent}>
                <Text style={styles.statLabel}>Discharged This Week</Text>
                <Text style={[styles.statValue, { color: Colors.blue600 }]}>{dischargeStats.thisWeek}</Text>
                <Calendar size={18} color={Colors.blue600} />
              </CardContent>
            </Card>
            <Card style={styles.statCard}>
              <CardContent style={styles.statContent}>
                <Text style={styles.statLabel}>Discharged This Month</Text>
                <Text style={[styles.statValue, { color: Colors.teal600 }]}>{dischargeStats.thisMonth}</Text>
                <Calendar size={18} color={Colors.teal600} />
              </CardContent>
            </Card>
          </View>
        ) : (
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
                <Text style={styles.statLabel}>Critical</Text>
                <Text style={[styles.statValue, { color: Colors.red600 }]}>
                  {patients.filter((p) => p.riskLevel === 'critical').length}
                </Text>
                <AlertCircle size={18} color={Colors.red600} />
              </CardContent>
            </Card>
            <Card style={styles.statCard}>
              <CardContent style={styles.statContent}>
                <Text style={styles.statLabel}>High Risk</Text>
                <Text style={[styles.statValue, { color: Colors.orange600 }]}>
                  {patients.filter((p) => p.riskLevel === 'high').length}
                </Text>
                <AlertCircle size={18} color={Colors.orange600} />
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
            <Card style={styles.statCard}>
              <CardContent style={styles.statContent}>
                <Text style={styles.statLabel}>Discharged</Text>
                <Text style={[styles.statValue, { color: Colors.gray600 }]}>
                  {patients.filter((p) => p.status === 'discharged').length}
                </Text>
                <LogOut size={18} color={Colors.gray600} />
              </CardContent>
            </Card>
          </View>
        )}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.blue600} />
          </View>
        ) : sortedPatients.length === 0 ? (
          <Card>
            <CardContent style={styles.center}>
              <Text style={styles.muted}>No patients found</Text>
            </CardContent>
          </Card>
        ) : (
          pagedPatients.map((patient) => {
            const statusConfig = STATUS_CONFIG[patient.status || 'admitted'] || STATUS_CONFIG.admitted;
            const isDischarged = patient.status === 'discharged';
            return (
            <Card
              key={patient.id}
              style={{
                ...styles.patientCard,
                ...(isDischarged ? styles.patientCardDischarged : null),
              }}
            >
              <CardContent style={styles.cardBody}>
                {/* Header: identity + quick-access icon actions */}
                <View style={styles.cardHeader}>
                  <View style={styles.identityBlock}>
                    <View style={styles.nameRow}>
                      <Text style={styles.patientName}>{patient.name}</Text>
                      <Badge variant="outline">{patient.id}</Badge>
                    </View>
                    <View style={styles.badgeRow}>
                      <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                      {!isDischarged ? <RiskBadge level={patient.riskLevel} size="sm" /> : null}
                    </View>
                  </View>
                  <View style={styles.headerActions}>
                    <Pressable
                      onPress={() => {
                        setHistoryPatient(patient);
                        setHistoryOpen(true);
                      }}
                      style={styles.iconBtn}
                      hitSlop={6}
                      accessibilityLabel={`View visit history for ${patient.name}`}
                    >
                      <History size={15} color={Colors.blue700} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setAssignmentHistoryPatient(patient);
                        setAssignmentHistoryOpen(true);
                      }}
                      style={styles.iconBtn}
                      hitSlop={6}
                      accessibilityLabel={`View nurses who have handled ${patient.name}`}
                    >
                      <Users size={15} color={Colors.blue700} />
                    </Pressable>
                    {isSupervisor ? (
                      <Pressable
                        onPress={() => {
                          setEditTarget(patient);
                          setEditOpen(true);
                        }}
                        style={styles.iconBtn}
                        hitSlop={6}
                        accessibilityLabel={`Edit record for ${patient.name}`}
                      >
                        <Edit2 size={15} color={Colors.blue700} />
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => {
                        setLabsMedsPatient(patient);
                        setLabsMedsOpen(true);
                      }}
                      style={styles.iconBtn}
                      hitSlop={6}
                      accessibilityLabel={`Labs and medication intake for ${patient.name}`}
                    >
                      <FlaskConical size={15} color={Colors.blue700} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.metaDivider} />

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <User size={13} color={Colors.mutedForeground} />
                    <Text style={styles.metaText}>
                      {patient.age}y · {patient.gender}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <MapPin size={13} color={Colors.mutedForeground} />
                    <Text style={styles.metaText}>
                      {isDischarged ? 'Last Room: ' : ''}
                      {patient.room}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Calendar size={13} color={Colors.mutedForeground} />
                    <Text style={styles.metaText}>
                      Admitted {new Date(patient.admissionDate).toLocaleDateString()}
                    </Text>
                  </View>
                  {isDischarged && patient.dischargedAt ? (
                    <View style={styles.metaItem}>
                      <LogOut size={13} color={Colors.gray500} />
                      <Text style={styles.metaText}>
                        Discharged {new Date(patient.dischargedAt).toLocaleDateString()}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {(isDischarged && patient.dischargedByName) || patient.lastEditedByName ? (
                  <View style={styles.chipRow}>
                    {isDischarged && patient.dischargedByName ? (
                      <View style={styles.dischargedByBox}>
                        <LogOut size={10} color={Colors.gray600} />
                        <Text style={styles.dischargedByCardText}>
                          Discharged by {patient.dischargedByName}
                        </Text>
                      </View>
                    ) : null}
                    {patient.lastEditedByName ? (
                      <View style={styles.dischargedByBox}>
                        <Edit2 size={10} color={Colors.gray600} />
                        <Text style={styles.dischargedByCardText}>
                          Edited by {patient.lastEditedByName}
                          {patient.lastEditedAt
                            ? ` · ${new Date(patient.lastEditedAt).toLocaleDateString()}`
                            : ''}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.sectionBox}>
                  <Text style={styles.sectionHeading}>Clinical Details</Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>
                      {isDischarged ? 'Last Diagnosis' : 'Diagnosis'}
                    </Text>
                    <Text style={styles.detailValue}>{patient.diagnosis}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelRow}>
                      <Stethoscope size={12.5} color={Colors.blue700} />
                      <Text style={styles.detailLabel}>Attending Physician</Text>
                    </View>
                    <Text style={styles.detailValue}>{getAttendingPhysician(patient)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Vital Signs Monitoring</Text>
                    <Text style={styles.detailValue}>{getVitalsMonitoringOrderLabel(patient)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>
                      {isDischarged ? 'Last Assigned Nurse' : 'Assigned Nurse'}
                    </Text>
                    <Text style={styles.detailValue}>
                      {isDischarged
                        ? patient.assignedNurseName || 'Not on record'
                        : getAssignedNurseDisplay(patient)}
                    </Text>
                  </View>
                  {!isDischarged ? (
                    <Text style={styles.assignmentSub}>{getAssignmentLabel(patient)}</Text>
                  ) : null}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>
                      {isDischarged ? 'Last Department' : 'Department'}
                    </Text>
                    {isSupervisor && !isDischarged ? (
                      <Select
                        value={patient.departmentId != null ? String(patient.departmentId) : ''}
                        onValueChange={(v) => setPatientDepartment(patient, v)}
                        placeholder={settingDeptFor === patient.id ? 'Saving...' : 'Set department'}
                        style={styles.deptSelect}
                        options={departments.map((d) => ({ label: d.name, value: String(d.id) }))}
                      />
                    ) : (
                      <Text style={styles.detailValue}>
                        {patient.departmentName || 'No department set'}
                      </Text>
                    )}
                  </View>
                </View>

                {patient.assignedDoctors && patient.assignedDoctors.length > 0 ? (
                  <View style={styles.medicalTeamBox}>
                    <Text style={styles.medicalTeamLabel}>Medical Team</Text>
                    {groupDoctorsByDepartment(patient).map(({ department, doctors }) => (
                      <View key={department} style={styles.physicianRow}>
                        <Building2 size={13} color={Colors.blue700} />
                        <Text style={styles.medicalTeamText} numberOfLines={1}>
                          <Text style={styles.medicalTeamDept}>{department}: </Text>
                          {doctors.join(', ')}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <Text style={styles.vitalsSectionLabel}>
                  {isDischarged ? 'Last Recorded Vitals' : 'Current Vitals'}
                </Text>
                <View style={styles.vitalsGrid}>
                  {(
                    [
                      {
                        key: 'hr', short: 'HR', icon: Heart,
                        value: patient.vitalSigns.heartRate, unit: 'bpm',
                        severity: heartRateSeverity(patient.vitalSigns.heartRate),
                      },
                      {
                        key: 'bp', short: 'BP', icon: Activity,
                        value: patient.vitalSigns.bloodPressure, unit: 'mmHg',
                        severity: bloodPressureSeverity(patient.vitalSigns.bloodPressure),
                      },
                      {
                        key: 'temp', short: 'Temp', icon: Thermometer,
                        value: patient.vitalSigns.temperature, unit: '°C',
                        severity: temperatureSeverity(patient.vitalSigns.temperature),
                      },
                      {
                        key: 'spo2', short: 'SpO2', icon: Droplet,
                        value: patient.vitalSigns.oxygenSaturation, unit: '%',
                        severity: spo2Severity(patient.vitalSigns.oxygenSaturation),
                      },
                    ] as const
                  ).map((vital) => {
                    const severityStyle = VITAL_SEVERITY_STYLE[vital.severity];
                    const VitalIcon = vital.icon;
                    const hasReading = !!vital.value;
                    const spacedUnit = vital.unit === '°C' || vital.unit === '%';
                    return (
                      <View
                        key={vital.key}
                        style={[
                          styles.vitalBox,
                          { backgroundColor: severityStyle.bg, borderColor: severityStyle.border },
                        ]}
                      >
                        <View style={styles.vitalIconRow}>
                          <VitalIcon size={11} color={severityStyle.text} />
                          <Text style={[styles.vitalLabel, { color: severityStyle.text }]}>
                            {vital.short}
                          </Text>
                          {hasReading && vital.severity !== 'normal' ? (
                            <AlertCircle size={10} color={severityStyle.text} />
                          ) : null}
                        </View>
                        <Text style={[styles.vitalValue, { color: severityStyle.text }]}>
                          {hasReading
                            ? `${vital.value}${spacedUnit ? '' : ' '}${vital.unit}`
                            : '—'}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {patient.heightCm != null || patient.weightKg != null ? (
                  <Text style={styles.heightWeightLine}>
                    Height: {patient.heightCm != null ? `${patient.heightCm} cm` : '—'} · Weight:{' '}
                    {patient.weightKg != null ? `${patient.weightKg} kg` : '—'}
                    {patient.bmi != null ? ` · BMI: ${patient.bmi} (${bmiCategory(patient.bmi)})` : ''}
                  </Text>
                ) : null}

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
                  {isDischarged ? (
                    isSupervisor ? (
                      <Button
                        size="sm"
                        style={styles.readmitBtn}
                        onPress={() => {
                          setReadmitTarget(patient);
                          setReadmitOpen(true);
                        }}
                      >
                        <RotateCcw size={15} color={Colors.white} />
                        <Text style={styles.primaryBtnText}>Readmit Patient</Text>
                      </Button>
                    ) : (
                      <Text style={styles.dischargedNote}>
                        This patient must be readmitted before further action.
                      </Text>
                    )
                  ) : (
                    <>
                      <Button
                        size="sm"
                        style={styles.actionBtn}
                        onPress={() => {
                          setSelectedPatient(patient);
                          setTaskModalOpen(true);
                        }}
                      >
                        <UserPlus size={14} color={Colors.white} />
                        <Text style={styles.primaryBtnText}>Assign Nurse</Text>
                      </Button>
                      {isSupervisor ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          style={styles.actionBtn}
                          onPress={() => {
                            setToDischarge(patient);
                            setDischargeConfirmOpen(true);
                          }}
                        >
                          <LogOut size={14} color={Colors.white} />
                          <Text style={styles.primaryBtnText}>Discharge</Text>
                        </Button>
                      ) : null}
                    </>
                  )}
                </View>
              </CardContent>
            </Card>
            );
          })
        )}

        {!loading && totalPages > 1 ? (
          <View style={styles.pagination}>
            <Pressable
              onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              style={[styles.pageNavBtn, safePage === 1 && styles.pageNavBtnDisabled]}
              hitSlop={6}
              accessibilityLabel="Previous page"
            >
              <ChevronLeft size={16} color={safePage === 1 ? Colors.gray300 : Colors.blue700} />
            </Pressable>
            {pageNumbers.map((page) => (
              <Pressable
                key={page}
                onPress={() => setCurrentPage(page)}
                style={[styles.pageNumBtn, page === safePage && styles.pageNumBtnActive]}
              >
                <Text style={[styles.pageNumText, page === safePage && styles.pageNumTextActive]}>
                  {page}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              style={[styles.pageNavBtn, safePage === totalPages && styles.pageNavBtnDisabled]}
              hitSlop={6}
              accessibilityLabel="Next page"
            >
              <ChevronRight size={16} color={safePage === totalPages ? Colors.gray300 : Colors.blue700} />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <TaskAssignmentModal
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        patient={selectedPatient}
      />
      <PatientVisitHistoryModal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        patient={historyPatient}
      />
      <PatientAssignmentHistoryModal
        open={assignmentHistoryOpen}
        onOpenChange={setAssignmentHistoryOpen}
        patient={assignmentHistoryPatient}
      />
      <ReadmitPatientModal
        open={readmitOpen}
        onOpenChange={setReadmitOpen}
        patient={readmitTarget}
        onReadmitted={(updated) => {
          setPatients((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        }}
      />
      <EditPatientModal
        open={editOpen}
        onOpenChange={setEditOpen}
        patient={editTarget}
        onSaved={(updated) => {
          setPatients((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        }}
      />
      <PatientKardexModal
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        patient={editingPatient}
        onSaved={loadPatients}
      />
      <LabsAndMedicationsModal
        open={labsMedsOpen}
        onOpenChange={setLabsMedsOpen}
        patient={labsMedsPatient}
      />
      <ConfirmDialog
        open={dischargeConfirmOpen}
        onOpenChange={(next) => {
          setDischargeConfirmOpen(next);
          if (!next) setToDischarge(null);
        }}
        title="Discharge Patient"
        description={
          toDischarge
            ? `Discharge ${toDischarge.name}? You'll complete a Discharge Plan next — the patient isn't marked as discharged until that's submitted.`
            : 'Discharge this patient?'
        }
        confirmLabel="Discharge"
        destructive
        onConfirm={() => {
          // The patient stays exactly as they are (not discharged) until the
          // Discharge Plan modal's own "Complete Discharge" actually submits —
          // this step only decides which patient to open that form for.
          setDischargeConfirmOpen(false);
          setDischargeOpen(true);
        }}
      />
      <DischargePlanModal
        open={dischargeOpen}
        onOpenChange={(next) => {
          setDischargeOpen(next);
          if (!next) setToDischarge(null);
        }}
        patient={toDischarge}
        onConfirm={async (plan) => {
          if (!toDischarge) return;
          try {
            const updated = await dischargePatient(toDischarge.id, plan);
            setPatients((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            toast.success('Patient discharged', {
              description: `${toDischarge.name} has been marked as discharged.`,
            });
            setDischargeOpen(false);
            setToDischarge(null);
          } catch (error) {
            toast.error('Failed to discharge patient', {
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
  tabRow: { flexDirection: 'row', gap: 8, backgroundColor: Colors.gray100, padding: 4, borderRadius: Radius.lg, alignSelf: 'flex-start' },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.md,
  },
  tabBtnActive: { backgroundColor: Colors.blue600, ...Shadows.sm },
  tabBtnText: { fontSize: 13, fontWeight: '700', color: Colors.gray600 },
  tabBtnTextActive: { color: Colors.white },
  tabBadge: {
    backgroundColor: Colors.white,
    borderRadius: Radius.full,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { fontSize: 10.5, fontWeight: '800', color: Colors.blue700 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  filterSelect: { flexGrow: 1, flexBasis: 150, minWidth: 140 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sortLabel: { fontSize: 12.5, fontWeight: '600', color: Colors.mutedForeground },
  sortSelect: { flex: 1, maxWidth: 220 },
  sortDirBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sortDirText: { fontSize: 12, fontWeight: '700', color: Colors.gray600 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', flexGrow: 1, minWidth: 140 },
  statContent: { padding: 12, gap: 4 },
  statLabel: { fontSize: 11, color: Colors.mutedForeground },
  statValue: { fontSize: 22, fontWeight: '700', color: Colors.foreground },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  muted: { color: Colors.mutedForeground, fontSize: 14 },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  pageNavBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNavBtnDisabled: { opacity: 0.5 },
  pageNumBtn: {
    minWidth: 32,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNumBtnActive: { backgroundColor: Colors.blue600, borderColor: Colors.blue600 },
  pageNumText: { fontSize: 13, fontWeight: '600', color: Colors.gray700 },
  pageNumTextActive: { color: Colors.white },
  patientCard: { borderWidth: 1, borderColor: Colors.border, ...Shadows.sm },
  patientCardDischarged: { backgroundColor: Colors.gray50, borderColor: Colors.gray200 },
  cardBody: { gap: 14, padding: 18 },

  // Header: identity on the left, quick-access icon actions pinned right —
  // kept out of the action-button row below so they never compete with it.
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  identityBlock: { flex: 1, gap: 6 },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  patientName: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  headerActions: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    backgroundColor: Colors.blue50,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // A thin rule separates "who this is" from "the facts about them" —
  // point 2 of the redesign ask, so the header doesn't blend into the rest.
  metaDivider: { height: 1, backgroundColor: Colors.gray100 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, color: Colors.mutedForeground, fontWeight: '500' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dischargedByBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.gray100,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dischargedByCardText: { fontSize: 11, fontWeight: '600', color: Colors.gray600 },

  // Clinical details: a labelled card, each fact its own row (label above
  // value) rather than one dense "Label: value" run-on line.
  sectionBox: {
    backgroundColor: Colors.gray50,
    borderRadius: Radius.md,
    padding: 12,
    gap: 10,
  },
  sectionHeading: {
    fontSize: 11.5,
    fontWeight: '800',
    color: Colors.gray600,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailRow: { gap: 3 },
  detailLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailLabel: { fontSize: 11, fontWeight: '700', color: Colors.mutedForeground },
  detailValue: { fontSize: 13.5, color: Colors.foreground, fontWeight: '600' },
  assignmentSub: {
    fontSize: 11,
    color: Colors.gray400,
    marginTop: -6,
  },
  deptSelect: { minWidth: 160, alignSelf: 'flex-start' },

  physicianRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  medicalTeamText: {
    flex: 1,
    fontSize: 12,
    color: Colors.foreground,
  },
  medicalTeamDept: {
    fontWeight: '700',
  },

  vitalsSectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: Colors.gray600,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vitalBox: {
    width: '22%',
    flexGrow: 1,
    minWidth: 72,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 9,
    gap: 3,
  },
  vitalIconRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vitalLabel: { fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.2 },
  vitalValue: { fontSize: 13.5, fontWeight: '800' },
  heightWeightLine: { fontSize: 12, color: Colors.gray600, marginTop: 2 },

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

  actions: { flexDirection: 'row', gap: 8, paddingTop: 6, marginTop: 2, borderTopWidth: 1, borderTopColor: Colors.gray100 },
  actionBtn: { flex: 1 },
  // Discharged cards get one full-width, unmistakably primary action rather
  // than sharing the row with a second (now-removed) button.
  readmitBtn: { flex: 1, ...Shadows.sm },
  primaryBtnText: { fontSize: 13, fontWeight: '600', color: Colors.white },
  dischargedNote: {
    flex: 1,
    fontSize: 12,
    color: Colors.gray500,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
});
