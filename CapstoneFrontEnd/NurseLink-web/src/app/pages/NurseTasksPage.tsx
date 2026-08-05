import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import type { Task } from '../types/domain';
import { fetchTasks, createTask, updateTask, deleteTask, completeTask, ApiError } from '../api/nurselink';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  CheckCircle,
  Clock,
  Edit,
  Trash2,
  Plus,
  Loader2,
  Search,
  ArrowUpDown,
  Stethoscope,
  Bed,
  ClipboardList,
  ArrowLeft,
  UserCheck,
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

export default function NurseTasksPage() {
  // data loaded after nurseName is known

  const { nurseName } = useParams<{ nurseName: string }>();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
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

  useEffect(() => {
    if (!nurseName) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTasks({ assignedTo: decodeURIComponent(nurseName) });
        if (!cancelled) setTasks(data);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nurseName]);

  // Filter tasks by nurse
  const nurseTasks = tasks.filter(task => task.assignedTo === nurseName);

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
      const decodedName = nurseName ? decodeURIComponent(nurseName) : 'Current User';
      if (taskModalMode === 'add') {
        const newTask = await createTask({
          ...taskData,
          assignedTo: decodedName,
          status: 'pending',
          category: taskData.category || 'medication',
        });
        setTasks((prev) => [newTask, ...prev]);
        toast.success('Task added successfully!', {
          description: `"${newTask.title}" has been assigned to ${decodedName}.`,
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

  const handleDeleteTask = async (taskId: string) => {
    setTaskToDelete(taskId);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;

    setDeleteLoading(true);
    try {
      const deletedTask = tasks.find((t) => t.id === taskToDelete);
      await deleteTask(taskToDelete);
      setTasks((prev) => prev.filter((task) => task.id !== taskToDelete));
      setDeleteDialogOpen(false);
      setTaskToDelete(null);
      toast.success('Task deleted', {
        description: `"${deletedTask?.title}" has been removed.`,
      });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to delete task');
    } finally {
      setDeleteLoading(false);
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

  // Filter and sort tasks
  const filteredTasks = nurseTasks
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
    all: nurseTasks.length,
    urgent: nurseTasks.filter(t => t.priority === 'urgent').length,
    routine: nurseTasks.filter(t => t.priority === 'routine').length,
    overdue: nurseTasks.filter(t => t.status === 'overdue').length,
    completed: nurseTasks.filter(t => t.status === 'completed').length,
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
      {/* Header with Back Button */}
      <div className="space-y-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <UserCheck className="w-6 h-6 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900">{nurseName}'s Tasks</h1>
            </div>
            <p className="text-gray-600">
              {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
              {selectedTab !== 'all' && ` in ${selectedTab}`}
            </p>
            <p className="text-sm text-blue-600 font-medium mt-1">
              Supervisor Mode: Edit, delete, or complete tasks on behalf of {nurseName}
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

      {/* Filter Tabs */}
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
              <p className="text-gray-500">No tasks found for {nurseName}</p>
            </CardContent>
          </Card>
        ) : (
          filteredTasks.map(task => (
            <Card
              key={task.id}
              className={`border-2 ${getPriorityColor(task.priority)} hover:shadow-md transition-all`}
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
        description="Are you sure you want to delete this task? This action cannot be undone. The nurse will be notified."
      />
    </div>
  );
}
