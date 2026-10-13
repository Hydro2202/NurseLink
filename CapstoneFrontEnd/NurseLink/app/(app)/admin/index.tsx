import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ShieldCheck,
  IdCard,
  Users,
  ClipboardList,
  FileText,
  ArrowLeftRight,
  BookOpen,
  Calendar,
  Stethoscope,
  Building2,
  HeartPulse,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react-native';
import { useAuth } from '../../../contexts/AuthContext';
import { useLiveRefresh } from '../../../contexts/LiveContext';
import { fetchAdminAccounts, fetchPatients } from '../../../services/api';
import { Card, CardContent } from '../../../components/Card';
import { Colors, Shadows, Radius } from '../../../constants/colors';

interface SectionLink {
  key: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  href: string;
}

// Mirrors the Django admin index's grouped list (Charting notes, Departments,
// Doctors, Duty assignments, Referral notes, Kardex records, Patients,
// Task handovers, Tasks, Vital signs...) as tappable cards. Accounts and
// Registrations get their own dedicated screens (real workflows, not just a
// browse view); everything else routes through the generic read-only
// browser at admin/[section].
const SECTIONS: SectionLink[] = [
  { key: 'patients', name: 'Patients', description: 'Every admitted, observed, and discharged patient.', icon: Users, href: '/(app)/admin/patients' },
  { key: 'tasks', name: 'Tasks', description: 'Every care task across every nurse.', icon: ClipboardList, href: '/(app)/admin/tasks' },
  { key: 'handovers', name: 'Referral Notes', description: 'SBAR patient referrals between nurses.', icon: FileText, href: '/(app)/admin/handovers' },
  { key: 'task-handovers', name: 'Task Handovers', description: 'Shift-to-shift task handoffs.', icon: ArrowLeftRight, href: '/(app)/admin/task-handovers' },
  { key: 'charting', name: 'Charting Notes', description: 'Nursing notes and auto-charted entries.', icon: FileText, href: '/(app)/admin/charting' },
  { key: 'duty', name: 'Duty Assignments', description: 'The full shift roster, every department.', icon: Calendar, href: '/(app)/admin/duty' },
  { key: 'kardex', name: 'Kardex Records', description: 'Admission kardex submissions and reviews.', icon: BookOpen, href: '/(app)/admin/kardex' },
  { key: 'vitals', name: 'Vital Signs', description: 'Recorded vitals history.', icon: HeartPulse, href: '/(app)/admin/vitals' },
  { key: 'doctors', name: 'Doctors', description: 'Manage the hospital doctor directory.', icon: Stethoscope, href: '/(app)/admin/doctors' },
  { key: 'departments', name: 'Departments', description: 'Reference list of hospital departments.', icon: Building2, href: '/(app)/admin/departments' },
];

export default function AdminIndexPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [totalAccounts, setTotalAccounts] = useState<number | null>(null);
  const [totalPatients, setTotalPatients] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [accounts, patients] = await Promise.all([fetchAdminAccounts(), fetchPatients()]);
      setTotalAccounts(accounts.length);
      setPendingCount(accounts.filter((a) => a.approvalStatus === 'pending').length);
      setTotalPatients(patients.length);
    } catch {
      // Non-critical stat — the section grid below still works without it.
    }
  }, []);

  // Loads on first focus, and again on every return: screens stay mounted
  // when switching admin tabs, so re-fetching here means an
  // account deleted elsewhere (Accounts / Registrations) is gone here too.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // A new signup notifies every admin (see notify_admin_new_registration on
  // the backend) — that notification moving the shared 'notifications'
  // revision is what makes this count catch up without a manual refresh.
  useLiveRefresh('notifications', () => {
    void load();
  });

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <View style={styles.headerIconWrap}>
          <ShieldCheck size={28} color={Colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Admin Console</Text>
          <Text style={styles.subtitle}>Signed in as {user?.name} · {user?.email}</Text>
        </View>
      </View>

      {pendingCount !== null && pendingCount > 0 ? (
        <Pressable onPress={() => router.push('/(app)/admin/accounts?status=pending' as any)}>
          <View style={[styles.alertCard, Shadows.sm]}>
            <AlertTriangle size={20} color={Colors.orange700} />
            <Text style={styles.alertText}>
              {pendingCount} account{pendingCount === 1 ? '' : 's'} waiting for approval
            </Text>
            <ChevronRight size={18} color={Colors.orange700} />
          </View>
        </Pressable>
      ) : null}

      <View style={styles.statRow}>
        <Card style={styles.statCard}>
          <CardContent style={styles.statContent}>
            <Text style={styles.statValue}>{totalAccounts ?? '—'}</Text>
            <Text style={styles.statLabel}>Nurse &amp; head nurse accounts</Text>
          </CardContent>
        </Card>
        <Card style={styles.statCard}>
          <CardContent style={styles.statContent}>
            <Text style={styles.statValue}>{pendingCount ?? '—'}</Text>
            <Text style={styles.statLabel}>Pending approval</Text>
          </CardContent>
        </Card>
        <Card style={styles.statCard}>
          <CardContent style={styles.statContent}>
            <Text style={styles.statValue}>{totalPatients ?? '—'}</Text>
            <Text style={styles.statLabel}>Total Patients</Text>
          </CardContent>
        </Card>
      </View>

      <Pressable onPress={() => router.push('/(app)/admin/accounts' as any)}>
        <View style={[styles.wideLink, Shadows.sm]}>
          <ShieldCheck size={20} color={Colors.blue600} />
          <View style={{ flex: 1 }}>
            <Text style={styles.wideLinkTitle}>Accounts</Text>
            <Text style={styles.wideLinkDesc}>Approve, reject, deactivate, or reset a password.</Text>
          </View>
          <ChevronRight size={18} color={Colors.gray400} />
        </View>
      </Pressable>
      <Pressable onPress={() => router.push('/(app)/admin/registrations' as any)}>
        <View style={[styles.wideLink, Shadows.sm]}>
          <IdCard size={20} color={Colors.blue600} />
          <View style={{ flex: 1 }}>
            <Text style={styles.wideLinkTitle}>Registrations</Text>
            <Text style={styles.wideLinkDesc}>Identity verification history behind every signup.</Text>
          </View>
          <ChevronRight size={18} color={Colors.gray400} />
        </View>
      </Pressable>

      <Text style={styles.sectionHeading}>Hospital Records</Text>
      <View style={styles.grid}>
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Pressable
              key={section.key}
              style={styles.gridItem}
              onPress={() => router.push(section.href as any)}
            >
              <View style={[styles.gridCard, Shadows.sm]}>
                <View style={styles.gridIconWrap}>
                  <Icon size={20} color={Colors.blue600} />
                </View>
                <Text style={styles.gridTitle}>{section.name}</Text>
                <Text style={styles.gridDesc} numberOfLines={2}>{section.description}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 100, gap: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.blue600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '900', color: Colors.gray900 },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 2 },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.orange50,
    borderWidth: 1,
    borderColor: Colors.orange300,
    borderRadius: Radius.lg,
    padding: 14,
  },
  alertText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: Colors.orange700 },
  statRow: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1 },
  statContent: { alignItems: 'center', gap: 4, paddingVertical: 18 },
  statValue: { fontSize: 26, fontWeight: '900', color: Colors.gray900 },
  statLabel: { fontSize: 11.5, color: Colors.mutedForeground, textAlign: 'center' },
  wideLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  wideLinkTitle: { fontSize: 14.5, fontWeight: '800', color: Colors.gray900 },
  wideLinkDesc: { fontSize: 12, color: Colors.mutedForeground, marginTop: 2 },
  sectionHeading: { fontSize: 13, fontWeight: '800', color: Colors.gray500, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { width: '47%', minWidth: 150 },
  gridCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 6,
    minHeight: 108,
  },
  gridIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.blue50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTitle: { fontSize: 13.5, fontWeight: '800', color: Colors.gray900 },
  gridDesc: { fontSize: 11.5, color: Colors.mutedForeground, lineHeight: 15 },
});
