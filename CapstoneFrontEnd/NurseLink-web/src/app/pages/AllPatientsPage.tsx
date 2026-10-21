import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Department, Patient } from '../types/domain';
import {
  fetchPatients,
  fetchDepartments,
  updatePatient,
  deletePatient,
  dischargePatient,
  ApiError,
} from '../api/nurselink';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Search,
  UserPlus,
  Activity,
  User,
  MapPin,
  AlertCircle,
  Calendar,
  Stethoscope,
  Building2,
  Edit2,
  Trash2,
  LogOut,
  ArrowUpDown,
  RotateCcw,
  History,
  Heart,
  Thermometer,
  Droplet,
  Wind,
  FlaskConical,
  Loader2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { TaskAssignmentModal } from '../components/TaskAssignmentModal';
import { PatientKardexModal } from '../components/PatientKardexModal';
import { DischargePlanModal } from '../components/DischargePlanModal';
import { ReadmitPatientModal } from '../components/ReadmitPatientModal';
import { EditPatientModal } from '../components/EditPatientModal';
import { PatientVisitHistoryModal } from '../components/PatientVisitHistoryModal';
import { LabsAndMedicationsModal } from '../components/LabsAndMedicationsModal';
import { toast } from 'sonner';
import { bmiCategory } from '../utils/bmi';
import {
  groupDoctorsByDepartment,
  heartRateSeverity,
  bloodPressureSeverity,
  temperatureSeverity,
  spo2Severity,
  localTodayIso,
  vitalsMonitoringOrderLabel,
  VITAL_SEVERITY_CLASSES,
  type VitalSeverity,
} from '../utils/patientDisplay';

function getAttendingPhysician(patient: Patient) {
  return patient.attendingPhysician?.trim() || 'Not Assigned';
}

/**
 * "Ana Cruz · assigned by Mharon Reyes" — the roster is shared, so a nurse
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
 * prefers who's actually on shift right now (onDutyNurseName) over the
 * static day-to-day assignment. */
function getAssignedNurseName(patient: Patient): string {
  return patient.onDutyNurseName?.trim() || patient.assignedNurseName?.trim() || '';
}

/** Display string for the Assigned Nurse row — same preference as
 * getAssignedNurseName, but labelled so it's never mistaken for a live
 * reading when it's actually the (possibly stale) static assignment. */
function getAssignedNurseDisplay(patient: Patient): string {
  if (patient.onDutyNurseName) return patient.onDutyNurseName;
  if (patient.assignedNurseName) return `${patient.assignedNurseName} (off duty)`;
  return 'Unassigned';
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  admitted: { label: 'Admitted', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  observation: { label: 'Under Observation', className: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  discharged: { label: 'Discharged', className: 'bg-gray-200 text-gray-700 border-gray-300' },
};

const getRiskColor = (risk: string) => {
  switch (risk) {
    case 'critical':
      return 'bg-red-200 text-red-900 border-red-400';
    case 'high':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'low':
      return 'bg-green-100 text-green-800 border-green-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

type SortKey = 'name' | 'room' | 'nurse' | 'status';
// 'active' (the default) means not-discharged — a discharged patient's
// record is kept, never deleted, but stays out of the working list unless
// a head nurse explicitly asks to see it via 'discharged' or 'all'.
type StatusFilter = 'active' | 'admitted' | 'observation' | 'discharged' | 'all';

type VitalTile = {
  key: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number | string | null | undefined;
  unit: string;
  /** null = this vital has no severity thresholds (rendered neutral gray so
   * it's never mistaken for an assessed-normal reading). */
  severity: VitalSeverity | null;
};

export default function AllPatientsPage() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'head_nurse';
  const [patients, setPatients] = useState<Patient[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Patient | null>(null);
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
      setLoadingPatients(false);
    }
  }, []);

  useEffect(() => {
    loadPatients();
    fetchDepartments()
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [loadPatients]);

  const replacePatient = (updated: Patient) =>
    setPatients((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));

  const uniqueRooms = useMemo(
    () => Array.from(new Set(patients.map((p) => p.room.split('-')[0]).filter(Boolean))),
    [patients]
  );
  const uniqueNurses = useMemo(
    () =>
      Array.from(new Set(patients.map(getAssignedNurseName).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [patients]
  );

  const filteredPatients = useMemo(
    () =>
      patients.filter((patient) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          !q ||
          patient.name.toLowerCase().includes(q) ||
          patient.id.toLowerCase().includes(q) ||
          patient.room.toLowerCase().includes(q);
        const matchesRoom = roomFilter === 'all' || patient.room.startsWith(roomFilter);
        const matchesRisk = riskFilter === 'all' || patient.riskLevel === riskFilter;
        const matchesDept =
          deptFilter === 'all' || String(patient.departmentId ?? '') === deptFilter;
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
          statusFilter !== 'discharged' ||
          !dischargeDateFrom ||
          (!!dischargedDate && dischargedDate >= dischargeDateFrom);
        const matchesDischargeTo =
          statusFilter !== 'discharged' ||
          !dischargeDateTo ||
          (!!dischargedDate && dischargedDate <= dischargeDateTo);
        return (
          matchesSearch &&
          matchesRoom &&
          matchesRisk &&
          matchesDept &&
          matchesNurse &&
          matchesStatus &&
          matchesDischargeFrom &&
          matchesDischargeTo
        );
      }),
    [
      patients,
      searchQuery,
      roomFilter,
      riskFilter,
      deptFilter,
      nurseFilter,
      statusFilter,
      dischargeDateFrom,
      dischargeDateTo,
    ]
  );

  const dischargedCount = useMemo(
    () => patients.filter((p) => p.status === 'discharged').length,
    [patients]
  );

  // Risk has no place in the Discharged view (see the stats/filter/badge
  // changes below) — clear a leftover risk filter so it can't silently hide
  // discharged patients that don't match a risk picked while looking at a
  // different tab.
  useEffect(() => {
    if (statusFilter === 'discharged') setRiskFilter('all');
  }, [statusFilter]);

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
      const matchesFrom = !dischargeDateFrom || (!!dischargedDate && dischargedDate >= dischargeDateFrom);
      const matchesTo = !dischargeDateTo || (!!dischargedDate && dischargedDate <= dischargeDateTo);
      return matchesSearch && matchesFrom && matchesTo;
    }).length;
  }, [patients, searchQuery, dischargeDateFrom, dischargeDateTo]);

  // Ground-truth discharge counts for the Discharged tab's stat cards —
  // always computed over every patient regardless of the current filters,
  // so these three numbers never mix in a non-discharged patient and never
  // shrink just because a search/filter happens to be active.
  const dischargeStats = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    const monthAgo = now - 30 * 86400000;
    const discharged = patients.filter((p) => p.status === 'discharged');
    const thisWeek = discharged.filter((p) => p.dischargedAt && new Date(p.dischargedAt).getTime() >= weekAgo).length;
    const thisMonth = discharged.filter((p) => p.dischargedAt && new Date(p.dischargedAt).getTime() >= monthAgo).length;
    return { total: discharged.length, thisWeek, thisMonth };
  }, [patients]);

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

  const setPatientDepartment = async (patient: Patient, departmentId: string) => {
    setSettingDeptFor(patient.id);
    try {
      const updated = await updatePatient(patient.id, {
        departmentId: departmentId ? Number(departmentId) : null,
      });
      replacePatient(updated);
      toast.success('Department updated', {
        description: `${patient.name} is now under ${updated.departmentName || 'no department'}.`,
      });
    } catch (error) {
      toast.error('Failed to set department', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setSettingDeptFor(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deletePatient(toDelete.id);
      toast.success('Patient record deleted');
      setToDelete(null);
      setDeleteOpen(false);
      await loadPatients();
    } catch (error) {
      toast.error('Failed to delete patient', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    }
  };

  const handleDischargeSubmit = async (plan: Parameters<typeof dischargePatient>[1]) => {
    if (!toDischarge) return;
    try {
      const updated = await dischargePatient(toDischarge.id, plan);
      replacePatient(updated);
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
  };

  const today = localTodayIso();

  return (
    <div className="p-4 md:p-6 pb-24 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Patients</h1>
          {statusFilter === 'discharged' ? (
            <p className="text-gray-600">
              {dischargedMatchingDateAndSearch} discharged patient{dischargedMatchingDateAndSearch === 1 ? '' : 's'}
              {filteredPatients.length !== dischargedMatchingDateAndSearch ? ` (showing ${filteredPatients.length})` : ''}
              {loadingPatients ? ' (loading...)' : ''}
            </p>
          ) : (
            <p className="text-gray-600">
              Head Nurse view - {filteredPatients.length} of {patients.length} patients
              {loadingPatients ? ' (loading...)' : ''}
              {statusFilter === 'active' ? ' · discharged patients hidden, switch filter to view' : ''}
            </p>
          )}
        </div>
        {isSupervisor ? (
          <Button onClick={() => setFormOpen(true)} className="bg-blue-600 hover:bg-blue-700">
            <UserPlus className="w-4 h-4 mr-2" />
            Add Patient
          </Button>
        ) : null}
      </div>

      {/* Active / Discharged tabs */}
      <div className="inline-flex gap-2 rounded-lg bg-gray-100 p-1" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter !== 'discharged'}
          onClick={() => setStatusFilter('active')}
          className={`flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-bold transition-colors ${
            statusFilter !== 'discharged'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-200'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          Active Patients
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'discharged'}
          onClick={() => setStatusFilter('discharged')}
          className={`flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-bold transition-colors ${
            statusFilter === 'discharged'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-200'
          }`}
        >
          <LogOut className="w-3.5 h-3.5" />
          Discharged
          {dischargedCount > 0 ? (
            <span
              className={`inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-extrabold ${
                statusFilter === 'discharged' ? 'bg-white text-blue-700' : 'bg-blue-600 text-white'
              }`}
            >
              {dischargedCount}
            </span>
          ) : null}
        </button>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            type="text"
            placeholder={
              statusFilter === 'discharged'
                ? 'Search discharged patients by name or ID...'
                : 'Search by name, patient ID, or room...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 shadow-md border-2 border-gray-200 focus:border-blue-500 focus:shadow-lg focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {statusFilter === 'discharged' ? (
          <div className="flex gap-3 flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="discharged-from" className="text-xs text-gray-600">
                Discharged From
              </Label>
              <Input
                id="discharged-from"
                type="date"
                value={dischargeDateFrom}
                max={dischargeDateTo || today}
                onChange={(e) => setDischargeDateFrom(e.target.value)}
                className="w-[180px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="discharged-to" className="text-xs text-gray-600">
                Discharged To
              </Label>
              <Input
                id="discharged-to"
                type="date"
                value={dischargeDateTo}
                min={dischargeDateFrom || undefined}
                max={today}
                onChange={(e) => setDischargeDateTo(e.target.value)}
                className="w-[180px]"
              />
            </div>
            {dischargeDateFrom || dischargeDateTo ? (
              <Button
                variant="ghost"
                size="sm"
                className="self-end"
                onClick={() => {
                  setDischargeDateFrom('');
                  setDischargeDateTo('');
                }}
              >
                Clear dates
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-3 flex-wrap">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-[180px] shadow-md border-2 border-gray-200">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={nurseFilter} onValueChange={setNurseFilter}>
            <SelectTrigger className="w-[180px] shadow-md border-2 border-gray-200">
              <SelectValue placeholder="All Nurses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Nurses</SelectItem>
              {uniqueNurses.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={roomFilter} onValueChange={setRoomFilter}>
            <SelectTrigger className="w-[180px] shadow-md border-2 border-gray-200">
              <SelectValue placeholder="Filter by room" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Rooms</SelectItem>
              {uniqueRooms.map((room) => (
                <SelectItem key={room} value={room}>
                  {room}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[180px] shadow-md border-2 border-gray-200">
              <SelectValue placeholder="Active Patients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active Patients</SelectItem>
              <SelectItem value="admitted">Admitted</SelectItem>
              <SelectItem value="observation">Under Observation</SelectItem>
              <SelectItem value="discharged">Discharged</SelectItem>
              <SelectItem value="all">All Records</SelectItem>
            </SelectContent>
          </Select>

          {statusFilter !== 'discharged' ? (
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-[180px] shadow-md border-2 border-gray-200">
                <SelectValue placeholder="Filter by risk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk Levels</SelectItem>
                <SelectItem value="critical">Critical Risk</SelectItem>
                <SelectItem value="high">High Risk</SelectItem>
                <SelectItem value="medium">Medium Risk</SelectItem>
                <SelectItem value="low">Low Risk</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-500">Sort by</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Patient Name</SelectItem>
              <SelectItem value="room">Room</SelectItem>
              <SelectItem value="nurse">Assigned Nurse</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortDesc((prev) => !prev)}
            aria-label={sortDesc ? 'Sort descending' : 'Sort ascending'}
          >
            <ArrowUpDown className="w-3.5 h-3.5 mr-1.5" />
            {sortDesc ? 'Z–A' : 'A–Z'}
          </Button>
        </div>
      </div>

      {statusFilter === 'discharged' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="Total Discharged" value={dischargeStats.total} valueClass="text-gray-600">
            <LogOut className="w-8 h-8 text-gray-500" />
          </StatCard>
          <StatCard label="Discharged This Week" value={dischargeStats.thisWeek} valueClass="text-blue-600">
            <Calendar className="w-8 h-8 text-blue-600" />
          </StatCard>
          <StatCard label="Discharged This Month" value={dischargeStats.thisMonth} valueClass="text-teal-600">
            <Calendar className="w-8 h-8 text-teal-600" />
          </StatCard>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Patients" value={patients.length} valueClass="text-gray-900">
            <User className="w-8 h-8 text-blue-600" />
          </StatCard>
          <StatCard
            label="Critical"
            value={patients.filter((p) => p.riskLevel === 'critical').length}
            valueClass="text-red-700"
          >
            <AlertCircle className="w-8 h-8 text-red-700" />
          </StatCard>
          <StatCard
            label="High Risk"
            value={patients.filter((p) => p.riskLevel === 'high').length}
            valueClass="text-red-600"
          >
            <AlertCircle className="w-8 h-8 text-red-600" />
          </StatCard>
          <StatCard
            label="Medium Risk"
            value={patients.filter((p) => p.riskLevel === 'medium').length}
            valueClass="text-yellow-600"
          >
            <Activity className="w-8 h-8 text-yellow-600" />
          </StatCard>
          <StatCard
            label="Low Risk"
            value={patients.filter((p) => p.riskLevel === 'low').length}
            valueClass="text-green-600"
          >
            <Activity className="w-8 h-8 text-green-600" />
          </StatCard>
          <StatCard label="Discharged" value={dischargedCount} valueClass="text-gray-600">
            <LogOut className="w-8 h-8 text-gray-500" />
          </StatCard>
        </div>
      )}

      <div className="space-y-3">
        {loadingPatients ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : sortedPatients.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500">No patients found</p>
            </CardContent>
          </Card>
        ) : (
          sortedPatients.map((patient) => {
            const statusConfig = STATUS_CONFIG[patient.status || 'admitted'] || STATUS_CONFIG.admitted;
            const isDischarged = patient.status === 'discharged';
            const vitals = patient.vitalSigns;
            const vitalTiles: VitalTile[] = [
              {
                key: 'hr',
                short: 'HR',
                icon: Heart,
                value: vitals.heartRate,
                unit: 'bpm',
                severity: heartRateSeverity(vitals.heartRate),
              },
              {
                key: 'bp',
                short: 'BP',
                icon: Activity,
                value: vitals.bloodPressure,
                unit: 'mmHg',
                severity: bloodPressureSeverity(vitals.bloodPressure),
              },
              {
                key: 'temp',
                short: 'Temp',
                icon: Thermometer,
                value: vitals.temperature,
                unit: '°C',
                severity: temperatureSeverity(vitals.temperature),
              },
              {
                key: 'spo2',
                short: 'SpO2',
                icon: Droplet,
                value: vitals.oxygenSaturation,
                unit: '%',
                severity: spo2Severity(vitals.oxygenSaturation),
              },
              {
                key: 'rr',
                short: 'RR',
                icon: Wind,
                value: vitals.respiratoryRate,
                unit: '/min',
                severity: null,
              },
            ];
            const doctorGroups = groupDoctorsByDepartment(patient);

            return (
              <Card
                key={patient.id}
                className={`border-2 hover:shadow-lg transition-all ${
                  isDischarged ? 'bg-gray-50 border-gray-200' : ''
                }`}
              >
                <CardContent className="p-4 md:p-5">
                  <div className="space-y-3.5">
                    {/* Header: identity + quick-access icon actions */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-bold text-gray-900">{patient.name}</h3>
                          <Badge variant="outline" className="text-xs">
                            {patient.id}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge className={`text-xs border ${statusConfig.className}`}>
                            {statusConfig.label}
                          </Badge>
                          {!isDischarged ? (
                            <Badge className={`text-xs border ${getRiskColor(patient.riskLevel)}`}>
                              {patient.riskLevel.toUpperCase()} RISK
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <IconAction
                          label={`View visit history for ${patient.name}`}
                          onClick={() => {
                            setHistoryPatient(patient);
                            setHistoryOpen(true);
                          }}
                        >
                          <History className="w-4 h-4" />
                        </IconAction>
                        {isSupervisor ? (
                          <IconAction
                            label={`Edit record for ${patient.name}`}
                            onClick={() => {
                              setEditTarget(patient);
                              setEditOpen(true);
                            }}
                          >
                            <Edit2 className="w-4 h-4" />
                          </IconAction>
                        ) : null}
                        <IconAction
                          label={`Labs and medication intake for ${patient.name}`}
                          onClick={() => {
                            setLabsMedsPatient(patient);
                            setLabsMedsOpen(true);
                          }}
                        >
                          <FlaskConical className="w-4 h-4" />
                        </IconAction>
                        {isSupervisor ? (
                          <IconAction
                            label={`Delete record for ${patient.name} (data-entry errors only)`}
                            destructive
                            onClick={() => {
                              setToDelete(patient);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </IconAction>
                        ) : null}
                      </div>
                    </div>

                    <div className="h-px bg-gray-100" />

                    <div className="flex items-center gap-x-4 gap-y-1 text-sm text-gray-600 flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="w-4 h-4" />
                        {patient.age}y • {patient.gender}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        {isDischarged ? 'Last Room: ' : ''}
                        {patient.room}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        Admitted {new Date(patient.admissionDate).toLocaleDateString()}
                      </span>
                      {isDischarged && patient.dischargedAt ? (
                        <span className="flex items-center gap-1">
                          <LogOut className="w-4 h-4 text-gray-500" />
                          Discharged {new Date(patient.dischargedAt).toLocaleDateString()}
                        </span>
                      ) : null}
                    </div>

                    {/* Audit trail chips */}
                    {(isDischarged && patient.dischargedByName) || patient.lastEditedByName ? (
                      <div className="flex gap-1.5 flex-wrap">
                        {isDischarged && patient.dischargedByName ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
                            <LogOut className="w-2.5 h-2.5" />
                            Discharged by {patient.dischargedByName}
                          </span>
                        ) : null}
                        {patient.lastEditedByName ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
                            <Edit2 className="w-2.5 h-2.5" />
                            Edited by {patient.lastEditedByName}
                            {patient.lastEditedAt
                              ? ` · ${new Date(patient.lastEditedAt).toLocaleDateString()}`
                              : ''}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Clinical details */}
                    <div className="rounded-md bg-gray-50 p-3 space-y-2.5">
                      <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-gray-600">
                        Clinical Details
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
                        <DetailRow label={isDischarged ? 'Last Diagnosis' : 'Diagnosis'}>
                          {patient.diagnosis}
                        </DetailRow>
                        <DetailRow
                          label={
                            <span className="flex items-center gap-1">
                              <Stethoscope className="w-3 h-3 text-blue-700" />
                              Attending Physician
                            </span>
                          }
                        >
                          {getAttendingPhysician(patient)}
                        </DetailRow>
                        <DetailRow label="Vital Signs Monitoring">
                          {vitalsMonitoringOrderLabel(patient.vitalsMonitoringOrder)}
                        </DetailRow>
                        <DetailRow label={isDischarged ? 'Last Assigned Nurse' : 'Assigned Nurse'}>
                          {isDischarged
                            ? patient.assignedNurseName || 'Not on record'
                            : getAssignedNurseDisplay(patient)}
                          {!isDischarged ? (
                            <span className="block text-[11px] font-normal text-gray-400">
                              {getAssignmentLabel(patient)}
                            </span>
                          ) : null}
                        </DetailRow>
                        <DetailRow label={isDischarged ? 'Last Department' : 'Department'}>
                          {isSupervisor && !isDischarged ? (
                            <Select
                              value={patient.departmentId != null ? String(patient.departmentId) : ''}
                              onValueChange={(v) => setPatientDepartment(patient, v)}
                              disabled={settingDeptFor === patient.id}
                            >
                              <SelectTrigger className="h-8 w-full max-w-[240px] bg-white text-sm">
                                <SelectValue
                                  placeholder={
                                    settingDeptFor === patient.id ? 'Saving...' : 'Set department'
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {departments.map((d) => (
                                  <SelectItem key={d.id} value={String(d.id)}>
                                    {d.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            patient.departmentName || 'No department set'
                          )}
                        </DetailRow>
                      </div>
                    </div>

                    {doctorGroups.length > 0 ? (
                      <div className="rounded-md bg-blue-50 p-2.5 space-y-1">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">
                          Medical Team
                        </p>
                        {doctorGroups.map(({ department, doctors }) => (
                          <div key={department} className="flex items-center gap-1.5 text-xs text-gray-900">
                            <Building2 className="w-3.5 h-3.5 shrink-0 text-blue-700" />
                            <span className="truncate">
                              <span className="font-bold">{department}: </span>
                              {doctors.join(', ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-gray-600">
                      {isDischarged ? 'Last Recorded Vitals' : 'Current Vitals'}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                      {vitalTiles.map((vital) => {
                        const hasReading = !!vital.value;
                        const style = vital.severity
                          ? VITAL_SEVERITY_CLASSES[vital.severity]
                          : { box: 'bg-gray-50 border-gray-200', text: 'text-gray-900' };
                        const abnormal = hasReading && vital.severity != null && vital.severity !== 'normal';
                        const spacedUnit = vital.unit !== '°C' && vital.unit !== '%' && vital.unit !== '/min';
                        const VitalIcon = vital.icon;
                        return (
                          <div
                            key={vital.key}
                            className={`rounded-md border p-2 ${style.box}`}
                            title={
                              abnormal
                                ? `${vital.severity === 'critical' ? 'Critical' : 'Abnormal'} reading`
                                : vital.severity == null
                                  ? 'Not severity-flagged'
                                  : undefined
                            }
                          >
                            <div className={`flex items-center gap-1 ${style.text}`}>
                              <VitalIcon className="w-3 h-3" />
                              <span className="text-[10.5px] font-bold uppercase tracking-wide">
                                {vital.short}
                              </span>
                              {abnormal ? (
                                <AlertCircle
                                  className="w-3 h-3"
                                  aria-label={vital.severity === 'critical' ? 'Critical' : 'Abnormal'}
                                />
                              ) : null}
                            </div>
                            <p className={`text-sm font-extrabold ${style.text}`}>
                              {hasReading ? `${vital.value}${spacedUnit ? ' ' : ''}${vital.unit}` : '—'}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {patient.heightCm != null || patient.weightKg != null ? (
                      <p className="text-xs text-gray-600">
                        Height: {patient.heightCm != null ? `${patient.heightCm} cm` : '—'} · Weight:{' '}
                        {patient.weightKg != null ? `${patient.weightKg} kg` : '—'}
                        {patient.bmi != null ? ` · BMI: ${patient.bmi} (${bmiCategory(patient.bmi)})` : ''}
                      </p>
                    ) : null}

                    {patient.alerts.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {patient.alerts.map((alert, idx) => (
                          <Badge
                            key={idx}
                            variant="outline"
                            className="text-xs bg-orange-50 border-orange-300 text-orange-800"
                          >
                            <AlertCircle className="w-3 h-3 mr-1" />
                            {alert}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2 pt-2 border-t">
                      {isDischarged ? (
                        isSupervisor ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setReadmitTarget(patient);
                              setReadmitOpen(true);
                            }}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 shadow-sm"
                          >
                            <RotateCcw className="w-4 h-4 mr-2" />
                            Readmit Patient
                          </Button>
                        ) : (
                          <p className="flex-1 py-2 text-center text-xs italic text-gray-500">
                            This patient must be readmitted before further action.
                          </p>
                        )
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedPatient(patient);
                              setTaskModalOpen(true);
                            }}
                            className="flex-1 bg-blue-600 hover:bg-blue-700"
                          >
                            <UserPlus className="w-4 h-4 mr-2" />
                            Assign Nurse
                          </Button>
                          {isSupervisor ? (
                            <Button
                              size="sm"
                              onClick={() => {
                                setToDischarge(patient);
                                setDischargeConfirmOpen(true);
                              }}
                              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                            >
                              <LogOut className="w-4 h-4 mr-2" />
                              Discharge
                            </Button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <TaskAssignmentModal
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        patient={selectedPatient}
        onTaskAssigned={() => {}}
      />

      <PatientKardexModal open={formOpen} onOpenChange={setFormOpen} mode="add" patient={null} onSaved={loadPatients} />

      <EditPatientModal open={editOpen} onOpenChange={setEditOpen} patient={editTarget} onSaved={replacePatient} />

      <PatientVisitHistoryModal open={historyOpen} onOpenChange={setHistoryOpen} patient={historyPatient} />

      <LabsAndMedicationsModal open={labsMedsOpen} onOpenChange={setLabsMedsOpen} patient={labsMedsPatient} />

      <ReadmitPatientModal
        open={readmitOpen}
        onOpenChange={setReadmitOpen}
        patient={readmitTarget}
        onReadmitted={replacePatient}
      />

      {/* Step 1 of discharge: confirm which patient. The patient stays exactly
          as they are until the Discharge Plan modal's "Complete Discharge"
          actually submits. toDischarge is deliberately not cleared here —
          Radix fires onOpenChange(false) on Continue too, and step 2 needs it. */}
      <AlertDialog open={dischargeConfirmOpen} onOpenChange={setDischargeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discharge Patient</AlertDialogTitle>
            <AlertDialogDescription>
              {toDischarge
                ? `Discharge ${toDischarge.name}? You'll complete a Discharge Plan next — the patient isn't marked as discharged until that's submitted.`
                : 'Discharge this patient?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setToDischarge(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDischargeConfirmOpen(false);
                // Defer so the alert dialog finishes closing (and releases its
                // focus trap) before the plan dialog mounts its own.
                setTimeout(() => setDischargeOpen(true), 0);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DischargePlanModal
        open={dischargeOpen}
        onOpenChange={(next) => {
          setDischargeOpen(next);
          if (!next) setToDischarge(null);
        }}
        patient={toDischarge}
        onConfirm={handleDischargeSubmit}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Patient Record</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `Permanently delete ${toDelete.name} (${toDelete.id})? This erases their kardex, tasks, assignments, and visit history and cannot be undone. Use this only for duplicate or mistaken entries — to end an admission, use Discharge instead, which keeps the record.`
                : 'Delete this patient?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} variant="destructive">
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClass,
  children,
}: {
  label: string;
  value: number;
  valueClass: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-600">{label}</p>
            <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
          </div>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function IconAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        destructive
          ? 'bg-red-50 text-red-600 hover:bg-red-100'
          : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
      }`}
    >
      {children}
    </button>
  );
}

function DetailRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5 min-w-0">
      <div className="text-[11px] font-bold text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900">{children}</div>
    </div>
  );
}
