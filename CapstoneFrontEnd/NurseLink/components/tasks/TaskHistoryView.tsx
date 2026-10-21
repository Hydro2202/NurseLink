import React, { useCallback, useEffect, useState, type RefObject } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, type ScrollView } from 'react-native';
import { History, Search, UserCheck, CheckCircle2, Pencil, PlusCircle, RefreshCw, UserMinus } from 'lucide-react-native';
import { fetchTaskHistory, ApiError } from '../../services/api';
import { Colors, Radius } from '../../constants/colors';
import type { MyPatientFolder, TaskHistoryEntry } from '../../types/domain';
import { Card, CardContent } from '../Card';
import { Input } from '../Input';
import { Select } from '../Select';
import { DatePicker } from '../DatePicker';
import { Pagination, usePagination } from '../Pagination';
import { TaskStatusBadge, TaskTypeBadge, TASK_STATUS_LABELS, formatDateTime } from './taskLabels';

const EVENT_LABELS: Record<TaskHistoryEntry['event'], string> = {
  created: 'Task created',
  assigned: 'Assigned',
  unassigned: 'Unassigned',
  status_changed: 'Status changed',
  edited: 'Edited',
  completed: 'Completed',
  remarks_amended: 'Remarks corrected',
};

const EVENT_ICONS: Record<TaskHistoryEntry['event'], { icon: typeof History; color: string }> = {
  created: { icon: PlusCircle, color: Colors.blue600 },
  assigned: { icon: UserCheck, color: Colors.indigo600 },
  unassigned: { icon: UserMinus, color: Colors.orange600 },
  status_changed: { icon: RefreshCw, color: Colors.orange600 },
  edited: { icon: Pencil, color: Colors.gray600 },
  completed: { icon: CheckCircle2, color: Colors.green600 },
  remarks_amended: { icon: Pencil, color: Colors.purple600 },
};

function statusLabel(value: string) {
  return TASK_STATUS_LABELS[value as keyof typeof TASK_STATUS_LABELS] || value;
}

function describe(entry: TaskHistoryEntry): string {
  const details = entry.details || {};
  switch (entry.event) {
    case 'assigned':
      return `Assigned to ${String(details.assignedTo || '—')}${
        details.previousAssignee ? ` (was ${String(details.previousAssignee)})` : ''
      }`;
    case 'unassigned':
      return `Removed from ${String(details.previousAssignee || 'the nurse')}`;
    case 'status_changed':
      return `${statusLabel(entry.fromStatus)} → ${statusLabel(entry.toStatus)}${details.reopened ? ' (reopened)' : ''}`;
    case 'edited':
      return `Changed: ${Array.isArray(details.fields) ? (details.fields as string[]).join(', ') : 'details'}`;
    case 'created':
      return details.source ? `From ${String(details.source)}` : entry.source === 'task_record' ? 'Recorded on the task' : '';
    default:
      return '';
  }
}

interface Props {
  scrollRef: RefObject<ScrollView | null>;
  patients: MyPatientFolder[];
  /** Head nurses can widen the history to every nurse's tasks. */
  canViewAllNurses: boolean;
  /** Bumped by the page after a completion so this view refetches. */
  refreshKey: number;
}

/**
 * Read-only history of the tasks this user can access: what happened, when,
 * by whom, and the remarks written at completion (with corrections shown
 * next to the version they replaced).
 */
export function TaskHistoryView({ scrollRef, patients, canViewAllNurses, refreshKey }: Props) {
  const [rows, setRows] = useState<TaskHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [patientId, setPatientId] = useState('all');
  const [taskType, setTaskType] = useState('all');
  const [status, setStatus] = useState('all');
  const [event, setEvent] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTaskHistory({
        mine: scope === 'mine',
        patientId: patientId !== 'all' ? patientId : undefined,
        taskType: taskType !== 'all' ? taskType : undefined,
        status: status !== 'all' ? status : undefined,
        event: event !== 'all' ? event : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        q: debouncedQuery || undefined,
      });
      setRows(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the task history.');
    } finally {
      setLoading(false);
    }
  }, [scope, patientId, taskType, status, event, dateFrom, dateTo, debouncedQuery]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, refreshKey]);

  const paged = usePagination(rows, {
    scrollRef,
    resetKey: `${scope}|${patientId}|${taskType}|${status}|${event}|${dateFrom}|${dateTo}|${debouncedQuery}`,
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.filters}>
        <Input
          placeholder="Search task, patient, remarks or nurse…"
          value={query}
          onChangeText={setQuery}
          leftIcon={<Search size={18} color={Colors.gray500} />}
        />
        <View style={styles.filterRow}>
          <Select
            value={patientId}
            onValueChange={setPatientId}
            options={[
              { label: 'All patients', value: 'all' },
              ...patients.map((p) => ({ label: `${p.name} · ${p.room}`, value: p.patientId })),
            ]}
            searchable
            style={styles.filter}
          />
          <Select
            value={taskType}
            onValueChange={setTaskType}
            options={[
              { label: 'All types', value: 'all' },
              { label: 'Procedure', value: 'procedure' },
              { label: 'Endorsement', value: 'referral' },
            ]}
            style={styles.filter}
          />
          <Select
            value={status}
            onValueChange={setStatus}
            options={[
              { label: 'Any status', value: 'all' },
              { label: 'Pending', value: 'pending' },
              { label: 'In Progress', value: 'in_progress' },
              { label: 'Not yet completed', value: 'overdue' },
              { label: 'Completed', value: 'completed' },
            ]}
            style={styles.filter}
          />
          <Select
            value={event}
            onValueChange={setEvent}
            options={[
              { label: 'All activity', value: 'all' },
              ...Object.entries(EVENT_LABELS).map(([value, label]) => ({ label, value })),
            ]}
            style={styles.filter}
          />
        </View>
        <View style={styles.filterRow}>
          <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="From date" maxDate={dateTo || undefined} style={styles.filter} />
          <DatePicker value={dateTo} onChange={setDateTo} placeholder="To date" minDate={dateFrom || undefined} style={styles.filter} />
          {canViewAllNurses ? (
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as 'mine' | 'all')}
              options={[
                { label: 'My tasks', value: 'mine' },
                { label: 'All nurses', value: 'all' },
              ]}
              style={styles.filter}
            />
          ) : null}
          {dateFrom || dateTo ? (
            <Pressable
              onPress={() => {
                setDateFrom('');
                setDateTo('');
              }}
              style={styles.clearBtn}
            >
              <Text style={styles.clearText}>Clear dates</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.blue600} />
        </View>
      ) : error ? (
        <Card>
          <CardContent style={styles.empty}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void load()} style={styles.clearBtn}>
              <Text style={styles.clearText}>Try again</Text>
            </Pressable>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent style={styles.empty}>
            <History size={28} color={Colors.gray300} />
            <Text style={styles.emptyText}>No task history matches these filters.</Text>
          </CardContent>
        </Card>
      ) : (
        <>
          <Text style={styles.count}>
            {rows.length} record{rows.length === 1 ? '' : 's'}
          </Text>
          {paged.pageItems.map((entry) => {
            const meta = EVENT_ICONS[entry.event] || EVENT_ICONS.edited;
            const Icon = meta.icon;
            const line = describe(entry);
            return (
              <Card key={entry.id}>
                <CardContent style={styles.row}>
                  <View style={[styles.eventIcon, { backgroundColor: `${meta.color}14` }]}>
                    <Icon size={16} color={meta.color} />
                  </View>
                  <View style={styles.flex1}>
                    <View style={styles.titleRow}>
                      <Text style={styles.eventLabel}>{EVENT_LABELS[entry.event] || entry.event}</Text>
                      <Text style={styles.at}>{formatDateTime(entry.at)}</Text>
                    </View>
                    <Text style={styles.taskTitle} numberOfLines={2}>
                      {entry.taskTitle}
                    </Text>
                    <Text style={styles.meta}>
                      {entry.patientName || 'No patient'}
                      {entry.patientId ? ` · ${entry.patientId}` : ''}
                      {entry.patientRoom ? ` · Room ${entry.patientRoom}` : ''}
                    </Text>
                    <View style={styles.badges}>
                      <TaskTypeBadge type={entry.taskType} />
                      <TaskStatusBadge status={entry.taskStatus} />
                    </View>
                    {line ? <Text style={styles.detail}>{line}</Text> : null}
                    {entry.remarks ? (
                      <View style={styles.remarksBox}>
                        <Text style={styles.remarksLabel}>
                          {entry.event === 'remarks_amended' ? 'Corrected remarks' : 'Remarks'}
                        </Text>
                        <Text style={styles.remarksText}>{entry.remarks}</Text>
                        {entry.previousRemarks ? (
                          <Text style={styles.previous}>Previously: {entry.previousRemarks}</Text>
                        ) : null}
                      </View>
                    ) : null}
                    <Text style={styles.actor}>
                      {entry.actorName ? `By ${entry.actorName}` : entry.source === 'task_record' ? 'Before history logging' : ''}
                    </Text>
                  </View>
                </CardContent>
              </Card>
            );
          })}
          <Pagination page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} total={paged.total} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  filters: { gap: 10 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  filter: { flexGrow: 1, flexBasis: 160, minWidth: 150 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  clearText: { color: Colors.blue600, fontWeight: '600', fontSize: 13 },
  center: { paddingVertical: 40, alignItems: 'center' },
  empty: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  emptyText: { color: Colors.gray500, fontSize: 14 },
  errorText: { color: Colors.red600, fontSize: 14 },
  count: { fontSize: 12, color: Colors.mutedForeground },
  row: { flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start' },
  eventIcon: { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  eventLabel: { fontSize: 13, fontWeight: '700', color: Colors.gray900 },
  at: { fontSize: 12, color: Colors.mutedForeground },
  taskTitle: { fontSize: 14, fontWeight: '600', color: Colors.gray800 },
  meta: { fontSize: 12, color: Colors.gray600 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  detail: { fontSize: 12, color: Colors.gray700 },
  remarksBox: {
    marginTop: 4,
    backgroundColor: Colors.green50,
    borderWidth: 1,
    borderColor: Colors.green200,
    borderRadius: Radius.sm,
    padding: 8,
    gap: 2,
  },
  remarksLabel: { fontSize: 11, fontWeight: '700', color: Colors.green800 },
  remarksText: { fontSize: 13, color: Colors.gray800 },
  previous: { fontSize: 12, color: Colors.gray500, fontStyle: 'italic' },
  actor: { fontSize: 12, color: Colors.mutedForeground },
});
