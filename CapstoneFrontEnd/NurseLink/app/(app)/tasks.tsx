import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  CheckCircle,
  Clock,
  Edit,
  UserMinus,
  Plus,
  Search,
  Stethoscope,
  Bed,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Square,
  CheckSquare,
  Lock,
  HeartPulse,
  X,
} from 'lucide-react-native';
import {
  fetchTasks,
  fetchVitalReadings,
  createTask,
  updateTask,
  unassignTask,
  completeTask,
  ApiError,
} from '../../services/api';
import type { Task } from '../../types/domain';
import { Card, CardContent } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { TaskModal } from '../../components/TaskModal';
import { TaskVitalSignsBars } from '../../components/TaskVitalSignsBars';
import { DeleteConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import { useLiveRefresh } from '../../contexts/LiveContext';
import { useAuth } from '../../contexts/AuthContext';
import { Colors, Shadows, Radius } from '../../constants/colors';

type SortBy = 'newest' | 'oldest' | 'priority' | 'status';

const VITALS_READINGS_REQUIRED = 2;

const SORT_OPTIONS = [
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
  { label: 'Priority', value: 'priority' },
  { label: 'Status', value: 'status' },
];

export default function TasksPage() {
  const params = useLocalSearchParams<{
    taskId?: string;
    highlightId?: string;
    patientId?: string;
    scrollToPatient?: string;
  }>();
  const toast = useToast();
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const taskYOffsets = useRef<Record<string, number>>({});

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('all');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState<'add' | 'edit'>('add');
  const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
  const [taskToUnassign, setTaskToUnassign] = useState<string | null>(null);
  const [unassignLoading, setUnassignLoading] = useState(false);
  const [completeLoading, setCompleteLoading] = useState<string | null>(null);
  const [expandedChecklistId, setExpandedChecklistId] = useState<string | null>(null);
  const [checklistSaving, setChecklistSaving] = useState<string | null>(null);
  // Fetched for every vital_signs task right after the task list loads (see
  // loadTasks), so the checklist's lock state is correct even before the
  // nurse ever opens the vitals card for that task this session.
  const [vitalsReadingCounts, setVitalsReadingCounts] = useState<Record<string, number>>({});
  const [vitalsModalTaskId, setVitalsModalTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

  const loadTasks = async () => {
    try {
      const data = await fetchTasks({ mine: true });
      setTasks(data);
      const vitalsTasks = data.filter((t) => t.category === 'vital_signs');
      if (vitalsTasks.length > 0) {
        const pairs = await Promise.all(
          vitalsTasks.map(async (t) => {
            try {
              const readings = await fetchVitalReadings({ taskId: t.id });
              return [t.id, readings.length] as const;
            } catch {
              return [t.id, 0] as const;
            }
          })
        );
        setVitalsReadingCounts((prev) => {
          const next = { ...prev };
          pairs.forEach(([id, count]) => {
            next[id] = count;
          });
          return next;
        });
      }
    } catch (error) {
      toast.error('Failed to load tasks', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  // Refetch whenever the screen comes back into view, not just on mount.
  // expo-router keeps screens mounted, so a nurse who acknowledges a handover
  // and then taps Tasks would otherwise be looking at a list built before the
  // handover's work was added to it.
  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [])
  );

  // A task can arrive from another nurse's device — handed over, or assigned by
  // a head nurse — so the list also follows the shared live revision rather
  // than only reloading when this screen happens to regain focus.
  useLiveRefresh('tasks', loadTasks);

  useEffect(() => {
    // Notifications and the handover screen both point here with highlightId;
    // older links use taskId. Accept either so a link never silently does
    // nothing after landing on the right screen.
    const taskId =
      typeof params.taskId === 'string'
        ? params.taskId
        : typeof params.highlightId === 'string'
          ? params.highlightId
          : undefined;
    const patientId = typeof params.patientId === 'string' ? params.patientId : undefined;
    const scrollToPatient = params.scrollToPatient === 'true' || params.scrollToPatient === '1';

    if (taskId) {
      setHighlightedTaskId(taskId);
      const t1 = setTimeout(() => {
        const y = taskYOffsets.current[taskId];
        if (y !== undefined && scrollRef.current) {
          scrollRef.current.scrollTo({ y: Math.max(y - 80, 0), animated: true });
        }
      }, 150);
      const t2 = setTimeout(() => setHighlightedTaskId(null), 3000);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }

    if (scrollToPatient && patientId) {
      const patientTask = tasks.find((task) => task.patientId === patientId);
      if (patientTask) {
        setHighlightedTaskId(patientTask.id);
        const t1 = setTimeout(() => {
          const y = taskYOffsets.current[patientTask.id];
          if (y !== undefined && scrollRef.current) {
            scrollRef.current.scrollTo({ y: Math.max(y - 80, 0), animated: true });
          }
        }, 150);
        const t2 = setTimeout(() => setHighlightedTaskId(null), 3000);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
        };
      }
    }
  }, [params.taskId, params.highlightId, params.patientId, params.scrollToPatient, tasks]);

  const handleAddTask = () => {
    setSelectedTask(null);
    setTaskModalMode('add');
    setTaskModalOpen(true);
  };

  const handleEditTask = (task: Task) => {
    setSelectedTask(task);
    setTaskModalMode('edit');
    setTaskModalOpen(true);
  };

  const handleSaveTask = async (taskData: Partial<Task>) => {
    try {
      if (taskModalMode === 'add') {
        const newTask = await createTask({
          patientId: taskData.patientId || '',
          patientName: taskData.patientName || '',
          title: taskData.title || '',
          description: taskData.description || '',
          priority: taskData.priority || 'routine',
          dueTime: taskData.dueTime || '',
          status: 'pending',
          category: taskData.category || 'medication',
          departmentId: taskData.departmentId,
          doctorIds: taskData.doctorIds,
          attendingPhysician: taskData.attendingPhysician,
          patientRoom: taskData.patientRoom,
          doctorOrder: taskData.doctorOrder,
          assignedTo: taskData.assignedTo || user?.name || '',
        });
        setTasks((prev) => [newTask, ...prev]);
        toast.success('Task added successfully!', {
          description: `"${newTask.title}" has been added to your task list.`,
        });
      } else if (selectedTask) {
        const updated = await updateTask(selectedTask.id, taskData);
        setTasks((prev) => prev.map((task) => (task.id === selectedTask.id ? updated : task)));
        toast.success('Task updated successfully!', {
          description: 'Your changes have been saved.',
        });
      }
    } catch (error) {
      toast.error('Failed to save task', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
      throw error;
    }
  };

  const handleUnassignTask = (taskId: string) => {
    setTaskToUnassign(taskId);
    setUnassignDialogOpen(true);
  };

  const confirmUnassignTask = async () => {
    if (!taskToUnassign) return;

    setUnassignLoading(true);
    try {
      const unassigned = tasks.find((t) => t.id === taskToUnassign);
      const updated = await unassignTask(taskToUnassign);
      setTasks((prev) => prev.map((task) => (task.id === taskToUnassign ? updated : task)));
      setUnassignDialogOpen(false);
      setTaskToUnassign(null);
      toast.success('Task unassigned', {
        description: `"${unassigned?.title}" is back on the pending list, unassigned.`,
      });
    } catch (error) {
      toast.error('Failed to unassign task', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setUnassignLoading(false);
    }
  };

  const handleCompleteTask = async (task: Task) => {
    setCompleteLoading(task.id);
    try {
      const updated = await completeTask(task.id);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      toast.success('Task completed!', {
        description: `"${task.title}" has been marked as complete.`,
      });
    } catch (error) {
      toast.error('Failed to complete task', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setCompleteLoading(null);
    }
  };

  const handleToggleChecklistItem = async (task: Task, index: number) => {
    const isLastItem = index === task.checklist.length - 1;
    const isVitalsTask = task.category === 'vital_signs';
    const readingCount = vitalsReadingCounts[task.id] ?? 0;
    if (
      isVitalsTask &&
      isLastItem &&
      !task.checklist[index].done &&
      readingCount < VITALS_READINGS_REQUIRED
    ) {
      toast.error('Vital signs not recorded yet', {
        description: `Record at least ${VITALS_READINGS_REQUIRED} vital sign readings below before completing this step.`,
      });
      return;
    }

    const nextChecklist = task.checklist.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    );
    // Optimistic — checking off a step should feel instant, not wait on a
    // round trip, and the ward network is not always fast.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, checklist: nextChecklist } : t)));
    setChecklistSaving(task.id);
    try {
      const updated = await updateTask(task.id, { checklist: nextChecklist });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (error) {
      // Roll back — the server did not actually record this check.
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      toast.error('Failed to update checklist', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setChecklistSaving(null);
    }
  };

  const vitalsModalTask = tasks.find((t) => t.id === vitalsModalTaskId) || null;

  const filteredTasks = tasks
    .filter((task) => {
      const matchesSearch =
        searchQuery === '' ||
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.patientName.toLowerCase().includes(searchQuery.toLowerCase());

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
        const priorityOrder = { urgent: 0, routine: 1, completed: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      if (sortBy === 'status') {
        const statusOrder = { overdue: 0, pending: 1, in_progress: 2, completed: 3 };
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return 0;
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

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'medication':
        return '💊';
      case 'vital_signs':
        return '📊';
      case 'care':
        return '🩺';
      case 'assessment':
        return '📋';
      case 'documentation':
        return '📝';
      default:
        return '📌';
    }
  };

  const counts = {
    all: tasks.length,
    urgent: tasks.filter((t) => t.priority === 'urgent').length,
    routine: tasks.filter((t) => t.priority === 'routine').length,
    overdue: tasks.filter((t) => t.status === 'overdue').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
  };

  const filterTabs = [
    { id: 'all', label: 'All', count: counts.all, color: Colors.blue600 },
    { id: 'urgent', label: 'Urgent', count: counts.urgent, color: Colors.red600 },
    { id: 'routine', label: 'Routine', count: counts.routine, color: Colors.yellow700 },
    { id: 'overdue', label: 'Overdue', count: counts.overdue, color: Colors.orange600 },
    { id: 'completed', label: 'Done', count: counts.completed, color: Colors.green600 },
  ];

  return (
    <View style={styles.root}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
          <ActivityIndicator size="large" color={Colors.blue600} />
        </View>
      ) : (
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.flex1}>
            <Text style={styles.title}>My Tasks</Text>
            <Text style={styles.subtitle}>
              {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
              {selectedTab !== 'all' ? ` in ${selectedTab}` : ''}
            </Text>
          </View>
          <Button size="sm" onPress={handleAddTask} style={styles.addBtn}>
            <Plus size={16} color={Colors.white} />
            <Text style={styles.addBtnText}>Add Task</Text>
          </Button>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchWrap}>
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              leftIcon={<Search size={18} color={Colors.gray500} />}
              inputWrapperStyle={styles.searchInput}
            />
          </View>
          <Select
            value={sortBy}
            onValueChange={(value) => setSortBy(value as SortBy)}
            options={SORT_OPTIONS}
            placeholder="Sort by"
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
                <Text style={styles.emptyText}>No tasks found</Text>
              </CardContent>
            </Card>
          ) : (
            filteredTasks.map((task) => (
              <View
                key={task.id}
                onLayout={(e) => {
                  taskYOffsets.current[task.id] = e.nativeEvent.layout.y;
                }}
              >
                <Card
                  style={{
                    ...styles.taskCard,
                    ...getPriorityStyle(task.priority),
                    ...(highlightedTaskId === task.id ? styles.taskHighlighted : {}),
                  }}
                >
                  <CardContent style={styles.taskContent}>
                    <View style={styles.taskRow}>
                      <View style={styles.flex1}>
                        <View style={styles.taskTitleRow}>
                          <Text style={styles.categoryEmoji}>{getCategoryIcon(task.category)}</Text>
                          <Text style={styles.taskTitle} numberOfLines={2}>
                            {task.title}
                          </Text>
                          <Badge
                            variant={task.priority === 'urgent' ? 'destructive' : 'secondary'}
                            textStyle={styles.badgeXs}
                          >
                            {task.priority}
                          </Badge>
                        </View>
                        <Text style={styles.taskDescription}>{task.description}</Text>

                        <View style={styles.metaBlock}>
                          <View style={styles.metaRow}>
                            <View style={styles.metaItem}>
                              <Clock size={14} color={Colors.gray500} />
                              <Text style={styles.metaText}>{task.dueTime}</Text>
                            </View>
                            <Text style={styles.metaText}>
                              Patient: {task.patientName} ({task.patientId})
                            </Text>
                          </View>

                          {(task.attendingPhysician || task.patientRoom) && (
                            <View style={styles.metaRow}>
                              {task.attendingPhysician ? (
                                <View style={styles.metaItem}>
                                  <Stethoscope size={13} color={Colors.gray500} />
                                  <Text style={styles.metaTextSm}>
                                    <Text style={styles.metaBold}>Doctor: </Text>
                                    {task.attendingPhysician}
                                  </Text>
                                </View>
                              ) : null}
                              {task.patientRoom ? (
                                <View style={styles.metaItem}>
                                  <Bed size={13} color={Colors.gray500} />
                                  <Text style={styles.metaTextSm}>
                                    <Text style={styles.metaBold}>Room: </Text>
                                    {task.patientRoom}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          )}

                          {task.doctorOrder ? (
                            <View style={styles.orderBox}>
                              <ClipboardList size={13} color={Colors.blue600} />
                              <View style={styles.flex1}>
                                <Text style={styles.orderTitle}>Doctor&apos;s Order</Text>
                                <Text style={styles.orderText}>{task.doctorOrder}</Text>
                              </View>
                            </View>
                          ) : null}

                          {task.checklist.length > 0 ? (
                            <View style={styles.checklistWrap}>
                              <Pressable
                                style={styles.checklistToggle}
                                onPress={() =>
                                  setExpandedChecklistId((prev) => (prev === task.id ? null : task.id))
                                }
                              >
                                <ClipboardList size={13} color={Colors.purple600} />
                                <Text style={styles.checklistToggleText}>
                                  Checklist: {task.checklist.filter((i) => i.done).length}/
                                  {task.checklist.length} completed
                                </Text>
                                {expandedChecklistId === task.id ? (
                                  <ChevronUp size={14} color={Colors.gray500} />
                                ) : (
                                  <ChevronDown size={14} color={Colors.gray500} />
                                )}
                              </Pressable>
                              {expandedChecklistId === task.id ? (
                                <View style={styles.checklistItems}>
                                  {task.checklist.map((item, index) => {
                                    const isLastItem = index === task.checklist.length - 1;
                                    const isVitalsTask = task.category === 'vital_signs';
                                    const readingCount = vitalsReadingCounts[task.id] ?? 0;
                                    const isLocked =
                                      isVitalsTask &&
                                      isLastItem &&
                                      !item.done &&
                                      readingCount < VITALS_READINGS_REQUIRED;
                                    return (
                                      <Pressable
                                        key={index}
                                        style={styles.checklistItemRow}
                                        disabled={checklistSaving === task.id}
                                        onPress={() => handleToggleChecklistItem(task, index)}
                                      >
                                        {item.done ? (
                                          <CheckSquare size={16} color={Colors.green600} />
                                        ) : isLocked ? (
                                          <Lock size={14} color={Colors.gray400} />
                                        ) : (
                                          <Square size={16} color={Colors.gray400} />
                                        )}
                                        <Text
                                          style={[
                                            styles.checklistItemText,
                                            item.done && styles.checklistItemTextDone,
                                            isLocked && styles.checklistItemTextLocked,
                                          ]}
                                        >
                                          {item.text}
                                          {isLocked
                                            ? ` (record ${VITALS_READINGS_REQUIRED} vitals first)`
                                            : ''}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      </View>

                      <View style={styles.actions}>
                        {task.status !== 'completed' ? (
                          <Button
                            size="icon-sm"
                            variant="outline"
                            onPress={() => handleCompleteTask(task)}
                            disabled={completeLoading === task.id}
                            style={styles.completeBtn}
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
                          onPress={() => handleEditTask(task)}
                          style={styles.editBtn}
                        >
                          <Edit size={16} color={Colors.blue600} />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="outline"
                          onPress={() => setVitalsModalTaskId(task.id)}
                          style={styles.vitalsBtn}
                        >
                          <HeartPulse size={16} color={Colors.red600} />
                        </Button>
                        {user?.role === 'head_nurse' && task.assignedTo ? (
                          <Button
                            size="icon-sm"
                            variant="outline"
                            onPress={() => handleUnassignTask(task.id)}
                            style={styles.deleteBtn}
                          >
                            <UserMinus size={16} color={Colors.red600} />
                          </Button>
                        ) : null}
                      </View>
                    </View>
                  </CardContent>
                </Card>
              </View>
            ))
          )}
        </View>
      </ScrollView>
      )}

      <TaskModal
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        onSave={handleSaveTask}
        task={selectedTask}
        mode={taskModalMode}
        allTasks={tasks}
        patientScope="mine"
      />

      <DeleteConfirmDialog
        open={unassignDialogOpen}
        onOpenChange={setUnassignDialogOpen}
        onConfirm={confirmUnassignTask}
        loading={unassignLoading}
        title="Unassign Task"
        description="This will remove the assigned nurse and return the task to pending. The task itself is not deleted."
      />

      {vitalsModalTask ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setVitalsModalTaskId(null)}
        >
          <Pressable style={styles.vitalsModalBackdrop} onPress={() => setVitalsModalTaskId(null)}>
            <Pressable style={[styles.vitalsModalCard, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.vitalsModalHeader}>
                <HeartPulse size={18} color={Colors.red600} />
                <Text style={styles.vitalsModalTitle}>Vital Signs Check-ins</Text>
                <Pressable onPress={() => setVitalsModalTaskId(null)} hitSlop={8}>
                  <X size={20} color={Colors.gray500} />
                </Pressable>
              </View>
              <Text style={styles.vitalsModalSubtitle}>
                {vitalsModalTask.patientName} ({vitalsModalTask.patientId}) · Room{' '}
                {vitalsModalTask.patientRoom || '—'}
              </Text>
              <ScrollView style={styles.vitalsModalScroll} keyboardShouldPersistTaps="handled">
                <TaskVitalSignsBars
                  taskId={vitalsModalTask.id}
                  patientId={vitalsModalTask.patientId}
                  readingsRequired={VITALS_READINGS_REQUIRED}
                  onReadingsChange={(count) =>
                    setVitalsReadingCounts((prev) => ({ ...prev, [vitalsModalTask.id]: count }))
                  }
                />
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
    maxWidth: 896,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  flex1: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.gray900,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.gray600,
    marginTop: 2,
  },
  addBtn: {
    backgroundColor: Colors.blue600,
    ...Shadows.md,
  },
  addBtnText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 13,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  searchWrap: {
    flex: 1,
  },
  searchInput: {
    borderWidth: 2,
    borderColor: Colors.gray200,
    ...Shadows.md,
  },
  sortSelect: {
    width: 150,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 4,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  filterTabInactive: {
    backgroundColor: Colors.white,
    borderWidth: 2,
    borderColor: Colors.gray200,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.gray700,
  },
  filterTabTextActive: {
    color: Colors.white,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  countBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  countBadgeInactive: {
    backgroundColor: Colors.gray200,
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
  },
  countTextActive: {
    color: Colors.white,
  },
  countTextInactive: {
    color: Colors.gray700,
  },
  list: {
    gap: 12,
  },
  empty: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    color: Colors.gray500,
    fontSize: 14,
  },
  taskCard: {
    borderWidth: 2,
  },
  taskHighlighted: {
    borderColor: Colors.blue500,
    ...Shadows.lg,
    transform: [{ scale: 1.02 }],
  },
  taskContent: {
    padding: 16,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  categoryEmoji: {
    fontSize: 18,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.gray900,
    flexShrink: 1,
  },
  badgeXs: {
    fontSize: 11,
    textTransform: 'capitalize',
  },
  taskDescription: {
    fontSize: 13,
    color: Colors.gray600,
    marginBottom: 8,
  },
  metaBlock: {
    gap: 6,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    color: Colors.gray500,
  },
  metaTextSm: {
    fontSize: 12,
    color: Colors.gray500,
  },
  metaBold: {
    fontWeight: '600',
  },
  orderBox: {
    marginTop: 8,
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
    borderRadius: Radius.sm,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  orderTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.blue900,
  },
  orderText: {
    fontSize: 11,
    color: Colors.blue800,
    marginTop: 2,
  },
  checklistWrap: {
    marginTop: 8,
    backgroundColor: Colors.purple50,
    borderWidth: 1,
    borderColor: Colors.purple100,
    borderRadius: Radius.sm,
    padding: 8,
  },
  checklistToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checklistToggleText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.purple700,
  },
  checklistItems: {
    marginTop: 8,
    gap: 6,
  },
  checklistItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checklistItemText: {
    fontSize: 12,
    color: Colors.gray700,
    flex: 1,
  },
  checklistItemTextDone: {
    color: Colors.gray400,
    textDecorationLine: 'line-through',
  },
  checklistItemTextLocked: {
    color: Colors.gray400,
    fontStyle: 'italic',
  },
  actions: {
    gap: 8,
  },
  completeBtn: {
    borderColor: Colors.green600,
  },
  editBtn: {
    borderColor: Colors.blue600,
  },
  vitalsBtn: {
    borderColor: Colors.red600,
  },
  vitalsModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  vitalsModalCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 760,
    maxHeight: '88%',
  },
  vitalsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vitalsModalTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foreground,
  },
  vitalsModalSubtitle: {
    fontSize: 12,
    color: Colors.gray500,
    marginTop: 4,
    marginBottom: 12,
  },
  vitalsModalScroll: {
    flexGrow: 0,
  },
  deleteBtn: {
    borderColor: Colors.red600,
  },
});
