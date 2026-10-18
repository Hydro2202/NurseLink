import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { useLiveRefresh } from '../contexts/LiveContext';
import {
  fetchTasks,
  createTask,
  updateTask,
  unassignTask,
  completeTask,
  fetchPatients,
  fetchVitalReadings,
  ApiError,
} from '../api/nurselink';
import type { Task } from '../types/domain';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  CheckCircle,
  Clock,
  AlertTriangle,
  Edit,
  UserMinus,
  Plus,
  Loader2,
  Search,
  ArrowUpDown,
  Stethoscope,
  Bed,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Square,
  CheckSquare,
  Lock,
  HeartPulse,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { TaskModal } from '../components/TaskModal';
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog';
import { TaskVitalSignsBars } from '../components/TaskVitalSignsBars';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { toast } from 'sonner';

const VITALS_READINGS_REQUIRED = 2;

/** "Mar 15" from an ISO "YYYY-MM-DD" — '' if blank (predates dueDate).
 * Exported for NurseTasksPage.tsx, which shows the same task cards in the
 * head nurse's per-nurse view and wants the same overdue flagging. */
export function formatDueDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** True once a task's due date+time has passed and it's still not done. */
export function isTaskOverdue(task: Task): boolean {
  if (task.status === 'completed' || !task.dueDate || !task.dueTime) return false;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const [h, min] = task.dueTime.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(min)) return false;
  return new Date(y, m - 1, d, h, min).getTime() < Date.now();
}

/** "Due in 12 min" (amber) / "Due now" (red) / "Overdue by 25 min" (red) /
 * "Completed" (green) — null once it's more than half an hour out, where
 * the plain due date/time next to it already says enough. */
export function taskDueChip(task: Task): { label: string; color: string } | null {
  if (task.status === 'completed') return { label: 'Completed', color: '#16A34A' };
  if (!task.dueDate || !task.dueTime) return null;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const [h, min] = task.dueTime.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(min)) return null;
  const due = new Date(y, m - 1, d, h, min).getTime();
  const diffMin = Math.round((due - Date.now()) / 60000);
  if (task.status === 'overdue' || diffMin < 0) {
    return { label: diffMin < 0 ? `Overdue by ${Math.abs(diffMin)} min` : 'Overdue', color: '#DC2626' };
  }
  if (diffMin === 0) return { label: 'Due now', color: '#DC2626' };
  if (diffMin <= 30) return { label: `Due in ${diffMin} min`, color: '#EA580C' };
  return null;
}

export default function TasksPage() {
  const location = useLocation();
  const { user } = useAuth();
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
  // Fetched for every vital_signs task right after the task list loads, so
  // the checklist's lock state is correct even before the nurse ever opens
  // the vitals panel for that task this session.
  const [vitalsReadingCounts, setVitalsReadingCounts] = useState<Record<string, number>>({});
  const [vitalsModalTaskId, setVitalsModalTaskId] = useState<string | null>(null);
  // Codes of the patients this nurse is assigned to. Vitals can only be
  // recorded for those (the server enforces it — VitalSignsViewSet's
  // _check_patient_care_scope); null until loaded.
  const [myPatientCodes, setMyPatientCodes] = useState<Set<string> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Default view order: High -> Medium -> Low risk, overdue first within
  // each, then soonest due date/time, completed last.
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'priority' | 'status'>('priority');
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

  const loadTasks = React.useCallback(async (options?: { quiet?: boolean }) => {
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
      if (!options?.quiet) {
        toast.error(error instanceof ApiError ? error.message : 'Failed to load tasks');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // Tasks are written on other nurses'/head nurses' devices (assigned,
  // completed, handed over), so this follows the shared live revision
  // instead of only what this device has done itself.
  useLiveRefresh('tasks', () => {
    void loadTasks({ quiet: true });
  });

  useEffect(() => {
    // Head nurses may record vitals for any patient, so they need no list.
    if (user?.role === 'head_nurse') return;
    let cancelled = false;
    fetchPatients({ mine: true })
      .then((patients) => {
        if (!cancelled) setMyPatientCodes(new Set(patients.map((p) => p.id)));
      })
      .catch(() => {
        // Without the list the vitals button stays hidden; nothing else depends on it.
        if (!cancelled) setMyPatientCodes(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  // The task this screen should land on and highlight — from the dashboard's
  // "Upcoming Tasks" arrow / TaskDueAlertModal (state.taskId), or from a
  // notification (NotificationPanel/NotificationToastCard send
  // state.highlightId, same convention as mobile's tasks.tsx). Captured once
  // via a lazy initializer, not re-read from location.state on every render,
  // so clearing the browser history entry below can't make a slower-loading
  // task list lose track of what it was supposed to scroll to.
  const [targetTaskId] = useState<string | null>(() => {
    const state = location.state as { taskId?: string; highlightId?: string } | null;
    return state?.taskId || state?.highlightId || null;
  });
  const [targetPatientTask] = useState<{ patientId: string; scrollToPatient: boolean } | null>(() => {
    const state = location.state as { patientId?: string; scrollToPatient?: boolean } | null;
    return state?.scrollToPatient && state?.patientId
      ? { patientId: state.patientId, scrollToPatient: true }
      : null;
  });

  useEffect(() => {
    // Clear the state right away so a browser back/forward can't re-trigger
    // this; the two captures above already have what they need for this mount.
    if (location.state) window.history.replaceState({}, document.title);
    // A leftover search query or status tab from an earlier visit to this
    // same page (React Router doesn't remount TasksPage just because a
    // notification navigated here again) could hide the exact task this
    // link was supposed to surface.
    if (targetTaskId || targetPatientTask) {
      setSearchQuery('');
      setSelectedTab('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handled exactly once per mount — without this, every later unrelated
  // live `tasks` refresh would re-run this effect (it depends on `tasks`)
  // and re-trigger the highlight/scroll, or re-show the "not found" toast,
  // for as long as the nurse stays on this page.
  const deepLinkHandledRef = useRef(false);

  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    if (!targetTaskId && !targetPatientTask) return;
    if (loading) return; // wait for the real, permission-scoped list first

    const id = targetTaskId || tasks.find((t) => t.patientId === targetPatientTask?.patientId)?.id;
    // fetchTasks() already scopes to tasks this nurse can see — if the id
    // didn't resolve, or resolved but isn't in that list, there is nothing
    // valid to open.
    if (!id || !tasks.some((t) => t.id === id)) {
      deepLinkHandledRef.current = true;
      toast.error('Task not found', {
        description: 'This task is no longer available, or you do not have access to it.',
      });
      return;
    }

    deepLinkHandledRef.current = true;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const element = document.getElementById(`task-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedTaskId(id);
        setTimeout(() => setHighlightedTaskId(null), 3000);
        clearInterval(timer);
      } else if (attempts > 20) {
        clearInterval(timer);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [targetTaskId, targetPatientTask, tasks, loading]);

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
      toast.error(error instanceof ApiError ? error.message : 'Failed to save task');
      throw error;
    }
  };

  const handleUnassignTask = async (taskId: string) => {
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
      toast.error(error instanceof ApiError ? error.message : 'Failed to unassign task');
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
      toast.error(error instanceof ApiError ? error.message : 'Failed to complete task');
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
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, checklist: nextChecklist } : t)));
    setChecklistSaving(task.id);
    try {
      const updated = await updateTask(task.id, { checklist: nextChecklist });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      toast.error(error instanceof ApiError ? error.message : 'Failed to update checklist');
    } finally {
      setChecklistSaving(null);
    }
  };

  const vitalsModalTask = tasks.find((t) => t.id === vitalsModalTaskId) || null;

  // Filter and sort tasks
  const filteredTasks = tasks
    .filter(task => {
      // Search filter
      const matchesSearch = searchQuery === '' ||
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.patientName.toLowerCase().includes(searchQuery.toLowerCase());

      // Tab filter
      if (selectedTab === 'all') return matchesSearch;
      if (selectedTab === 'high') return matchesSearch && task.priority === 'high';
      if (selectedTab === 'medium') return matchesSearch && task.priority === 'medium';
      if (selectedTab === 'low') return matchesSearch && task.priority === 'low';
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
        // Default view order: completed last regardless of risk; within the
        // rest, High -> Medium -> Low; within the same risk, overdue first;
        // then soonest due date/time. Mirrors the backend's default
        // TaskViewSet.get_queryset ordering.
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

  const RISK_LABELS: Record<string, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' };
  const RISK_TEXT_COLORS: Record<string, string> = { high: '#DC2626', medium: '#EA580C', low: '#16A34A' };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-50 border-red-200';
      case 'medium': return 'bg-orange-50 border-orange-100';
      case 'low': return 'bg-green-50 border-green-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'medication': return '💊';
      case 'vital_signs': return '📊';
      case 'care': return '🩺';
      case 'assessment': return '📋';
      case 'documentation': return '📝';
      default: return '📌';
    }
  };

  const getTaskCounts = () => ({
    all: tasks.length,
    high: tasks.filter(t => t.priority === 'high').length,
    medium: tasks.filter(t => t.priority === 'medium').length,
    low: tasks.filter(t => t.priority === 'low').length,
    overdue: tasks.filter(t => t.status === 'overdue').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  });

  const counts = getTaskCounts();

  const filterTabs = [
    { id: 'all', label: 'All', count: counts.all, color: 'bg-blue-600' },
    { id: 'high', label: 'High', count: counts.high, color: 'bg-red-600' },
    { id: 'medium', label: 'Medium', count: counts.medium, color: 'bg-orange-600' },
    { id: 'low', label: 'Low', count: counts.low, color: 'bg-green-600' },
    { id: 'overdue', label: 'Overdue', count: counts.overdue, color: 'bg-orange-700' },
    { id: 'completed', label: 'Done', count: counts.completed, color: 'bg-green-700' },
  ];

  return (
    <div className="p-4 pb-24 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Tasks</h1>
          <p className="text-gray-600">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
            {selectedTab !== 'all' && ` in ${selectedTab}`}
          </p>
        </div>
        <Button
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 shadow-md"
          onClick={handleAddTask}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Task
        </Button>
      </div>

      {/* Search and Sort */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
          <Input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10 shadow-md border-2 border-gray-200 focus:border-blue-500 focus:shadow-lg focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
          <SelectTrigger className="w-[160px] shadow-md border-2 border-gray-200 focus:border-blue-500 focus:shadow-lg focus:ring-2 focus:ring-blue-200">
            <ArrowUpDown className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filter Tabs with Better Spacing */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSelectedTab(tab.id)}
            className={`flex-shrink-0 px-4 py-2.5 rounded-lg font-semibold text-sm transition-all ${
              selectedTab === tab.id
                ? `${tab.color} text-white shadow-md`
                : 'bg-white border-2 border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                selectedTab === tab.id
                  ? 'bg-white/30 text-white'
                  : 'bg-gray-200 text-gray-700'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500">No tasks found</p>
            </CardContent>
          </Card>
        ) : (
          filteredTasks.map(task => (
            <Card
              key={task.id}
              id={`task-${task.id}`}
              className={`border-2 border-l-4 ${getPriorityColor(task.priority)} hover:shadow-md transition-all ${
                highlightedTaskId === task.id ? 'ring-4 ring-blue-500 ring-opacity-50 shadow-lg scale-105' : ''
              }`}
              style={{ borderLeftColor: RISK_TEXT_COLORS[task.priority] || '#9CA3AF' }}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{getCategoryIcon(task.category)}</span>
                      <h3 className="font-bold text-gray-900">{task.title}</h3>
                      <Badge
                        variant="outline"
                        className="text-xs capitalize"
                        style={{ color: RISK_TEXT_COLORS[task.priority] || '#6B7280' }}
                      >
                        {RISK_LABELS[task.priority] || task.priority}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                    <div className="space-y-1">
                      {/* Primary Info: Date/Time, due-status chip, and Patient */}
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        <span className={`flex items-center gap-1 font-semibold ${isTaskOverdue(task) ? 'text-red-600' : 'text-gray-700'}`}>
                          <Clock className="w-4 h-4" />
                          {formatDueDate(task.dueDate)}
                          {formatDueDate(task.dueDate) && task.dueTime ? ' · ' : ''}
                          {task.dueTime}
                        </span>
                        {(() => {
                          const chip = taskDueChip(task);
                          return chip ? (
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded-full border"
                              style={{ color: chip.color, borderColor: chip.color }}
                            >
                              {chip.label}
                            </span>
                          ) : null;
                        })()}
                        <span className="text-gray-500">Patient: {task.patientName} ({task.patientId})</span>
                      </div>

                      {/* Secondary Info: Doctor and Room */}
                      {(task.attendingPhysician || task.patientRoom) && (
                        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                          {task.attendingPhysician && (
                            <span className="flex items-center gap-1">
                              <Stethoscope className="w-3.5 h-3.5" />
                              <span className="font-medium">Doctor:</span> {task.attendingPhysician}
                            </span>
                          )}
                          {task.patientRoom && (
                            <span className="flex items-center gap-1">
                              <Bed className="w-3.5 h-3.5" />
                              <span className="font-medium">Room:</span> {task.patientRoom}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Doctor's Order */}
                      {task.doctorOrder && (
                        <div className="mt-2 bg-blue-50 border border-blue-200 rounded-md p-2">
                          <div className="flex items-start gap-2">
                            <ClipboardList className="w-3.5 h-3.5 text-blue-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-semibold text-blue-900">Doctor's Order</p>
                              <p className="text-xs text-blue-800 mt-0.5">{task.doctorOrder}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Checklist */}
                      {task.checklist.length > 0 && (
                        <div className="mt-2 bg-purple-50 border border-purple-100 rounded-md p-2">
                          <button
                            type="button"
                            className="w-full flex items-center gap-2 text-left"
                            onClick={() =>
                              setExpandedChecklistId((prev) => (prev === task.id ? null : task.id))
                            }
                          >
                            <ClipboardList className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />
                            <span className="flex-1 text-xs font-semibold text-purple-700">
                              Checklist: {task.checklist.filter((i) => i.done).length}/
                              {task.checklist.length} completed
                            </span>
                            {expandedChecklistId === task.id ? (
                              <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                            )}
                          </button>
                          {expandedChecklistId === task.id && (
                            <div className="mt-2 space-y-1.5">
                              {task.checklist.map((item, index) => {
                                const isLocked =
                                  task.category === 'vital_signs' &&
                                  index === task.checklist.length - 1 &&
                                  !item.done &&
                                  (vitalsReadingCounts[task.id] ?? 0) < VITALS_READINGS_REQUIRED;
                                return (
                                  <button
                                    type="button"
                                    key={index}
                                    disabled={checklistSaving === task.id}
                                    onClick={() => handleToggleChecklistItem(task, index)}
                                    className="w-full flex items-center gap-2 text-left"
                                  >
                                    {item.done ? (
                                      <CheckSquare className="w-4 h-4 text-green-600 flex-shrink-0" />
                                    ) : isLocked ? (
                                      <Lock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                    ) : (
                                      <Square className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                    )}
                                    <span
                                      className={`text-xs ${
                                        item.done
                                          ? 'text-gray-400 line-through'
                                          : isLocked
                                            ? 'text-gray-400 italic'
                                            : 'text-gray-700'
                                      }`}
                                    >
                                      {item.text}
                                      {isLocked ? ` (record ${VITALS_READINGS_REQUIRED} vitals first)` : ''}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {task.status !== 'completed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCompleteTask(task)}
                        disabled={completeLoading === task.id}
                        className="text-green-600 border-green-600 hover:bg-green-50"
                      >
                        {completeLoading === task.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEditTask(task)}
                      className="text-blue-600 border-blue-600 hover:bg-blue-50"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    {(user?.role === 'head_nurse' || myPatientCodes?.has(task.patientId)) && (
                      <Button
                        size="sm"
                        variant="outline"
                        title="Record vital signs"
                        aria-label="Record vital signs"
                        onClick={() => setVitalsModalTaskId(task.id)}
                        className="text-red-600 border-red-600 hover:bg-red-50"
                      >
                        <HeartPulse className="w-4 h-4" />
                      </Button>
                    )}
                    {user?.role === 'head_nurse' && task.assignedTo && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUnassignTask(task.id)}
                        className="text-red-600 border-red-600 hover:bg-red-50"
                      >
                        <UserMinus className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Modals */}
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

      <Dialog
        open={!!vitalsModalTask}
        onOpenChange={(open) => {
          if (!open) setVitalsModalTaskId(null);
        }}
      >
        <DialogContent className="sm:max-w-[860px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HeartPulse className="w-5 h-5 text-red-600" />
              Vital Signs Check-ins
            </DialogTitle>
            <DialogDescription>
              {vitalsModalTask
                ? `${vitalsModalTask.patientName} (${vitalsModalTask.patientId}) · Room ${
                    vitalsModalTask.patientRoom || '—'
                  }`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {vitalsModalTask ? (
            <TaskVitalSignsBars
              key={vitalsModalTask.id}
              taskId={vitalsModalTask.id}
              patientId={vitalsModalTask.patientId}
              readingsRequired={VITALS_READINGS_REQUIRED}
              onReadingsChange={(count) =>
                setVitalsReadingCounts((prev) => ({ ...prev, [vitalsModalTask.id]: count }))
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}