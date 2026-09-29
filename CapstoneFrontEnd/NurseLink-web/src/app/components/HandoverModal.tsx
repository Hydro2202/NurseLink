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
import { Loader2, Shield, User, Clock } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import type { EligibleReferralRecipients, HandoverNote, Patient } from '../types/domain';
import { fetchPatients, fetchEligibleReferralRecipients, ApiError } from '../api/nurselink';
import { bmiCategory } from '../utils/bmi';

interface HandoverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (handover: Partial<HandoverNote>) => Promise<void>;
}

export function HandoverModal({ open, onOpenChange, onSave }: HandoverModalProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [selectedNurseId, setSelectedNurseId] = useState<string>('');
  const [formData, setFormData] = useState({
    patientName: '',
    nurseTo: '',
    situation: '',
    background: '',
    assessment: '',
    recommendation: '',
    attendingPhysician: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Shift-rotation eligibility — who the signed-in nurse may refer to right
  // now, per the Duty Roster (see api/referral_shifts.py). There is no
  // manual "Shift" field any more: which shift this referral is on, and
  // who's eligible to receive it, is entirely server-derived.
  const [eligibility, setEligibility] = useState<EligibleReferralRecipients | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [eligibilityError, setEligibilityError] = useState('');

  useEffect(() => {
    if (!open) {
      setSelectedPatientId('');
      setSelectedNurseId('');
      setFormData({
        patientName: '',
        nurseTo: '',
        situation: '',
        background: '',
        assessment: '',
        recommendation: '',
        attendingPhysician: '',
      });
      setErrors({});
      setEligibility(null);
      setEligibilityError('');
      return;
    }
    fetchPatients()
      .then(setPatients)
      .catch(() => {});
  }, [open]);

  // Refetched every time the modal opens — eligibility depends on the Duty
  // Roster and the current time, both of which can have changed since the
  // last time it was open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEligibilityLoading(true);
    setEligibilityError('');
    fetchEligibleReferralRecipients()
      .then((data) => {
        if (cancelled) return;
        setEligibility(data);
        setSelectedNurseId((prev) => (prev && !data.recipients.some((n) => n.id === prev) ? '' : prev));
      })
      .catch((err) => {
        if (cancelled) return;
        setEligibility(null);
        setEligibilityError(err instanceof ApiError ? err.message : 'Failed to load eligible recipients.');
      })
      .finally(() => {
        if (!cancelled) setEligibilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const nurses = eligibility?.recipients ?? [];
  const onDuty = eligibility?.onDuty ?? false;
  const noNursesReason =
    !eligibilityLoading && eligibility && onDuty && nurses.length === 0
      ? `No nurses are assigned to the ${eligibility.nextShiftLabel} shift yet. Ask your Head Nurse to update the Duty Roster.`
      : '';

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
        const heightWeightLine =
          patient.heightCm != null || patient.weightKg != null
            ? `\nHeight: ${patient.heightCm != null ? `${patient.heightCm} cm` : 'N/A'} | Weight: ${
                patient.weightKg != null ? `${patient.weightKg} kg` : 'N/A'
              } | BMI: ${patient.bmi != null ? `${patient.bmi} (${bmiCategory(patient.bmi)})` : 'N/A'}`
            : '';
        const pendingLabs = (patient.laboratories || []).filter((l) => l.status === 'pending');
        const activeMeds = (patient.medicationOrders || []).filter((m) => m.isActive);
        const labsAndMedsLine =
          pendingLabs.length > 0 || activeMeds.length > 0
            ? `\n\nPending Labs: ${
                pendingLabs.length > 0 ? pendingLabs.map((l) => l.testName).join(', ') : 'None'
              }\nActive Medications: ${
                activeMeds.length > 0
                  ? activeMeds
                      .map(
                        (m) =>
                          `${m.medicationName} ${m.dose} ${m.route} ${m.frequency}${
                            m.lastGiven ? ` (last given ${new Date(m.lastGiven).toLocaleString()})` : ' (not yet given)'
                          }`
                      )
                      .join('; ')
                  : 'None'
              }`
            : '';
        const assessment = `Vital Signs:\n- Heart Rate: ${patient.vitalSigns.heartRate} bpm\n- Blood Pressure: ${patient.vitalSigns.bloodPressure}\n- Temperature: ${patient.vitalSigns.temperature}°C\n- Oxygen Saturation: ${patient.vitalSigns.oxygenSaturation}%\n- Respiratory Rate: ${patient.vitalSigns.respiratoryRate}/min${heightWeightLine}${labsAndMedsLine}\n\nAlerts: ${patient.alerts.join('; ')}`;

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

    if (!onDuty) {
      newErrors.form = "You are not on duty right now, so you can't create a referral.";
    }

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
        nurseTo: formData.nurseTo,
        // Sent alongside the name so the API can notify exactly this nurse —
        // display names are not unique on this ward.
        nurseToId: selectedNurseId,
        sbar: {
          situation: formData.situation,
          background: formData.background,
          assessment: formData.assessment,
          recommendation: formData.recommendation,
        },
        unfinishedTasks: [],
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving handover:', error);
      // The shift-rotation rule (and the duplicate-recipient check) is
      // enforced server-side — never trust the eligible-recipients list
      // alone, since the roster or the clock may have moved since it was
      // fetched. Map the field the backend rejected onto the matching
      // form field instead of a generic failure toast.
      if (error instanceof ApiError && error.data && typeof error.data === 'object') {
        const data = error.data as Record<string, unknown>;
        const messageFor = (field: string): string => {
          const value = data[field];
          if (Array.isArray(value) && value.length) return String(value[0]);
          if (typeof value === 'string') return value;
          return '';
        };
        const nurseToIdMessage = messageFor('nurseToId');
        const nonFieldMessage = messageFor('nonFieldErrors');
        setErrors((prev) => ({
          ...prev,
          ...(nurseToIdMessage ? { nurse: nurseToIdMessage } : {}),
          ...(nonFieldMessage ? { form: nonFieldMessage } : nurseToIdMessage ? {} : { form: error.message }),
        }));
      } else {
        setErrors((prev) => ({ ...prev, form: 'Failed to save the referral. Please try again.' }));
      }
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
            Create Referral Note
          </DialogTitle>
          <DialogDescription>
            Complete the SBAR form to submit a secure referral note to the incoming nurse.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Alert className="bg-blue-50 border-blue-200">
            <Shield className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              All referral notes are encrypted and comply with HIPAA security standards.
            </AlertDescription>
          </Alert>

          {errors.form && (
            <Alert variant="destructive">
              <AlertDescription>{errors.form}</AlertDescription>
            </Alert>
          )}

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

            {eligibilityError ? (
              <Alert variant="destructive">
                <AlertDescription>{eligibilityError}</AlertDescription>
              </Alert>
            ) : eligibilityLoading ? (
              <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Checking your shift...</span>
              </div>
            ) : !onDuty ? (
              <Alert variant="warning">
                <AlertDescription>You are not on duty right now, so you can't create a referral.</AlertDescription>
              </Alert>
            ) : (
              <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                <span className="text-sm">
                  You are on {eligibility?.currentShiftLabel} shift. Referring to:{' '}
                  <strong>
                    {eligibility?.nextShiftLabel} shift{eligibility?.nextShiftDate ? ` (${eligibility.nextShiftDate})` : ''}
                  </strong>
                  .
                </span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="nurseTo">Receiving Nurse *</Label>
              <Select
                value={selectedNurseId}
                onValueChange={setSelectedNurseId}
                disabled={eligibilityLoading || !onDuty}
              >
                <SelectTrigger id="nurseTo" className={errors.nurse ? 'border-red-500' : ''}>
                  <SelectValue placeholder={eligibilityLoading ? 'Checking your shift...' : noNursesReason || 'Choose a nurse'} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {nurses.map((nurse) => (
                    <SelectItem key={nurse.id} value={nurse.id}>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{nurse.name}</span>
                          <span className="text-muted-foreground">• {nurse.role}</span>
                          {nurse.specialization && (
                            <span className="text-xs text-muted-foreground">({nurse.specialization})</span>
                          )}
                        </div>
                        {/* Every eligible recipient is, by the shift-rotation rule
                            itself, on the exact same next shift — so this is the
                            real assigned shift for this nurse, not a placeholder. */}
                        {eligibility?.nextShiftLabel && (
                          <span className="text-xs text-muted-foreground">
                            {eligibility.nextShiftLabel} shift
                            {eligibility.nextShiftDate ? ` (${eligibility.nextShiftDate})` : ''}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.nurse && (
                <p className="text-sm text-red-500">{errors.nurse}</p>
              )}
              {!eligibilityLoading && onDuty && nurses.length === 0 && (
                <p className="text-sm text-amber-600">{noNursesReason}</p>
              )}
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
