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
import { BloodPressureInput } from './BloodPressureInput';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertCircle, Edit2, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { updatePatient, fetchDepartments, ApiError } from '../api/nurselink';
import type { Department, Patient } from '../types/domain';
import { computeBmi, bmiCategory, validateHeightCm, validateWeightKg } from '../utils/bmi';
import { localTodayIso } from '../utils/patientDisplay';

const NO_DEPARTMENT = '__none__';

interface EditPatientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onSaved: (patient: Patient) => void;
}

type FormState = {
  name: string;
  age: string;
  gender: string;
  room: string;
  diagnosis: string;
  riskLevel: Patient['riskLevel'];
  attendingPhysician: string;
  departmentId: string;
  admissionDate: string;
  heartRate: string;
  bloodPressure: string;
  temperature: string;
  oxygenSaturation: string;
  heightCm: string;
  weightKg: string;
};

function formFromPatient(patient: Patient): FormState {
  const v = patient.vitalSigns;
  return {
    name: patient.name || '',
    age: String(patient.age ?? ''),
    gender: patient.gender || '',
    room: patient.room || '',
    diagnosis: patient.diagnosis || '',
    riskLevel: patient.riskLevel || 'low',
    attendingPhysician: patient.attendingPhysician || '',
    departmentId: patient.departmentId != null ? String(patient.departmentId) : '',
    admissionDate: patient.admissionDate || '',
    heartRate: v?.heartRate != null ? String(v.heartRate) : '',
    bloodPressure: v?.bloodPressure || '',
    temperature: v?.temperature != null ? String(v.temperature) : '',
    oxygenSaturation: v?.oxygenSaturation != null ? String(v.oxygenSaturation) : '',
    heightCm: patient.heightCm != null ? String(patient.heightCm) : '',
    weightKg: patient.weightKg != null ? String(patient.weightKg) : '',
  };
}

/**
 * Lightweight quick-edit for a patient's core record — distinct from the
 * full Kardex form (PatientKardexModal). PATCHes /patients/{id}/ directly;
 * the backend logs changed fields to the record's edit history.
 */
export function EditPatientModal({ open, onOpenChange, patient, onSaved }: EditPatientModalProps) {
  const isDischarged = patient?.status === 'discharged';
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !patient) {
      setForm(null);
      setError('');
      return;
    }
    setForm(formFromPatient(patient));
    fetchDepartments()
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [open, patient]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const heightError = form ? validateHeightCm(form.heightCm) : null;
  const weightError = form ? validateWeightKg(form.weightKg) : null;
  const liveBmi = form ? computeBmi(form.heightCm, form.weightKg) : null;

  const handleSubmit = async () => {
    if (!patient || !form) return;
    if (!form.name.trim() || !form.age || !form.room.trim() || !form.diagnosis.trim()) {
      setError('Name, age, room, and diagnosis are required.');
      return;
    }
    if (heightError || weightError) {
      setError(heightError || weightError || '');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const updated = await updatePatient(patient.id, {
        name: form.name.trim(),
        age: Number(form.age) || 0,
        gender: form.gender as Patient['gender'],
        room: form.room.trim(),
        diagnosis: form.diagnosis.trim(),
        riskLevel: form.riskLevel,
        attendingPhysician: form.attendingPhysician.trim(),
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        admissionDate: form.admissionDate,
        heightCm: form.heightCm ? Number(form.heightCm) : null,
        weightKg: form.weightKg ? Number(form.weightKg) : null,
        vitalSigns: {
          heartRate: form.heartRate ? Number(form.heartRate) : 0,
          bloodPressure: form.bloodPressure.trim(),
          temperature: form.temperature ? Number(form.temperature) : 0,
          oxygenSaturation: form.oxygenSaturation ? Number(form.oxygenSaturation) : 0,
        },
        // respiratoryRate deliberately omitted (as on mobile): the backend
        // merges vitalSigns per key, so the stored RR is left untouched.
      } as Partial<Patient>);
      toast.success('Patient record updated', {
        description: `Changes to ${patient.name} were saved${
          updated.lastEditedByName ? ` and logged under ${updated.lastEditedByName}` : ''
        }.`,
      });
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save changes.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-blue-600" />
            Edit Patient Record
          </DialogTitle>
          <DialogDescription>
            {isDischarged
              ? 'This patient is discharged — corrections here fix the stored record (and their closed visit history) without readmitting them.'
              : 'Only the fields you change are logged to the record’s edit history.'}
          </DialogDescription>
        </DialogHeader>

        {form && patient ? (
          <div className="space-y-3 py-1">
            {error ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1">
              <Label htmlFor="edit-name">Patient Name *</Label>
              <Input id="edit-name" value={form.name} onChange={(e) => setField('name', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-age">Age *</Label>
                <Input
                  id="edit-age"
                  type="number"
                  min={0}
                  value={form.age}
                  onChange={(e) => setField('age', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Sex *</Label>
                <Select value={form.gender} onValueChange={(v) => setField('gender', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-room">{isDischarged ? 'Last Room *' : 'Room *'}</Label>
                <Input id="edit-room" value={form.room} onChange={(e) => setField('room', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Risk Level</Label>
                <Select
                  value={form.riskLevel}
                  onValueChange={(v) => setField('riskLevel', v as Patient['riskLevel'])}
                >
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
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-diagnosis">{isDischarged ? 'Last Diagnosis *' : 'Diagnosis *'}</Label>
              <Input
                id="edit-diagnosis"
                value={form.diagnosis}
                onChange={(e) => setField('diagnosis', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-physician">Attending Physician</Label>
              <Input
                id="edit-physician"
                value={form.attendingPhysician}
                onChange={(e) => setField('attendingPhysician', e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1">
              <Label>Department</Label>
              <Select
                value={form.departmentId || NO_DEPARTMENT}
                onValueChange={(v) => setField('departmentId', v === NO_DEPARTMENT ? '' : v)}
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-admission">Admission Date</Label>
                <Input
                  id="edit-admission"
                  type="date"
                  value={form.admissionDate}
                  max={localTodayIso()}
                  onChange={(e) => setField('admissionDate', e.target.value)}
                />
              </div>
              {isDischarged ? (
                <div className="space-y-1">
                  <Label htmlFor="edit-discharged">Discharge Date</Label>
                  <Input
                    id="edit-discharged"
                    value={patient.dischargedAt ? new Date(patient.dischargedAt).toLocaleString() : '—'}
                    readOnly
                    disabled
                  />
                </div>
              ) : null}
            </div>

            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-xs font-bold text-gray-500">Assigned Nurse</p>
              <p className="text-sm font-semibold text-gray-900">
                {patient.assignedNurseName || 'Unassigned'}
                {isDischarged ? ' (last on record)' : ''}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                Use Assign Nurse{isDischarged ? '/Readmit' : ''} to change this.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-height">Height (cm)</Label>
                <Input
                  id="edit-height"
                  inputMode="decimal"
                  value={form.heightCm}
                  onChange={(e) => setField('heightCm', e.target.value)}
                  className={heightError ? 'border-red-500' : ''}
                />
                {heightError ? <p className="text-xs text-red-600">{heightError}</p> : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-weight">Weight (kg)</Label>
                <Input
                  id="edit-weight"
                  inputMode="decimal"
                  value={form.weightKg}
                  onChange={(e) => setField('weightKg', e.target.value)}
                  className={weightError ? 'border-red-500' : ''}
                />
                {weightError ? <p className="text-xs text-red-600">{weightError}</p> : null}
              </div>
            </div>
            {liveBmi != null ? (
              <p className="text-sm text-gray-500">
                BMI: <span className="font-bold text-gray-900">{liveBmi}</span> ({bmiCategory(liveBmi)})
              </p>
            ) : null}

            <p className="pt-1 text-xs font-bold uppercase tracking-wide text-gray-500">
              {isDischarged ? 'Last Recorded Vitals' : 'Current Vitals'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-hr">Heart Rate (bpm)</Label>
                <Input
                  id="edit-hr"
                  inputMode="numeric"
                  value={form.heartRate}
                  onChange={(e) => setField('heartRate', e.target.value)}
                />
              </div>
              <BloodPressureInput
                id="edit-bp"
                value={form.bloodPressure}
                onChange={(v) => setField('bloodPressure', v)}
              />
              <div className="space-y-1">
                <Label htmlFor="edit-temp">Temperature (°C)</Label>
                <Input
                  id="edit-temp"
                  inputMode="decimal"
                  value={form.temperature}
                  onChange={(e) => setField('temperature', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-spo2">SpO2 (%)</Label>
                <Input
                  id="edit-spo2"
                  inputMode="numeric"
                  value={form.oxygenSaturation}
                  onChange={(e) => setField('oxygenSaturation', e.target.value)}
                />
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form}>
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {submitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
