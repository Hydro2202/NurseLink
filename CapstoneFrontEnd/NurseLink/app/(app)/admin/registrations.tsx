import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Modal } from 'react-native';
import { Search, X, CheckCircle2, XCircle, Trash2, Sparkles } from 'lucide-react-native';
import {
  fetchAdminRegistrationSessions,
  fetchAdminFaceVerificationAttempts,
  deleteAdminRegistrationSession,
  clearAbandonedRegistrationSessions,
  ApiError,
} from '../../../services/api';
import type { AdminRegistrationSession, AdminFaceVerificationAttempt } from '../../../types/domain';
import { Input } from '../../../components/Input';
import { Badge } from '../../../components/Badge';
import { Tabs, type TabItem } from '../../../components/Tabs';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useToast } from '../../../contexts/ToastContext';
import { Colors, Shadows, Radius } from '../../../constants/colors';

// Matches the backend's clear-abandoned filter exactly (RegistrationSessionViewSet.clear_abandoned)
// — used here only to show a live count before the admin commits to it.
function isAbandoned(s: AdminRegistrationSession): boolean {
  return (
    !s.email && !s.idFirstName && !s.idLastName
    && !s.faceVerified && !s.otpVerified && !s.userId
  );
}

const VERIFIED_TABS: TabItem[] = [
  { value: 'all', label: 'All' },
  { value: 'true', label: 'Verified' },
  { value: 'false', label: 'Unverified' },
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminRegistrationsPage() {
  const toast = useToast();
  const [sessions, setSessions] = useState<AdminRegistrationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('all');
  const [selected, setSelected] = useState<AdminRegistrationSession | null>(null);
  const [attempts, setAttempts] = useState<AdminFaceVerificationAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    (() => {
      if (!selected) {
        setAttempts([]);
        return;
      }
      setAttemptsLoading(true);
      fetchAdminFaceVerificationAttempts(selected.sessionId)
        .then(setAttempts)
        .catch(() => setAttempts([]))
        .finally(() => setAttemptsLoading(false));
    })();
  }, [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (verifiedFilter !== 'all' && String(s.isVerified) !== verifiedFilter) return false;
      if (!q) return true;
      return (
        s.email.toLowerCase().includes(q)
        || s.idFirstName.toLowerCase().includes(q)
        || s.idLastName.toLowerCase().includes(q)
        || s.prcFullName.toLowerCase().includes(q)
      );
    });
  }, [sessions, search, verifiedFilter]);

  const abandonedCount = useMemo(() => sessions.filter(isAbandoned).length, [sessions]);

  const handleDelete = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await deleteAdminRegistrationSession(selected.id);
      setSessions((prev) => prev.filter((s) => s.id !== selected.id));
      setConfirmDeleteOpen(false);
      setSelected(null);
      toast.success('Registration session deleted');
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
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Registrations</Text>
        <Text style={styles.subtitle}>
          The identity-verification audit trail behind every signup — evidence for each Accounts decision.
        </Text>

        {abandonedCount > 0 ? (
          <Pressable onPress={() => setConfirmClearOpen(true)}>
            <View style={[styles.abandonedCard, Shadows.sm]}>
              <Sparkles size={18} color={Colors.blue600} />
              <Text style={styles.abandonedText}>
                {abandonedCount} abandoned session{abandonedCount === 1 ? '' : 's'} — nobody ever
                finished Step 1 (no name, no email, no verification).
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
            {filtered.map((session) => (
              <Pressable key={session.id} onPress={() => setSelected(session)}>
                <View style={[styles.row, Shadows.sm]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowName}>
                        {session.idFirstName || session.prcFullName || session.email || 'Unknown'}{' '}
                        {session.idLastName}
                      </Text>
                      {session.isVerified ? (
                        <Badge variant="success">verified</Badge>
                      ) : (
                        <Badge variant="secondary">unverified</Badge>
                      )}
                      {session.faceLocked ? <Badge variant="destructive">face locked</Badge> : null}
                    </View>
                    <Text style={styles.rowMeta}>{session.email || 'No email yet'}</Text>
                    <Text style={styles.rowMeta}>
                      {session.faceAttempts} face attempt{session.faceAttempts === 1 ? '' : 's'}
                      {session.verificationMethod ? ` · via ${session.verificationMethod}` : ''}
                      {' · '}{formatDateTime(session.createdAt)}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.dialogWrap} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={[styles.dialog, Shadows.xl]}>
            {selected ? (
              <>
                <View style={styles.dialogHeader}>
                  <Text style={styles.dialogTitle}>
                    {selected.idFirstName || selected.email} {selected.idLastName}
                  </Text>
                  <View style={styles.dialogHeaderActions}>
                    <Pressable onPress={() => setConfirmDeleteOpen(true)} hitSlop={8}>
                      <Trash2 size={19} color={Colors.red600} />
                    </Pressable>
                    <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                      <X size={20} color={Colors.gray500} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.detailGrid}>
                  <DetailRow label="Email" value={selected.email || '—'} />
                  <DetailRow label="Verification method" value={selected.verificationMethod || '—'} />
                  <DetailRow label="Face verified" value={selected.faceVerified ? 'Yes' : 'No'} />
                  <DetailRow label="Face attempts" value={String(selected.faceAttempts)} />
                  <DetailRow label="Face locked" value={selected.faceLocked ? 'Yes' : 'No'} />
                  <DetailRow label="OTP verified" value={selected.otpVerified ? 'Yes' : 'No'} />
                  <DetailRow label="ID name" value={`${selected.idFirstName} ${selected.idMiddleName} ${selected.idLastName}`.trim() || '—'} />
                  <DetailRow label="ID registration #" value={selected.idRegistrationNo || '—'} />
                  <DetailRow label="ID verification status" value={selected.idVerificationStatus || '—'} />
                  <DetailRow label="Linked account" value={selected.userEmail || 'Not yet signed up'} />
                  <DetailRow label="Started" value={formatDateTime(selected.createdAt)} />
                  <DetailRow label="Last updated" value={formatDateTime(selected.updatedAt)} />
                </View>

                <Text style={styles.attemptsHeading}>Face verification attempts</Text>
                {attemptsLoading ? (
                  <ActivityIndicator color={Colors.blue600} style={{ marginTop: 8 }} />
                ) : attempts.length === 0 ? (
                  <Text style={styles.empty}>No face attempts recorded.</Text>
                ) : (
                  <View style={{ gap: 8 }}>
                    {attempts.map((a) => (
                      <View key={a.id} style={styles.attemptRow}>
                        {a.matched ? (
                          <CheckCircle2 size={16} color={Colors.green600} />
                        ) : (
                          <XCircle size={16} color={Colors.red600} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.attemptText}>
                            {a.matched ? 'Match' : a.reasonLabel || 'No match'}
                            {a.confidence ? ` · ${Math.round(a.confidence * 100)}% confidence` : ''}
                          </Text>
                          <Text style={styles.attemptMeta}>
                            {formatDateTime(a.createdAt)}{a.countable ? '' : ' · not counted'}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this registration session?"
        description="Removes the identity-verification audit trail and its face-attempt history. If this session already has a signed-up account, the account itself is not affected."
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
  attemptsHeading: { fontSize: 13, fontWeight: '800', color: Colors.gray500, marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  attemptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.gray50,
    borderRadius: Radius.md,
    padding: 10,
  },
  attemptText: { fontSize: 12.5, fontWeight: '700', color: Colors.foreground },
  attemptMeta: { fontSize: 11, color: Colors.mutedForeground, marginTop: 2 },
});
