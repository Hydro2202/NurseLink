import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Modal } from 'react-native';
import { Eye, History, Pencil, Printer, Search, ShieldCheck, X } from 'lucide-react-native';
import {
  fetchAdminAuditEntry,
  fetchAdminAuditPage,
  ApiError,
  type AdminAuditCategory,
  type AdminAuditEntry,
  type AdminAuditQuery,
} from '../../../services/api';
import { Input } from '../../../components/Input';
import { Select } from '../../../components/Select';
import { Tabs, type TabItem } from '../../../components/Tabs';
import { DatePicker } from '../../../components/DatePicker';
import { Badge } from '../../../components/Badge';
import { Pagination } from '../../../components/Pagination';
import { PrintButton } from '../../../components/admin/PrintButton';
import { printReport } from '../../../utils/print';
import { formatDateTime12 } from '../../../utils/time';
import { useAuth } from '../../../contexts/AuthContext';
import { Colors, Radius, Shadows } from '../../../constants/colors';

const PAGE_SIZE = 20;

const CATEGORY_TABS: TabItem[] = [
  { value: 'all', label: 'All' },
  { value: 'view', label: 'Views' },
  { value: 'change', label: 'Changes' },
  { value: 'decision', label: 'Account decisions' },
  { value: 'print', label: 'Prints' },
];

const ACTION_OPTIONS = [
  { value: 'all', label: 'Any action' },
  { value: 'view', label: 'Viewed' },
  { value: 'create', label: 'Created' },
  { value: 'update', label: 'Updated' },
  { value: 'delete', label: 'Deleted' },
  { value: 'approve', label: 'Approved' },
  { value: 'reject', label: 'Rejected' },
  { value: 'deactivate', label: 'Deactivated' },
  { value: 'reactivate', label: 'Reactivated' },
  { value: 'role_change', label: 'Changed role' },
  { value: 'password_reset', label: 'Reset password' },
  { value: 'unlock', label: 'Unlocked' },
  { value: 'print', label: 'Print requested' },
];

const RECORD_TYPES: { value: string; label: string }[] = [
  { value: 'all', label: 'Any record type' },
  { value: 'patients', label: 'Patients' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'handovers', label: 'Endorsements' },
  { value: 'task-handovers', label: 'Task handovers' },
  { value: 'charting', label: 'Charting' },
  { value: 'duty', label: 'Duty assignments' },
  { value: 'kardex', label: 'Kardex' },
  { value: 'vitals', label: 'Vital signs' },
  { value: 'departments', label: 'Departments' },
  { value: 'doctors', label: 'Doctors' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'registrations', label: 'Registrations' },
  { value: 'corrections', label: 'Identity corrections' },
];

const TYPE_LABEL = Object.fromEntries(RECORD_TYPES.map((t) => [t.value, t.label]));

const CATEGORY_STYLE: Record<AdminAuditCategory, { color: string; variant: 'info' | 'warning' | 'success' | 'secondary' }> = {
  view: { color: Colors.blue600, variant: 'info' },
  change: { color: Colors.orange600, variant: 'warning' },
  decision: { color: Colors.green600, variant: 'success' },
  print: { color: Colors.gray600, variant: 'secondary' },
};

function CategoryIcon({ category }: { category?: AdminAuditCategory }) {
  const color = CATEGORY_STYLE[category || 'change'].color;
  if (category === 'view') return <Eye size={16} color={color} />;
  if (category === 'decision') return <ShieldCheck size={16} color={color} />;
  if (category === 'print') return <Printer size={16} color={color} />;
  return <Pencil size={16} color={color} />;
}

function changeText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Administrator activity history: every record an admin viewed, changed,
 * approved, rejected or printed, as recorded by the server. Read-only.
 */
export default function AdminAuditLogPage() {
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [actor, setActor] = useState('');
  const [debouncedActor, setDebouncedActor] = useState('');
  const [category, setCategory] = useState('all');
  const [action, setAction] = useState('all');
  const [recordType, setRecordType] = useState('all');
  const [recordId, setRecordId] = useState('');
  const [debouncedRecordId, setDebouncedRecordId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminAuditEntry[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AdminAuditEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedActor(actor.trim());
      setDebouncedRecordId(recordId.trim());
    }, 300);
    return () => clearTimeout(id);
  }, [actor, recordId]);

  const query: AdminAuditQuery = {
    actor: debouncedActor || undefined,
    category: category !== 'all' ? category : undefined,
    action: action !== 'all' ? action : undefined,
    recordType: recordType !== 'all' ? recordType : undefined,
    recordId: debouncedRecordId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    order,
  };
  const queryKey = JSON.stringify(query);

  // A new filter starts again at page 1 (render-time reset, no extra effect).
  const [lastKey, setLastKey] = useState(queryKey);
  if (lastKey !== queryKey) {
    setLastKey(queryKey);
    setPage(1);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAdminAuditPage({ ...JSON.parse(queryKey), page, pageSize: PAGE_SIZE });
      setRows(data.results);
      setCount(data.count);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [queryKey, page]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const changePage = (next: number) => {
    setPage(next);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const openEntry = async (entry: AdminAuditEntry) => {
    setSelected(entry);
    setDetailLoading(true);
    try {
      setSelected(await fetchAdminAuditEntry(entry.id));
    } catch {
      // Keep the summary row; the change details just won't show.
    } finally {
      setDetailLoading(false);
    }
  };

  const scopeLines = () => {
    const parts: string[] = [];
    if (debouncedActor) parts.push(`Administrator: "${debouncedActor}"`);
    if (category !== 'all') parts.push(`Category: ${CATEGORY_TABS.find((t) => t.value === category)?.label}`);
    if (action !== 'all') parts.push(`Action: ${ACTION_OPTIONS.find((a) => a.value === action)?.label}`);
    if (recordType !== 'all') parts.push(`Record type: ${TYPE_LABEL[recordType]}`);
    if (debouncedRecordId) parts.push(`Record: "${debouncedRecordId}"`);
    if (dateFrom || dateTo) parts.push(`Dates: ${dateFrom || 'start'} to ${dateTo || 'today'}`);
    return [parts.length ? `Filters: ${parts.join(' · ')}` : 'Filters: none (all activity)', `Order: ${order} first`];
  };

  // Prints every matching entry, not just the page on screen.
  const printLog = async () => {
    const all = await fetchAdminAuditPage({ ...query, all: true });
    await printReport(
      {
        title: 'Administrator Audit Log',
        subtitle: 'Records viewed, changed, approved, rejected or printed by administrators',
        printedBy: user?.name,
        scope: [...scopeLines(), `${all.results.length} of ${all.count} entries`],
        columns: [
          { label: 'Date & time', value: (e: AdminAuditEntry) => formatDateTime12(e.createdAt), width: '17%' },
          { label: 'Administrator', value: (e: AdminAuditEntry) => e.actorName || '—', width: '14%' },
          { label: 'Action', value: (e: AdminAuditEntry) => e.actionLabel || e.action, width: '15%' },
          {
            label: 'Record',
            value: (e: AdminAuditEntry) =>
              `${TYPE_LABEL[e.recordType] || e.recordType}${e.recordId ? ` #${e.recordId}` : ''}${e.recordLabel ? `\n${e.recordLabel}` : ''}`,
            width: '24%',
          },
          { label: 'Details', value: (e: AdminAuditEntry) => e.summary || '' },
        ],
        rows: all.results,
      },
      { recordType: 'audit-log', scope: 'list', filters: { ...query } }
    );
    void load();
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <View style={styles.root}>
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <View style={styles.flex1}>
            <Text style={styles.title}>Audit Log</Text>
            <Text style={styles.subtitle}>
              Administrator activity recorded by the server: records viewed, changes, account decisions and print
              requests.
            </Text>
          </View>
          <PrintButton label="Print log" onPrint={printLog} disabled={loading || !!error} />
        </View>

        <Tabs value={category} onValueChange={setCategory} tabs={CATEGORY_TABS} />
        <Input
          placeholder="Search by administrator"
          value={actor}
          onChangeText={setActor}
          leftIcon={<Search size={16} color={Colors.gray400} />}
        />
        <View style={styles.filterRow}>
          <Select value={action} onValueChange={setAction} options={ACTION_OPTIONS} style={styles.filter} />
          <Select value={recordType} onValueChange={setRecordType} options={RECORD_TYPES} style={styles.filter} />
          <Select
            value={order}
            onValueChange={(v) => setOrder(v as 'newest' | 'oldest')}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
            ]}
            style={styles.filter}
          />
        </View>
        <View style={styles.filterRow}>
          <Input
            placeholder="Record ID or name (e.g. P001)"
            value={recordId}
            onChangeText={setRecordId}
            containerStyle={styles.filter}
          />
          <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="From date" maxDate={dateTo || undefined} style={styles.filter} />
          <DatePicker value={dateTo} onChange={setDateTo} placeholder="To date" minDate={dateFrom || undefined} style={styles.filter} />
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={Colors.blue600} />
        ) : error ? (
          <View style={styles.stateBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void load()}>
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.stateBox}>
            <History size={26} color={Colors.gray300} />
            <Text style={styles.empty}>No administrator activity matches these filters.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={styles.count}>
              {count} entr{count === 1 ? 'y' : 'ies'}
            </Text>
            {rows.map((entry) => (
              <Pressable key={entry.id} onPress={() => void openEntry(entry)} accessibilityRole="button">
                <View style={[styles.row, Shadows.sm]}>
                  <View style={styles.iconWrap}>
                    <CategoryIcon category={entry.category} />
                  </View>
                  <View style={styles.flex1}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {entry.summary || `${entry.actionLabel || entry.action} ${TYPE_LABEL[entry.recordType] || entry.recordType}`}
                      </Text>
                      <Badge variant={CATEGORY_STYLE[entry.category || 'change'].variant}>
                        {entry.actionLabel || entry.action}
                      </Badge>
                    </View>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {TYPE_LABEL[entry.recordType] || entry.recordType}
                      {entry.recordId ? ` #${entry.recordId}` : ''}
                      {entry.recordLabel ? ` · ${entry.recordLabel}` : ''}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {entry.actorName || 'Unknown'} · {formatDateTime12(entry.createdAt)}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={changePage} total={count} pageSize={PAGE_SIZE} />
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
            {selected ? (
              <>
                <View style={styles.dialogHeader}>
                  <Text style={styles.dialogTitle}>{selected.summary || selected.actionLabel || selected.action}</Text>
                  <Pressable onPress={() => setSelected(null)} hitSlop={8} accessibilityLabel="Close">
                    <X size={20} color={Colors.gray500} />
                  </Pressable>
                </View>
                <ScrollView style={styles.dialogBody}>
                  {[
                    ['Event ID', String(selected.id)],
                    ['When', formatDateTime12(selected.createdAt)],
                    ['Administrator', `${selected.actorName || '—'}${selected.actorRole ? ` (${selected.actorRole})` : ''}`],
                    ['Action', selected.actionLabel || selected.action],
                    ['Record type', TYPE_LABEL[selected.recordType] || selected.recordType],
                    ['Record ID', selected.recordId || '—'],
                    ['Record', selected.recordLabel || '—'],
                    ['Result', selected.status || 'success'],
                    ['Request ID', selected.requestId || '—'],
                  ].map(([label, value]) => (
                    <View key={label} style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{label}</Text>
                      <Text style={styles.detailValue}>{value}</Text>
                    </View>
                  ))}
                  {detailLoading ? <ActivityIndicator style={{ marginTop: 10 }} color={Colors.blue600} /> : null}
                  {selected.changes && Object.keys(selected.changes).length ? (
                    <View style={styles.changes}>
                      <Text style={styles.changesTitle}>
                        {selected.action === 'update' || selected.action === 'role_change' ? 'Before → after' : 'Details'}
                      </Text>
                      {Object.entries(selected.changes).map(([key, value]) => (
                        <Text key={key} style={styles.changeLine}>
                          <Text style={styles.changeKey}>{key}: </Text>
                          {Array.isArray(value) && value.length === 2
                            ? `${changeText(value[0])} → ${changeText(value[1])}`
                            : changeText(value)}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </ScrollView>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 100, gap: 12 },
  flex1: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  title: { fontSize: 20, fontWeight: '900', color: Colors.gray900 },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 2 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' },
  filter: { flexGrow: 1, flexBasis: 180, minWidth: 160 },
  stateBox: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  errorText: { color: Colors.red700, fontSize: 13 },
  retry: { color: Colors.blue600, fontWeight: '700', fontSize: 13 },
  empty: { color: Colors.mutedForeground, fontSize: 13 },
  count: { fontSize: 12, color: Colors.mutedForeground },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  rowTitle: { fontSize: 14, fontWeight: '700', color: Colors.gray900, flex: 1 },
  rowMeta: { fontSize: 12, color: Colors.mutedForeground, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 20, width: '100%', maxWidth: 560, maxHeight: '85%' },
  dialogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: Colors.gray900, flex: 1 },
  dialogBody: { marginTop: 12, flexGrow: 0 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 5 },
  detailLabel: { fontSize: 12.5, color: Colors.mutedForeground },
  detailValue: { fontSize: 12.5, color: Colors.foreground, fontWeight: '600', flex: 1, textAlign: 'right' },
  changes: { marginTop: 12, backgroundColor: Colors.gray50, borderRadius: Radius.md, padding: 10, gap: 4 },
  changesTitle: { fontSize: 12, fontWeight: '800', color: Colors.gray700, marginBottom: 2 },
  changeLine: { fontSize: 12, color: Colors.gray800 },
  changeKey: { fontWeight: '700' },
});
