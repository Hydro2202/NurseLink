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
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';
import { ClipboardCheck, Info, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { generateDischargePlan, ApiError, type DischargePlanDraft } from '../api/nurselink';
import type { Patient } from '../types/domain';

type PlanFieldKey =
  | 'medications'
  | 'environment'
  | 'treatment'
  | 'healthTeaching'
  | 'outpatientReferral'
  | 'diet';

const EMPTY_PLAN: Record<PlanFieldKey, string> = {
  medications: '',
  environment: '',
  treatment: '',
  healthTeaching: '',
  outpatientReferral: '',
  diet: '',
};

const FIELDS: { key: PlanFieldKey; letter: string; label: string; placeholder: string; hint: string }[] = [
  {
    key: 'medications',
    letter: 'M',
    label: 'Medications',
    placeholder: 'Prescribed medications, dosage, frequency, route, and special instructions.',
    hint: 'Example: "Metformin 500mg PO BID with meals. Lisinopril 10mg PO once daily each morning. Take with food to reduce stomach upset."',
  },
  {
    key: 'environment',
    letter: 'E',
    label: 'Environment',
    placeholder: 'Home environment considerations, safety needs, and caregiver/support availability.',
    hint: 'Example: "Lives with spouse on the second floor, no elevator. Needs a bedside commode and grab bars in the bathroom. Daughter available for daytime support."',
  },
  {
    key: 'treatment',
    letter: 'T',
    label: 'Treatment',
    placeholder: 'Ongoing treatments, wound care, therapy, or activity restrictions.',
    hint: 'Example: "Continue wound dressing changes every other day. Physical therapy 3x/week. Avoid lifting more than 10 lbs for 2 weeks."',
  },
  {
    key: 'healthTeaching',
    letter: 'H',
    label: 'Health Teaching',
    placeholder: 'Patient/family education given, warning signs to watch for, and self-monitoring instructions.',
    hint: 'Example: "Reviewed signs of infection (fever, redness, drainage) — call the clinic if any appear. Taught proper glucometer use; return demonstration successful."',
  },
  {
    key: 'outpatientReferral',
    letter: 'O',
    label: 'Outpatient Referral',
    placeholder: 'Follow-up appointments, specialist referrals, and contact information provided.',
    hint: 'Example: "Follow-up with Dr. Lim (Cardiology) on 09/20/2026, 9:00 AM, (02) 555-0100. Home health nursing to call within 48 hours to schedule a visit."',
  },
  {
    key: 'diet',
    letter: 'D',
    label: 'Diet',
    placeholder: 'Dietary guidelines and nutritional instructions.',
    hint: 'Example: "Low-sodium, diabetic diet. Limit fluid intake to 1.5L/day. Avoid grapefruit — interacts with current medications."',
  },
];

interface DischargePlanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onConfirm: (plan: DischargePlanDraft) => Promise<void>;
  /** Defaults to "Complete Discharge". */
  confirmLabel?: string;
}

export function DischargePlanModal({
  open,
  onOpenChange,
  patient,
  onConfirm,
  confirmLabel,
}: DischargePlanModalProps) {
  const [fields, setFields] = useState<Record<PlanFieldKey, string>>(EMPTY_PLAN);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<PlanFieldKey, string>>>({});
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setFields(EMPTY_PLAN);
      setAiGenerated(false);
      setErrors({});
      setSubmitting(false);
    }
  }, [open]);

  const busy = generating || submitting;

  const setField = (key: PlanFieldKey, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    // Once the nurse edits anything, the plan is no longer purely AI output —
    // it's been reviewed and changed, so the record should say "manual" too.
    setAiGenerated(false);
  };

  const handleGenerate = async () => {
    if (!patient) return;
    setGenerating(true);
    try {
      const draft = await generateDischargePlan(patient.id);
      setFields({
        medications: draft.medications || '',
        environment: draft.environment || '',
        treatment: draft.treatment || '',
        healthTeaching: draft.healthTeaching || '',
        outpatientReferral: draft.outpatientReferral || '',
        diet: draft.diet || '',
      });
      setAiGenerated(true);
      setErrors({});
      toast.success('Discharge plan drafted', {
        description: 'Review each section below — fill in anything left blank before discharging.',
      });
    } catch (error) {
      toast.error('Could not draft a discharge plan', {
        description:
          error instanceof ApiError ? error.message : 'Please try again, or fill it in manually.',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirm = async () => {
    const nextErrors: Partial<Record<PlanFieldKey, string>> = {};
    for (const { key, label } of FIELDS) {
      if (!fields[key].trim()) {
        nextErrors[key] = `${label} is required to complete the discharge plan.`;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error('Discharge plan incomplete', {
        description: 'Every M.E.T.H.O.D. section must be filled in before discharging this patient.',
      });
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm({ ...fields, aiGenerated });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-blue-600" />
            Discharge Plan
          </DialogTitle>
          <DialogDescription>
            {patient ? `${patient.name} • ${patient.room} — ` : ''}the M.E.T.H.O.D. framework
            (Medications, Environment, Treatment, Health Teaching, Outpatient Referral, Diet)
            documents this patient&apos;s plan of care after discharge.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <Alert className="bg-blue-50 border-blue-200 text-blue-800">
            <Info />
            <AlertDescription className="text-blue-800">
              All six sections are required before this patient can be discharged.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleGenerate}
              disabled={busy || !patient}
              className="w-full border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Drafting from charted notes...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  AI-Generate Discharge Plan
                </>
              )}
            </Button>
            {aiGenerated ? (
              <p className="text-xs text-blue-700">
                Drafted from this patient&apos;s medications, diet, and charted notes. Review each
                section before discharging — editing any field marks it reviewed.
              </p>
            ) : null}
          </div>

          {FIELDS.map(({ key, letter, label, placeholder, hint }) => (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`discharge-${key}`} className="flex items-center gap-2 text-sm font-medium">
                <span className="inline-flex w-[22px] h-[22px] items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                  {letter}
                </span>
                {label}
              </label>
              <Textarea
                id={`discharge-${key}`}
                value={fields[key]}
                onChange={(e) => setField(key, e.target.value)}
                placeholder={placeholder}
                rows={3}
                disabled={busy}
                className={errors[key] ? 'border-red-500' : ''}
              />
              {errors[key] ? <p className="text-xs text-red-600">{errors[key]}</p> : null}
              <p className="text-[11px] leading-4 text-gray-500">{hint}</p>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={busy || !patient}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {submitting ? 'Discharging...' : confirmLabel || 'Complete Discharge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
