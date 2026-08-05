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
import type { Patient, Task } from '../types/domain';
import { fetchPatients } from '../api/nurselink';

interface TaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  onSave: (task: Partial<Task>) => Promise<void>;
  mode: 'add' | 'edit';
  allTasks?: Task[];
}

export function TaskModal({
  open,
  onOpenChange,
  task,
  onSave,
  mode,
  allTasks = [],
}: TaskModalProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
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

  useEffect(() => {
    if (!open) return;
    fetchPatients().then(setPatients).catch(() => setPatients([]));
  }, [open]);

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
                value={formData.patientId}
                onValueChange={(patientId) => {
                  const selectedPatient = patients.find((p) => p.id === patientId);
                  setFormData({
                    ...formData,
                    patientId,
                    patientName: selectedPatient?.name || '',
                    attendingPhysician:
                      selectedPatient?.attendingPhysician || formData.attendingPhysician,
                    patientRoom: selectedPatient?.room || formData.patientRoom,
                  });
                }}
              >
                <SelectTrigger id="patientName" className={errors.patientName ? 'border-red-500' : ''}>
                  <SelectValue placeholder={patients.length ? 'Select patient' : 'No patients found'} />
                </SelectTrigger>
                <SelectContent>
                  {patients.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No patients found
                    </SelectItem>
                  ) : (
                    patients.map((patient) => (
                      <SelectItem key={patient.id} value={patient.id}>
                        {patient.name} ({patient.id})
                      </SelectItem>
                    ))
                  )}
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
              <Input
                id="attendingPhysician"
                placeholder="Physician name"
                value={formData.attendingPhysician}
                onChange={(e) =>
                  setFormData({ ...formData, attendingPhysician: e.target.value })
                }
                className={errors.attendingPhysician ? 'border-red-500' : ''}
              />
              {errors.attendingPhysician && (
                <p className="text-sm text-red-500">{errors.attendingPhysician}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Bed className="w-4 h-4 text-gray-600" />
                <Label htmlFor="patientRoom">Room *</Label>
              </div>
              <Input
                id="patientRoom"
                placeholder="Room number"
                value={formData.patientRoom}
                onChange={(e) => setFormData({ ...formData, patientRoom: e.target.value })}
                className={errors.patientRoom ? 'border-red-500' : ''}
              />
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
