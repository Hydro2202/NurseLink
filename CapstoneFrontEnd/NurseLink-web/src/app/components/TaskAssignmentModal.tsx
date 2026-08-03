import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { mockNurses } from '../data/mockData';
import { Patient } from '../data/mockData';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

interface TaskAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onTaskAssigned?: () => void;
}

export function TaskAssignmentModal({ open, onOpenChange, patient, onTaskAssigned }: TaskAssignmentModalProps) {
  const [taskTitle, setTaskTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'urgent' | 'routine'>('routine');
  const [dueTime, setDueTime] = useState('');
  const [selectedNurse, setSelectedNurse] = useState('');
  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [doctorOrder, setDoctorOrder] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskTitle || !selectedNurse || !dueTime) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));

    const nurse = mockNurses.find(n => n.id === selectedNurse);

    toast.success('Task assigned successfully!', {
      description: `${taskTitle} has been assigned to ${nurse?.name || 'the selected nurse'}`,
    });

    // Reset form
    setTaskTitle('');
    setDescription('');
    setPriority('routine');
    setDueTime('');
    setSelectedNurse('');
    setAttendingPhysician('');
    setDoctorOrder('');
    setIsSubmitting(false);
    
    onTaskAssigned?.();
    onOpenChange(false);
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

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          {/* Patient Info Display */}
          {patient && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="font-semibold">Patient:</span> {patient.name}
                </div>
                <div>
                  <span className="font-semibold">Room:</span> {patient.room}
                </div>
                <div>
                  <span className="font-semibold">Diagnosis:</span> {patient.diagnosis}
                </div>
                <div>
                  <span className="font-semibold">Risk Level:</span>{' '}
                  <span className={`capitalize ${
                    patient.riskLevel === 'high' ? 'text-red-600' :
                    patient.riskLevel === 'medium' ? 'text-yellow-600' :
                    'text-green-600'
                  }`}>
                    {patient.riskLevel}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Task Title */}
          <div className="space-y-2">
            <Label htmlFor="taskTitle">
              Task Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="taskTitle"
              placeholder="e.g., Administer medication, Vital signs check"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Detailed instructions for the task..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Priority and Due Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="priority">
                Priority <span className="text-red-500">*</span>
              </Label>
              <Select value={priority} onValueChange={(value: any) => setPriority(value)}>
                <SelectTrigger id="priority">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="routine">Routine</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dueTime">
                Due Time <span className="text-red-500">*</span>
              </Label>
              <Input
                id="dueTime"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Assign to Nurse */}
          <div className="space-y-2">
            <Label htmlFor="nurse">
              Assign to Nurse <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedNurse} onValueChange={setSelectedNurse}>
              <SelectTrigger id="nurse">
                <SelectValue placeholder="Select a nurse" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {mockNurses.map((nurse) => (
                  <SelectItem key={nurse.id} value={nurse.id}>
                    <div className="flex flex-col">
                      <span className="font-medium">{nurse.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {nurse.role} • {nurse.shift} shift • {nurse.specialization}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Attending Physician */}
          <div className="space-y-2">
            <Label htmlFor="physician">Attending Physician</Label>
            <Input
              id="physician"
              placeholder="e.g., Dr. Smith"
              value={attendingPhysician}
              onChange={(e) => setAttendingPhysician(e.target.value)}
            />
          </div>

          {/* Doctor's Order */}
          <div className="space-y-2">
            <Label htmlFor="doctorOrder">Doctor's Order</Label>
            <Textarea
              id="doctorOrder"
              placeholder="Specific orders from the physician..."
              value={doctorOrder}
              onChange={(e) => setDoctorOrder(e.target.value)}
              rows={2}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Assign Task
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
