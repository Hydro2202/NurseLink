import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchTasks,
  createTask,
  updateTask,
  unassignTask,
  completeTask,
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
import { toast } from 'sonner';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'priority' | 'status'>('newest');
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTasks({ mine: true });
        if (!cancelled) setTasks(data);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : 'Failed to load tasks');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Handle navigation from dashboard - scroll to and highlight specific task
  useEffect(() => {
    const state = location.state as { taskId?: string; patientId?: string; scrollToPatient?: boolean } | null;
    
    // Handle scroll to specific task
    if (state?.taskId) {
      setHighlightedTaskId(state.taskId);
      
      // Scroll to task after render
      setTimeout(() => {
        const element = document.getElementById(`task-${state.taskId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);

      // Remove highlight after 3 seconds
      setTimeout(() => {
        setHighlightedTaskId(null);
      }, 3000);

      // Clear the state to prevent re-highlighting on re-renders
      window.history.replaceState({}, document.title);
    }
    
    // Handle scroll to patient's first task
    if (state?.scrollToPatient && state?.patientId) {
      // Find the first task for this patient
      const patientTask = tasks.find(task => task.patientId === state.patientId);
      
      if (patientTask) {
        setHighlightedTaskId(patientTask.id);
        
        // Scroll to task after render
        setTimeout(() => {
          const element = document.getElementById(`task-${patientTask.id}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);

        // Remove highlight after 3 seconds
        setTimeout(() => {
          setHighlightedTaskId(null);
        }, 3000);
      }

      // Clear the state to prevent re-highlighting on re-renders
      window.history.replaceState({}, document.title);
    }
  }, [location.state, tasks]);

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

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-50 border-red-200';
      case 'routine': return 'bg-yellow-50 border-yellow-200';
      case 'completed': return 'bg-green-50 border-green-200';
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
    urgent: tasks.filter(t => t.priority === 'urgent').length,
    routine: tasks.filter(t => t.priority === 'routine').length,
    overdue: tasks.filter(t => t.status === 'overdue').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  });

  const counts = getTaskCounts();

  const filterTabs = [
    { id: 'all', label: 'All', count: counts.all, color: 'bg-blue-600' },
    { id: 'urgent', label: 'Urgent', count: counts.urgent, color: 'bg-red-600' },
    { id: 'routine', label: 'Routine', count: counts.routine, color: 'bg-yellow-600' },
    { id: 'overdue', label: 'Overdue', count: counts.overdue, color: 'bg-orange-600' },
    { id: 'completed', label: 'Done', count: counts.completed, color: 'bg-green-600' },
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
              className={`border-2 ${getPriorityColor(task.priority)} hover:shadow-md transition-all ${
                highlightedTaskId === task.id ? 'ring-4 ring-blue-500 ring-opacity-50 shadow-lg scale-105' : ''
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{getCategoryIcon(task.category)}</span>
                      <h3 className="font-bold text-gray-900">{task.title}</h3>
                      <Badge variant={task.priority === 'urgent' ? 'destructive' : 'secondary'} className="text-xs">
                        {task.priority}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                    <div className="space-y-1">
                      {/* Primary Info: Time and Patient */}
                      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {task.dueTime}
                        </span>
                        <span>Patient: {task.patientName} ({task.patientId})</span>
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
                              {task.checklist.map((item, index) => (
                                <button
                                  type="button"
                                  key={index}
                                  disabled={checklistSaving === task.id}
                                  onClick={() => handleToggleChecklistItem(task, index)}
                                  className="w-full flex items-center gap-2 text-left"
                                >
                                  {item.done ? (
                                    <CheckSquare className="w-4 h-4 text-green-600 flex-shrink-0" />
                                  ) : (
                                    <Square className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                  )}
                                  <span
                                    className={`text-xs ${
                                      item.done ? 'text-gray-400 line-through' : 'text-gray-700'
                                    }`}
                                  >
                                    {item.text}
                                  </span>
                                </button>
                              ))}
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
      />

      <DeleteConfirmDialog
        open={unassignDialogOpen}
        onOpenChange={setUnassignDialogOpen}
        onConfirm={confirmUnassignTask}
        loading={unassignLoading}
        title="Unassign Task"
        description="This will remove the assigned nurse and return the task to pending. The task itself is not deleted."
      />
    </div>
  );
}