import React, { useEffect, useState } from 'react';
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
import { Alert, AlertDescription } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { readmitPatient, fetchDepartments, ApiError } from '../api/nurselink';
import type { Department, Patient } from '../types/domain';
import { localTodayIso } from '../utils/patientDisplay';

const NO_DEPARTMENT = '__none__';

interface ReadmitPatientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onReadmitted: (patient: Patient) => void;
}

export function ReadmitPatientModal({
  open,
  onOpenChange,
  patient,
  onReadmitted,
}: ReadmitPatientModalProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [admissionDate, setAdmissionDate] = useState(localTodayIso());
  const [diagnosis, setDiagnosis] = useState('');
  const [room, setRoom] = useState('');
  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [riskLevel, setRiskLevel] = useState<Patient['riskLevel']>('low');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setAdmissionDate(localTodayIso());
      setDiagnosis('');
      setRoom('');
      setAttendingPhysician('');
      setDepartmentId('');
      setRiskLevel('low');
      setError('');
      return;
    }
    fetchDepartments()
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [open]);

  const handleSubmit = async () => {
    if (!patient) return;
    if (!diagnosis.trim() || !room.trim()) {
      setError('Diagnosis and room are required to readmit this patient.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const updated = await readmitPatient(patient.id, {
        admissionDate,
        diagnosis: diagnosis.trim(),
        room: room.trim(),
        attendingPhysician: attendingPhysician.trim(),
        departmentId: departmentId ? Number(departmentId) : null,
        riskLevel,
      });
      toast.success('Patient readmitted', {
        description: `${patient.name} is admitted again under their existing profile (${patient.id}).`,
      });
      onReadmitted(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to readmit this patient.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-blue-600" />
            Readmit Patient
          </DialogTitle>
          <DialogDescription>
            {patient
              ? `${patient.name} (${patient.id}) was previously discharged. This reactivates their existing profile for a new admission — their prior visit history stays on record.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="readmit-date">Admission Date *</Label>
            <Input
              id="readmit-date"
              type="date"
              value={admissionDate}
              max={localTodayIso()}
              onChange={(e) => setAdmissionDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="readmit-diagnosis">Diagnosis *</Label>
            <Input
              id="readmit-diagnosis"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Recurrent pneumonia"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="readmit-room">Room *</Label>
            <Input
              id="readmit-room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. W-10"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="readmit-physician">Attending Physician</Label>
            <Input
              id="readmit-physician"
              value={attendingPhysician}
              onChange={(e) => setAttendingPhysician(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Risk Level</Label>
              <Select value={riskLevel} onValueChange={(v) => setRiskLevel(v as Patient['riskLevel'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Department</Label>
              <Select
                value={departmentId || NO_DEPARTMENT}
                onValueChange={(v) => setDepartmentId(v === NO_DEPARTMENT ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4 mr-2" />
            )}
            {submitting ? 'Readmitting...' : 'Readmit Patient'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
