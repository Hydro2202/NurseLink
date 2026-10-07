import React, { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { ClipboardCheck, Sparkles, X } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Alert, AlertDescription } from './Alert';
import { generateDischargePlan, ApiError, type DischargePlanDraft } from '../services/api';
import type { Patient } from '../types/domain';
import { useToast } from '../contexts/ToastContext';

type PlanFieldKey = 'medications' | 'environment' | 'treatment' | 'healthTeaching' | 'outpatientReferral' | 'diet';

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

export function DischargePlanModal({ open, onOpenChange, patient, onConfirm, confirmLabel }: DischargePlanModalProps) {
  const toast = useToast();
  const [fields, setFields] = useState<Record<PlanFieldKey, string>>(EMPTY_PLAN);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<PlanFieldKey, string>>>({});
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (() => {
      if (!open) {
        setFields(EMPTY_PLAN);
        setAiGenerated(false);
        setErrors({});
        setSubmitting(false);
      }
    })();
  }, [open]);

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
      const draft: DischargePlanDraft = await generateDischargePlan(patient.id);
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
        description: error instanceof ApiError ? error.message : 'Please try again, or fill it in manually.',
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

  const busy = generating || submitting;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => !busy && onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <View style={styles.headerTitleRow}>
              <ClipboardCheck size={20} color={Colors.blue600} />
              <Text style={styles.title}>Discharge Plan</Text>
            </View>
            <Pressable onPress={() => !busy && onOpenChange(false)} hitSlop={8}>
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={styles.description}>
            {patient ? `${patient.name} • ${patient.room}` : ''} — the M.E.T.H.O.D. framework
            (Medications, Environment, Treatment, Health Teaching, Outpatient Referral, Diet)
            documents this patient&apos;s plan of care after discharge.
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              <Alert variant="info">
                <AlertDescription>
                  All six sections are required before this patient can be discharged.
                </AlertDescription>
              </Alert>

              <Button
                variant="outline"
                onPress={handleGenerate}
                disabled={busy || !patient}
                style={styles.aiButton}
              >
                {generating ? (
                  <View style={styles.btnInner}>
                    <ActivityIndicator size="small" color={Colors.blue600} />
                    <Text style={styles.aiButtonText}>Drafting from charted notes...</Text>
                  </View>
                ) : (
                  <View style={styles.btnInner}>
                    <Sparkles size={16} color={Colors.blue600} />
                    <Text style={styles.aiButtonText}>AI-Generate Discharge Plan</Text>
                  </View>
                )}
              </Button>
              {aiGenerated ? (
                <Text style={styles.aiNote}>
                  Drafted from this patient&apos;s medications, diet, and charted notes. Review each
                  section before discharging — editing any field marks it reviewed.
                </Text>
              ) : null}

              {FIELDS.map(({ key, letter, label, placeholder, hint }) => (
                <View key={key} style={styles.field}>
                  <View style={styles.labelRow}>
                    <View style={styles.letterBadge}>
                      <Text style={styles.letterBadgeText}>{letter}</Text>
                    </View>
                    <Text style={styles.label}>{label}</Text>
                  </View>
                  <TextInput
                    style={[styles.textarea, errors[key] ? styles.textareaError : null]}
                    placeholder={placeholder}
                    placeholderTextColor={Colors.mutedForeground}
                    value={fields[key]}
                    onChangeText={(text) => setField(key, text)}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    editable={!busy}
                  />
                  {errors[key] ? <Text style={styles.errorText}>{errors[key]}</Text> : null}
                  <Text style={styles.hint}>{hint}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button variant="outline" onPress={() => onOpenChange(false)} disabled={busy} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button
              onPress={handleConfirm}
              disabled={busy || !patient}
              loading={submitting}
              style={{ flex: 1, backgroundColor: Colors.red600 }}
            >
              {submitting ? 'Discharging...' : confirmLabel || 'Complete Discharge'}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 700,
    maxHeight: '90%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
  },
  description: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginBottom: 16,
    lineHeight: 18,
  },
  scroll: { flexGrow: 0 },
  form: { gap: 16, paddingBottom: 8 },
  aiButton: {
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
  },
  aiButtonText: {
    color: Colors.blue700,
    fontWeight: '600',
    fontSize: 14,
  },
  aiNote: {
    fontSize: 12,
    color: Colors.blue700,
    lineHeight: 16,
    marginTop: -8,
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  field: { gap: 6 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  letterBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.blue700,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  textarea: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.inputBackground,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.foreground,
    lineHeight: 20,
  },
  textareaError: {
    borderColor: Colors.red600,
  },
  errorText: {
    fontSize: 12,
    color: Colors.red600,
  },
  hint: {
    fontSize: 11,
    color: Colors.gray500,
    lineHeight: 16,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
