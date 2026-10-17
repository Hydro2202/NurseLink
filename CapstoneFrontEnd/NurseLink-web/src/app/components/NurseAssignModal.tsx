import { useEffect, useState } from 'react';
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
import { Loader2 } from 'lucide-react';
import { PresenceDot } from './PresenceDot';
import type { NursePresence } from '../types/domain';

export interface AssignTarget {
  id: string;
  name: string;
  department: string;
  shift: string;
  presence?: NursePresence;
  lastSeenAt?: string | null;
}

interface NurseAssignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nurse: AssignTarget | null;
  onSave: (data: { department: string; shift: string }) => Promise<void>;
}

export function NurseAssignModal({ open, onOpenChange, nurse, onSave }: NurseAssignModalProps) {
  const [department, setDepartment] = useState('');
  const [shift, setShift] = useState('morning');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (nurse) {
      setDepartment(nurse.department || '');
      setShift(nurse.shift || 'morning');
      setError('');
    }
  }, [nurse, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!department.trim()) {
      setError('Department is required');
      return;
    }
    setLoading(true);
    try {
      await onSave({ department: department.trim(), shift });
      onOpenChange(false);
    } catch (error) {
      console.error('Error assigning nurse:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!nurse) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Assign {nurse.name}
            <PresenceDot presence={nurse.presence} lastSeenAt={nurse.lastSeenAt} showLabel />
          </DialogTitle>
          <DialogDescription>
            Change this nurse's department or shift. They will be notified.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="assignDepartment">Department *</Label>
            <Input
              id="assignDepartment"
              placeholder="e.g., ICU"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className={error ? 'border-red-500' : ''}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="assignShift">Shift</Label>
            <Select value={shift} onValueChange={setShift}>
              <SelectTrigger id="assignShift">
                <SelectValue placeholder="Select shift" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="morning">Morning</SelectItem>
                <SelectItem value="afternoon">Afternoon</SelectItem>
                <SelectItem value="night">Night</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" className="bg-primary hover:bg-primary-hover" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
