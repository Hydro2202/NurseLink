import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Modal } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  Search,
  Mail,
  Building2,
  Calendar,
  X,
  CheckCircle,
  XCircle,
  UserX,
  UserCheck,
  KeyRound,
} from 'lucide-react-native';
import {
  fetchAdminAccounts,
  approveAdminAccount,
  rejectAdminAccount,
  deactivateAdminAccount,
  reactivateAdminAccount,
  setAdminAccountPassword,
  ApiError,
} from '../../../services/api';
import type { AdminAccount } from '../../../types/domain';
import { Input } from '../../../components/Input';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Select, type SelectOption } from '../../../components/Select';
import { Tabs, type TabItem } from '../../../components/Tabs';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useToast } from '../../../contexts/ToastContext';
import { useLiveRefresh } from '../../../contexts/LiveContext';
import { Colors, Shadows, Radius } from '../../../constants/colors';

const STATUS_TABS: TabItem[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const STATUS_VARIANT: Record<AdminAccount['approvalStatus'], 'warning' | 'success' | 'destructive'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
};

// 'default' (solid primary), not Badge's 'secondary' variant, for Head Nurse
// — mobile's 'secondary' is an intentionally muted/subtle gray (see
// Badge.tsx), which reads as de-emphasized rather than the emphasis this
// role distinction needs. 'info' (soft primary chip) for Nurse keeps both
// within the existing primary color family — no new color introduced.
const ROLE_BADGE: Record<AdminAccount['role'], { label: string; variant: 'info' | 'default' }> = {
  staff_nurse: { label: 'Nurse', variant: 'info' },
  head_nurse: { label: 'Head Nurse', variant: 'default' },
};

const ROLE_FILTER_OPTIONS: SelectOption[] = [
  { label: 'All Roles', value: 'all' },
  { label: 'Nurse', value: 'staff_nurse' },
  { label: 'Head Nurse', value: 'head_nurse' },
];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AdminAccountsPage() {
  const params = useLocalSearchParams<{ status?: string }>();
  const toast = useToast();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState((params.status as string) || 'all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selected, setSelected] = useState<AdminAccount | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchAdminAccounts();
      setAccounts(data);
    } catch (err) {
      toast.error('Could not load accounts', {
        description: err instanceof ApiError ? err.message : 'Check your connection and try again.',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // A new signup notifies every admin immediately (see
  // notify_admin_new_registration) — this keeps the list itself in sync
  // with that same signal, not just the notification bell.
  useLiveRefresh('notifications', () => {
    void load();
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (statusFilter !== 'all' && a.approvalStatus !== statusFilter) return false;
      if (roleFilter !== 'all' && a.role !== roleFilter) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
    });
  }, [accounts, search, statusFilter, roleFilter]);

  const refreshSelected = (updated: AdminAccount) => {
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSelected(updated);
  };

  const handleApprove = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await approveAdminAccount(selected.id);
      refreshSelected(updated);
      toast.success('Account approved');
    } catch (err) {
      toast.error('Could not approve', { description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!selected || !rejectReason.trim()) return;
    setBusy(true);
    try {
      const updated = await rejectAdminAccount(selected.id, rejectReason.trim());
      refreshSelected(updated);
      setRejectOpen(false);
      setRejectReason('');
      toast.success('Account rejected');
    } catch (err) {
      toast.error('Could not reject', { description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivateToggle = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = selected.isActiveStaff
        ? await deactivateAdminAccount(selected.id)
        : await reactivateAdminAccount(selected.id);
      refreshSelected(updated);
      setConfirmDeactivate(false);
      toast.success(updated.isActiveStaff ? 'Account reactivated' : 'Account deactivated');
    } catch (err) {
      toast.error('Could not update account', { description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const handleSetPassword = async () => {
    if (!selected || newPassword.length < 8) return;
    setBusy(true);
    try {
      await setAdminAccountPassword(selected.id, newPassword);
      setPasswordOpen(false);
      setNewPassword('');
      toast.success('Password updated', { description: 'The account was signed out everywhere.' });
    } catch (err) {
      toast.error('Could not set password', { description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Accounts</Text>
        <Text style={styles.subtitle}>Every nurse and head nurse account, regardless of status.</Text>

        <Input
          placeholder="Search by name or email"
          value={search}
          onChangeText={setSearch}
          leftIcon={<Search size={16} color={Colors.gray400} />}
        />
        <Tabs value={statusFilter} onValueChange={setStatusFilter} tabs={STATUS_TABS} />
        <Select
          label="Role"
          value={roleFilter}
          onValueChange={setRoleFilter}
          options={ROLE_FILTER_OPTIONS}
        />

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={Colors.blue600} />
        ) : filtered.length === 0 ? (
          <Text style={styles.empty}>No accounts match.</Text>
        ) : (
          <View style={styles.list}>
            {filtered.map((account) => (
              <Pressable key={account.id} onPress={() => setSelected(account)}>
                <View style={[styles.row, Shadows.sm]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowName}>{account.name}</Text>
                      <Badge variant={STATUS_VARIANT[account.approvalStatus]}>
                        {account.approvalStatus}
                      </Badge>
                      <Badge variant={ROLE_BADGE[account.role].variant}>
                        {ROLE_BADGE[account.role].label}
                      </Badge>
                      {!account.isActiveStaff ? <Badge variant="secondary">deactivated</Badge> : null}
                    </View>
                    <Text style={styles.rowMeta}>{account.email}</Text>
                    {account.department ? <Text style={styles.rowMeta}>{account.department}</Text> : null}
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
            {selected ? (
              <>
                <View style={styles.dialogHeader}>
                  <Text style={styles.dialogTitle}>{selected.name}</Text>
                  <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                    <X size={20} color={Colors.gray500} />
                  </Pressable>
                </View>
                <View style={styles.detailRow}>
                  <Mail size={14} color={Colors.gray500} />
                  <Text style={styles.detailText}>{selected.email}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Building2 size={14} color={Colors.gray500} />
                  <Text style={styles.detailText}>{selected.department || 'No department assigned'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Calendar size={14} color={Colors.gray500} />
                  <Text style={styles.detailText}>Joined {formatDate(selected.dateJoined)}</Text>
                </View>
                <View style={styles.badgeRow}>
                  <Badge variant={STATUS_VARIANT[selected.approvalStatus]}>{selected.approvalStatus}</Badge>
                  <Badge variant={ROLE_BADGE[selected.role].variant}>{ROLE_BADGE[selected.role].label}</Badge>
                  <Badge variant={selected.isActiveStaff ? 'outline' : 'secondary'}>
                    {selected.isActiveStaff ? 'active' : 'deactivated'}
                  </Badge>
                </View>
                {selected.approvalStatus === 'rejected' && selected.rejectionReason ? (
                  <Text style={styles.rejectionNote}>Reason: {selected.rejectionReason}</Text>
                ) : null}

                <View style={styles.actions}>
                  {selected.approvalStatus !== 'approved' ? (
                    <Button onPress={handleApprove} disabled={busy} loading={busy}>
                      <View style={styles.btnInner}>
                        <CheckCircle size={16} color={Colors.white} />
                        <Text style={styles.btnLabel}>Approve</Text>
                      </View>
                    </Button>
                  ) : null}
                  {selected.approvalStatus !== 'rejected' ? (
                    <Button variant="destructive" onPress={() => setRejectOpen(true)} disabled={busy}>
                      <View style={styles.btnInner}>
                        <XCircle size={16} color={Colors.white} />
                        <Text style={styles.btnLabel}>Reject</Text>
                      </View>
                    </Button>
                  ) : null}
                  <Button variant="outline" onPress={() => setConfirmDeactivate(true)} disabled={busy}>
                    <View style={styles.btnInner}>
                      {selected.isActiveStaff ? (
                        <UserX size={16} color={Colors.foreground} />
                      ) : (
                        <UserCheck size={16} color={Colors.foreground} />
                      )}
                      <Text style={[styles.btnLabel, { color: Colors.foreground }]}>
                        {selected.isActiveStaff ? 'Deactivate' : 'Reactivate'}
                      </Text>
                    </View>
                  </Button>
                  <Button variant="outline" onPress={() => setPasswordOpen(true)} disabled={busy}>
                    <View style={styles.btnInner}>
                      <KeyRound size={16} color={Colors.foreground} />
                      <Text style={[styles.btnLabel, { color: Colors.foreground }]}>Reset Password</Text>
                    </View>
                  </Button>
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={rejectOpen} transparent animationType="fade" onRequestClose={() => setRejectOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRejectOpen(false)}>
          <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.dialogTitle}>Reject {selected?.name}</Text>
            <Input
              label="Reason *"
              placeholder="e.g. Employee ID did not match hospital records."
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              containerStyle={{ marginTop: 12 }}
            />
            <View style={styles.footer}>
              <Button variant="outline" onPress={() => setRejectOpen(false)} style={{ flex: 1 }} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onPress={handleReject}
                style={{ flex: 1 }}
                disabled={busy || !rejectReason.trim()}
                loading={busy}
              >
                Reject
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={passwordOpen} transparent animationType="fade" onRequestClose={() => setPasswordOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPasswordOpen(false)}>
          <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.dialogTitle}>Reset password for {selected?.name}</Text>
            <Text style={styles.dialogSub}>The account is signed out everywhere the moment this saves.</Text>
            <Input
              label="New password *"
              placeholder="At least 8 characters"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              containerStyle={{ marginTop: 12 }}
            />
            <View style={styles.footer}>
              <Button variant="outline" onPress={() => setPasswordOpen(false)} style={{ flex: 1 }} disabled={busy}>
                Cancel
              </Button>
              <Button
                onPress={handleSetPassword}
                style={{ flex: 1 }}
                disabled={busy || newPassword.length < 8}
                loading={busy}
              >
                Save
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={selected?.isActiveStaff ? 'Deactivate account?' : 'Reactivate account?'}
        description={
          selected?.isActiveStaff
            ? `${selected?.name} will no longer be able to sign in until reactivated.`
            : `${selected?.name} will be able to sign in again.`
        }
        confirmLabel={selected?.isActiveStaff ? 'Deactivate' : 'Reactivate'}
        destructive={selected?.isActiveStaff}
        loading={busy}
        onConfirm={handleDeactivateToggle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 100, gap: 12 },
  title: { fontSize: 20, fontWeight: '900', color: Colors.gray900 },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: -6 },
  empty: { textAlign: 'center', color: Colors.mutedForeground, marginTop: 32, fontSize: 13 },
  list: { gap: 10 },
  row: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowName: { fontSize: 14.5, fontWeight: '800', color: Colors.gray900 },
  rowMeta: { fontSize: 12, color: Colors.mutedForeground, marginTop: 3 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 440,
  },
  dialogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: Colors.gray900 },
  dialogSub: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 4 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  detailText: { fontSize: 13, color: Colors.foreground },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  rejectionNote: { fontSize: 12.5, color: Colors.red700, marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btnLabel: { color: Colors.white, fontWeight: '700', fontSize: 13.5 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 20 },
});
