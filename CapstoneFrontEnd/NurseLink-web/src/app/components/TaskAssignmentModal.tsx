import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import type { Nurse, Patient } from '../types/domain';
import { fetchNurses, createTask, ApiError } from '../api/nurselink';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

interface TaskAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onTaskAssigned?: () => void;
}

export function TaskAssignmentModal({
  open,
  onOpenChange,
  patient,
  onTaskAssigned,
}: TaskAssignmentModalProps) {
  const [nurses, setNurses] = useState<Nurse[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'urgent' | 'routine'>('routine');
  const [dueTime, setDueTime] = useState('');
  const [selectedNurse, setSelectedNurse] = useState('');
  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [doctorOrder, setDoctorOrder] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchNurses().then(setNurses).catch(() => setNurses([]));
  }, [open]);

  useEffect(() => {
    if (patient?.attendingPhysician) {
      setAttendingPhysician(patient.attendingPhysician);
    }
  }, [patient]);

  const resetForm = () => {
    setTaskTitle('');
    setDescription('');
    setPriority('routine');
    setDueTime('');
    setSelectedNurse('');
    setAttendingPhysician(patient?.attendingPhysician || '');
    setDoctorOrder('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskTitle || !selectedNurse || !dueTime || !patient) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    try {
      const nurse = nurses.find((n) => n.id === selectedNurse);
      await createTask({
        title: taskTitle,
        description,
        priority,
        dueTime,
        patientId: patient.id,
        patientName: patient.name,
        patientRoom: patient.room,
        assignedTo: nurse?.name || '',
        attendingPhysician: attendingPhysician || patient.attendingPhysician,
        doctorOrder,
        status: 'pending',
        category: 'care',
      });

      toast.success('Task assigned successfully!', {
        description: `${taskTitle} has been assigned to ${nurse?.name || 'the selected nurse'}`,
      });

      resetForm();
      onTaskAssigned?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to assign task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-blue-600" />
            Assign Task to Nurse
          </DialogTitle>
          <DialogDescription>
            {patient && `Assigning task for ${patient.name} (${patient.id}) - Room ${patient.room}`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="taskTitle">Task Title *</Label>
            <Input
              id="taskTitle"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="e.g. Administer medication"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Task details"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority *</Label>
              <Select value={priority} onValueChange={(v: 'urgent' | 'routine') => setPriority(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="routine">Routine</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueTime">Due Time *</Label>
              <Input
                id="dueTime"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                placeholder="08:00"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Assign To Nurse *</Label>
            <Select value={selectedNurse} onValueChange={setSelectedNurse}>
              <SelectTrigger>
                <SelectValue placeholder="Select nurse" />
              </SelectTrigger>
              <SelectContent>
                {nurses.map((nurse) => (
                  <SelectItem key={nurse.id} value={nurse.id}>
                    {nurse.name} ({nurse.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="attendingPhysician">Attending Physician</Label>
            <Input
              id="attendingPhysician"
              value={attendingPhysician}
              onChange={(e) => setAttendingPhysician(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="doctorOrder">Doctor Order</Label>
            <Textarea
              id="doctorOrder"
              value={doctorOrder}
              onChange={(e) => setDoctorOrder(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Assigning…
                </>
              ) : (
                'Assign Task'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
