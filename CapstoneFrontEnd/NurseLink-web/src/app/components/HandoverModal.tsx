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
import { Loader2, Shield, User } from 'lucide-react';
import { HandoverNote } from '../types';
import { Alert, AlertDescription } from './ui/alert';
import type { Nurse, Patient } from '../types/domain';
import { fetchPatients, fetchNurses } from '../api/nurselink';

interface HandoverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (handover: Partial<HandoverNote>) => Promise<void>;
}

export function HandoverModal({ open, onOpenChange, onSave }: HandoverModalProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [nurses, setNurses] = useState<Nurse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [selectedNurseId, setSelectedNurseId] = useState<string>('');
  const [formData, setFormData] = useState({
    patientName: '',
    shift: 'morning' as 'morning' | 'afternoon' | 'night',
    nurseTo: '',
    situation: '',
    background: '',
    assessment: '',
    recommendation: '',
    attendingPhysician: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setSelectedPatientId('');
      setSelectedNurseId('');
      setFormData({
        patientName: '',
        shift: 'morning',
        nurseTo: '',
        situation: '',
        background: '',
        assessment: '',
        recommendation: '',
        attendingPhysician: '',
      });
      setErrors({});
      return;
    }
    Promise.all([fetchPatients(), fetchNurses()])
      .then(([plist, nlist]) => {
        setPatients(plist);
        setNurses(nlist);
      })
      .catch(() => {});
  }, [open]);

  // Update nurseTo when a nurse is selected
  useEffect(() => {
    if (selectedNurseId) {
      const nurse = nurses.find((n) => n.id === selectedNurseId);
      if (nurse) {
        setFormData((prev) => ({
          ...prev,
          nurseTo: nurse.name,
        }));
      }
    }
  }, [selectedNurseId, nurses]);

  // Auto-fill SBAR fields when a patient is selected
  useEffect(() => {
    if (selectedPatientId) {
      const patient = patients.find((p) => p.id === selectedPatientId);
      if (patient) {
        const situation = `${patient.name} is a ${patient.age}-year-old ${patient.gender.toLowerCase()} admitted on ${patient.admissionDate} with ${patient.diagnosis}. Currently in ${patient.room}. Risk level: ${patient.riskLevel}.`;
        const background = `Diagnosis: ${patient.diagnosis}\nAllergies: ${patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None known'}\nCurrent Medications: ${patient.medications.join(', ')}\nAdmission Date: ${patient.admissionDate}`;
        const assessment = `Vital Signs:\n- Heart Rate: ${patient.vitalSigns.heartRate} bpm\n- Blood Pressure: ${patient.vitalSigns.bloodPressure}\n- Temperature: ${patient.vitalSigns.temperature}°C\n- Oxygen Saturation: ${patient.vitalSigns.oxygenSaturation}%\n- Respiratory Rate: ${patient.vitalSigns.respiratoryRate}/min\n\nAlerts: ${patient.alerts.join('; ')}`;

        setFormData((prev) => ({
          ...prev,
          patientName: patient.name,
          situation,
          background,
          assessment,
          attendingPhysician: patient.attendingPhysician || '',
        }));
      }
    }
  }, [selectedPatientId, patients]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!selectedPatientId) {
      newErrors.patient = 'Please select a patient';
    }

    if (!selectedNurseId) {
      newErrors.nurse = 'Please select a receiving nurse';
    }

    if (!formData.recommendation.trim()) {
      newErrors.recommendation = 'Recommendation is required';
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
        patientId: selectedPatientId,
        patientName: formData.patientName,
        shift: formData.shift,
        nurseTo: formData.nurseTo,
        sbar: {
          situation: formData.situation,
          background: formData.background,
          assessment: formData.assessment,
          recommendation: formData.recommendation,
        },
        unfinishedTasks: [],
        status: 'pending',
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving handover:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Create Handover Note
          </DialogTitle>
          <DialogDescription>
            Complete the SBAR form to submit a secure handover note to the incoming nurse.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <Alert className="bg-blue-50 border-blue-200">
            <Shield className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              All handover notes are encrypted and comply with HIPAA security standards.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="patient">Select Patient *</Label>
              <Select
                value={selectedPatientId}
                onValueChange={setSelectedPatientId}
              >
                <SelectTrigger id="patient" className={errors.patient ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Choose a patient" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {patients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{patient.name}</span>
                        <span className="text-muted-foreground">• {patient.room}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.patient && (
                <p className="text-sm text-red-500">{errors.patient}</p>
              )}
            </div>

            {selectedPatientId && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-blue-900">Attending Physician</span>
                </div>
                <p className="text-sm text-blue-800 font-medium ml-6">{formData.attendingPhysician}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="shift">Shift *</Label>
                <Select
                  value={formData.shift}
                  onValueChange={(value: 'morning' | 'afternoon' | 'night') =>
                    setFormData({ ...formData, shift: value })
                  }
                >
                  <SelectTrigger id="shift">
                    <SelectValue placeholder="Select shift" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="morning">☀️ Morning (07:00-15:00)</SelectItem>
                    <SelectItem value="afternoon">🌤️ Afternoon (15:00-23:00)</SelectItem>
                    <SelectItem value="night">🌙 Night (23:00-07:00)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="nurseTo">Receiving Nurse *</Label>
                <Select
                  value={selectedNurseId}
                  onValueChange={setSelectedNurseId}
                >
                  <SelectTrigger id="nurseTo" className={errors.nurse ? 'border-red-500' : ''}>
                    <SelectValue placeholder="Choose a nurse" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {nurses.map((nurse) => (
                      <SelectItem key={nurse.id} value={nurse.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{nurse.name}</span>
                          <span className="text-muted-foreground">• {nurse.role}</span>
                          {nurse.specialization && (
                            <span className="text-xs text-muted-foreground">({nurse.specialization})</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.nurse && (
                  <p className="text-sm text-red-500">{errors.nurse}</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t pt-4 mt-4">
            <h3 className="font-semibold text-lg mb-4">SBAR Report</h3>

            {!selectedPatientId && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                <p className="text-gray-500 text-sm">Please select a patient to view SBAR information</p>
              </div>
            )}

            {selectedPatientId && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="situation" className="flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold">S</span>
                    Situation
                    <span className="text-xs text-muted-foreground">(Auto-filled)</span>
                  </Label>
                  <Textarea
                    id="situation"
                    value={formData.situation}
                    readOnly
                    rows={3}
                    className="bg-gray-50 border-gray-300 cursor-not-allowed resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="background" className="flex items-center gap-2">
                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-bold">B</span>
                    Background
                    <span className="text-xs text-muted-foreground">(Auto-filled)</span>
                  </Label>
                  <Textarea
                    id="background"
                    value={formData.background}
                    readOnly
                    rows={4}
                    className="bg-gray-50 border-gray-300 cursor-not-allowed resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="assessment" className="flex items-center gap-2">
                    <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-xs font-bold">A</span>
                    Assessment
                    <span className="text-xs text-muted-foreground">(Auto-filled)</span>
                  </Label>
                  <Textarea
                    id="assessment"
                    value={formData.assessment}
                    readOnly
                    rows={5}
                    className="bg-gray-50 border-gray-300 cursor-not-allowed resize-none"
                  />
                </div>

                <div className="space-y-2 bg-purple-50 p-4 rounded-lg border-2 border-purple-300">
                  <Label htmlFor="recommendation" className="flex items-center gap-2">
                    <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs font-bold">R</span>
                    Recommendation *
                    <span className="text-xs font-semibold text-purple-700">(Enter your recommendations)</span>
                  </Label>
                  <Textarea
                    id="recommendation"
                    placeholder="What needs to be done for this patient? (e.g., pending tasks, follow-ups, special care)"
                    value={formData.recommendation}
                    onChange={(e) => setFormData({ ...formData, recommendation: e.target.value })}
                    rows={4}
                    className={`bg-white border-purple-300 focus:border-purple-500 focus:ring-purple-200 ${
                      errors.recommendation ? 'border-red-500' : ''
                    }`}
                  />
                  {errors.recommendation && (
                    <p className="text-sm text-red-500">{errors.recommendation}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-4 border-t">
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
                  Submitting...
                </>
              ) : (
                'Submit Handover'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
