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
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import {
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
  Check,
  ListChecks,
  CheckCircle2,
  History,
  FolderOpen,
  LayoutGrid,
  Table2,
} from 'lucide-react-native';
import {
  fetchTasks,
  fetchVitalReadings,
  createTask,
  updateTask,
  unassignTask,
  fetchMyPatientFolders,
  ApiError,
} from '../../services/api';
import type { MyPatientFolder, Task } from '../../types/domain';
import { CompleteTaskDialog } from '../../components/tasks/CompleteTaskDialog';
import { TaskHistoryView } from '../../components/tasks/TaskHistoryView';
import { MyPatientsView } from '../../components/tasks/MyPatientsView';
import {
  TaskStatusBadge,
  TaskTypeBadge,
  formatDateTime,
  vitalsMonitoringOrderLabel,
} from '../../components/tasks/taskLabels';
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
import { Pagination, usePagination } from '../../components/Pagination';
import { formatTime12 } from '../../utils/time';
import { countTasksByFilter, isTaskPastDue, matchesTaskFilter } from '../../utils/taskFilters';

type SortBy = 'newest' | 'oldest' | 'priority' | 'status';

/** Free-standing vital signs tasks need 2 check-ins; a scheduled check needs 1 (server decides). */
const readingsRequired = (task: Task) => task.vitalReadingsRequired ?? 2;

type TaskView = 'all' | 'completed' | 'history' | 'patients';

const SORT_OPTIONS = [
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
  { label: 'Risk Level', value: 'priority' },
  { label: 'Status', value: 'status' },
];

/** "Mar 15" from an ISO "YYYY-MM-DD" — '' if blank (predates dueDate).
 * Exported for nurse-tasks/[name].tsx, which shows the same task cards in
 * the head nurse's per-nurse view and wants the same overdue flagging. */
export function formatDueDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** True once a task's due date+time has passed and it's still not done —
 * the visual half of the due-task reminder (api/notifications.py's
 * check_due_task_reminders raises the actual notification; this is what
 * lets the card itself keep showing it's overdue afterward too). A task
 * with no dueDate (predates the field, or entered as free text through the
 * admin generic editor) is never flagged — there's nothing reliable to
 * compare against. */
export function isTaskOverdue(task: Task): boolean {
  return isTaskPastDue(task);
}

/** "Due in 12 min" (amber) / "Due now" (red) / "Overdue by 25 min" (red) /
 * "Completed" (green) — null once it's more than half an hour out, where
 * the plain due date/time next to it already says enough without a
 * ticking-clock chip. Exported for nurse-tasks/[name].tsx, same reuse
 * reasoning as formatDueDate/isTaskOverdue above. */
export function taskDueChip(task: Task): { label: string; color: string } | null {
  if (task.status === 'completed') return { label: 'Completed', color: Colors.green600 };
  if (!task.dueDate || !task.dueTime) return null;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const [h, min] = task.dueTime.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(min)) return null;
  const due = new Date(y, m - 1, d, h, min).getTime();
  const diffMin = Math.round((due - Date.now()) / 60000);
  if (task.status === 'overdue' || diffMin < 0) {
    return {
      label: diffMin < 0 ? `Overdue by ${Math.abs(diffMin)} min` : 'Overdue',
      color: Colors.red600,
    };
  }
  if (diffMin === 0) return { label: 'Due now', color: Colors.red600 };
  if (diffMin <= 30) return { label: `Due in ${diffMin} min`, color: Colors.orange600 };
  return null;
}

// Card / Table layout for the task list, remembered per device (same pattern
// as the Patients screen; wrapped in try/catch because localStorage can throw
// or be unavailable on native / private windows).
type TaskViewMode = 'card' | 'table';
const TASK_VIEW_KEY = 'nurselink.tasksViewMode';
function loadTaskView(): TaskViewMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(TASK_VIEW_KEY);
      if (v === 'card' || v === 'table') return v;
    }
  } catch {
    // ignore — fall back to the default
  }
  return 'card';
}
// Table columns size by FLEX so the table fills the whole content width on
// wide screens, with a minWidth floor per column so nothing is crushed; the
// row's total minWidth is what makes it scroll horizontally (header + rows
// together) only once the window is too narrow to fit. Index order matches
// the header row.
const TASK_TABLE_COLS = [
  { flex: 2.4, minWidth: 180 }, // Task
  { flex: 1.6, minWidth: 150 }, // Patient
  { flex: 1, minWidth: 90 },    // Priority
  { flex: 1.3, minWidth: 120 }, // Due
  { flex: 1, minWidth: 100 },   // Status
  { flex: 1.4, minWidth: 130 }, // Nurse
];
const TASK_TABLE_MIN_WIDTH = TASK_TABLE_COLS.reduce((s, c) => s + c.minWidth, 0);

export default function TasksPage() {
  const params = useLocalSearchParams<{
    taskId?: string;
    highlightId?: string;
    patientId?: string;
    scrollToPatient?: string;
    /** Opens on a filter tab, e.g. ?filter=overdue from the dashboard banner. */
    filter?: string;
    /** Opens a view: all | completed | history | patients. */
    view?: string;
    /** With highlightId: open that task's Vital Signs Check-ins (from a vitals reminder). */
    openVitals?: string;
  }>();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const taskYOffsets = useRef<Record<string, number>>({});
  // Tracks which deep-link target (taskId/patientId pair) has already been
  // handled, so a later unrelated `tasks` refresh can't re-trigger the
  // highlight/scroll or the "not found" toast for the same link.
  const handledDeepLinkRef = useRef<string | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('all');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState<'add' | 'edit'>('add');
  const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
  const [taskToUnassign, setTaskToUnassign] = useState<string | null>(null);
  const [unassignLoading, setUnassignLoading] = useState(false);
  const [expandedChecklistId, setExpandedChecklistId] = useState<string | null>(null);
  const [checklistSaving, setChecklistSaving] = useState<string | null>(null);
  // Fetched for every vital_signs task right after the task list loads (see
  // loadTasks), so the checklist's lock state is correct even before the
  // nurse ever opens the vitals card for that task this session.
  const [vitalsReadingCounts, setVitalsReadingCounts] = useState<Record<string, number>>({});
  const [vitalsModalTaskId, setVitalsModalTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<TaskView>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'procedure' | 'referral'>('all');
  const [folders, setFolders] = useState<MyPatientFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [completingTask, setCompletingTask] = useState<Task | null>(null);
  // Bumped after a completion so the History view refetches.
  const [historyKey, setHistoryKey] = useState(0);
  // "View Overdue Tasks" (and any other ?filter= / ?view= link) opens on that
  // tab. A param, not initial state: this screen stays mounted between visits.
  useEffect(() => {
    const filter = typeof params.filter === 'string' ? params.filter : '';
    const viewParam = typeof params.view === 'string' ? params.view : '';
    (() => {
      if (filter === 'completed' || viewParam === 'completed') {
        setView('completed');
        setSearchQuery('');
      } else if (['all', 'high', 'medium', 'low', 'overdue'].includes(filter)) {
        setView('all');
        setSelectedTab(filter);
        setSearchQuery('');
      } else if (viewParam === 'history' || viewParam === 'patients' || viewParam === 'all') {
        setView(viewParam);
      }
    })();
  }, [params.filter, params.view]);
  // Default view order: High -> Medium -> Low risk, overdue first within
  // each, then soonest due date/time, completed last — see the 'priority'
  // branch of filteredTasks' sort below.
  const [sortBy, setSortBy] = useState<SortBy>('priority');
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  // Card / Table layout switch, remembered per device (see TASK_VIEW_KEY).
  const [taskViewMode, setTaskViewModeState] = useState<TaskViewMode>(loadTaskView);
  const setTaskViewMode = useCallback((mode: TaskViewMode) => {
    setTaskViewModeState(mode);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(TASK_VIEW_KEY, mode);
    } catch {
      // ignore storage failures — the choice still applies this session
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      setFolders(await fetchMyPatientFolders());
    } catch {
      // The task list itself still works; the folder view shows its empty state.
    } finally {
      setFoldersLoading(false);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    void loadFolders();
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
  }, [toast, loadFolders]);

  // Refetch whenever the screen comes back into view, not just on mount.
  // expo-router keeps screens mounted, so a nurse who acknowledges a handover
  // and then taps Tasks would otherwise be looking at a list built before the
  // handover's work was added to it.
  useFocusEffect(
    useCallback(() => {
      void loadTasks();
    }, [loadTasks])
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
    const openVitals = params.openVitals === '1' || params.openVitals === 'true';
    if (!taskId && !(scrollToPatient && patientId)) {
      // No link pending (or it was consumed below): the same link may be followed again later.
      handledDeepLinkRef.current = null;
      return;
    }

    // Handle each distinct deep link exactly once — this effect also reruns
    // on every unrelated live `tasks` refresh (see the deps list), which
    // would otherwise re-show the "not found" toast or re-highlight the
    // task repeatedly for as long as the nurse stays on this screen.
    const linkKey = `${taskId ?? ''}|${scrollToPatient ? patientId ?? '' : ''}|${openVitals ? 'vitals' : ''}`;
    if (loading || handledDeepLinkRef.current === linkKey) return;

    // A leftover search query or status tab from an earlier visit to this
    // same screen (expo-router keeps it mounted — see the comment above the
    // useLiveRefresh call below) could hide the exact task this link was
    // supposed to surface.
    setSearchQuery('');
    setSelectedTab('all');
    setTypeFilter('all');

    const targetId = taskId || tasks.find((task) => task.patientId === patientId)?.id;
    // get_queryset() already scopes the fetched list to tasks this nurse can
    // see — if the id didn't resolve, or resolved but isn't in that list,
    // there is nothing valid to open.
    if (!targetId || !tasks.some((task) => task.id === targetId)) {
      handledDeepLinkRef.current = linkKey;
      toast.error('Task not found', {
        description: 'This task is no longer available, or you do not have access to it.',
      });
      return;
    }

    handledDeepLinkRef.current = linkKey;
    (() => {
      // A finished task lives under Completed, an open one under All Tasks.
      setView(tasks.find((task) => task.id === targetId)?.status === 'completed' ? 'completed' : 'all');
      if (!openVitals) setHighlightedTaskId(targetId);
    })();
    if (openVitals) {
      // A vital signs reminder: open that task's Check-ins straight away, then
      // consume the link so tapping the same reminder again reopens it.
      (() => setVitalsModalTaskId(targetId))();
      router.setParams({ openVitals: undefined, highlightId: undefined, taskId: undefined });
      return;
    }
    let attempts = 0;
    const scrollTimer = setInterval(() => {
      attempts += 1;
      const y = taskYOffsets.current[targetId];
      if (y !== undefined && scrollRef.current) {
        scrollRef.current.scrollTo({ y: Math.max(y - 80, 0), animated: true });
        clearInterval(scrollTimer);
      } else if (attempts > 20) {
        clearInterval(scrollTimer);
      }
    }, 150);
    const clearHighlight = setTimeout(() => setHighlightedTaskId(null), 3000);
    return () => {
      clearInterval(scrollTimer);
      clearTimeout(clearHighlight);
    };
    // toast is stable (useToast's own context value); omitting it keeps this
    // from re-running on every unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.taskId, params.highlightId, params.patientId, params.scrollToPatient, params.openVitals, tasks, loading]);

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
          priority: taskData.priority || 'medium',
          taskType: taskData.taskType || 'procedure',
          dueDate: taskData.dueDate || '',
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

  // Done opens the remarks dialog; the task only moves to Completed once the
  // server has saved the completion (see CompleteTaskDialog).
  const handleCompleteTask = (task: Task) => {
    if (task.status === 'completed') return;
    setCompletingTask(task);
  };

  const handleTaskCompleted = (updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setCompletingTask(null);
    setHistoryKey((k) => k + 1);
    void loadFolders();
    toast.success('Task completed', {
      description: `"${updated.title}" was saved with your remarks and moved to Completed.`,
    });
  };

  const handleToggleChecklistItem = async (task: Task, index: number) => {
    const isLastItem = index === task.checklist.length - 1;
    const isVitalsTask = task.category === 'vital_signs';
    const readingCount = vitalsReadingCounts[task.id] ?? 0;
    const required = readingsRequired(task);
    if (isVitalsTask && isLastItem && !task.checklist[index].done && readingCount < required) {
      toast.error('Vital signs not recorded yet', {
        description: `Record at least ${required} vital sign reading${required > 1 ? 's' : ''} (heart icon) before completing this step.`,
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

  const unfinishedTasks = tasks.filter((t) => t.status !== 'completed');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const matchesType = (task: Task) => typeFilter === 'all' || (task.taskType || 'procedure') === typeFilter;

  // All Tasks = unfinished only; Completed = finished only.
  const filteredTasks = (view === 'completed' ? completedTasks : unfinishedTasks)
    .filter((task) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        searchQuery === '' ||
        task.title.toLowerCase().includes(q) ||
        task.description.toLowerCase().includes(q) ||
        task.patientName.toLowerCase().includes(q) ||
        (task.completionRemarks || '').toLowerCase().includes(q);
      if (!matchesSearch || !matchesType(task)) return false;
      if (view === 'completed') return true;

      return matchesTaskFilter(task, selectedTab);
    })
    .sort((a, b) => {
      if (view === 'completed' && (sortBy === 'newest' || sortBy === 'priority')) {
        // Most recently completed first.
        return (b.completedAt || '').localeCompare(a.completedAt || '');
      }
      if (sortBy === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortBy === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sortBy === 'priority') {
        // Default view order: completed last regardless of risk; within the
        // rest, High -> Medium -> Low; within the same risk, overdue first;
        // then soonest due date/time (undated tasks sort last in their
        // group). Mirrors TaskViewSet.get_queryset's backend ordering.
        const aCompleted = a.status === 'completed' ? 1 : 0;
        const bCompleted = b.status === 'completed' ? 1 : 0;
        if (aCompleted !== bCompleted) return aCompleted - bCompleted;
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        const aOverdue = a.status === 'overdue' ? 0 : 1;
        const bOverdue = b.status === 'overdue' ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        const aDue = a.dueDate ? `${a.dueDate} ${a.dueTime || ''}` : null;
        const bDue = b.dueDate ? `${b.dueDate} ${b.dueTime || ''}` : null;
        if (aDue && bDue) return aDue < bDue ? -1 : aDue > bDue ? 1 : 0;
        if (aDue) return -1;
        if (bDue) return 1;
        return 0;
      }
      if (sortBy === 'status') {
        const statusOrder = { overdue: 0, pending: 1, in_progress: 2, completed: 3 };
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return 0;
    });

  // Completion status is the card's primary color, not risk/priority — a
  // card background should never make an unfinished task look done (or vice
  // versa). Risk stays visible as the thin left-border accent stripe and
  // the badge's text color only, never as a full background fill.
  const getCardStatusStyle = (task: Task) => {
    if (task.status === 'completed') {
      return { backgroundColor: Colors.green50, borderColor: Colors.green200 };
    }
    return { backgroundColor: Colors.white, borderColor: Colors.gray200 };
  };

  const RISK_LABELS: Record<string, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' };
  const RISK_COLORS: Record<string, string> = { high: Colors.red600, medium: Colors.orange600, low: Colors.green600 };

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

  const typedUnfinished = unfinishedTasks.filter(matchesType);
  const counts = countTasksByFilter(typedUnfinished);

  const filterTabs = [
    { id: 'all', label: 'All', count: counts.all, color: Colors.blue600 },
    { id: 'high', label: 'High', count: counts.high, color: Colors.red600 },
    { id: 'medium', label: 'Medium', count: counts.medium, color: Colors.orange600 },
    { id: 'low', label: 'Low', count: counts.low, color: Colors.green600 },
    { id: 'overdue', label: 'Overdue', count: counts.overdue, color: Colors.orange700 },
  ];

  const viewCards: { id: TaskView; label: string; description: string; icon: typeof ListChecks }[] = [
    { id: 'all', label: 'All Tasks', description: 'Unfinished tasks only', icon: ListChecks },
    { id: 'completed', label: 'Completed', description: 'Finished tasks and remarks', icon: CheckCircle2 },
    { id: 'history', label: 'History', description: 'All past tasks and notes', icon: History },
    { id: 'patients', label: 'My Patients', description: 'Tasks organized by patient', icon: FolderOpen },
  ];

  const switchView = (next: TaskView) => {
    setView(next);
    setOpenFolderId(null);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };


  // 10 per page; Next/Prev jumps back to the top.
  const paged = usePagination(filteredTasks, {
    scrollRef,
    resetKey: `${view}|${typeFilter}|${searchQuery}|${selectedTab}|${sortBy}`,
  });
  // A task opened from a link may sit on a later page: show that page first
  // (the deep-link effect above then scrolls to it).
  const { setPage: goToTaskPage, pageSize: taskPageSize } = paged;
  useEffect(() => {
    if (!highlightedTaskId) return;
    const index = filteredTasks.findIndex((task) => task.id === highlightedTaskId);
    if (index >= 0) goToTaskPage(Math.floor(index / taskPageSize) + 1);
    // Only when the highlighted task changes, not on every live refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedTaskId]);
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
        <Card>
          <CardContent style={styles.headerCard}>
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <ClipboardList size={22} color={Colors.teal600} />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.title}>Tasks</Text>
                <Text style={styles.subtitle}>Manage nursing procedures, endorsements, and patient care activities.</Text>
              </View>
              <Button size="sm" onPress={handleAddTask} style={styles.addBtn} accessibilityLabel="Add task">
                <Plus size={16} color={Colors.white} />
                <Text style={styles.addBtnText}>Add Task</Text>
              </Button>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Unfinished</Text>
                <Text style={[styles.statValue, { color: Colors.orange600 }]}>{unfinishedTasks.length}</Text>
                <Text style={styles.statHint}>Active tasks</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Completed</Text>
                <Text style={[styles.statValue, { color: Colors.green600 }]}>{completedTasks.length}</Text>
                <Text style={styles.statHint}>Finished tasks</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Patients</Text>
                <Text style={styles.statValue}>{folders.length}</Text>
                <Text style={styles.statHint}>Assigned to me</Text>
              </View>
            </View>

            <Text style={styles.viewsLabel}>Task views</Text>
            <View style={styles.viewGrid}>
              {viewCards.map((card) => {
                const active = view === card.id;
                const Icon = card.icon;
                return (
                  <Pressable
                    key={card.id}
                    onPress={() => switchView(card.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={(state) => [
                      styles.viewCard,
                      active && styles.viewCardActive,
                      !active && (state as { hovered?: boolean }).hovered && styles.viewCardHover,
                    ]}
                  >
                    <View style={styles.viewCardTop}>
                      <Icon size={16} color={active ? Colors.teal700 : Colors.gray600} />
                      <Text style={[styles.viewCardLabel, active && styles.viewCardLabelActive]}>{card.label}</Text>
                    </View>
                    <Text style={styles.viewCardDesc}>{card.description}</Text>
                  </Pressable>
                );
              })}
            </View>
          </CardContent>
        </Card>

        {view === 'history' ? (
          <TaskHistoryView
            scrollRef={scrollRef}
            patients={folders}
            canViewAllNurses={user?.role === 'head_nurse'}
            refreshKey={historyKey}
          />
        ) : view === 'patients' ? (
          <MyPatientsView
            folders={folders}
            tasks={tasks}
            loading={foldersLoading}
            openPatientId={openFolderId}
            onOpenPatient={(id) => {
              setOpenFolderId(id);
              scrollRef.current?.scrollTo({ y: 0, animated: true });
            }}
            onDone={handleCompleteTask}
            scrollRef={scrollRef}
          />
        ) : (
        <>
        <Text style={styles.sectionTitle}>
          {view === 'completed' ? 'Completed tasks' : 'Unfinished tasks'}
          <Text style={styles.sectionCount}>
            {'  '}
            {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
            {view === 'all' && selectedTab !== 'all' ? ` in ${selectedTab}` : ''}
          </Text>
        </Text>

        <View style={styles.searchRow}>
          <View style={styles.searchWrap}>
            <Input
              placeholder={view === 'completed' ? 'Search completed tasks or remarks...' : 'Search tasks...'}
              value={searchQuery}
              onChangeText={setSearchQuery}
              leftIcon={<Search size={18} color={Colors.gray500} />}
              inputWrapperStyle={styles.searchInput}
            />
          </View>
          <Select
            value={typeFilter}
            onValueChange={(value) => setTypeFilter(value as 'all' | 'procedure' | 'referral')}
            options={[
              { label: 'All types', value: 'all' },
              { label: 'Procedure', value: 'procedure' },
              { label: 'Endorsement', value: 'referral' },
            ]}
            placeholder="Type"
            style={styles.sortSelect}
          />
          <Select
            value={sortBy}
            onValueChange={(value) => setSortBy(value as SortBy)}
            options={SORT_OPTIONS}
            placeholder="Sort by"
            style={styles.sortSelect}
          />
          {/* Card / Table layout switch — remembered per device. */}
          <View style={styles.viewSwitch} accessibilityRole="radiogroup">
            {([
              { key: 'card', icon: LayoutGrid, label: 'Card view' },
              { key: 'table', icon: Table2, label: 'Table view' },
            ] as const).map(({ key, icon: Icon, label }) => {
              const active = taskViewMode === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTaskViewMode(key)}
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
        </View>

        {view === 'all' ? (
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
        ) : null}

        <View style={styles.list}>
          {filteredTasks.length === 0 ? (
            <Card>
              <CardContent style={styles.empty}>
                <Text style={styles.emptyText}>
                  {view === 'completed'
                    ? 'No completed tasks yet.'
                    : searchQuery || typeFilter !== 'all' || selectedTab !== 'all'
                      ? 'No unfinished tasks match these filters.'
                      : 'You have no unfinished tasks. Nice work!'}
                </Text>
              </CardContent>
            </Card>
          ) : taskViewMode === 'table' ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              style={styles.tableScroll}
              contentContainerStyle={styles.tableScrollContent}
            >
              <View style={[styles.tableInner, { minWidth: TASK_TABLE_MIN_WIDTH }]}>
                <View style={styles.tableHeaderRow}>
                  {['Task', 'Patient', 'Priority', 'Due', 'Status', 'Nurse'].map((h, i) => (
                    <Text key={h} style={[styles.tableHeadCell, TASK_TABLE_COLS[i]]} numberOfLines={1}>
                      {h}
                    </Text>
                  ))}
                </View>
                {paged.pageItems.map((task) => (
                  <Pressable
                    key={task.id}
                    onPress={() => handleEditTask(task)}
                    style={({ hovered }: { hovered?: boolean }) => [styles.tableRow, hovered && styles.tableRowHover]}
                    accessibilityLabel={`Open task ${task.title}`}
                  >
                    <View style={[styles.tableCell, TASK_TABLE_COLS[0]]}>
                      <Text style={styles.tableCellStrong} numberOfLines={2}>
                        {getCategoryIcon(task.category)} {task.title}
                      </Text>
                    </View>
                    <Text style={[styles.tableCellText, TASK_TABLE_COLS[1]]} numberOfLines={2}>
                      {task.patientName} ({task.patientId})
                    </Text>
                    <View style={[styles.tableCell, TASK_TABLE_COLS[2]]}>
                      <Text style={[styles.tableBadgeText, { color: RISK_COLORS[task.priority] || Colors.gray600 }]} numberOfLines={1}>
                        {RISK_LABELS[task.priority] || task.priority}
                      </Text>
                    </View>
                    <Text
                      style={[styles.tableCellText, TASK_TABLE_COLS[3], isTaskOverdue(task) && styles.metaTextOverdue]}
                      numberOfLines={2}
                    >
                      {formatDueDate(task.dueDate) || '—'}
                      {formatDueDate(task.dueDate) && task.dueTime ? ' · ' : ''}
                      {formatTime12(task.dueTime)}
                    </Text>
                    <View style={[styles.tableCell, TASK_TABLE_COLS[4]]}>
                      <TaskStatusBadge status={task.status} />
                    </View>
                    <Text style={[styles.tableCellText, TASK_TABLE_COLS[5]]} numberOfLines={2}>
                      {task.assignedTo || 'Unassigned'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          ) : (
            paged.pageItems.map((task) => (
              <View
                key={task.id}
                onLayout={(e) => {
                  taskYOffsets.current[task.id] = e.nativeEvent.layout.y;
                }}
              >
                <Card
                  style={{
                    ...styles.taskCard,
                    ...getCardStatusStyle(task),
                    borderLeftWidth: 4,
                    borderLeftColor: RISK_COLORS[task.priority] || Colors.gray400,
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
                            variant="outline"
                            textStyle={{ ...styles.badgeXs, color: RISK_COLORS[task.priority] || Colors.gray600 }}
                          >
                            {RISK_LABELS[task.priority] || task.priority}
                          </Badge>
                          <TaskTypeBadge type={task.taskType} />
                          <TaskStatusBadge status={task.status} />
                        </View>
                        <Text style={styles.taskDescription}>{task.description}</Text>

                        <View style={styles.metaBlock}>
                          <View style={styles.metaRow}>
                            <View style={styles.metaItem}>
                              <Clock size={15} color={isTaskOverdue(task) ? Colors.red600 : Colors.gray600} />
                              <Text style={[styles.dueText, isTaskOverdue(task) && styles.metaTextOverdue]}>
                                {formatDueDate(task.dueDate)}
                                {formatDueDate(task.dueDate) && task.dueTime ? ' · ' : ''}
                                {formatTime12(task.dueTime)}
                              </Text>
                            </View>
                            {(() => {
                              const chip = taskDueChip(task);
                              return chip ? (
                                <View style={[styles.dueChip, { borderColor: chip.color }]}>
                                  <Text style={[styles.dueChipText, { color: chip.color }]}>{chip.label}</Text>
                                </View>
                              ) : null;
                            })()}
                          </View>
                          <View style={styles.metaRow}>
                            <Text style={styles.metaText}>
                              Patient: {task.patientName} ({task.patientId})
                            </Text>
                            {task.assignedTo ? (
                              <Text style={styles.metaText}>Nurse: {task.assignedTo}</Text>
                            ) : null}
                          </View>
                          {task.category === 'vital_signs' ? (
                            <View style={styles.metaRow}>
                              <Text style={styles.metaTextSm}>
                                <Text style={styles.metaBold}>Vital Signs Monitoring: </Text>
                                {vitalsMonitoringOrderLabel(task.vitalsMonitoringOrder)}
                              </Text>
                            </View>
                          ) : null}
                          {task.status === 'completed' ? (
                            <View style={styles.completedBox}>
                              <Text style={styles.completedMeta}>
                                Completed {formatDateTime(task.completedAt)}
                                {task.completedBy ? ` by ${task.completedBy}` : ''}
                              </Text>
                              <Text style={styles.completedLabel}>Remarks</Text>
                              <Text style={styles.completedRemarks}>
                                {task.completionRemarks ||
                                  'No remarks were recorded (completed before remarks were required).'}
                              </Text>
                            </View>
                          ) : null}

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
                                      readingCount < readingsRequired(task);
                                    return (
                                      <Pressable
                                        key={index}
                                        style={styles.checklistItemRow}
                                        disabled={checklistSaving === task.id || task.status === 'completed'}
                                        onPress={() => handleToggleChecklistItem(task, index)}
                                      >
                                        {item.done ? (
                                          <CheckSquare size={18} color={Colors.green600} />
                                        ) : isLocked ? (
                                          <Lock size={16} color={Colors.gray400} />
                                        ) : (
                                          <Square size={18} color={Colors.gray400} />
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
                                            ? ` (record ${readingsRequired(task)} vital${readingsRequired(task) > 1 ? 's' : ''} first)`
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
                          <>
                            <Pressable
                              onPress={() => handleCompleteTask(task)}
                              style={styles.doneBtn}
                              accessibilityRole="button"
                              accessibilityLabel={`Mark ${task.title} as done`}
                            >
                              <Check size={16} color={Colors.white} />
                              <Text style={styles.doneBtnText}>Done</Text>
                            </Pressable>
                            <Button
                              size="icon-sm"
                              variant="outline"
                              onPress={() => handleEditTask(task)}
                              style={styles.editBtn}
                              accessibilityLabel="Edit task"
                            >
                              <Edit size={16} color={Colors.blue600} />
                            </Button>
                            {/* Every task here already belongs to this nurse (fetchTasks({ mine: true })),
                                or to no one in particular for a head nurse, who may record vitals for
                                any patient. The backend's care-scope check still rejects a save if the
                                patient was reassigned away from this nurse. */}
                            <Button
                              size="icon-sm"
                              variant="outline"
                              onPress={() => setVitalsModalTaskId(task.id)}
                              style={styles.vitalsBtn}
                              accessibilityLabel="Record vital signs"
                            >
                              <HeartPulse size={16} color={Colors.red600} />
                            </Button>
                          </>
                        ) : null}
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
          <Pagination
            page={paged.page}
            totalPages={paged.totalPages}
            onPageChange={paged.setPage}
            total={paged.total}
          />
        </View>
        </>
        )}
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

      <CompleteTaskDialog
        task={completingTask}
        onClose={() => setCompletingTask(null)}
        onCompleted={handleTaskCompleted}
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
              <Text style={styles.vitalsModalSubtitle}>
                Assigned nurse: {vitalsModalTask.assignedTo || '—'}
                {vitalsModalTask.dueTime ? ` · Scheduled ${vitalsModalTask.dueTime}` : ''}
              </Text>
              <Text style={styles.vitalsModalSubtitle}>
                Vital Signs Monitoring: {vitalsMonitoringOrderLabel(vitalsModalTask.vitalsMonitoringOrder)}
              </Text>
              <ScrollView style={styles.vitalsModalScroll} keyboardShouldPersistTaps="handled">
                <TaskVitalSignsBars
                  taskId={vitalsModalTask.id}
                  patientId={vitalsModalTask.patientId}
                  readingsRequired={readingsRequired(vitalsModalTask)}
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
  headerCard: {
    padding: 16,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.teal50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  stat: {
    flex: 1,
    minWidth: 0,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.gray600,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.gray900,
    marginTop: 2,
  },
  statHint: {
    fontSize: 12,
    color: Colors.gray500,
  },
  viewsLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.gray900,
    marginBottom: -6,
  },
  viewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  viewCard: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 140,
    padding: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    gap: 4,
  },
  viewCardActive: {
    borderColor: Colors.teal600,
    backgroundColor: Colors.teal50,
  },
  viewCardHover: {
    borderColor: Colors.teal100,
  },
  viewCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  viewCardLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.gray800,
  },
  viewCardLabelActive: {
    color: Colors.teal700,
  },
  viewCardDesc: {
    fontSize: 12,
    color: Colors.gray500,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.gray900,
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.gray500,
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: Colors.green600,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: Radius.md,
  },
  doneBtnText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 13,
  },
  completedBox: {
    marginTop: 6,
    backgroundColor: Colors.green50,
    borderWidth: 1,
    borderColor: Colors.green200,
    borderRadius: Radius.sm,
    padding: 8,
    gap: 2,
  },
  completedMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.green700,
  },
  completedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.green800,
    marginTop: 4,
  },
  completedRemarks: {
    fontSize: 13,
    color: Colors.gray800,
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
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-start',
  },
  searchWrap: {
    flex: 1,
    minWidth: 220,
  },
  searchInput: {
    borderWidth: 2,
    borderColor: Colors.gray200,
    ...Shadows.md,
  },
  sortSelect: {
    width: 140,
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
  tableBadgeText: { fontSize: 12, fontWeight: '800' },
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
  // Large/easy-to-read due date+time, distinct from the smaller metaText
  // used for secondary details (patient, doctor, room).
  dueText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.gray800,
  },
  metaTextOverdue: {
    color: Colors.red600,
    fontWeight: '700',
  },
  dueChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  dueChipText: {
    fontSize: 11,
    fontWeight: '700',
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
  // A comfortable thumb tap (36px is close to the 44px minimum target
  // without the row ballooning on a narrow phone) — the old row had no
  // padding or minHeight at all, just an icon and 12px text packed tight
  // together, so this is a moderate bump rather than the much larger one
  // tried first, which read as oversized on phone.
  checklistItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray50,
  },
  checklistItemText: {
    fontSize: 13,
    lineHeight: 18,
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
