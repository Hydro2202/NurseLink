import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router';
import { mockTasks } from '../data/mockData';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  CheckCircle,
  Clock,
  AlertTriangle,
  Edit,
  Trash2,
  Plus,
  Loader2,
  Search,
  ArrowUpDown,
  Stethoscope,
  Bed,
  ClipboardList,
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
import { Task } from '../types';
import { toast } from 'sonner';

export default function TasksPage() {
  const location = useLocation();
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
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'priority' | 'status'>('newest');
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

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
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 800));

    if (taskModalMode === 'add') {
      const newTask: Task = {
        id: `task-${Date.now()}`,
        patientId: taskData.patientId || '',
        patientName: taskData.patientName || '',
        title: taskData.title || '',
        description: taskData.description || '',
        priority: taskData.priority || 'routine',
        dueTime: taskData.dueTime || '',
        assignedTo: 'Current User',
        status: 'pending',
        category: 'medication',
        createdAt: new Date().toISOString(),
        attendingPhysician: taskData.attendingPhysician,
        patientRoom: taskData.patientRoom,
        doctorOrder: taskData.doctorOrder,
      };
      setTasks([newTask, ...tasks]);
      toast.success('Task added successfully!', {
        description: `"${newTask.title}" has been added to your task list.`,
      });
    } else {
      setTasks(tasks.map(task =>
        task.id === selectedTask?.id
          ? { ...task, ...taskData }
          : task
      ));
      toast.success('Task updated successfully!', {
        description: 'Your changes have been saved.',
      });
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    setTaskToDelete(taskId);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;

    setDeleteLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 600));

    const deletedTask = tasks.find(t => t.id === taskToDelete);
    setTasks(tasks.filter(task => task.id !== taskToDelete));
    setDeleteLoading(false);
    setDeleteDialogOpen(false);
    setTaskToDelete(null);

    toast.success('Task deleted', {
      description: `"${deletedTask?.title}" has been removed from your task list.`,
    });
  };

  const handleCompleteTask = async (task: Task) => {
    setCompleteLoading(task.id);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 800));

    setTasks(tasks.map(t =>
      t.id === task.id
        ? {
            ...t,
            status: 'completed' as const,
            priority: 'completed' as const,
            completedAt: new Date().toISOString(),
          }
        : t
    ));
    setCompleteLoading(null);

    toast.success('Task completed! 🎉', {
      description: `"${task.title}" has been marked as complete.`,
    });
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteTask(task.id)}
                      className="text-red-600 border-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
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
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDeleteTask}
        loading={deleteLoading}
        title="Delete Task"
        description="Are you sure you want to delete this task? This action cannot be undone."
      />
    </div>
  );
}