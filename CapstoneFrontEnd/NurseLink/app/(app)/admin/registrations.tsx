import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Modal } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Search, X, Trash2, Sparkles } from 'lucide-react-native';
import {
  fetchAdminRegistrationSessions,
  fetchAdminRegistrationSession,
  deleteAdminRegistrationSession,
  clearAbandonedRegistrationSessions,
  ApiError,
} from '../../../services/api';
import type { AdminRegistrationSession } from '../../../types/domain';
import { Input } from '../../../components/Input';
import { Badge } from '../../../components/Badge';
import { Tabs, type TabItem } from '../../../components/Tabs';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useToast } from '../../../contexts/ToastContext';
import { Colors, Shadows, Radius } from '../../../constants/colors';
import { Pagination, usePagination } from '../../../components/Pagination';
import { formatDateTime12 } from '../../../utils/time';
import { PrintButton } from '../../../components/admin/PrintButton';
import { printReport, type PrintField } from '../../../utils/print';
import { useAuth } from '../../../contexts/AuthContext';

// Matches the backend's clear-abandoned filter exactly (RegistrationSessionViewSet.clear_abandoned)
// — used here only to show a live count before the admin commits to it.
function isAbandoned(s: AdminRegistrationSession): boolean {
  return !s.email && !s.isVerified && !s.otpVerified && !s.userId;
}

/** "First Middle Last" as entered at sign-up, else the email. */
function displayName(s: AdminRegistrationSession): string {
  return (
    s.fullName
    || [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ')
    || s.email
    || 'Unknown'
  );
}

function formatRole(role: string): string {
  if (!role) return '—';
  return role === 'head_nurse' ? 'Head Nurse' : role === 'staff_nurse' ? 'Staff Nurse' : role.replace('_', ' ');
}

const VERIFIED_TABS: TabItem[] = [
  { value: 'all', label: 'All' },
  { value: 'true', label: 'Verified' },
  { value: 'false', label: 'Unverified' },
];

function formatDateTime(iso: string): string {
  return formatDateTime12(iso) || '—';
}

export default function AdminRegistrationsPage() {
  const toast = useToast();
  const [sessions, setSessions] = useState<AdminRegistrationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('all');
  const [selected, setSelected] = useState<AdminRegistrationSession | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { user: currentUser } = useAuth();

  // Opening a registration re-reads it through the server, which logs the view.
  const openSession = async (session: AdminRegistrationSession) => {
    setSelected(session);
    try {
      setSelected(await fetchAdminRegistrationSession(session.id));
    } catch (err) {
      setSelected(null);
      toast.error('Could not open this registration', {
        description: err instanceof ApiError ? err.message : 'Please try again.',
      });
    }
  };

  const regFields = (s: AdminRegistrationSession): PrintField[] => [
    { label: 'Name', value: displayName(s) },
    { label: 'Email', value: s.email || s.userEmail || '—' },
    { label: 'Phone', value: s.phone || '—' },
    { label: 'Requested role', value: s.requestedRole || '—' },
    { label: 'Role', value: s.role || '—' },
    { label: 'Department', value: s.department || '—' },
    { label: 'Verified', value: s.isVerified ? 'Yes' : 'No' },
    { label: 'Verification method', value: s.verificationMethod || '—' },
    { label: 'Approval status', value: s.approvalStatus || '—' },
    { label: 'Started', value: formatDateTime12(s.createdAt) || '—' },
    { label: 'Last updated', value: formatDateTime12(s.updatedAt) || '—' },
  ];

  const load = useCallback(async () => {
    try {
      const data = await fetchAdminRegistrationSessions();
      setSessions(data);
    } catch (err) {
      toast.error('Could not load registrations', {
        description: err instanceof ApiError ? err.message : 'Check your connection and try again.',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Loads on first focus, and again on every return: screens stay mounted
  // when switching admin tabs, so re-fetching here means an
  // account deleted elsewhere (Accounts / Registrations) is gone here too.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (verifiedFilter !== 'all' && String(s.isVerified) !== verifiedFilter) return false;
      if (!q) return true;
      return (
        s.email.toLowerCase().includes(q)
        || displayName(s).toLowerCase().includes(q)
        || (s.phone || '').includes(q)
      );
    });
  }, [sessions, search, verifiedFilter]);

  // 10 per page; Next/Prev jumps back to the top of the list.
  const scrollRef = useRef<ScrollView>(null);
  const paged = usePagination(filtered, { scrollRef, resetKey: `${search}|${verifiedFilter}` });

  const abandonedCount = useMemo(() => sessions.filter(isAbandoned).length, [sessions]);

  const handleDelete = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await deleteAdminRegistrationSession(selected.id);
      // The backend removes every row for this person (same email) plus
      // their account, so drop them all locally and re-sync.
      const email = (selected.email || '').toLowerCase();
      setSessions((prev) =>
        prev.filter((s) => s.id !== selected.id && !(email && s.email.toLowerCase() === email))
      );
      setConfirmDeleteOpen(false);
      setSelected(null);
      toast.success('Registration and account deleted');
      void load();
    } catch (err) {
      toast.error('Could not delete', { description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const handleClearAbandoned = async () => {
    setBusy(true);
    try {
      const { deleted } = await clearAbandonedRegistrationSessions();
      setConfirmClearOpen(false);
      toast.success(`Deleted ${deleted} abandoned session${deleted === 1 ? '' : 's'}`);
      void load();
    } catch (err) {
      toast.error('Could not clear abandoned sessions', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
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
            <Text style={styles.title}>Registrations</Text>
            <Text style={styles.subtitle}>
              Every sign-up and the details the applicant entered — the basis for each Accounts decision.
            </Text>
          </View>
          <PrintButton
            label="Print list"
            disabled={loading}
            onPrint={() =>
              printReport(
                {
                  title: 'Registrations',
                  subtitle: 'Sign-ups and identity verification',
                  printedBy: currentUser?.name,
                  scope: [
                    `Verified: ${verifiedFilter === 'all' ? 'All' : verifiedFilter === 'true' ? 'Verified' : 'Unverified'}${
                      search.trim() ? ` · Search: "${search.trim()}"` : ''
                    }`,
                    `${filtered.length} of ${sessions.length} registrations`,
                  ],
                  columns: [
                    { label: 'Name', value: (s: AdminRegistrationSession) => displayName(s), width: '22%' },
                    { label: 'Email', value: (s: AdminRegistrationSession) => s.email || s.userEmail || '—', width: '26%' },
                    { label: 'Role', value: (s: AdminRegistrationSession) => s.requestedRole || s.role || '—', width: '12%' },
                    { label: 'Verified', value: (s: AdminRegistrationSession) => (s.isVerified ? 'Yes' : 'No'), width: '9%' },
                    { label: 'Status', value: (s: AdminRegistrationSession) => s.approvalStatus || '—', width: '11%' },
                    { label: 'Started', value: (s: AdminRegistrationSession) => formatDateTime12(s.createdAt) },
                  ],
                  rows: filtered,
                },
                { recordType: 'registrations', scope: 'list', filters: { verified: verifiedFilter, search: search.trim() } }
              )
            }
          />
        </View>

        {abandonedCount > 0 ? (
          <Pressable onPress={() => setConfirmClearOpen(true)}>
            <View style={[styles.abandonedCard, Shadows.sm]}>
              <Sparkles size={18} color={Colors.blue600} />
              <Text style={styles.abandonedText}>
                {abandonedCount} abandoned session{abandonedCount === 1 ? '' : 's'} — nobody ever
                finished the first step (no name, no email, no verification).
              </Text>
              <Text style={styles.abandonedAction}>Clear</Text>
            </View>
          </Pressable>
        ) : null}

        <Input
          placeholder="Search by email or name"
          value={search}
          onChangeText={setSearch}
          leftIcon={<Search size={16} color={Colors.gray400} />}
        />
        <Tabs value={verifiedFilter} onValueChange={setVerifiedFilter} tabs={VERIFIED_TABS} />

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={Colors.blue600} />
        ) : filtered.length === 0 ? (
          <Text style={styles.empty}>No registration sessions match.</Text>
        ) : (
          <View style={styles.list}>
            {paged.pageItems.map((session) => (
              <Pressable key={session.id} onPress={() => void openSession(session)}>
                <View style={[styles.row, Shadows.sm]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowName}>{displayName(session)}</Text>
                      {session.isVerified ? (
                        <Badge variant="success">verified</Badge>
                      ) : (
                        <Badge variant="secondary">unverified</Badge>
                      )}
                    </View>
                    <Text style={styles.rowMeta}>
                      {session.email || 'No email yet'}
                      {session.phone ? ` · ${session.phone}` : ''}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {session.userId ? 'Account created' : 'Sign-up not finished'}
                      {' · '}{formatDateTime(session.createdAt)}
                    </Text>
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
          <Pressable style={styles.dialogWrap} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={[styles.dialog, Shadows.xl]}>
            {selected ? (
              <>
                <View style={styles.dialogHeader}>
                  <Text style={styles.dialogTitle}>{displayName(selected)}</Text>
                  <View style={styles.dialogHeaderActions}>
                    <PrintButton
                      compact
                      label="Print registration"
                      onPrint={() =>
                        printReport(
                          {
                            title: `Registration: ${displayName(selected)}`,
                            subtitle: `Registration ID: ${selected.id}`,
                            printedBy: currentUser?.name,
                            fields: regFields(selected),
                          },
                          { recordType: 'registrations', scope: 'detail', recordId: String(selected.id), label: displayName(selected) }
                        )
                      }
                    />
                    <Pressable onPress={() => setConfirmDeleteOpen(true)} hitSlop={8}>
                      <Trash2 size={19} color={Colors.red600} />
                    </Pressable>
                    <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                      <X size={20} color={Colors.gray500} />
                    </Pressable>
                  </View>
                </View>

                {/* Only what the applicant entered at sign-up (never the password). */}
                <View style={styles.detailGrid}>
                  <DetailRow label="First name" value={selected.firstName || '—'} />
                  <DetailRow label="Middle name" value={selected.middleName || '—'} />
                  <DetailRow label="Last name" value={selected.lastName || '—'} />
                  <DetailRow label="Email" value={selected.email || '—'} />
                  <DetailRow label="Phone number" value={selected.phone || '—'} />
                  <DetailRow label="Requested role" value={formatRole(selected.requestedRole)} />
                  <DetailRow label="Email verified" value={selected.otpVerified ? 'Yes' : 'No'} />
                  <DetailRow
                    label="Account status"
                    value={selected.userId ? (selected.approvalStatus || '—') : 'Not yet signed up'}
                  />
                  <DetailRow label="Started" value={formatDateTime(selected.createdAt)} />
                  <DetailRow label="Last updated" value={formatDateTime(selected.updatedAt)} />
                </View>
              </>
            ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this registration?"
        description="Removes this sign-up and the person's account (it disappears from Accounts too). Their email can be used to sign up again. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title={`Delete ${abandonedCount} abandoned session${abandonedCount === 1 ? '' : 's'}?`}
        description="Only sessions with no name, no email, and no verification progress are removed — anything with real progress or a linked account is left alone."
        confirmLabel="Clear"
        destructive
        loading={busy}
        onConfirm={handleClearAbandoned}
      />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 100, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  title: { fontSize: 20, fontWeight: '900', color: Colors.gray900 },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: -6 },
  abandonedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
    borderRadius: Radius.lg,
    padding: 14,
  },
  abandonedText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: Colors.blue800, lineHeight: 17 },
  abandonedAction: { fontSize: 13, fontWeight: '800', color: Colors.blue700 },
  empty: { textAlign: 'center', color: Colors.mutedForeground, marginTop: 16, fontSize: 13 },
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
  dialogWrap: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
  },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
  },
  dialogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dialogHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: Colors.gray900, flex: 1, marginRight: 8 },
  detailGrid: { marginTop: 14, gap: 10 },
  detailItem: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontSize: 12.5, color: Colors.mutedForeground, flexShrink: 0 },
  detailValue: { fontSize: 12.5, color: Colors.foreground, fontWeight: '600', flex: 1, textAlign: 'right' },
});
