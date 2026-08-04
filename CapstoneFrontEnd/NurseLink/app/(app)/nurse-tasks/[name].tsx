import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  Edit,
  Trash2,
  Plus,
  Search,
  Stethoscope,
  Bed,
  ClipboardList,
} from 'lucide-react-native';
import { mockTasks, Task } from '../../../data/mockData';
import { Card, CardContent } from '../../../components/Card';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { Select } from '../../../components/Select';
import { TaskModal } from '../../../components/TaskModal';
import { DeleteConfirmDialog } from '../../../components/ConfirmDialog';
import { useToast } from '../../../contexts/ToastContext';
import { Colors, Shadows, Radius } from '../../../constants/colors';

type SortBy = 'newest' | 'oldest' | 'priority' | 'status';

const SORT_OPTIONS = [
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
  { label: 'Priority', value: 'priority' },
  { label: 'Status', value: 'status' },
];

export default function NurseTasksPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string }>();
  const nurseName = decodeURIComponent(
    typeof params.name === 'string' ? params.name : 'Nurse'
  );
  const toast = useToast();

  const [tasks, setTasks] = useState<Task[]>(mockTasks);
  const [selectedTab, setSelectedTab] = useState('all');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState<'add' | 'edit'>('add');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [completeLoading, setCompleteLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  const nurseTasks = useMemo(
    () => tasks.filter((task) => task.assignedTo === nurseName),
    [tasks, nurseName]
  );

  const handleSaveTask = async (taskData: Partial<Task>) => {
    await new Promise((resolve) => setTimeout(resolve, 600));

    if (taskModalMode === 'add') {
      const newTask: Task = {
        id: `task-${Date.now()}`,
        patientId: taskData.patientId || '',
        patientName: taskData.patientName || '',
        title: taskData.title || '',
        description: taskData.description || '',
        priority: taskData.priority || 'routine',
        dueTime: taskData.dueTime || '',
        assignedTo: nurseName,
        status: 'pending',
        category: 'medication',
        createdAt: new Date().toISOString(),
        attendingPhysician: taskData.attendingPhysician,
        patientRoom: taskData.patientRoom,
        doctorOrder: taskData.doctorOrder,
      };
      setTasks([newTask, ...tasks]);
      toast.success('Task added successfully!', {
        description: `"${newTask.title}" assigned to ${nurseName}.`,
      });
    } else {
      setTasks(
        tasks.map((task) =>
          task.id === selectedTask?.id ? { ...task, ...taskData } : task
        )
      );
      toast.success('Task updated successfully!');
    }
  };

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;
    setDeleteLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const deleted = tasks.find((t) => t.id === taskToDelete);
    setTasks(tasks.filter((task) => task.id !== taskToDelete));
    setDeleteLoading(false);
    setDeleteDialogOpen(false);
    setTaskToDelete(null);
    toast.success('Task deleted', {
      description: `"${deleted?.title}" has been removed.`,
    });
  };

  const handleCompleteTask = async (task: Task) => {
    setCompleteLoading(task.id);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setTasks(
      tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: 'completed' as const,
              priority: 'completed' as const,
              completedAt: new Date().toISOString(),
            }
          : t
      )
    );
    setCompleteLoading(null);
    toast.success('Task completed!', {
      description: `"${task.title}" marked complete.`,
    });
  };

  const filteredTasks = nurseTasks
    .filter((task) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        task.title.toLowerCase().includes(q) ||
        task.description.toLowerCase().includes(q) ||
        task.patientName.toLowerCase().includes(q);

      if (selectedTab === 'all') return matchesSearch;
      if (selectedTab === 'urgent') return matchesSearch && task.priority === 'urgent';
      if (selectedTab === 'routine') return matchesSearch && task.priority === 'routine';
      if (selectedTab === 'completed') return matchesSearch && task.status === 'completed';
      if (selectedTab === 'overdue') return matchesSearch && task.status === 'overdue';
      return matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortBy === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sortBy === 'priority') {
        const order = { urgent: 0, routine: 1, completed: 2 };
        return order[a.priority] - order[b.priority];
      }
      const statusOrder = { overdue: 0, pending: 1, in_progress: 2, completed: 3 };
      return statusOrder[a.status] - statusOrder[b.status];
    });

  const getPriorityStyle = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return { backgroundColor: Colors.red50, borderColor: Colors.red200 };
      case 'routine':
        return { backgroundColor: Colors.yellow50, borderColor: Colors.yellow200 };
      case 'completed':
        return { backgroundColor: Colors.green50, borderColor: Colors.green200 };
      default:
        return { backgroundColor: Colors.gray50, borderColor: Colors.gray200 };
    }
  };

  const counts = {
    all: nurseTasks.length,
    urgent: nurseTasks.filter((t) => t.priority === 'urgent').length,
    routine: nurseTasks.filter((t) => t.priority === 'routine').length,
    overdue: nurseTasks.filter((t) => t.status === 'overdue').length,
    completed: nurseTasks.filter((t) => t.status === 'completed').length,
  };

  const filterTabs = [
    { id: 'all', label: 'All', count: counts.all, color: Colors.blue600 },
    { id: 'urgent', label: 'Urgent', count: counts.urgent, color: Colors.red600 },
    { id: 'routine', label: 'Routine', count: counts.routine, color: '#CA8A04' },
    { id: 'overdue', label: 'Overdue', count: counts.overdue, color: Colors.orange600 },
    { id: 'completed', label: 'Done', count: counts.completed, color: Colors.green600 },
  ];

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Button variant="ghost" size="icon-sm" onPress={() => router.back()}>
            <ArrowLeft size={18} color={Colors.foreground} />
          </Button>
          <View style={styles.flex1}>
            <Text style={styles.title}>{nurseName}&apos;s Tasks</Text>
            <Text style={styles.subtitle}>
              {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <Button
            size="sm"
            onPress={() => {
              setSelectedTask(null);
              setTaskModalMode('add');
              setTaskModalOpen(true);
            }}
          >
            <Plus size={16} color={Colors.white} />
            <Text style={styles.addText}>Add</Text>
          </Button>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchWrap}>
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              leftIcon={<Search size={16} color={Colors.gray500} />}
            />
          </View>
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortBy)}
            options={SORT_OPTIONS}
            style={styles.sortSelect}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
        >
          {filterTabs.map((tab) => {
            const active = selectedTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setSelectedTab(tab.id)}
                style={[
                  styles.filterTab,
                  active
                    ? { backgroundColor: tab.color, ...Shadows.md }
                    : styles.filterTabInactive,
                ]}
              >
                <Text style={[styles.filterTabText, active && styles.filterTabTextActive]}>
                  {tab.label}
                </Text>
                {tab.count > 0 ? (
                  <View
                    style={[
                      styles.countBadge,
                      active ? styles.countBadgeActive : styles.countBadgeInactive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.countText,
                        active ? styles.countTextActive : styles.countTextInactive,
                      ]}
                    >
                      {tab.count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.list}>
          {filteredTasks.length === 0 ? (
            <Card>
              <CardContent style={styles.empty}>
                <Text style={styles.muted}>No tasks found for {nurseName}</Text>
              </CardContent>
            </Card>
          ) : (
            filteredTasks.map((task) => (
              <Card key={task.id} style={{ ...styles.taskCard, ...getPriorityStyle(task.priority) }}>
                <CardContent style={styles.taskContent}>
                  <View style={styles.taskTitleRow}>
                    <Text style={styles.taskTitle} numberOfLines={2}>
                      {task.title}
                    </Text>
                    <Badge variant={task.priority === 'urgent' ? 'destructive' : 'secondary'}>
                      {task.priority}
                    </Badge>
                  </View>
                  <Text style={styles.taskDescription}>{task.description}</Text>

                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Clock size={14} color={Colors.gray500} />
                      <Text style={styles.metaText}>{task.dueTime}</Text>
                    </View>
                    <Text style={styles.metaText}>
                      {task.patientName} ({task.patientId})
                    </Text>
                  </View>

                  {(task.attendingPhysician || task.patientRoom) && (
                    <View style={styles.metaRow}>
                      {task.attendingPhysician ? (
                        <View style={styles.metaItem}>
                          <Stethoscope size={13} color={Colors.gray500} />
                          <Text style={styles.metaText}>{task.attendingPhysician}</Text>
                        </View>
                      ) : null}
                      {task.patientRoom ? (
                        <View style={styles.metaItem}>
                          <Bed size={13} color={Colors.gray500} />
                          <Text style={styles.metaText}>{task.patientRoom}</Text>
                        </View>
                      ) : null}
                    </View>
                  )}

                  {task.doctorOrder ? (
                    <View style={styles.orderBox}>
                      <ClipboardList size={13} color={Colors.blue600} />
                      <Text style={styles.orderText}>{task.doctorOrder}</Text>
                    </View>
                  ) : null}

                  <View style={styles.actions}>
                    {task.status !== 'completed' ? (
                      <Button
                        size="icon-sm"
                        variant="outline"
                        onPress={() => handleCompleteTask(task)}
                        disabled={completeLoading === task.id}
                      >
                        {completeLoading === task.id ? (
                          <ActivityIndicator size="small" color={Colors.green600} />
                        ) : (
                          <CheckCircle size={16} color={Colors.green600} />
                        )}
                      </Button>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onPress={() => {
                        setSelectedTask(task);
                        setTaskModalMode('edit');
                        setTaskModalOpen(true);
                      }}
                    >
                      <Edit size={16} color={Colors.blue600} />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onPress={() => {
                        setTaskToDelete(task.id);
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 size={16} color={Colors.red600} />
                    </Button>
                  </View>
                </CardContent>
              </Card>
            ))
          )}
        </View>
      </ScrollView>

      <TaskModal
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        task={selectedTask}
        mode={taskModalMode}
        onSave={handleSaveTask}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDeleteTask}
        loading={deleteLoading}
        title="Delete Task"
        description="Are you sure you want to delete this task? This action cannot be undone."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex1: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 13, color: Colors.mutedForeground, marginTop: 2 },
  addText: { color: Colors.white, fontWeight: '600', fontSize: 13 },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  searchWrap: { flex: 1 },
  sortSelect: { width: 120 },
  tabsRow: { gap: 8, paddingVertical: 2 },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
  },
  filterTabInactive: { backgroundColor: Colors.gray100 },
  filterTabText: { fontSize: 12, fontWeight: '700', color: Colors.gray700 },
  filterTabTextActive: { color: Colors.white },
  countBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  countBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  countBadgeInactive: { backgroundColor: Colors.gray200 },
  countText: { fontSize: 10, fontWeight: '700' },
  countTextActive: { color: Colors.white },
  countTextInactive: { color: Colors.gray700 },
  list: { gap: 10 },
  empty: { paddingVertical: 32, alignItems: 'center' },
  muted: { color: Colors.mutedForeground },
  taskCard: { borderWidth: 1 },
  taskContent: { padding: 14, gap: 8 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  taskTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.foreground },
  taskDescription: { fontSize: 13, color: Colors.mutedForeground, lineHeight: 18 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: Colors.mutedForeground },
  orderBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: Colors.blue50,
    borderRadius: Radius.sm,
    padding: 10,
  },
  orderText: { flex: 1, fontSize: 12, color: Colors.blue800 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
