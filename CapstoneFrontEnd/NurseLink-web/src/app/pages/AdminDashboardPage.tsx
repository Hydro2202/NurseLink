import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  ShieldCheck,
  LogOut,
  CheckCircle2,
  XCircle,
  UserX,
  UserCheck,
  KeyRound,
  Loader2,
  Eye,
  ClipboardList,
  FileText,
  ArrowLeftRight,
  Calendar,
  BookOpen,
  HeartPulse,
  Stethoscope,
  Building2,
  IdCard,
  Plus,
  Trash2,
  Sparkles,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchAdminUsers,
  approveAdminUser,
  rejectAdminUser,
  deactivateAdminUser,
  reactivateAdminUser,
  setAdminUserPassword,
  fetchPatients,
  fetchDepartments,
  fetchTasks,
  fetchHandovers,
  fetchTaskHandovers,
  fetchChartingNotes,
  fetchDutyAssignments,
  fetchKardexRecords,
  fetchVitalReadings,
  fetchDoctors,
  createDoctor,
  updateDoctor,
  fetchAdminRegistrationSessions,
  fetchAdminFaceVerificationAttempts,
  deleteAdminRegistrationSession,
  clearAbandonedRegistrationSessions,
  ApiError,
} from '../api/nurselink';
import type {
  AdminUser,
  Patient,
  Department,
  Doctor,
  AdminTaskHandover,
  AdminRegistrationSession,
  AdminFaceVerificationAttempt,
} from '../types/domain';
import {
  RECORD_SECTIONS,
  RECORD_SECTION_LIST,
  type RecordSectionKey,
  type RecordRow,
  type RecordFilter,
} from '../utils/adminRecordSections';

const STATUS_BADGE: Record<AdminUser['approvalStatus'], { label: string; variant: 'info' | 'success' | 'destructive' }> = {
  pending: { label: 'Pending', variant: 'info' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

const STATUS_TABS: Array<{ id: 'all' | AdminUser['approvalStatus']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

const ROLE_BADGE: Record<AdminUser['role'], { label: string; variant: 'info' | 'secondary' }> = {
  staff_nurse: { label: 'Nurse', variant: 'info' },
  head_nurse: { label: 'Head Nurse', variant: 'secondary' },
};

const ROLE_FILTERS: Array<{ id: 'all' | AdminUser['role']; label: string }> = [
  { id: 'all', label: 'All Roles' },
  { id: 'staff_nurse', label: 'Nurse' },
  { id: 'head_nurse', label: 'Head Nurse' },
];

type PanelId = 'accounts' | 'patients' | 'doctors' | 'registrations' | 'records';

const PANEL_TABS: Array<{ id: PanelId; label: string }> = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'patients', label: 'Patients' },
  { id: 'doctors', label: 'Doctors' },
  { id: 'registrations', label: 'Registrations' },
  { id: 'records', label: 'Hospital Records' },
];

const SECTION_ICON: Record<RecordSectionKey, React.ComponentType<{ className?: string }>> = {
  tasks: ClipboardList,
  handovers: FileText,
  'task-handovers': ArrowLeftRight,
  charting: FileText,
  duty: Calendar,
  kardex: BookOpen,
  vitals: HeartPulse,
  departments: Building2,
};

interface DoctorForm {
  fullName: string;
  specialization: string;
  departmentId: string;
  licenseNumber: string;
  status: 'active' | 'inactive';
}

const EMPTY_DOCTOR_FORM: DoctorForm = {
  fullName: '', specialization: '', departmentId: '', licenseNumber: '', status: 'active',
};

const VERIFIED_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'true', label: 'Verified' },
  { id: 'false', label: 'Unverified' },
];

// Matches the backend's clear-abandoned filter exactly (RegistrationSessionViewSet.clear_abandoned).
function isAbandonedSession(s: AdminRegistrationSession): boolean {
  return !s.email && !s.idFirstName && !s.idLastName && !s.faceVerified && !s.otpVerified && !s.userId;
}

const RISK_BADGE: Record<string, 'success' | 'warning' | 'destructive'> = {
  low: 'success',
  medium: 'warning',
  high: 'destructive',
  critical: 'destructive',
};

const RISK_FILTERS = [
  { id: 'all', label: 'All Risk Levels' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'critical', label: 'Critical' },
];

const PATIENT_STATUS_BADGE: Record<string, 'success' | 'info' | 'secondary'> = {
  admitted: 'success',
  observation: 'info',
  discharged: 'secondary',
};

const PATIENT_STATUS_FILTERS = [
  { id: 'all', label: 'All Statuses' },
  { id: 'admitted', label: 'Admitted' },
  { id: 'observation', label: 'Observation' },
  { id: 'discharged', label: 'Discharged' },
];

export default function AdminDashboardPage() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();

  // The backend already rejects every /admin/users/ call for a non-admin
  // token (IsAdmin) — this is just so a nurse/supervisor who lands on this
  // URL directly sees a redirect instead of a page full of failed requests.
  useEffect(() => {
    if (!isLoading && (!user || !user.isAdmin)) {
      navigate('/login', { replace: true });
    }
  }, [user, isLoading, navigate]);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | AdminUser['approvalStatus']>('pending');
  const [roleFilter, setRoleFilter] = useState<'all' | AdminUser['role']>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<AdminUser | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [passwordTarget, setPasswordTarget] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const [panel, setPanel] = useState<PanelId>('accounts');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [nurseFilter, setNurseFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [patientStatusFilter, setPatientStatusFilter] = useState('all');
  const [viewPatient, setViewPatient] = useState<Patient | null>(null);

  // --- Hospital Records (generic config-driven browser) ---
  const [recordsSection, setRecordsSection] = useState<RecordSectionKey>('tasks');
  const [recordRows, setRecordRows] = useState<RecordRow[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [recordFilterValues, setRecordFilterValues] = useState<Record<string, string>>({});
  const [selectedRecord, setSelectedRecord] = useState<RecordRow | null>(null);

  const recordsConfig = RECORD_SECTIONS[recordsSection];

  useEffect(() => {
    if (panel !== 'records') return;
    let cancelled = false;
    setRecordsLoading(true);
    setRecordsError('');
    setRecordFilterValues({});
    (async () => {
      try {
        const data = await recordsConfig.fetch();
        if (cancelled) return;
        setRecordRows(data.map((item) => ({ ...recordsConfig.toRow(item), raw: item })));
      } catch (err) {
        if (cancelled) return;
        setRecordsError(err instanceof ApiError ? err.message : 'Could not load this section.');
      } finally {
        if (!cancelled) setRecordsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, recordsSection]);

  const activeRecordFilters: RecordFilter[] = useMemo(
    () => (recordsConfig.filters ? recordsConfig.filters(recordRows.map((r) => r.raw)) : []),
    [recordsConfig, recordRows]
  );

  const filteredRecordRows = useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    let result = recordRows;
    for (const f of activeRecordFilters) {
      const value = recordFilterValues[f.key] ?? 'all';
      if (value !== 'all') {
        result = result.filter((r) => f.match(r.raw, value));
      }
    }
    if (!q) return result;
    return result.filter((r) => r.search.toLowerCase().includes(q));
  }, [recordRows, recordSearch, activeRecordFilters, recordFilterValues]);

  // --- Doctors ---
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [doctorSearch, setDoctorSearch] = useState('');
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const [doctorFormOpen, setDoctorFormOpen] = useState(false);
  const [doctorForm, setDoctorForm] = useState<DoctorForm>(EMPTY_DOCTOR_FORM);
  const [doctorSaving, setDoctorSaving] = useState(false);
  const [doctorFormError, setDoctorFormError] = useState('');

  useEffect(() => {
    if (panel !== 'doctors') return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchDoctors();
        if (!cancelled) setDoctors(data);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof ApiError ? err.message : 'Could not load doctors.');
      } finally {
        if (!cancelled) setDoctorsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panel]);

  const filteredDoctors = useMemo(() => {
    const q = doctorSearch.trim().toLowerCase();
    if (!q) return doctors;
    return doctors.filter(
      (d) => d.fullName.toLowerCase().includes(q) || d.specialization.toLowerCase().includes(q)
    );
  }, [doctors, doctorSearch]);

  const openCreateDoctor = () => {
    setEditingDoctor(null);
    setDoctorForm(EMPTY_DOCTOR_FORM);
    setDoctorFormError('');
    setDoctorFormOpen(true);
  };

  const openEditDoctor = (doctor: Doctor) => {
    setEditingDoctor(doctor);
    setDoctorForm({
      fullName: doctor.fullName,
      specialization: doctor.specialization,
      departmentId: String(doctor.departmentId),
      licenseNumber: doctor.licenseNumber || '',
      status: doctor.status,
    });
    setDoctorFormError('');
    setDoctorFormOpen(true);
  };

  const handleSaveDoctor = async () => {
    if (!doctorForm.fullName.trim()) {
      setDoctorFormError('Full name is required.');
      return;
    }
    if (!doctorForm.departmentId) {
      setDoctorFormError('Department is required.');
      return;
    }
    setDoctorSaving(true);
    try {
      const payload = {
        fullName: doctorForm.fullName.trim(),
        specialization: doctorForm.specialization.trim(),
        departmentId: Number(doctorForm.departmentId),
        licenseNumber: doctorForm.licenseNumber.trim(),
        status: doctorForm.status,
      };
      if (editingDoctor) {
        const updated = await updateDoctor(editingDoctor.id, payload);
        setDoctors((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        toast.success('Doctor updated');
      } else {
        const created = await createDoctor(payload);
        setDoctors((prev) => [created, ...prev]);
        toast.success('Doctor added');
      }
      setDoctorFormOpen(false);
    } catch (err) {
      setDoctorFormError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setDoctorSaving(false);
    }
  };

  // --- Registrations ---
  const [regSessions, setRegSessions] = useState<AdminRegistrationSession[]>([]);
  const [regLoading, setRegLoading] = useState(true);
  const [regSearch, setRegSearch] = useState('');
  const [regVerifiedFilter, setRegVerifiedFilter] = useState('all');
  const [selectedReg, setSelectedReg] = useState<AdminRegistrationSession | null>(null);
  const [regAttempts, setRegAttempts] = useState<AdminFaceVerificationAttempt[]>([]);
  const [regAttemptsLoading, setRegAttemptsLoading] = useState(false);
  const [confirmDeleteReg, setConfirmDeleteReg] = useState(false);
  const [confirmClearAbandoned, setConfirmClearAbandoned] = useState(false);
  const [regBusy, setRegBusy] = useState(false);

  const loadRegistrations = async () => {
    try {
      const data = await fetchAdminRegistrationSessions();
      setRegSessions(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not load registrations.');
    } finally {
      setRegLoading(false);
    }
  };

  useEffect(() => {
    if (panel !== 'registrations') return;
    void loadRegistrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  useEffect(() => {
    if (!selectedReg) {
      setRegAttempts([]);
      return;
    }
    setRegAttemptsLoading(true);
    fetchAdminFaceVerificationAttempts(selectedReg.sessionId)
      .then(setRegAttempts)
      .catch(() => setRegAttempts([]))
      .finally(() => setRegAttemptsLoading(false));
  }, [selectedReg]);

  const filteredRegSessions = useMemo(() => {
    const q = regSearch.trim().toLowerCase();
    return regSessions.filter((s) => {
      if (regVerifiedFilter !== 'all' && String(s.isVerified) !== regVerifiedFilter) return false;
      if (!q) return true;
      return (
        s.email.toLowerCase().includes(q) ||
        s.idFirstName.toLowerCase().includes(q) ||
        s.idLastName.toLowerCase().includes(q) ||
        s.prcFullName.toLowerCase().includes(q)
      );
    });
  }, [regSessions, regSearch, regVerifiedFilter]);

  const abandonedRegCount = useMemo(() => regSessions.filter(isAbandonedSession).length, [regSessions]);

  const handleDeleteReg = async () => {
    if (!selectedReg) return;
    setRegBusy(true);
    try {
      await deleteAdminRegistrationSession(selectedReg.id);
      setRegSessions((prev) => prev.filter((s) => s.id !== selectedReg.id));
      setConfirmDeleteReg(false);
      setSelectedReg(null);
      toast.success('Registration session deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete.');
    } finally {
      setRegBusy(false);
    }
  };

  const handleClearAbandoned = async () => {
    setRegBusy(true);
    try {
      const { deleted } = await clearAbandonedRegistrationSessions();
      setConfirmClearAbandoned(false);
      toast.success(`Deleted ${deleted} abandoned session${deleted === 1 ? '' : 's'}`);
      void loadRegistrations();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not clear abandoned sessions.');
    } finally {
      setRegBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [patientData, deptData] = await Promise.all([fetchPatients(), fetchDepartments()]);
        setPatients(patientData);
        setDepartments(deptData);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : 'Failed to load patients.');
      } finally {
        setPatientsLoading(false);
      }
    })();
  }, []);

  const nurseOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of patients) {
      if (p.assignedNurseId && p.assignedNurseName) seen.set(p.assignedNurseId, p.assignedNurseName);
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [patients]);

  const filteredPatients = useMemo(
    () =>
      patients.filter((p) => {
        if (nurseFilter !== 'all' && p.assignedNurseId !== nurseFilter) return false;
        if (deptFilter !== 'all' && String(p.departmentId ?? '') !== deptFilter) return false;
        if (riskFilter !== 'all' && p.riskLevel !== riskFilter) return false;
        if (patientStatusFilter !== 'all' && p.status !== patientStatusFilter) return false;
        return true;
      }),
    [patients, nurseFilter, deptFilter, riskFilter, patientStatusFilter]
  );

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminUsers(tab === 'all' ? undefined : { status: tab });
      setUsers(data);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to load accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleApprove = async (target: AdminUser) => {
    setBusyId(target.id);
    try {
      const updated = await approveAdminUser(target.id);
      setUsers((prev) => prev.map((u) => (u.id === target.id ? updated : u)));
      toast.success(`${target.name} approved`, { description: 'They can now sign in.' });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to approve.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    setBusyId(rejectTarget.id);
    try {
      const updated = await rejectAdminUser(rejectTarget.id, rejectReason.trim());
      setUsers((prev) => prev.map((u) => (u.id === rejectTarget.id ? updated : u)));
      toast.success(`${rejectTarget.name} rejected`);
      setRejectTarget(null);
      setRejectReason('');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to reject.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (target: AdminUser) => {
    setBusyId(target.id);
    try {
      const updated = target.isActiveStaff
        ? await deactivateAdminUser(target.id)
        : await reactivateAdminUser(target.id);
      setUsers((prev) => prev.map((u) => (u.id === target.id ? updated : u)));
      toast.success(`${target.name} ${updated.isActiveStaff ? 'reactivated' : 'deactivated'}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update account.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSetPassword = async () => {
    if (!passwordTarget || newPassword.length < 8) return;
    setBusyId(passwordTarget.id);
    try {
      await setAdminUserPassword(passwordTarget.id, newPassword);
      toast.success(`Password updated for ${passwordTarget.name}`, {
        description: 'Their previous session was signed out.',
      });
      setPasswordTarget(null);
      setNewPassword('');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to set password.');
    } finally {
      setBusyId(null);
    }
  };

  const counts = {
    all: users.length,
    pending: users.filter((u) => u.approvalStatus === 'pending').length,
  };

  const visibleUsers = useMemo(
    () => (roleFilter === 'all' ? users : users.filter((u) => u.role === roleFilter)),
    [users, roleFilter]
  );

  if (isLoading || !user?.isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
      <header className="bg-gradient-to-r from-white via-blue-50 to-blue-100 border-b-2 border-blue-300 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-lg shadow-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-md">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-black text-transparent bg-gradient-to-r from-blue-700 to-blue-900 bg-clip-text">
              NurseLink Admin
            </h1>
            <p className="text-xs text-gray-500">{user?.email}</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleLogout} className="shadow-sm">
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex gap-2">
          {PANEL_TABS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPanel(p.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                panel === p.id
                  ? 'bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-md'
                  : 'bg-white/70 text-foreground hover:bg-white shadow-sm'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {panel === 'accounts' ? (
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex gap-2 flex-wrap">
                {STATUS_TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                      tab === t.id
                        ? 'bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-md'
                        : 'bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    {t.label}
                    {t.id === 'pending' && counts.pending > 0 && (
                      <span className="ml-2 bg-white/20 rounded-full px-1.5 text-xs">{counts.pending}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="role-filter" className="text-sm font-medium text-muted-foreground">
                  Role
                </label>
                <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
                  <SelectTrigger id="role-filter" size="sm" className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_FILTERS.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : visibleUsers.length === 0 ? (
              <p className="text-center text-gray-500 py-12">No accounts in this view.</p>
            ) : (
              <div className="space-y-3">
                {visibleUsers.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between p-4 border rounded-lg gap-4 flex-wrap"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">{u.name}</p>
                        <Badge variant={STATUS_BADGE[u.approvalStatus].variant} className="text-xs">
                          {STATUS_BADGE[u.approvalStatus].label}
                        </Badge>
                        <Badge variant={ROLE_BADGE[u.role].variant} className="text-xs">
                          {ROLE_BADGE[u.role].label}
                        </Badge>
                        {!u.isActiveStaff && (
                          <Badge variant="destructive" className="text-xs">
                            Deactivated
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{u.email}</p>
                      <p className="text-xs text-gray-400">
                        {u.department || 'No department'}
                        {u.hospitalName ? ` • ${u.hospitalName}` : ''}
                        {u.employeeId ? ` • ID ${u.employeeId}` : ''}
                      </p>
                      {u.approvalStatus === 'rejected' && u.rejectionReason && (
                        <p className="text-xs text-red-600 mt-1">Reason: {u.rejectionReason}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {u.approvalStatus === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            variant="success"
                            disabled={busyId === u.id}
                            onClick={() => handleApprove(u)}
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === u.id}
                            onClick={() => setRejectTarget(u)}
                            className="border-destructive text-destructive hover:bg-destructive-light"
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Reject
                          </Button>
                        </>
                      )}
                      {u.approvalStatus === 'approved' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === u.id}
                          onClick={() => handleToggleActive(u)}
                          className={
                            u.isActiveStaff
                              ? 'border-warning text-warning-hover hover:bg-warning-light'
                              : 'border-success text-success-hover hover:bg-success-light'
                          }
                        >
                          {u.isActiveStaff ? (
                            <>
                              <UserX className="w-4 h-4 mr-1" />
                              Deactivate
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-4 h-4 mr-1" />
                              Reactivate
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === u.id}
                        onClick={() => setPasswordTarget(u)}
                      >
                        <KeyRound className="w-4 h-4 mr-1" />
                        Set Password
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        ) : panel === 'patients' ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Patients</CardTitle>
              <span className="text-sm font-semibold text-muted-foreground">
                Total Patients: {patients.length}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2">
                <label htmlFor="patient-nurse-filter" className="text-sm font-medium text-muted-foreground">
                  Assigned Nurse
                </label>
                <Select value={nurseFilter} onValueChange={setNurseFilter}>
                  <SelectTrigger id="patient-nurse-filter" size="sm" className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Nurses</SelectItem>
                    {nurseOptions.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="patient-dept-filter" className="text-sm font-medium text-muted-foreground">
                  Department
                </label>
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger id="patient-dept-filter" size="sm" className="w-[170px]">
                    <SelectValue />
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
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="patient-risk-filter" className="text-sm font-medium text-muted-foreground">
                  Risk Level
                </label>
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger id="patient-risk-filter" size="sm" className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_FILTERS.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="patient-status-filter" className="text-sm font-medium text-muted-foreground">
                  Status
                </label>
                <Select value={patientStatusFilter} onValueChange={setPatientStatusFilter}>
                  <SelectTrigger id="patient-status-filter" size="sm" className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PATIENT_STATUS_FILTERS.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {patientsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : filteredPatients.length === 0 ? (
              <p className="text-center text-gray-500 py-12">No patients in this view.</p>
            ) : (
              <div className="space-y-3">
                {filteredPatients.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-4 border rounded-lg gap-4 flex-wrap"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">{p.name}</p>
                        <span className="text-xs text-gray-500">#{p.id}</span>
                        <Badge variant={RISK_BADGE[p.riskLevel] || 'secondary'} className="text-xs capitalize">
                          {p.riskLevel}
                        </Badge>
                        <Badge variant={PATIENT_STATUS_BADGE[p.status || 'admitted'] || 'secondary'} className="text-xs capitalize">
                          {p.statusLabel || p.status || 'admitted'}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">
                        {p.departmentName || 'No department'} · Room {p.room || '—'}
                        {p.bedNumber ? ` / Bed ${p.bedNumber}` : ''}
                      </p>
                      <p className="text-xs text-gray-400">
                        Nurse: {p.assignedNurseName || 'Unassigned'} · Doctor:{' '}
                        {p.assignedDoctors?.[0]?.name || p.attendingPhysician || 'Unassigned'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => setViewPatient(p)}>
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        ) : panel === 'doctors' ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Doctors</CardTitle>
              <Button size="sm" onClick={openCreateDoctor}>
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search by name or specialization"
                value={doctorSearch}
                onChange={(e) => setDoctorSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {doctorsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : filteredDoctors.length === 0 ? (
              <p className="text-center text-gray-500 py-12">No doctors match.</p>
            ) : (
              <div className="space-y-3">
                {filteredDoctors.map((doctor) => (
                  <div
                    key={doctor.id}
                    className="flex items-center justify-between p-4 border rounded-lg gap-4 flex-wrap cursor-pointer hover:bg-accent/40"
                    onClick={() => openEditDoctor(doctor)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">Dr. {doctor.fullName}</p>
                        <Badge variant={doctor.status === 'active' ? 'success' : 'secondary'} className="text-xs">
                          {doctor.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">
                        {doctor.specialization || 'No specialization set'} · {doctor.departmentName}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        ) : panel === 'registrations' ? (
        <Card>
          <CardHeader>
            <CardTitle>Registrations</CardTitle>
            <p className="text-sm text-muted-foreground">
              The identity-verification audit trail behind every signup — evidence for each Accounts decision.
            </p>
          </CardHeader>
          <CardContent>
            {abandonedRegCount > 0 ? (
              <button
                onClick={() => setConfirmClearAbandoned(true)}
                className="w-full flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-left hover:bg-blue-100 transition-colors"
              >
                <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <span className="flex-1 text-sm font-medium text-blue-800">
                  {abandonedRegCount} abandoned session{abandonedRegCount === 1 ? '' : 's'} — nobody ever
                  finished Step 1 (no name, no email, no verification).
                </span>
                <span className="text-sm font-bold text-blue-700">Clear</span>
              </button>
            ) : null}

            <div className="flex flex-wrap gap-3 mb-4">
              <div className="relative max-w-sm flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search by email or name"
                  value={regSearch}
                  onChange={(e) => setRegSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2">
                {VERIFIED_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setRegVerifiedFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      regVerifiedFilter === f.id
                        ? 'bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-md'
                        : 'bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {regLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : filteredRegSessions.length === 0 ? (
              <p className="text-center text-gray-500 py-12">No registration sessions match.</p>
            ) : (
              <div className="space-y-3">
                {filteredRegSessions.map((session) => (
                  <div
                    key={session.id}
                    className="p-4 border rounded-lg cursor-pointer hover:bg-accent/40"
                    onClick={() => setSelectedReg(session)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900">
                        {session.idFirstName || session.prcFullName || session.email || 'Unknown'}{' '}
                        {session.idLastName}
                      </p>
                      <Badge variant={session.isVerified ? 'success' : 'secondary'} className="text-xs">
                        {session.isVerified ? 'verified' : 'unverified'}
                      </Badge>
                      {session.faceLocked ? (
                        <Badge variant="destructive" className="text-xs">face locked</Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{session.email || 'No email yet'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {session.faceAttempts} face attempt{session.faceAttempts === 1 ? '' : 's'}
                      {session.verificationMethod ? ` · via ${session.verificationMethod}` : ''}
                      {' · '}{new Date(session.createdAt).toLocaleString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>{recordsConfig.title}</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">{recordsConfig.description}</p>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap mb-4">
              {RECORD_SECTION_LIST.map((s) => {
                const Icon = SECTION_ICON[s.key];
                return (
                  <button
                    key={s.key}
                    onClick={() => setRecordsSection(s.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      recordsSection === s.key
                        ? 'bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-md'
                        : 'bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {s.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-3 mb-4">
              <div className="relative max-w-sm flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search"
                  value={recordSearch}
                  onChange={(e) => setRecordSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {activeRecordFilters.map((f) => (
                <div key={f.key} className="flex items-center gap-2">
                  <Select
                    value={recordFilterValues[f.key] ?? 'all'}
                    onValueChange={(v) => setRecordFilterValues((prev) => ({ ...prev, [f.key]: v }))}
                  >
                    <SelectTrigger size="sm" className="w-[170px]">
                      <SelectValue placeholder={f.label} />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {recordsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : recordsError ? (
              <p className="text-center text-destructive py-12">{recordsError}</p>
            ) : filteredRecordRows.length === 0 ? (
              <p className="text-center text-gray-500 py-12">Nothing here yet.</p>
            ) : (
              <div className="space-y-3">
                {filteredRecordRows.map((row) => (
                  <div
                    key={row.key}
                    className={`p-4 border rounded-lg ${recordsConfig.detailFields ? 'cursor-pointer hover:bg-accent/40' : ''}`}
                    onClick={() => recordsConfig.detailFields && setSelectedRecord(row)}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="font-semibold text-gray-900">{row.title}</p>
                      {row.badge ? (
                        <Badge variant={row.badge.variant} className="text-xs capitalize">
                          {row.badge.label}
                        </Badge>
                      ) : null}
                    </div>
                    {row.meta.filter(Boolean).map((line, i) => (
                      <p key={i} className="text-sm text-gray-500 mt-0.5">{line}</p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        )}
      </main>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejectTarget?.name}</DialogTitle>
            <DialogDescription>
              A reason is required — the nurse will see this the next time they try to log in.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Employee ID did not match hospital records."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || busyId === rejectTarget?.id}
            >
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set password dialog */}
      <Dialog open={!!passwordTarget} onOpenChange={(open) => !open && setPasswordTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set password for {passwordTarget?.name}</DialogTitle>
            <DialogDescription>
              At least 8 characters. This signs them out of every device they were already logged into.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSetPassword}
              disabled={newPassword.length < 8 || busyId === passwordTarget?.id}
            >
              Update Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Patient detail dialog — admin has read-only access, no edit/delete here */}
      <Dialog open={!!viewPatient} onOpenChange={(open) => !open && setViewPatient(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewPatient?.name}</DialogTitle>
            <DialogDescription>
              Patient ID {viewPatient?.id}
              {viewPatient?.medicalRecordNumber ? ` · MRN ${viewPatient.medicalRecordNumber}` : ''}
            </DialogDescription>
          </DialogHeader>
          {viewPatient ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="text-muted-foreground">Age / Sex</div>
              <div className="text-right font-medium">{viewPatient.age} / {viewPatient.gender}</div>
              <div className="text-muted-foreground">Date of Birth</div>
              <div className="text-right font-medium">{viewPatient.dateOfBirth || '—'}</div>
              <div className="text-muted-foreground">Department</div>
              <div className="text-right font-medium">{viewPatient.departmentName || '—'}</div>
              <div className="text-muted-foreground">Room / Bed</div>
              <div className="text-right font-medium">
                {viewPatient.room || '—'}{viewPatient.bedNumber ? ` / Bed ${viewPatient.bedNumber}` : ''}
              </div>
              <div className="text-muted-foreground">Assigned Nurse</div>
              <div className="text-right font-medium">{viewPatient.assignedNurseName || 'Unassigned'}</div>
              <div className="text-muted-foreground">Assigned Doctor</div>
              <div className="text-right font-medium">
                {viewPatient.assignedDoctors?.[0]?.name || viewPatient.attendingPhysician || 'Unassigned'}
              </div>
              <div className="text-muted-foreground">Risk Level</div>
              <div className="text-right font-medium capitalize">{viewPatient.riskLevel}</div>
              <div className="text-muted-foreground">Status</div>
              <div className="text-right font-medium capitalize">
                {viewPatient.statusLabel || viewPatient.status || 'admitted'}
              </div>
              <div className="text-muted-foreground">Admitted</div>
              <div className="text-right font-medium">{viewPatient.admissionDate}</div>
              <div className="text-muted-foreground">Diagnosis</div>
              <div className="text-right font-medium">{viewPatient.diagnosis || '—'}</div>
              <div className="text-muted-foreground">Contact Number</div>
              <div className="text-right font-medium">{viewPatient.contactNumber || '—'}</div>
              <div className="text-muted-foreground">Address</div>
              <div className="text-right font-medium">{viewPatient.address || '—'}</div>
              <div className="text-muted-foreground">Emergency Contact</div>
              <div className="text-right font-medium">
                {viewPatient.emergencyContactName || '—'}
                {viewPatient.emergencyContactNumber ? ` (${viewPatient.emergencyContactNumber})` : ''}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewPatient(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Doctor add/edit dialog */}
      <Dialog open={doctorFormOpen} onOpenChange={(open) => !doctorSaving && setDoctorFormOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDoctor ? 'Edit Doctor' : 'Add Doctor'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Full name *</label>
              <Input
                placeholder="e.g. Maria Santos"
                value={doctorForm.fullName}
                onChange={(e) => setDoctorForm((f) => ({ ...f, fullName: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Specialization</label>
              <Input
                placeholder="e.g. Cardiology"
                value={doctorForm.specialization}
                onChange={(e) => setDoctorForm((f) => ({ ...f, specialization: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Department *</label>
              <Select
                value={doctorForm.departmentId}
                onValueChange={(v) => setDoctorForm((f) => ({ ...f, departmentId: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">License number</label>
              <Input
                placeholder="Optional"
                value={doctorForm.licenseNumber}
                onChange={(e) => setDoctorForm((f) => ({ ...f, licenseNumber: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <Select
                value={doctorForm.status}
                onValueChange={(v) => setDoctorForm((f) => ({ ...f, status: v as 'active' | 'inactive' }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {doctorFormError ? <p className="text-sm text-destructive">{doctorFormError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoctorFormOpen(false)} disabled={doctorSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveDoctor} disabled={doctorSaving}>
              {doctorSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hospital Records detail dialog */}
      <Dialog open={!!selectedRecord} onOpenChange={(open) => !open && setSelectedRecord(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedRecord?.title}</DialogTitle>
          </DialogHeader>
          {selectedRecord && recordsConfig.detailFields ? (
            <div className="space-y-3">
              {recordsConfig.detailFields(selectedRecord.raw).map((field) =>
                field.multiline ? (
                  <div key={field.label}>
                    <p className="text-sm text-muted-foreground mb-1">{field.label}</p>
                    <p className="text-sm font-medium bg-gray-50 rounded-lg p-2.5 whitespace-pre-line">
                      {field.value}
                    </p>
                  </div>
                ) : (
                  <div key={field.label} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-muted-foreground flex-shrink-0">{field.label}</span>
                    <span className="font-medium text-right">{field.value}</span>
                  </div>
                )
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRecord(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Registration session detail dialog */}
      <Dialog open={!!selectedReg} onOpenChange={(open) => !open && setSelectedReg(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>
                {selectedReg?.idFirstName || selectedReg?.email} {selectedReg?.idLastName}
              </DialogTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDeleteReg(true)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </DialogHeader>
          {selectedReg ? (
            <div className="space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium text-right">{selectedReg.email || '—'}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Verification method</span>
                  <span className="font-medium text-right">{selectedReg.verificationMethod || '—'}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Face verified</span>
                  <span className="font-medium text-right">{selectedReg.faceVerified ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Face attempts</span>
                  <span className="font-medium text-right">{selectedReg.faceAttempts}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Face locked</span>
                  <span className="font-medium text-right">{selectedReg.faceLocked ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">OTP verified</span>
                  <span className="font-medium text-right">{selectedReg.otpVerified ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">ID name</span>
                  <span className="font-medium text-right">
                    {`${selectedReg.idFirstName} ${selectedReg.idMiddleName} ${selectedReg.idLastName}`.trim() || '—'}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">ID verification status</span>
                  <span className="font-medium text-right">{selectedReg.idVerificationStatus || '—'}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Linked account</span>
                  <span className="font-medium text-right">{selectedReg.userEmail || 'Not yet signed up'}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Started</span>
                  <span className="font-medium text-right">
                    {new Date(selectedReg.createdAt).toLocaleString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                  Face verification attempts
                </p>
                {regAttemptsLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : regAttempts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No face attempts recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {regAttempts.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2.5">
                        {a.matched ? (
                          <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">
                            {a.matched ? 'Match' : a.reasonLabel || 'No match'}
                            {a.confidence ? ` · ${Math.round(a.confidence * 100)}% confidence` : ''}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(a.createdAt).toLocaleString(undefined, {
                              year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                            {a.countable ? '' : ' · not counted'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedReg(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete registration session */}
      <Dialog open={confirmDeleteReg} onOpenChange={(open) => !regBusy && setConfirmDeleteReg(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this registration session?</DialogTitle>
            <DialogDescription>
              Removes the identity-verification audit trail and its face-attempt history. If this session
              already has a signed-up account, the account itself is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteReg(false)} disabled={regBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteReg} disabled={regBusy}>
              {regBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm clear abandoned sessions */}
      <Dialog open={confirmClearAbandoned} onOpenChange={(open) => !regBusy && setConfirmClearAbandoned(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {abandonedRegCount} abandoned session{abandonedRegCount === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              Only sessions with no name, no email, and no verification progress are removed — anything with
              real progress or a linked account is left alone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClearAbandoned(false)} disabled={regBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearAbandoned} disabled={regBusy}>
              {regBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
