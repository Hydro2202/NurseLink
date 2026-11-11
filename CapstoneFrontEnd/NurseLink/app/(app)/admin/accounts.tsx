import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Modal } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
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
  Trash2,
  Pencil,
  Phone,
  Unlock,
  LayoutGrid,
  Table2,
} from 'lucide-react-native';
import {
  fetchAdminAccounts,
  approveAdminAccount,
  rejectAdminAccount,
  deactivateAdminAccount,
  reactivateAdminAccount,
  setAdminAccountPassword,
  deleteAdminAccount,
  updateAdminAccount,
  grantAdminAccountRole,
  clearAdminAccountLoginLock,
  ApiError,
  fetchAdminAccount,
} from '../../../services/api';
import type { AdminAccount } from '../../../types/domain';
import { PrintButton } from '../../../components/admin/PrintButton';
import { printReport, type PrintField } from '../../../utils/print';
import { useAuth } from '../../../contexts/AuthContext';
import { formatDateTime12 } from '../../../utils/time';
import { Input } from '../../../components/Input';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Select, type SelectOption } from '../../../components/Select';
import { Tabs, type TabItem } from '../../../components/Tabs';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useToast } from '../../../contexts/ToastContext';
import { useLiveRefresh } from '../../../contexts/LiveContext';
import { Colors, Shadows, Radius } from '../../../constants/colors';
import { Pagination, usePagination } from '../../../components/Pagination';

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

// Card / Table layout for the accounts list, remembered per device (same
// pattern as the Patients and Tasks screens).
type AccountViewMode = 'card' | 'table';
const ACCOUNT_VIEW_KEY = 'nurselink.accountsViewMode';
function loadAccountView(): AccountViewMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(ACCOUNT_VIEW_KEY);
      if (v === 'card' || v === 'table') return v;
    }
  } catch {
    // ignore — fall back to the default
  }
  return 'card';
}
// Table columns size by FLEX so the table fills the whole content width on
// wide screens, with a minWidth floor per column; the row's total minWidth is
// what makes it scroll horizontally (header + rows together) only once the
// window is too narrow to fit. Index order matches the header row.
const ACCOUNT_TABLE_COLS = [
  { flex: 1.8, minWidth: 150 }, // Name
  { flex: 2.2, minWidth: 190 }, // Email
  { flex: 1, minWidth: 100 },   // Role
  { flex: 1, minWidth: 100 },   // Status
  { flex: 1.4, minWidth: 130 }, // Department
];
const ACCOUNT_TABLE_MIN_WIDTH = ACCOUNT_TABLE_COLS.reduce((s, c) => s + c.minWidth, 0);

export default function AdminAccountsPage() {
  const params = useLocalSearchParams<{ status?: string }>();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState((params.status as string) || 'all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selected, setSelected] = useState<AdminAccount | null>(null);
  const [accountViewMode, setAccountViewModeState] = useState<AccountViewMode>(loadAccountView);
  const setAccountViewMode = useCallback((mode: AccountViewMode) => {
    setAccountViewModeState(mode);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(ACCOUNT_VIEW_KEY, mode);
    } catch {
      // ignore storage failures — the choice still applies this session
    }
  }, []);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState('');
  const [busy, setBusy] = useState(false);
  // Shared "are you sure?" for every account change that otherwise fired on
  // a single click/selection — Approve, Role change, Unlock, and saving
  // Edit Details. Deactivate/Reactivate and Delete already had their own
  // ConfirmDialog; Reject and Reset Password already require typing a
  // reason/password first, which is its own deliberate step.
  const [pendingAction, setPendingAction] = useState<{
    title: string;
    description: string;
    run: () => void;
  } | null>(null);

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
    (async () => {
      await load();
    })();
  }, [load]);

  // expo-router keeps screens mounted, so an admin who deletes a
  // registration in the Registrations tab and switches back to this
  // already-mounted Accounts tab would otherwise still see the account
  // that registration was linked to — this list was built before that
  // delete happened and nothing was re-fetching it on return.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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

  // 10 per page; Next/Prev jumps back to the top of the list.
  const scrollRef = useRef<ScrollView>(null);
  const paged = usePagination(filtered, { scrollRef, resetKey: `${search}|${statusFilter}|${roleFilter}` });

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
      toast.success(`Account approved as ${ROLE_BADGE[updated.role].label}`);
    } catch (err) {
      toast.error('Could not approve', { description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const handleClearLock = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await clearAdminAccountLoginLock(selected.id);
      toast.success('Sign-in unlocked', { description: `${selected.name} can try signing in again now.` });
    } catch (err) {
      toast.error('Could not unlock', { description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (role: string) => {
    if (!selected || (role !== 'staff_nurse' && role !== 'head_nurse') || role === selected.role) return;
    setBusy(true);
    try {
      const updated = await grantAdminAccountRole(selected.id, role);
      refreshSelected(updated);
      toast.success(`Role changed to ${ROLE_BADGE[updated.role].label}`, {
        description: 'They sign in with this role from now on.',
      });
    } catch (err) {
      toast.error('Could not change role', { description: err instanceof ApiError ? err.message : undefined });
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

  const EDIT_FIELDS: { key: string; label: string }[] = [
    { key: 'firstName', label: 'First name *' },
    { key: 'middleName', label: 'Middle name' },
    { key: 'lastName', label: 'Last name *' },
    { key: 'email', label: 'Email *' },
    { key: 'phoneNumber', label: 'Phone number' },
    { key: 'department', label: 'Department' },
    { key: 'clinicalRole', label: 'Clinical role (e.g. RN)' },
    { key: 'specialization', label: 'Specialization' },
    { key: 'licenseNumber', label: 'License number' },
  ];

  const openEdit = () => {
    if (!selected) return;
    const values: Record<string, string> = {};
    for (const f of EDIT_FIELDS) values[f.key] = String((selected as any)[f.key] ?? '');
    setEditForm(values);
    setEditError('');
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!selected) return;
    const body: Record<string, string> = {};
    for (const f of EDIT_FIELDS) {
      const next = (editForm[f.key] ?? '').trim();
      if (next !== String((selected as any)[f.key] ?? '').trim()) body[f.key] = next;
    }
    if (!Object.keys(body).length) {
      setEditOpen(false);
      return;
    }
    setBusy(true);
    setEditError('');
    try {
      const updated = await updateAdminAccount(selected.id, body);
      setSelected(updated);
      setEditOpen(false);
      await load();
      toast.success('Account updated', { description: 'The new details show for every account.' });
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.data;
        const first = fields && typeof fields === 'object'
          ? Object.values(fields as Record<string, unknown>).flat().find((v) => typeof v === 'string')
          : null;
        setEditError((first as string) || err.message);
      } else {
        setEditError('Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await deleteAdminAccount(selected.id);
      setConfirmDelete(false);
      setSelected(null);
      await load();
      toast.success('Account deleted');
    } catch (err) {
      toast.error('Could not delete account', { description: err instanceof ApiError ? err.message : undefined });
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

  // Opening an account re-reads it through the server, which logs the view.
  const openAccount = async (account: AdminAccount) => {
    setSelected(account);
    try {
      setSelected(await fetchAdminAccount(account.id));
    } catch (err) {
      setSelected(null);
      toast.error('Could not open this account', {
        description: err instanceof ApiError ? err.message : 'Please try again.',
      });
    }
  };

  const roleText = (a: AdminAccount) => (a.role === 'head_nurse' ? 'Head Nurse' : 'Nurse');
  const statusText = (a: AdminAccount) =>
    `${a.approvalStatus}${a.isActiveStaff ? '' : ' (deactivated)'}`;

  const printList = () =>
    printReport(
      {
        title: 'Accounts',
        subtitle: 'Nurse and head nurse accounts',
        printedBy: currentUser?.name,
        scope: [
          `Status: ${statusFilter === 'all' ? 'All' : statusFilter} · Role: ${
            roleFilter === 'all' ? 'All' : roleFilter === 'head_nurse' ? 'Head Nurse' : 'Nurse'
          }${search.trim() ? ` · Search: "${search.trim()}"` : ''}`,
          `${filtered.length} of ${accounts.length} accounts`,
        ],
        columns: [
          { label: 'Name', value: (a: AdminAccount) => a.name, width: '22%' },
          { label: 'Email', value: (a: AdminAccount) => a.email, width: '24%' },
          { label: 'Role', value: roleText, width: '11%' },
          { label: 'Status', value: statusText, width: '13%' },
          { label: 'Department', value: (a: AdminAccount) => a.department || '—' },
          { label: 'Joined', value: (a: AdminAccount) => formatDateTime12(a.dateJoined) || '—', width: '16%' },
        ],
        rows: filtered,
      },
      {
        recordType: 'accounts',
        scope: 'list',
        filters: { status: statusFilter, role: roleFilter, search: search.trim() },
      }
    );

  const printAccount = (a: AdminAccount) => {
    const fields: PrintField[] = [
      { label: 'Name', value: a.name },
      { label: 'Email', value: a.email },
      { label: 'Phone', value: a.phoneNumber || '—' },
      { label: 'Role', value: roleText(a) },
      { label: 'Requested role', value: a.requestedRole === 'head_nurse' ? 'Head Nurse' : a.requestedRole ? 'Nurse' : '—' },
      { label: 'Approval status', value: a.approvalStatus },
      { label: 'Active', value: a.isActiveStaff ? 'Yes' : 'No (deactivated)' },
      { label: 'Department', value: a.department || '—' },
      { label: 'Clinical role', value: a.clinicalRole || '—' },
      { label: 'Specialization', value: a.specialization || '—' },
      { label: 'License number', value: a.licenseNumber || '—' },
      { label: 'Employee ID', value: a.employeeId || '—' },
      { label: 'Hospital', value: a.hospitalName || '—' },
      { label: 'Verification', value: a.verificationMethod || '—' },
      { label: 'Role granted by', value: a.roleGrantedBy || '—' },
      { label: 'Role granted at', value: formatDateTime12(a.roleGrantedAt) || '—' },
      { label: 'Joined', value: formatDateTime12(a.dateJoined) || '—' },
    ];
    if (a.rejectionReason) fields.push({ label: 'Rejection reason', value: a.rejectionReason, multiline: true });
    return printReport(
      { title: `Account: ${a.name}`, subtitle: `Account ID: ${a.id}`, printedBy: currentUser?.name, fields },
      { recordType: 'accounts', scope: 'detail', recordId: a.id, label: a.name }
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Accounts</Text>
            <Text style={styles.subtitle}>Every nurse and head nurse account, regardless of status.</Text>
          </View>
          <View style={styles.titleActions}>
            {/* Card / Table layout switch — remembered per device. */}
            <View style={styles.viewSwitch} accessibilityRole="radiogroup">
              {([
                { key: 'card', icon: LayoutGrid, label: 'Card view' },
                { key: 'table', icon: Table2, label: 'Table view' },
              ] as const).map(({ key, icon: Icon, label }) => {
                const active = accountViewMode === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setAccountViewMode(key)}
                    style={[styles.viewSwitchBtn, active && styles.viewSwitchBtnActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={label}
                  >
                    <Icon size={16} color={active ? Colors.blue600 : Colors.gray500} />
                  </Pressable>
                );
              })}
            </View>
            <PrintButton label="Print list" onPrint={printList} disabled={loading} />
          </View>
        </View>

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
        ) : accountViewMode === 'table' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            style={styles.tableScroll}
            contentContainerStyle={styles.tableScrollContent}
          >
            <View style={[styles.tableInner, { minWidth: ACCOUNT_TABLE_MIN_WIDTH }]}>
              <View style={styles.tableHeaderRow}>
                {['Name', 'Email', 'Role', 'Status', 'Department'].map((h, i) => (
                  <Text key={h} style={[styles.tableHeadCell, ACCOUNT_TABLE_COLS[i]]} numberOfLines={1}>
                    {h}
                  </Text>
                ))}
              </View>
              {paged.pageItems.map((account) => (
                <Pressable
                  key={account.id}
                  onPress={() => void openAccount(account)}
                  style={({ hovered }: { hovered?: boolean }) => [styles.tableRow, hovered && styles.tableRowHover]}
                  accessibilityLabel={`Open account ${account.name}`}
                >
                  <View style={[styles.tableCell, ACCOUNT_TABLE_COLS[0]]}>
                    <Text style={styles.tableCellStrong} numberOfLines={2}>{account.name}</Text>
                    {!account.isActiveStaff ? <Text style={styles.tableCellMuted}>deactivated</Text> : null}
                  </View>
                  <Text style={[styles.tableCellText, ACCOUNT_TABLE_COLS[1]]} numberOfLines={2}>
                    {account.email}
                  </Text>
                  <View style={[styles.tableCell, ACCOUNT_TABLE_COLS[2]]}>
                    <Badge variant={ROLE_BADGE[account.role].variant}>{ROLE_BADGE[account.role].label}</Badge>
                  </View>
                  <View style={[styles.tableCell, ACCOUNT_TABLE_COLS[3]]}>
                    <Badge variant={STATUS_VARIANT[account.approvalStatus]}>{account.approvalStatus}</Badge>
                  </View>
                  <Text style={[styles.tableCellText, ACCOUNT_TABLE_COLS[4]]} numberOfLines={2}>
                    {account.department || '—'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : (
          <View style={styles.list}>
            {paged.pageItems.map((account) => (
              <Pressable key={account.id} onPress={() => void openAccount(account)}>
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
                      {account.approvalStatus !== 'approved'
                        && account.requestedRole === 'head_nurse'
                        && account.role !== 'head_nurse' ? (
                        <Badge variant="warning">requests Head Nurse</Badge>
                      ) : null}
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
        <Pagination
          page={paged.page}
          totalPages={paged.totalPages}
          onPageChange={paged.setPage}
          total={paged.total}
        />
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
            {selected ? (
              <>
                <View style={styles.dialogHeader}>
                  <Text style={styles.dialogTitle}>{selected.name}</Text>
                  <PrintButton compact label="Print account" onPrint={() => printAccount(selected)} />
                  <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                    <X size={20} color={Colors.gray500} />
                  </Pressable>
                </View>
                <View style={styles.detailRow}>
                  <Mail size={14} color={Colors.gray500} />
                  <Text style={styles.detailText}>{selected.email}</Text>
                </View>
                {selected.phoneNumber ? (
                  <View style={styles.detailRow}>
                    <Phone size={14} color={Colors.gray500} />
                    <Text style={styles.detailText}>{selected.phoneNumber}</Text>
                  </View>
                ) : null}
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
                {selected.requestedRole && selected.requestedRole !== selected.role ? (
                  <Text style={styles.requestNote}>
                    Signed up as {selected.requestedRole === 'head_nurse' ? 'Head Nurse' : 'Nurse'}
                    {selected.approvalStatus !== 'approved' ? ' — approving gives them this role.' : '.'}
                  </Text>
                ) : null}
                {selected.approvalStatus === 'approved' ? (
                  <Select
                    label="Role"
                    value={selected.role}
                    onValueChange={(role) => {
                      if (role === selected.role) return;
                      const label = role === 'head_nurse' ? 'Head Nurse' : 'Nurse';
                      setPendingAction({
                        title: 'Change role?',
                        description: `Change ${selected.name}'s role to ${label}? They sign in with this role from now on.`,
                        run: () => handleRoleChange(role),
                      });
                    }}
                    options={[
                      { label: 'Nurse', value: 'staff_nurse' },
                      { label: 'Head Nurse', value: 'head_nurse' },
                    ]}
                  />
                ) : null}
                {selected.approvalStatus === 'rejected' && selected.rejectionReason ? (
                  <Text style={styles.rejectionNote}>Reason: {selected.rejectionReason}</Text>
                ) : null}

                <View style={styles.actions}>
                  <Button variant="outline" onPress={openEdit} disabled={busy}>
                    <View style={styles.btnInner}>
                      <Pencil size={16} color={Colors.foreground} />
                      <Text style={[styles.btnLabel, { color: Colors.foreground }]}>Edit Details</Text>
                    </View>
                  </Button>
                  {selected.approvalStatus !== 'approved' ? (
                    <Button
                      onPress={() => {
                        const roleLabel = (selected.requestedRole || selected.role) === 'head_nurse' ? 'Head Nurse' : 'Nurse';
                        setPendingAction({
                          title: 'Approve this account?',
                          description: `Approve ${selected.name} as ${roleLabel}? They'll be able to sign in immediately.`,
                          run: handleApprove,
                        });
                      }}
                      disabled={busy}
                      loading={busy}
                    >
                      <View style={styles.btnInner}>
                        <CheckCircle size={16} color={Colors.white} />
                        <Text style={styles.btnLabel}>
                          Approve as {(selected.requestedRole || selected.role) === 'head_nurse' ? 'Head Nurse' : 'Nurse'}
                        </Text>
                      </View>
                    </Button>
                  ) : null}
                  {/* Reject is a decision on a pending registration only. An approved
                      account is managed with Deactivate below, never rejected. */}
                  {selected.approvalStatus === 'pending' ? (
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
                  <Button
                    variant="outline"
                    onPress={() =>
                      setPendingAction({
                        title: 'Unlock sign-in?',
                        description: `Clear ${selected.name}'s sign-in lockout? They'll be able to try signing in again immediately.`,
                        run: handleClearLock,
                      })
                    }
                    disabled={busy}
                  >
                    <View style={styles.btnInner}>
                      <Unlock size={16} color={Colors.foreground} />
                      <Text style={[styles.btnLabel, { color: Colors.foreground }]}>Unlock Sign-in</Text>
                    </View>
                  </Button>
                  <Button variant="outline" onPress={() => setPasswordOpen(true)} disabled={busy}>
                    <View style={styles.btnInner}>
                      <KeyRound size={16} color={Colors.foreground} />
                      <Text style={[styles.btnLabel, { color: Colors.foreground }]}>Reset Password</Text>
                    </View>
                  </Button>
                  <Button variant="destructive" onPress={() => setConfirmDelete(true)} disabled={busy}>
                    <View style={styles.btnInner}>
                      <Trash2 size={16} color={Colors.white} />
                      <Text style={styles.btnLabel}>Delete Account</Text>
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

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setEditOpen(false)}>
          <Pressable style={[styles.dialog, Shadows.xl, { maxHeight: '85%' }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dialogHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dialogTitle}>Edit {selected?.name}</Text>
                <Text style={styles.dialogSub}>Saved to the account itself, so every screen shows the change.</Text>
              </View>
              <Pressable onPress={() => !busy && setEditOpen(false)} hitSlop={8} accessibilityLabel="Close">
                <X size={20} color={Colors.gray500} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {EDIT_FIELDS.map((f) => (
                <Input
                  key={f.key}
                  label={f.label}
                  value={editForm[f.key] ?? ''}
                  onChangeText={(v) => setEditForm((prev) => ({ ...prev, [f.key]: v }))}
                  autoCapitalize={f.key === 'email' ? 'none' : 'words'}
                  keyboardType={f.key === 'email' ? 'email-address' : f.key === 'phoneNumber' ? 'phone-pad' : 'default'}
                  containerStyle={{ marginTop: 10 }}
                />
              ))}
              {editError ? <Text style={styles.rejectionNote}>{editError}</Text> : null}
              <View style={styles.footer}>
                <Button variant="outline" onPress={() => setEditOpen(false)} style={{ flex: 1 }} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  onPress={() =>
                    setPendingAction({
                      title: 'Save these changes?',
                      description: `Save the edited details for ${selected?.name}? Every screen will show the change.`,
                      run: handleEditSave,
                    })
                  }
                  style={{ flex: 1 }}
                  loading={busy}
                >
                  Save
                </Button>
              </View>
            </ScrollView>
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
                onPress={() =>
                  setPendingAction({
                    title: 'Reset this password?',
                    description: `Set a new password for ${selected?.name}? They'll be signed out everywhere immediately.`,
                    run: handleSetPassword,
                  })
                }
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
        open={!!pendingAction}
        onOpenChange={(next) => {
          if (!next) setPendingAction(null);
        }}
        title={pendingAction?.title || ''}
        description={pendingAction?.description || ''}
        confirmLabel="Confirm"
        loading={busy}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          action?.run();
        }}
      />

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

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${selected?.name}?`}
        description="Permanently removes this account. Unlike Deactivate, this cannot be undone -- it frees their email and name for a new signup. Use this only if you actually want them gone, not just blocked."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={handleDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 100, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  viewSwitch: { flexDirection: 'row', borderWidth: 1, borderColor: Colors.gray200, borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.white },
  viewSwitchBtn: { width: 38, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  viewSwitchBtnActive: { backgroundColor: '#EAF0FF' },
  tableScroll: { borderWidth: 1, borderColor: Colors.gray200, borderRadius: Radius.lg, backgroundColor: Colors.white },
  // flexGrow lets the table fill the viewport when it fits; the inner view's
  // own minWidth is what forces a scroll when it doesn't.
  tableScrollContent: { flexGrow: 1 },
  tableInner: { flex: 1 },
  tableHeaderRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.gray50, borderBottomWidth: 1, borderBottomColor: Colors.gray200, paddingVertical: 10, paddingHorizontal: 8 },
  tableHeadCell: { fontSize: 11, fontWeight: '800', color: Colors.gray600, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 6 },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.gray100, paddingVertical: 10, paddingHorizontal: 8 },
  tableRowHover: { backgroundColor: Colors.gray50 },
  tableCell: { paddingHorizontal: 6, justifyContent: 'center' },
  tableCellStrong: { fontSize: 13, fontWeight: '700', color: Colors.gray900, paddingHorizontal: 6 },
  tableCellText: { fontSize: 12.5, color: Colors.gray700, paddingHorizontal: 6 },
  tableCellMuted: { fontSize: 11, color: Colors.gray500, paddingHorizontal: 6, marginTop: 1 },
  title: { fontSize: 20, fontWeight: '900', color: Colors.gray900 },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 2 },
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
  requestNote: { fontSize: 12.5, fontWeight: '700', color: Colors.blue700, marginTop: 8 },
  rejectionNote: { fontSize: 12.5, color: Colors.red700, marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 },
  btnLabel: { color: Colors.white, fontWeight: '700', fontSize: 13.5, flexShrink: 1 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 20 },
});
