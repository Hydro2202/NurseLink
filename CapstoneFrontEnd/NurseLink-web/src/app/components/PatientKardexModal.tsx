import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { BloodPressureInput } from './BloodPressureInput';
import {
  createKardexRecord,
  updatePatient,
  ApiError,
} from '../api/nurselink';
import type { Patient, VitalsMonitoringOrder } from '../types/domain';

export type PatientKardexForm = {
  lastName: string;
  firstName: string;
  middleName: string;
  age: string;
  gender: string;
  religion: string;
  room: string;
  bedNumber: string;
  admissionDate: string;
  attendingPhysician: string;
  chiefComplaint: string;
  admittingDiagnosis: string;
  finalDiagnosis: string;
  diet: string;
  // Simple order/reference pair shown in both modes — not the richer
  // VitalsScheduleCard. In 'add' mode the patient doesn't exist yet when
  // this form is open, so handleSave PATCHes the just-created patient right
  // after create, same as patientCode is already meant to be used for. In
  // 'edit' mode they go straight into the same updatePatient(...) PATCH as
  // the rest of the clinical fields.
  vitalsMonitoringOrder: VitalsMonitoringOrder;
  vitalsMonitoringBasis: string;
  temperature: string;
  pulseRate: string;
  respiratoryRate: string;
  bloodPressure: string;
  oxygenSaturation: string;
  specialEndorsements: string;
};

const emptyForm = (): PatientKardexForm => ({
  lastName: '',
  firstName: '',
  middleName: '',
  age: '',
  gender: '',
  religion: '',
  room: '',
  bedNumber: '',
  admissionDate: '',
  attendingPhysician: '',
  chiefComplaint: '',
  admittingDiagnosis: '',
  finalDiagnosis: '',
  diet: '',
  temperature: '',
  pulseRate: '',
  respiratoryRate: '',
  bloodPressure: '',
  oxygenSaturation: '',
  specialEndorsements: '',
  vitalsMonitoringOrder: 'not_specified',
  vitalsMonitoringBasis: '',
});

function patientToForm(patient: Patient): PatientKardexForm {
  const parts = patient.name.trim().split(/\s+/);
  return {
    ...emptyForm(),
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    age: String(patient.age ?? ''),
    gender: patient.gender || '',
    room: patient.room || '',
    admissionDate: patient.admissionDate || '',
    attendingPhysician: patient.attendingPhysician || '',
    admittingDiagnosis: patient.diagnosis || '',
    temperature:
      patient.vitalSigns?.temperature != null ? String(patient.vitalSigns.temperature) : '',
    pulseRate:
      patient.vitalSigns?.heartRate != null ? String(patient.vitalSigns.heartRate) : '',
    respiratoryRate:
      patient.vitalSigns?.respiratoryRate != null
        ? String(patient.vitalSigns.respiratoryRate)
        : '',
    bloodPressure: patient.vitalSigns?.bloodPressure || '',
    oxygenSaturation:
      patient.vitalSigns?.oxygenSaturation != null
        ? String(patient.vitalSigns.oxygenSaturation)
        : '',
    vitalsMonitoringOrder: patient.vitalsMonitoringOrder || 'not_specified',
    vitalsMonitoringBasis: patient.vitalsMonitoringBasis || '',
  };
}

interface PatientKardexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  patient?: Patient | null;
  onSaved: () => void;
}

export function PatientKardexModal({
  open,
  onOpenChange,
  mode,
  patient,
  onSaved,
}: PatientKardexModalProps) {
  const [form, setForm] = useState<PatientKardexForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && patient) {
      setForm(patientToForm(patient));
    } else {
      setForm(emptyForm());
    }
  }, [open, mode, patient]);

  const setField = <K extends keyof PatientKardexForm>(key: K, value: PatientKardexForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    const errors: string[] = [];
    if (!form.firstName) errors.push('First Name');
    if (!form.lastName) errors.push('Last Name');
    if (!form.age) errors.push('Age');
    if (!form.gender) errors.push('Sex/Gender');
    if (!form.admissionDate) errors.push('Admission Date');
    if (!form.room) errors.push('Room');
    return errors;
  };

  const handleSave = async () => {
    const errors = validate();
    if (errors.length) {
      toast.error(`Please fill in: ${errors.join(', ')}`);
      return;
    }
    setSaving(true);
    try {
      if (mode === 'add') {
        const created = await createKardexRecord({ ...form });
        // The monitoring order/reference live on Patient, not KardexHistory
        // — createKardexRecord has already created the patient by the time
        // it returns (patientCode is populated for exactly this reason), so
        // a quick follow-up PATCH is how they actually get saved. Skipped
        // entirely if the nurse left both at their defaults.
        if (
          created.patientCode &&
          (form.vitalsMonitoringOrder !== 'not_specified' || form.vitalsMonitoringBasis.trim())
        ) {
          await updatePatient(created.patientCode, {
            vitalsMonitoringOrder: form.vitalsMonitoringOrder,
            vitalsMonitoringBasis: form.vitalsMonitoringBasis.trim(),
          });
        }
        toast.success('Patient added', {
          description: 'Patient created from Kardex and added to the patient list.',
        });
      } else if (patient) {
        const name = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(' ');
        await updatePatient(patient.id, {
          name,
          age: Number(form.age) || 0,
          gender: form.gender as Patient['gender'],
          room: form.room,
          diagnosis: form.admittingDiagnosis || form.chiefComplaint || patient.diagnosis,
          admissionDate: form.admissionDate,
          attendingPhysician: form.attendingPhysician,
          vitalsMonitoringOrder: form.vitalsMonitoringOrder,
          vitalsMonitoringBasis: form.vitalsMonitoringBasis.trim(),
          vitalSigns: {
            heartRate: Number(form.pulseRate) || 0,
            bloodPressure: form.bloodPressure || '',
            temperature: Number(form.temperature) || 0,
            oxygenSaturation: Number(form.oxygenSaturation) || 0,
            respiratoryRate: Number(form.respiratoryRate) || 0,
          },
        });
        await createKardexRecord({ ...form, patientId: patient.id });
        toast.success('Patient updated');
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(mode === 'add' ? 'Failed to add patient' : 'Failed to update patient', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Add Patient (Kardex)' : 'Edit Patient'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm font-semibold text-blue-700">Patient Demographics</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Last Name *</Label>
              <Input value={form.lastName} onChange={(e) => setField('lastName', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>First Name *</Label>
              <Input value={form.firstName} onChange={(e) => setField('firstName', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Middle Name</Label>
              <Input value={form.middleName} onChange={(e) => setField('middleName', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Age *</Label>
              <Input value={form.age} onChange={(e) => setField('age', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Sex/Gender *</Label>
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
            <div className="space-y-1">
              <Label>Religion</Label>
              <Input value={form.religion} onChange={(e) => setField('religion', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Admission Date *</Label>
              <Input
                type="date"
                value={form.admissionDate}
                onChange={(e) => setField('admissionDate', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Room *</Label>
              <Input value={form.room} onChange={(e) => setField('room', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Bed Number</Label>
              <Input value={form.bedNumber} onChange={(e) => setField('bedNumber', e.target.value)} />
            </div>
          </div>

          <p className="text-sm font-semibold text-blue-700 pt-2">Medical Information</p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Attending Physician</Label>
              <Input
                value={form.attendingPhysician}
                onChange={(e) => setField('attendingPhysician', e.target.value)}
                placeholder="Physician name"
              />
            </div>
            <div className="space-y-1">
              <Label>Chief Complaint</Label>
              <Textarea
                value={form.chiefComplaint}
                onChange={(e) => setField('chiefComplaint', e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <Label>Admitting Diagnosis</Label>
              <Textarea
                value={form.admittingDiagnosis}
                onChange={(e) => setField('admittingDiagnosis', e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <Label>Final Diagnosis</Label>
              <Textarea
                value={form.finalDiagnosis}
                onChange={(e) => setField('finalDiagnosis', e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <Label>Diet</Label>
              <Input value={form.diet} onChange={(e) => setField('diet', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Vital Signs Monitoring (as ordered)</Label>
                <Select
                  value={form.vitalsMonitoringOrder}
                  onValueChange={(v) => setField('vitalsMonitoringOrder', v as VitalsMonitoringOrder)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_specified">Not set yet</SelectItem>
                    <SelectItem value="every_1h">Every 1 hour</SelectItem>
                    <SelectItem value="every_2h">Every 2 hours</SelectItem>
                    <SelectItem value="every_4h">Every 4 hours</SelectItem>
                    <SelectItem value="prn">As needed (PRN)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Order / protocol reference</Label>
                <Input
                  value={form.vitalsMonitoringBasis}
                  onChange={(e) => setField('vitalsMonitoringBasis', e.target.value)}
                  placeholder="e.g., Dr. Reyes order"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              A newly set schedule&apos;s first check is at the next full hour — change the exact
              timing any time from the patient&apos;s Vital Signs Schedule on Kardex. Leave the order
              as &quot;Not set yet&quot; and the Kardex will show monitoring as unspecified rather
              than assuming an interval.
            </p>
          </div>

          <p className="text-sm font-semibold text-blue-700 pt-2">Vital Signs</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Temperature</Label>
              <Input value={form.temperature} onChange={(e) => setField('temperature', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Pulse Rate</Label>
              <Input value={form.pulseRate} onChange={(e) => setField('pulseRate', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Respiratory Rate</Label>
              <Input
                value={form.respiratoryRate}
                onChange={(e) => setField('respiratoryRate', e.target.value)}
              />
            </div>
            <BloodPressureInput
              value={form.bloodPressure}
              onChange={(v) => setField('bloodPressure', v)}
            />
            <div className="space-y-1">
              <Label>Oxygen Saturation</Label>
              <Input
                value={form.oxygenSaturation}
                onChange={(e) => setField('oxygenSaturation', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1 pt-2">
            <Label>Special Endorsements</Label>
            <Textarea
              value={form.specialEndorsements}
              onChange={(e) => setField('specialEndorsements', e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {mode === 'add' ? 'Save Patient' : 'Update'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
