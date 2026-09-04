import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
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
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchAdminUsers,
  approveAdminUser,
  rejectAdminUser,
  deactivateAdminUser,
  reactivateAdminUser,
  setAdminUserPassword,
  ApiError,
} from '../api/nurselink';
import type { AdminUser } from '../types/domain';

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
  const [busyId, setBusyId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<AdminUser | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [passwordTarget, setPasswordTarget] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

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

  if (isLoading || !user?.isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
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
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-4 flex-wrap">
              {STATUS_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    tab === t.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t.label}
                  {t.id === 'pending' && counts.pending > 0 && (
                    <span className="ml-2 bg-white/20 rounded-full px-1.5 text-xs">{counts.pending}</span>
                  )}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-center text-gray-500 py-12">No accounts in this view.</p>
            ) : (
              <div className="space-y-3">
                {users.map((u) => (
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
                        <Badge variant="secondary" className="text-xs capitalize">
                          {u.role.replace('_', ' ')}
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
                            disabled={busyId === u.id}
                            onClick={() => handleApprove(u)}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === u.id}
                            onClick={() => setRejectTarget(u)}
                            className="border-red-600 text-red-600 hover:bg-red-50"
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
                              ? 'border-orange-600 text-orange-600 hover:bg-orange-50'
                              : 'border-green-600 text-green-600 hover:bg-green-50'
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
              onClick={handleReject}
              disabled={!rejectReason.trim() || busyId === rejectTarget?.id}
              className="bg-red-600 hover:bg-red-700"
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
    </div>
  );
}
