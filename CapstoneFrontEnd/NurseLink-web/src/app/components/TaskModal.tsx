import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Textarea } from './ui/textarea';
import { Loader2, Stethoscope, Bed, ClipboardList } from 'lucide-react';
import { Task } from '../types';
import { mockPatients } from '../data/mockData';

interface TaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  onSave: (task: Partial<Task>) => Promise<void>;
  mode: 'add' | 'edit';
  allTasks?: Task[];
}

// List of attending physicians
const doctors = [
  'Dr. Juan Dela Cruz',
  'Dr. Maria Santos',
  'Dr. Antonio Reyes',
  'Dr. Carmen Lopez',
  'Dr. Ricardo Fernandez',
  'Dr. Teresa Ramos',
  'Dr. Miguel Torres',
  'Dr. Ana Mendoza',
  'Dr. Jose Garcia',
  'Dr. Sofia Valdez',
];

// List of available rooms
const rooms = [
  'ICU-201',
  'ICU-202',
  'ICU-203',
  'ICU-204',
  'ICU-205',
  'Ward 4A-101',
  'Ward 4A-102',
  'Ward 4A-103',
  'Ward 4A-104',
  'Ward 4B-201',
  'Ward 4B-202',
  'Ward 4B-203',
  'Ward 5A-101',
  'Ward 5A-102',
  'Ward 5A-103',
  'ER-1',
  'ER-2',
  'ER-3',
];

export function TaskModal({ open, onOpenChange, task, onSave, mode, allTasks = [] }: TaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'routine' as 'urgent' | 'routine',
    patientName: '',
    patientId: '',
    dueTime: '',
    attendingPhysician: '',
    patientRoom: '',
    doctorOrder: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Check which rooms are occupied by active tasks
  const getOccupiedRooms = () => {
    const occupiedRooms = new Map<string, { patientName: string; taskId: string }>();

    allTasks.forEach(t => {
      // Only consider active tasks (not completed)
      if (t.patientRoom && t.status !== 'completed') {
        // If editing, don't mark current task's room as occupied
        if (mode === 'edit' && task?.id === t.id) {
          return;
        }
        occupiedRooms.set(t.patientRoom, {
          patientName: t.patientName,
          taskId: t.id,
        });
      }
    });

    return occupiedRooms;
  };

  const occupiedRooms = getOccupiedRooms();

  useEffect(() => {
    if (task && mode === 'edit') {
      setFormData({
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        patientName: task.patientName,
        patientId: task.patientId || '',
        dueTime: task.dueTime,
        attendingPhysician: task.attendingPhysician || '',
        patientRoom: task.patientRoom || '',
        doctorOrder: task.doctorOrder || '',
      });
    } else {
      // For new tasks, patient ID will be set when patient is selected
      setFormData({
        title: '',
        description: '',
        priority: 'routine',
        patientName: '',
        patientId: '',
        dueTime: '',
        attendingPhysician: '',
        patientRoom: '',
        doctorOrder: '',
      });
    }
    setErrors({});
  }, [task, mode, open]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Task title is required';
    }

    if (!formData.patientName.trim()) {
      newErrors.patientName = 'Patient name is required';
    }

    // Patient ID is auto-generated, no validation needed

    if (!formData.dueTime) {
      newErrors.dueTime = 'Due time is required';
    }

    if (!formData.attendingPhysician) {
      newErrors.attendingPhysician = 'Attending physician is required';
    }

    if (!formData.patientRoom) {
      newErrors.patientRoom = 'Patient room is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    
    try {
      await onSave({
        ...formData,
        id: task?.id || `task-${Date.now()}`,
        status: task?.status || 'pending',
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving task:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'add' ? 'Add New Task' : 'Edit Task'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'add' 
              ? 'Create a new task and assign it to a patient.' 
              : 'Update the task details below.'}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Task Title *</Label>
            <Input
              id="title"
              placeholder="e.g., Administer medication"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={errors.title ? 'border-red-500' : ''}
            />
            {errors.title && (
              <p className="text-sm text-red-500">{errors.title}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Additional details about the task..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="priority">Priority *</Label>
              <Select
                value={formData.priority}
                onValueChange={(value: 'urgent' | 'routine') => 
                  setFormData({ ...formData, priority: value })
                }
              >
                <SelectTrigger id="priority">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">🔴 Urgent</SelectItem>
                  <SelectItem value="routine">🟡 Routine</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dueTime">Due Time *</Label>
              <Input
                id="dueTime"
                type="time"
                value={formData.dueTime}
                onChange={(e) => setFormData({ ...formData, dueTime: e.target.value })}
                className={errors.dueTime ? 'border-red-500' : ''}
              />
              {errors.dueTime && (
                <p className="text-sm text-red-500">{errors.dueTime}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="patientName">Patient Name *</Label>
            <Select
              value={formData.patientName}
              onValueChange={(value) => {
                const selectedPatient = mockPatients.find(p => p.name === value);
                setFormData({
                  ...formData,
                  patientName: value,
                  patientId: selectedPatient?.id || `P${Date.now().toString().slice(-6)}`,
                });
              }}
            >
              <SelectTrigger id="patientName" className={errors.patientName ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select patient" />
              </SelectTrigger>
              <SelectContent>
                {mockPatients.map((patient) => (
                  <SelectItem key={patient.id} value={patient.name}>
                    {patient.name} ({patient.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.patientName && (
              <p className="text-sm text-red-500">{errors.patientName}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="patientId">Patient ID</Label>
            <Input
              id="patientId"
              placeholder="Select patient to view ID"
              value={formData.patientId}
              readOnly
              disabled
              className="bg-gray-100 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500">Patient ID is automatically filled from selected patient</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-blue-600" />
                <Label htmlFor="attendingPhysician">Doctor *</Label>
              </div>
              <Select
                value={formData.attendingPhysician}
                onValueChange={(value) => setFormData({ ...formData, attendingPhysician: value })}
              >
                <SelectTrigger id="attendingPhysician" className={errors.attendingPhysician ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select doctor" />
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((doctor) => (
                    <SelectItem key={doctor} value={doctor}>
                      {doctor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.attendingPhysician && (
                <p className="text-sm text-red-500">{errors.attendingPhysician}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Bed className="w-4 h-4 text-gray-600" />
                <Label htmlFor="patientRoom">Room *</Label>
              </div>
              <Select
                value={formData.patientRoom}
                onValueChange={(value) => setFormData({ ...formData, patientRoom: value })}
              >
                <SelectTrigger id="patientRoom" className={errors.patientRoom ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select room" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((room) => {
                    const occupation = occupiedRooms.get(room);
                    const isOccupied = !!occupation;
                    const displayText = isOccupied
                      ? `${room} (Occupied - Patient: ${occupation.patientName})`
                      : room;

                    return (
                      <SelectItem
                        key={room}
                        value={room}
                        disabled={isOccupied}
                        className={isOccupied ? 'text-gray-400' : ''}
                      >
                        {displayText}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {errors.patientRoom && (
                <p className="text-sm text-red-500">{errors.patientRoom}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600" />
              <Label htmlFor="doctorOrder">Doctor's Order / Notes</Label>
            </div>
            <Textarea
              id="doctorOrder"
              placeholder="Enter doctor's orders or clinical notes..."
              value={formData.doctorOrder}
              onChange={(e) => setFormData({ ...formData, doctorOrder: e.target.value })}
              rows={3}
            />
            <p className="text-xs text-gray-500">Medical instructions or clinical notes from the attending physician</p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              className="bg-primary hover:bg-primary-hover"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                mode === 'add' ? 'Add Task' : 'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
