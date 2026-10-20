import React, { useMemo, useState, type RefObject } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, type ScrollView } from 'react-native';
import { ArrowLeft, Check, ChevronRight, Folder, FolderOpen, ListTodo, ClipboardCheck, Search } from 'lucide-react-native';
import { Colors, Radius } from '../../constants/colors';
import type { MyPatientFolder, Task } from '../../types/domain';
import { Card, CardContent } from '../Card';
import { Input } from '../Input';
import { Pagination, usePagination } from '../Pagination';
import { TaskStatusBadge, TaskTypeBadge, formatDateTime } from './taskLabels';
import { formatDueDateTime } from '../../utils/time';

interface Props {
  folders: MyPatientFolder[];
  /** The nurse's own tasks (same list the Tasks page shows). */
  tasks: Task[];
  loading: boolean;
  openPatientId: string | null;
  onOpenPatient: (patientId: string | null) => void;
  onDone: (task: Task) => void;
  scrollRef: RefObject<ScrollView | null>;
}

function dueLabel(task: Task) {
  if (task.scheduledFor) return `Scheduled ${formatDateTime(task.scheduledFor)}`;
  const due = formatDueDateTime(task.dueDate, task.dueTime);
  return due ? `Due ${due}` : '';
}

/**
 * Patients assigned to the signed-in nurse, one folder each. A folder holds
 * that patient's unfinished tasks (with Done) and finished tasks with the
 * remarks written when each was completed.
 */
export function MyPatientsView({ folders, tasks, loading, openPatientId, onOpenPatient, onDone, scrollRef }: Props) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => `${f.name} ${f.patientId} ${f.room}`.toLowerCase().includes(q));
  }, [folders, query]);

  const open = folders.find((f) => f.patientId === openPatientId) || null;
  const paged = usePagination(filtered, { scrollRef, resetKey: query });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.blue600} />
      </View>
    );
  }

  if (open) {
    const patientTasks = tasks.filter((t) => t.patientId === open.patientId);
    const unfinished = patientTasks.filter((t) => t.status !== 'completed');
    const finished = patientTasks
      .filter((t) => t.status === 'completed')
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    return (
      <View style={styles.wrap}>
        <Pressable onPress={() => onOpenPatient(null)} style={styles.back} accessibilityRole="button">
          <ArrowLeft size={16} color={Colors.blue600} />
          <Text style={styles.backText}>All my patients</Text>
        </Pressable>
        <Card>
          <CardContent style={styles.folderHead}>
            <View style={styles.folderIcon}>
              <FolderOpen size={22} color={Colors.teal600} />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.folderName}>{open.name}</Text>
              <Text style={styles.folderMeta}>
                {open.patientId} · Room {open.room || '—'}
                {open.departmentName ? ` · ${open.departmentName}` : ''}
              </Text>
            </View>
          </CardContent>
        </Card>

        <View style={styles.sectionHead}>
          <ListTodo size={16} color={Colors.orange600} />
          <Text style={styles.sectionTitle}>Unfinished tasks</Text>
          <Text style={styles.sectionCount}>{unfinished.length}</Text>
        </View>
        {unfinished.length === 0 ? (
          <Text style={styles.emptyLine}>No unfinished tasks for this patient.</Text>
        ) : (
          unfinished.map((task) => (
            <Card key={task.id}>
              <CardContent style={styles.taskRow}>
                <View style={styles.flex1}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <View style={styles.badges}>
                    <TaskTypeBadge type={task.taskType} />
                    <TaskStatusBadge status={task.status} />
                  </View>
                  {dueLabel(task) ? <Text style={styles.taskMeta}>{dueLabel(task)}</Text> : null}
                </View>
                <Pressable
                  onPress={() => onDone(task)}
                  style={styles.doneBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${task.title} as done`}
                >
                  <Check size={16} color={Colors.white} />
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              </CardContent>
            </Card>
          ))
        )}

        <View style={styles.sectionHead}>
          <ClipboardCheck size={16} color={Colors.green600} />
          <Text style={styles.sectionTitle}>Finished tasks</Text>
          <Text style={styles.sectionCount}>{finished.length}</Text>
        </View>
        {finished.length === 0 ? (
          <Text style={styles.emptyLine}>No finished tasks yet.</Text>
        ) : (
          finished.map((task) => (
            <Card key={task.id}>
              <CardContent style={styles.finishedRow}>
                <View style={styles.titleLine}>
                  <Text style={[styles.taskTitle, styles.flex1]}>{task.title}</Text>
                  <TaskTypeBadge type={task.taskType} />
                </View>
                <Text style={styles.taskMeta}>
                  Completed {formatDateTime(task.completedAt)}
                  {task.completedBy ? ` by ${task.completedBy}` : ''}
                </Text>
                <View style={styles.remarksBox}>
                  <Text style={styles.remarksLabel}>Remarks</Text>
                  <Text style={styles.remarksText}>
                    {task.completionRemarks || 'No remarks were recorded (completed before remarks were required).'}
                  </Text>
                </View>
              </CardContent>
            </Card>
          ))
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Input
        placeholder="Search my patients…"
        value={query}
        onChangeText={setQuery}
        leftIcon={<Search size={18} color={Colors.gray500} />}
      />
      {filtered.length === 0 ? (
        <Card>
          <CardContent style={styles.empty}>
            <Folder size={28} color={Colors.gray300} />
            <Text style={styles.emptyText}>
              {folders.length === 0 ? 'No patients are assigned to you right now.' : 'No patient matches your search.'}
            </Text>
          </CardContent>
        </Card>
      ) : (
        paged.pageItems.map((folder) => (
          <Pressable
            key={folder.patientId}
            onPress={() => onOpenPatient(folder.patientId)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${folder.name}'s tasks`}
            style={(state) => [
              styles.folderCard,
              (state as { hovered?: boolean }).hovered && styles.folderCardHover,
            ]}
          >
            <View style={styles.folderIcon}>
              <Folder size={22} color={Colors.teal600} />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.folderName}>{folder.name}</Text>
              <Text style={styles.folderMeta}>
                Room {folder.room || '—'} · {folder.patientId}
              </Text>
              <View style={styles.badges}>
                <View style={[styles.countPill, { backgroundColor: Colors.orange50 }]}>
                  <Text style={[styles.countText, { color: Colors.orange700 }]}>{folder.unfinishedTasks} unfinished</Text>
                </View>
                <View style={[styles.countPill, { backgroundColor: Colors.green50 }]}>
                  <Text style={[styles.countText, { color: Colors.green700 }]}>{folder.finishedTasks} finished</Text>
                </View>
              </View>
            </View>
            <ChevronRight size={18} color={Colors.gray400} />
          </Pressable>
        ))
      )}
      <Pagination page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} total={paged.total} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  center: { paddingVertical: 40, alignItems: 'center' },
  flex1: { flex: 1, minWidth: 0 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
  backText: { color: Colors.blue600, fontWeight: '600', fontSize: 13 },
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  folderCardHover: { borderColor: Colors.teal600, backgroundColor: Colors.teal50 },
  folderHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  folderIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.teal50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderName: { fontSize: 15, fontWeight: '700', color: Colors.gray900 },
  folderMeta: { fontSize: 12, color: Colors.gray600, marginTop: 2 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  countPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  countText: { fontSize: 11, fontWeight: '700' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.gray900, flex: 1 },
  sectionCount: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.gray700,
    backgroundColor: Colors.gray100,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  emptyLine: { fontSize: 13, color: Colors.gray500 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  taskTitle: { fontSize: 14, fontWeight: '700', color: Colors.gray900 },
  taskMeta: { fontSize: 12, color: Colors.gray600, marginTop: 4 },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.green600,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: Radius.md,
  },
  doneText: { color: Colors.white, fontWeight: '700', fontSize: 13 },
  finishedRow: { padding: 14, gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  remarksBox: {
    marginTop: 6,
    backgroundColor: Colors.green50,
    borderWidth: 1,
    borderColor: Colors.green200,
    borderRadius: Radius.sm,
    padding: 8,
    gap: 2,
  },
  remarksLabel: { fontSize: 11, fontWeight: '700', color: Colors.green800 },
  remarksText: { fontSize: 13, color: Colors.gray800 },
  empty: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  emptyText: { color: Colors.gray500, fontSize: 14, textAlign: 'center' },
});
