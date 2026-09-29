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
  ApiError,
} from '../api/nurselink';
import type { AdminUser, Patient, Department } from '../types/domain';

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

const PANEL_TABS: Array<{ id: 'accounts' | 'patients'; label: string }> = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'patients', label: 'Patients' },
];

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

  const [panel, setPanel] = useState<'accounts' | 'patients'>('accounts');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [nurseFilter, setNurseFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [patientStatusFilter, setPatientStatusFilter] = useState('all');
  const [viewPatient, setViewPatient] = useState<Patient | null>(null);

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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900">NurseLink Admin</h1>
            <p className="text-xs text-gray-500">{user?.email}</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleLogout}>
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
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                panel === p.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'
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
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      tab === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'
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
        ) : (
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
    </div>
  );
}
