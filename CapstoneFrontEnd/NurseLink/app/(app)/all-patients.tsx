import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import {
  Search,
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
import { useLocalSearchParams } from 'expo-router';
import type { Department, Patient } from '../../types/domain';
import { vitalsMonitoringOrderLabel } from '../../components/tasks/taskLabels';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { DatePicker, todayIso } from '../../components/DatePicker';
import { TaskAssignmentModal } from '../../components/TaskAssignmentModal';
import { PatientKardexModal } from '../../components/PatientKardexModal';
import { DischargePlanModal } from '../../components/DischargePlanModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PatientVisitHistoryModal } from '../../components/PatientVisitHistoryModal';
import { ReadmitPatientModal } from '../../components/ReadmitPatientModal';
import { EditPatientModal } from '../../components/EditPatientModal';
import { LabsAndMedicationsModal } from '../../components/LabsAndMedicationsModal';
import { PatientAssignmentHistoryModal } from '../../components/PatientAssignmentHistoryModal';
import { Colors } from '../../constants/colors';
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
  normal: { bg: '#F8FAFD', border: '#E3E8F0', text: '#0F172A' },
};

// "Clean & light" tokens for this page.
const T = {
  pageBg: '#F4F6FB',
  card: '#FFFFFF',
  border: '#E3E8F0',
  inputBorder: '#D5DCE7',
  primary: '#1D4ED8',
  text: '#0F172A',
  muted: '#5B6B82',
  // Missing data ("Not assigned", "Not set yet") reads amber, not as a value.
  missing: '#92400E',
};

const RISK = {
  critical: { label: 'Critical', fg: '#B91C1C', bg: '#FEF2F2' },
  high: { label: 'High risk', fg: '#C2410C', bg: '#FFF7ED' },
  medium: { label: 'Medium risk', fg: '#92400E', bg: '#FFFBEB' },
  low: { label: 'Low risk', fg: '#15803D', bg: '#F0FDF4' },
} as const;

const STATUS_PILL: Record<'info' | 'warning' | 'secondary', { fg: string; bg: string }> = {
  info: { fg: '#1D4ED8', bg: '#EAF0FF' },
  warning: { fg: '#92400E', bg: '#FFFBEB' },
  secondary: { fg: '#475569', bg: '#EEF1F6' },
};

type StatTile = { label: string; value: number; dot: string };

const UNSET_VITALS_ORDER = vitalsMonitoringOrderLabel(null);
const MISSING_VALUES = new Set(['', 'Not Assigned', 'Not assigned', 'Not set yet', 'Unassigned']);

function isMissing(value: string | null | undefined): boolean {
  return MISSING_VALUES.has((value || '').trim());
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const PATIENTS_PER_PAGE = 10;

type SortKey = 'name' | 'room' | 'nurse' | 'status';
// 'active' (the default) means not-discharged — a discharged patient's
// record is kept, never deleted, but stays out of the working list unless
// a head nurse explicitly asks to see it via 'discharged' or 'all'.
type StatusFilter = 'active' | 'admitted' | 'observation' | 'discharged' | 'all';
const STATUS_FILTERS: StatusFilter[] = ['active', 'admitted', 'observation', 'discharged', 'all'];

export default function AllPatientsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const isSupervisor = user?.role === 'head_nurse';
  const { width } = useWindowDimensions();
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

  const searchParams = useLocalSearchParams<{ q?: string; view?: string }>();
  useEffect(() => {
    (() => {
      if (typeof searchParams.q === 'string') setSearchQuery(searchParams.q);
      if (searchParams.view && STATUS_FILTERS.includes(searchParams.view as StatusFilter)) {
        setStatusFilter(searchParams.view as StatusFilter);
      }
    })();
  }, [searchParams.q, searchParams.view]);

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

  const isNarrow = width < 640;
  const isDischargedView = statusFilter === 'discharged';
  const activeCount = patients.length - dischargedCount;
  const activePatients = patients.filter((p) => p.status !== 'discharged');
  const countStatus = (status: string) => patients.filter((p) => (p.status || 'admitted') === status).length;
  // One tab per status view (these used to be split between two tabs and a
  // dropdown). Counts are over every patient, not the current filters.
  const statusTabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'admitted', label: 'Admitted', count: countStatus('admitted') },
    { key: 'observation', label: 'Under observation', count: countStatus('observation') },
    { key: 'discharged', label: 'Discharged', count: dischargedCount },
    { key: 'all', label: 'All records', count: patients.length },
  ];
  const riskCount = (level: string) => activePatients.filter((p) => p.riskLevel === level).length;

  const activeTiles: StatTile[] = [
    { label: 'Active patients', value: activeCount, dot: T.primary },
    { label: 'Critical', value: riskCount('critical'), dot: RISK.critical.fg },
    { label: 'High risk', value: riskCount('high'), dot: RISK.high.fg },
    { label: 'Medium', value: riskCount('medium'), dot: RISK.medium.fg },
    { label: 'Low risk', value: riskCount('low'), dot: RISK.low.fg },
  ];
  const dischargedTiles: StatTile[] = [
    { label: 'Total discharged', value: dischargeStats.total, dot: T.muted },
    { label: 'This week', value: dischargeStats.thisWeek, dot: T.primary },
    { label: 'This month', value: dischargeStats.thisMonth, dot: '#0F766E' },
  ];

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, isNarrow && styles.contentNarrow]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.page}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} accessibilityRole="header">
                All Patients
              </Text>
              {isDischargedView ? (
                <Text style={styles.subtitle}>
                  {dischargedMatchingDateAndSearch} discharged patient{dischargedMatchingDateAndSearch === 1 ? '' : 's'}
                  {filteredPatients.length !== dischargedMatchingDateAndSearch ? ` (showing ${filteredPatients.length})` : ''}
                  {' · records stay searchable and can be readmitted any time'}
                  {loading ? ' (loading...)' : ''}
                </Text>
              ) : (
                <Text style={styles.subtitle}>
                  {user?.name ? `Welcome back, ${user.name.split(' ')[0]}. ` : ''}
                  {filteredPatients.length} of {patients.length} patients shown
                  {loading ? ' (loading...)' : ''}
                </Text>
              )}
            </View>
            {isSupervisor ? (
              <Pressable
                onPress={() => {
                  setFormMode('add');
                  setEditingPatient(null);
                  setFormOpen(true);
                }}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
                accessibilityRole="button"
              >
                <UserPlus size={17} color={Colors.white} />
                <Text style={styles.primaryBtnText}>Add Patient</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.statsGrid}>
            {(isDischargedView ? dischargedTiles : activeTiles).map((tile) => (
              <View key={tile.label} style={styles.statTile}>
                <View style={styles.statLabelRow}>
                  <View style={[styles.statDot, { backgroundColor: tile.dot }]} />
                  <Text style={styles.statLabel} numberOfLines={1}>
                    {tile.label}
                  </Text>
                </View>
                <Text style={[styles.statValue, tile.dot !== T.muted && tile.dot !== T.primary ? { color: tile.dot } : null]}>
                  {tile.value}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.toolbar}>
            <View style={styles.toolbarRow}>
              <View style={styles.segment} accessibilityRole="tablist">
                {statusTabs.map((tab) => {
                  const selected = statusFilter === tab.key;
                  return (
                    <Pressable
                      key={tab.key}
                      onPress={() => setStatusFilter(tab.key)}
                      style={[styles.segmentBtn, selected && styles.segmentBtnActive]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{tab.label}</Text>
                      <View style={[styles.segmentCount, selected && styles.segmentCountActive]}>
                        <Text style={[styles.segmentCountText, selected && styles.segmentCountTextActive]}>
                          {tab.count}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.sortGroup}>
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
                  <ArrowUpDown size={15} color={T.text} />
                  <Text style={styles.sortDirText}>{sortDesc ? 'Z–A' : 'A–Z'}</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.filterRow}>
              <Input
                placeholder={
                  isDischargedView ? 'Search discharged patients by name or ID' : 'Search name, patient ID, or room'
                }
                value={searchQuery}
                onChangeText={setSearchQuery}
                leftIcon={<Search size={16} color={T.muted} />}
                containerStyle={styles.searchBox}
              />
              {isDischargedView ? (
                <>
                  <DatePicker
                    label="Discharged from"
                    value={dischargeDateFrom}
                    onChange={setDischargeDateFrom}
                    maxDate={dischargeDateTo || todayIso()}
                    style={styles.filterSelect}
                  />
                  <DatePicker
                    label="Discharged to"
                    value={dischargeDateTo}
                    onChange={setDischargeDateTo}
                    minDate={dischargeDateFrom || undefined}
                    maxDate={todayIso()}
                    style={styles.filterSelect}
                  />
                </>
              ) : null}
              <Select
                value={deptFilter}
                onValueChange={setDeptFilter}
                placeholder="All departments"
                style={styles.filterSelect}
                searchable
                options={[
                  { label: 'All departments', value: 'all' },
                  ...departments.map((d) => ({ label: d.name, value: String(d.id) })),
                ]}
              />
              <Select
                value={nurseFilter}
                onValueChange={setNurseFilter}
                placeholder="All nurses"
                style={styles.filterSelect}
                searchable
                options={[
                  { label: 'All nurses', value: 'all' },
                  ...uniqueNurses.map((name) => ({ label: name, value: name })),
                ]}
              />
              <Select
                value={roomFilter}
                onValueChange={setRoomFilter}
                placeholder="All rooms"
                style={styles.filterSelect}
                options={[
                  { label: 'All rooms', value: 'all' },
                  ...uniqueRooms.map((room) => ({ label: room, value: room })),
                ]}
              />
              {!isDischargedView ? (
                <Select
                  value={riskFilter}
                  onValueChange={setRiskFilter}
                  placeholder="All risk levels"
                  style={styles.filterSelect}
                  options={[
                    { label: 'All risk levels', value: 'all' },
                    { label: 'Critical Risk', value: 'critical' },
                    { label: 'High Risk', value: 'high' },
                    { label: 'Moderate Risk', value: 'medium' },
                    { label: 'Low Risk', value: 'low' },
                  ]}
                />
              ) : null}
            </View>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={T.primary} />
            </View>
          ) : sortedPatients.length === 0 ? (
            <View style={[styles.card, styles.center]}>
              <Text style={styles.muted}>No patients found</Text>
            </View>
          ) : (
            pagedPatients.map((patient) => {
              const statusConfig = STATUS_CONFIG[patient.status || 'admitted'] || STATUS_CONFIG.admitted;
              const isDischarged = patient.status === 'discharged';
              const risk = RISK[patient.riskLevel as keyof typeof RISK];
              const attending = getAttendingPhysician(patient);
              const vitalsOrder = getVitalsMonitoringOrderLabel(patient);
              const nurseDisplay = isDischarged
                ? patient.assignedNurseName || 'Not on record'
                : getAssignedNurseDisplay(patient);
              const hasNurse = isDischarged ? !!patient.assignedNurseName : !!getAssignedNurseName(patient);
              const metaParts = [
                `${patient.age} y`,
                patient.gender,
                `${isDischarged ? 'Last room' : 'Room'} ${patient.room}`,
                `Admitted ${formatDate(patient.admissionDate)}`,
                isDischarged && patient.dischargedAt ? `Discharged ${formatDate(patient.dischargedAt)}` : null,
              ].filter(Boolean);
              return (
                <View key={patient.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.identity}>
                      <View style={[styles.avatar, isDischarged && styles.avatarDischarged]}>
                        <Text style={[styles.avatarText, isDischarged && styles.avatarTextDischarged]}>
                          {initialsOf(patient.name)}
                        </Text>
                      </View>
                      <View style={styles.identityText}>
                        <View style={styles.nameRow}>
                          <Text style={styles.patientName}>{patient.name}</Text>
                          <View style={styles.idChip}>
                            <Text style={styles.idChipText}>{patient.id}</Text>
                          </View>
                          <View style={[styles.pill, { backgroundColor: STATUS_PILL[statusConfig.variant].bg }]}>
                            <Text style={[styles.pillText, { color: STATUS_PILL[statusConfig.variant].fg }]}>
                              {statusConfig.label}
                            </Text>
                          </View>
                          {!isDischarged && risk ? (
                            <View style={[styles.pill, styles.riskPill, { backgroundColor: risk.bg }]}>
                              <View style={[styles.riskDot, { backgroundColor: risk.fg }]} />
                              <Text style={[styles.pillText, { color: risk.fg }]}>{risk.label}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.metaLine}>{metaParts.join(' · ')}</Text>
                      </View>
                    </View>
                    <View style={styles.iconActions}>
                      <Pressable
                        onPress={() => {
                          setHistoryPatient(patient);
                          setHistoryOpen(true);
                        }}
                        style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                        accessibilityLabel={`View visit history for ${patient.name}`}
                      >
                        <History size={17} color={T.text} />
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setAssignmentHistoryPatient(patient);
                          setAssignmentHistoryOpen(true);
                        }}
                        style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                        accessibilityLabel={`View nurses who have handled ${patient.name}`}
                      >
                        <Users size={17} color={T.text} />
                      </Pressable>
                      {isSupervisor ? (
                        <Pressable
                          onPress={() => {
                            setEditTarget(patient);
                            setEditOpen(true);
                          }}
                          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                          accessibilityLabel={`Edit record for ${patient.name}`}
                        >
                          <Edit2 size={17} color={T.text} />
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={() => {
                          setLabsMedsPatient(patient);
                          setLabsMedsOpen(true);
                        }}
                        style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                        accessibilityLabel={`Labs and medication intake for ${patient.name}`}
                      >
                        <FlaskConical size={17} color={T.text} />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.cardBody}>
                    <View style={styles.bodyCol}>
                      <Text style={styles.sectionLabel}>{isDischarged ? 'Clinical summary' : 'Clinical details'}</Text>
                      <View style={styles.dl}>
                        <View style={styles.dlItem}>
                          <Text style={styles.dt}>{isDischarged ? 'Last diagnosis' : 'Diagnosis'}</Text>
                          <Text style={[styles.dd, isMissing(patient.diagnosis) && styles.ddMissing]}>
                            {patient.diagnosis || 'Not set yet'}
                          </Text>
                        </View>
                        <View style={styles.dlItem}>
                          <Text style={styles.dt}>Attending physician</Text>
                          <Text style={[styles.dd, isMissing(attending) && styles.ddMissing]}>{attending}</Text>
                        </View>
                        <View style={styles.dlItem}>
                          <Text style={styles.dt}>{isDischarged ? 'Last assigned nurse' : 'Assigned nurse'}</Text>
                          <Text style={[styles.dd, !hasNurse && styles.ddMissing]}>{nurseDisplay}</Text>
                          {!isDischarged && hasNurse && patient.assignedBy?.trim() &&
                          patient.assignedBy.trim() !== patient.assignedNurseName?.trim() ? (
                            <Text style={styles.ddSub}>Assigned by {patient.assignedBy.trim()}</Text>
                          ) : null}
                        </View>
                        <View style={styles.dlItem}>
                          <Text style={styles.dt}>Vitals monitoring</Text>
                          <Text style={[styles.dd, vitalsOrder === UNSET_VITALS_ORDER && styles.ddMissing]}>
                            {vitalsOrder}
                          </Text>
                        </View>
                        <View style={styles.dlItem}>
                          <Text style={styles.dt}>{isDischarged ? 'Last department' : 'Department'}</Text>
                          {isSupervisor && !isDischarged ? (
                            <Select
                              value={patient.departmentId != null ? String(patient.departmentId) : ''}
                              onValueChange={(v) => setPatientDepartment(patient, v)}
                              placeholder={settingDeptFor === patient.id ? 'Saving...' : 'Set department'}
                              style={styles.deptSelect}
                              options={departments.map((d) => ({ label: d.name, value: String(d.id) }))}
                            />
                          ) : (
                            <Text style={[styles.dd, !patient.departmentName && styles.ddMissing]}>
                              {patient.departmentName || 'No department set'}
                            </Text>
                          )}
                        </View>
                        <View style={styles.dlItem}>
                          <Text style={styles.dt}>Medical team</Text>
                          {patient.assignedDoctors && patient.assignedDoctors.length > 0 ? (
                            groupDoctorsByDepartment(patient).map(({ department, doctors }) => (
                              <Text key={department} style={styles.dd}>
                                {doctors.join(', ')}
                                <Text style={styles.ddDept}> ({department})</Text>
                              </Text>
                            ))
                          ) : (
                            <Text style={[styles.dd, styles.ddMissing]}>Not assigned</Text>
                          )}
                        </View>
                      </View>
                    </View>

                    <View style={styles.bodyCol}>
                      <Text style={styles.sectionLabel}>{isDischarged ? 'Last recorded vitals' : 'Current vitals'}</Text>
                      <View style={styles.vitalsGrid}>
                        {(
                          [
                            {
                              key: 'hr', short: 'Heart rate', icon: Heart,
                              value: patient.vitalSigns.heartRate, unit: 'bpm',
                              severity: heartRateSeverity(patient.vitalSigns.heartRate),
                            },
                            {
                              key: 'bp', short: 'Blood pressure', icon: Activity,
                              value: patient.vitalSigns.bloodPressure, unit: 'mmHg',
                              severity: bloodPressureSeverity(patient.vitalSigns.bloodPressure),
                            },
                            {
                              key: 'temp', short: 'Temperature', icon: Thermometer,
                              value: patient.vitalSigns.temperature, unit: '°C',
                              severity: temperatureSeverity(patient.vitalSigns.temperature),
                            },
                            {
                              key: 'spo2', short: 'SpO₂', icon: Droplet,
                              value: patient.vitalSigns.oxygenSaturation, unit: '%',
                              severity: spo2Severity(patient.vitalSigns.oxygenSaturation),
                            },
                          ] as const
                        ).map((vital) => {
                          const severityStyle = VITAL_SEVERITY_STYLE[vital.severity];
                          const VitalIcon = vital.icon;
                          const hasReading = !!vital.value;
                          return (
                            <View
                              key={vital.key}
                              style={[
                                styles.vitalTile,
                                { backgroundColor: severityStyle.bg, borderColor: severityStyle.border },
                              ]}
                            >
                              <View style={styles.vitalLabelRow}>
                                <VitalIcon size={13} color={vital.severity === 'normal' ? T.muted : severityStyle.text} />
                                <Text style={styles.vitalLabel} numberOfLines={1}>
                                  {vital.short}
                                </Text>
                                {hasReading && vital.severity !== 'normal' ? (
                                  <AlertCircle size={12} color={severityStyle.text} />
                                ) : null}
                              </View>
                              <Text style={[styles.vitalValue, { color: severityStyle.text }]}>
                                {hasReading ? String(vital.value) : '—'}
                                {hasReading ? <Text style={styles.vitalUnit}> {vital.unit}</Text> : null}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                      {patient.heightCm != null || patient.weightKg != null ? (
                        <Text style={styles.heightWeightLine}>
                          Height {patient.heightCm != null ? `${patient.heightCm} cm` : '—'} · Weight{' '}
                          {patient.weightKg != null ? `${patient.weightKg} kg` : '—'}
                          {patient.bmi != null ? ` · BMI ${patient.bmi} (${bmiCategory(patient.bmi)})` : ''}
                        </Text>
                      ) : null}
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

                  <View style={styles.cardFooter}>
                    <Text style={styles.footerNote}>
                      {isDischarged && patient.dischargedByName
                        ? `Discharged by ${patient.dischargedByName}${patient.dischargedAt ? ` · ${formatDate(patient.dischargedAt)}` : ''}`
                        : patient.lastEditedByName
                          ? `Last edited by ${patient.lastEditedByName}${patient.lastEditedAt ? ` · ${formatDate(patient.lastEditedAt)}` : ''}`
                          : ''}
                    </Text>
                    <View style={styles.footerActions}>
                      {isDischarged ? (
                        isSupervisor ? (
                          <Pressable
                            onPress={() => {
                              setReadmitTarget(patient);
                              setReadmitOpen(true);
                            }}
                            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
                            accessibilityRole="button"
                          >
                            <RotateCcw size={16} color={Colors.white} />
                            <Text style={styles.primaryBtnText}>Readmit patient</Text>
                          </Pressable>
                        ) : (
                          <Text style={styles.dischargedNote}>
                            This patient must be readmitted before further action.
                          </Text>
                        )
                      ) : (
                        <>
                          <Pressable
                            onPress={() => {
                              setSelectedPatient(patient);
                              setTaskModalOpen(true);
                            }}
                            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
                            accessibilityRole="button"
                          >
                            <UserPlus size={16} color={T.primary} />
                            <Text style={styles.secondaryBtnText}>{hasNurse ? 'Reassign nurse' : 'Assign nurse'}</Text>
                          </Pressable>
                          {isSupervisor ? (
                            <Pressable
                              onPress={() => {
                                setToDischarge(patient);
                                setDischargeConfirmOpen(true);
                              }}
                              style={({ pressed }) => [styles.dangerBtn, pressed && styles.dangerBtnPressed]}
                              accessibilityRole="button"
                            >
                              <LogOut size={16} color={RISK.critical.fg} />
                              <Text style={styles.dangerBtnText}>Discharge</Text>
                            </Pressable>
                          ) : null}
                        </>
                      )}
                    </View>
                  </View>
                </View>
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
                <ChevronLeft size={16} color={safePage === 1 ? Colors.gray300 : T.primary} />
              </Pressable>
              {pageNumbers.map((page) => (
                <Pressable
                  key={page}
                  onPress={() => setCurrentPage(page)}
                  style={[styles.pageNumBtn, page === safePage && styles.pageNumBtnActive]}
                >
                  <Text style={[styles.pageNumText, page === safePage && styles.pageNumTextActive]}>{page}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                style={[styles.pageNavBtn, safePage === totalPages && styles.pageNavBtnDisabled]}
                hitSlop={6}
                accessibilityLabel="Next page"
              >
                <ChevronRight size={16} color={safePage === totalPages ? Colors.gray300 : T.primary} />
              </Pressable>
            </View>
          ) : null}
        </View>
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
  scroll: { flex: 1, backgroundColor: T.pageBg },
  content: { paddingHorizontal: 32, paddingTop: 28, paddingBottom: 40 },
  contentNarrow: { paddingHorizontal: 16, paddingTop: 16 },
  page: { width: '100%', maxWidth: 1180, alignSelf: 'center', gap: 16 },

  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerText: { flexGrow: 1, flexShrink: 1, flexBasis: 260, gap: 4 },
  title: { fontSize: 28, fontWeight: '800', color: T.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 14, color: T.muted },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: T.primary,
  },
  primaryBtnPressed: { backgroundColor: '#1E40AF' },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: Colors.white },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: T.inputBorder,
  },
  secondaryBtnPressed: { backgroundColor: '#F1F5FD' },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: T.primary },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  dangerBtnPressed: { backgroundColor: '#FEE2E2' },
  dangerBtnText: { fontSize: 14, fontWeight: '700', color: RISK.critical.fg },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statTile: {
    flexGrow: 1,
    flexBasis: 150,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statDot: { width: 8, height: 8, borderRadius: 4 },
  statLabel: { fontSize: 13, fontWeight: '600', color: T.muted, flexShrink: 1 },
  statValue: { fontSize: 26, fontWeight: '800', color: T.text },

  toolbar: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  toolbarRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: T.pageBg, borderRadius: 10, padding: 4, gap: 4, flexShrink: 1 },
  segmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: Colors.white,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontSize: 14, fontWeight: '600', color: T.muted },
  segmentTextActive: { color: T.text, fontWeight: '700' },
  segmentCount: { minWidth: 22, paddingHorizontal: 6, height: 20, borderRadius: 10, backgroundColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  segmentCountActive: { backgroundColor: '#EAF0FF' },
  segmentCountText: { fontSize: 11.5, fontWeight: '700', color: T.muted },
  segmentCountTextActive: { color: T.primary },
  sortGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  sortLabel: { fontSize: 13, fontWeight: '600', color: T.muted },
  sortSelect: { width: 180 },
  sortDirBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.inputBorder,
    backgroundColor: Colors.white,
  },
  sortDirText: { fontSize: 13, fontWeight: '700', color: T.text },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 },
  searchBox: { flexGrow: 2, flexBasis: 240, minWidth: 200 },
  filterSelect: { flexGrow: 1, flexBasis: 150, minWidth: 140, maxWidth: 260 },

  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  muted: { color: T.muted, fontSize: 14 },

  card: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F6',
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, flexGrow: 1, flexShrink: 1, flexBasis: 280 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EAF0FF', alignItems: 'center', justifyContent: 'center' },
  avatarDischarged: { backgroundColor: '#EEF1F6' },
  avatarText: { fontSize: 16, fontWeight: '800', color: T.primary },
  avatarTextDischarged: { color: T.muted },
  identityText: { flex: 1, minWidth: 0, gap: 4 },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  patientName: { fontSize: 19, fontWeight: '800', color: T.text },
  idChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: T.inputBorder },
  idChipText: { fontSize: 12, fontWeight: '700', color: T.muted },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '700' },
  riskPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riskDot: { width: 7, height: 7, borderRadius: 4 },
  metaLine: { fontSize: 13, color: T.muted },
  iconActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.inputBorder,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { backgroundColor: '#F1F5FD' },

  cardBody: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, paddingHorizontal: 20, paddingVertical: 18 },
  bodyCol: { flexGrow: 1, flexShrink: 1, flexBasis: 340, gap: 12 },
  sectionLabel: { fontSize: 11.5, fontWeight: '800', color: T.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  dl: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, columnGap: 16 },
  dlItem: { flexGrow: 1, flexBasis: 150, gap: 3 },
  dt: { fontSize: 12, fontWeight: '600', color: T.muted },
  dd: { fontSize: 14, fontWeight: '700', color: T.text },
  ddMissing: { color: T.missing },
  ddSub: { fontSize: 12, color: T.muted },
  ddDept: { fontWeight: '500', color: T.muted },
  deptSelect: { minWidth: 160, alignSelf: 'stretch' },

  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  vitalTile: { flexGrow: 1, flexBasis: '45%', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  vitalLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vitalLabel: { fontSize: 12, fontWeight: '600', color: T.muted, flexShrink: 1 },
  vitalValue: { fontSize: 22, fontWeight: '800' },
  vitalUnit: { fontSize: 12, fontWeight: '600', color: T.muted },
  heightWeightLine: { fontSize: 12.5, color: T.muted },

  alerts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 20, paddingBottom: 14 },
  alertChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.orange50,
    borderWidth: 1,
    borderColor: Colors.orange100,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  alertText: { fontSize: 12, color: Colors.orange700 },

  cardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FAFBFD',
    borderTopWidth: 1,
    borderTopColor: '#EEF1F6',
  },
  footerNote: { fontSize: 12.5, color: T.muted, flexShrink: 1 },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginLeft: 'auto' },
  dischargedNote: { fontSize: 12.5, color: T.muted, fontStyle: 'italic' },

  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  pageNavBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.inputBorder,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNavBtnDisabled: { opacity: 0.5 },
  pageNumBtn: {
    minWidth: 40,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.inputBorder,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNumBtnActive: { backgroundColor: T.primary, borderColor: T.primary },
  pageNumText: { fontSize: 13.5, fontWeight: '600', color: T.text },
  pageNumTextActive: { color: Colors.white },
});
