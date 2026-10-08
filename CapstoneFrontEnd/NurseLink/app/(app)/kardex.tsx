import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  Modal,
  Pressable,
  Share,
} from 'react-native';
import {
  User,
  UserRound,
  HeartPulse,
  FileText,
  AlertTriangle,
  Printer,
  Save,
  X,
  Clock,
  Calendar,
  History,
  Eye,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Stethoscope,
  MapPin,
  BedDouble,
  Plus,
  FlaskConical,
} from 'lucide-react-native';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/Card';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { DatePicker, todayIso, formatDisplayDate } from '../../components/DatePicker';
import { Badge } from '../../components/Badge';
import { PatientCareTeam } from '../../components/PatientCareTeam';
import { VitalSignsGrid } from '../../components/VitalSignsGrid';
import { KardexLabsAndMedications } from '../../components/KardexLabsAndMedications';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Colors, Radius, Shadows } from '../../constants/colors';
import {
  createKardexRecord,
  fetchKardexRecords,
  reviewKardexRecord,
  setPatientAssignedDoctors,
  ApiError,
} from '../../services/api';
import type { DuplicatePatientMatch, KardexHistory } from '../../types/domain';
import { computeBmi, bmiCategory, validateHeightCm, validateWeightKg } from '../../utils/bmi';

const STATUS_BADGE: Record<
  KardexHistory['status'],
  { label: string; variant: 'info' | 'success' | 'warning' | 'destructive' }
> = {
  submitted: { label: 'Pending Review', variant: 'info' },
  approved: { label: 'Approved', variant: 'success' },
  returned: { label: 'Returned', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

// Left-edge accent on each queue card — lets a head nurse scanning a long
// list tell status apart at a glance, without reading every badge.
const STATUS_ACCENT: Record<KardexHistory['status'], string> = {
  submitted: Colors.blue500,
  approved: Colors.green600,
  returned: Colors.orange600,
  rejected: Colors.red600,
};

// Module-scope, not defined inside KardexScreen: a component declared
// inside another component's render body gets a brand-new identity every
// render, so React tears down and remounts its actual <TextInput> DOM node
// on every keystroke — the field loses focus and only accepts one letter
// at a time until clicked again. Keeping these here (they only touch
// `styles`/`Colors`, no component-local state) keeps the same DOM node,
// and the same input, across renders.
const RequiredLabel = ({ text }: { text: string }) => (
  <Text style={styles.label}>
    {text} <Text style={styles.required}>*</Text>
  </Text>
);

const FieldLabel = ({ text }: { text: string }) => <Text style={styles.label}>{text}</Text>;

const TextArea = ({
  value,
  onChangeText,
  placeholder,
  minHeight = 72,
  editable = true,
}: {
  value: string;
  onChangeText?: (v: string) => void;
  placeholder?: string;
  minHeight?: number;
  editable?: boolean;
}) => (
  <TextInput
    style={[styles.textarea, { minHeight }, !editable && styles.readOnlyInput]}
    value={value}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor={Colors.mutedForeground}
    multiline
    textAlignVertical="top"
    editable={editable}
  />
);

const ReadOnlyField = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.field}>
    <FieldLabel text={label} />
    <TextInput style={[styles.singleInput, styles.readOnlyInput]} value={value} editable={false} />
  </View>
);

export default function KardexScreen() {
  const { user } = useAuth();
  const toast = useToast();

  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [birthday, setBirthday] = useState('');
  const [religion, setReligion] = useState('');
  const [room, setRoom] = useState('');
  const [bedNumber, setBedNumber] = useState('');
  const [admissionDate, setAdmissionDate] = useState('');

  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [admittingDiagnosis, setAdmittingDiagnosis] = useState('');
  const [finalDiagnosis, setFinalDiagnosis] = useState('');
  const [diet, setDiet] = useState('');
  const [ivf, setIvf] = useState('');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [allergyDraft, setAllergyDraft] = useState('');

  const [temperature, setTemperature] = useState('');
  const [pulseRate, setPulseRate] = useState('');
  const [respiratoryRate, setRespiratoryRate] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [oxygenSaturation, setOxygenSaturation] = useState('');

  const [specialEndorsements, setSpecialEndorsements] = useState('');

  const [doctorIds, setDoctorIds] = useState<number[]>([]);
  const [careTeamValid, setCareTeamValid] = useState(true);
  // Bumped on every save/clear so PatientCareTeam remounts fresh for the
  // next patient — it fetches its own data internally.
  const [careTeamResetKey, setCareTeamResetKey] = useState(0);

  const [kardexHistory, setKardexHistory] = useState<KardexHistory[]>([]);
  // Set right after a successful save so Laboratories/Medication Intake can
  // be added immediately for that patient, without leaving this screen —
  // cleared by the "Done" action below, not by clearForm() (the fields
  // reset for the next admission, but this panel should stay put until the
  // nurse is finished with it).
  const [savedPatient, setSavedPatient] = useState<{ id: string; name: string } | null>(null);

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicatePatientMatch[] | null>(null);
  const [saveSubmitting, setSaveSubmitting] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<KardexHistory | null>(null);

  // 'returned'/'rejected' need a reason typed in first — approved fires
  // immediately since an approval needs no explanation.
  const [reviewActionPending, setReviewActionPending] = useState<'returned' | 'rejected' | null>(null);
  const [reviewNotesInput, setReviewNotesInput] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchKardexRecords();
        if (!cancelled) setKardexHistory(data);
      } catch {
        // empty history is fine
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleViewHistory = (entry: KardexHistory) => {
    setSelectedHistoryEntry(entry);
    setShowHistoryDialog(true);
    setReviewActionPending(null);
    setReviewNotesInput('');
  };

  const handleReview = async (decision: 'approved' | 'returned' | 'rejected') => {
    if (!selectedHistoryEntry) return;
    if (decision !== 'approved' && !reviewNotesInput.trim()) {
      setReviewActionPending(decision);
      return;
    }

    setReviewSubmitting(true);
    try {
      const updated = await reviewKardexRecord(selectedHistoryEntry.id, decision, reviewNotesInput.trim());
      setSelectedHistoryEntry(updated);
      setKardexHistory((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setReviewActionPending(null);
      setReviewNotesInput('');
      toast.success(
        decision === 'approved' ? 'Kardex approved' : decision === 'returned' ? 'Kardex returned' : 'Kardex rejected',
        { description: `${updated.patientName}'s kardex has been ${decision}.` }
      );
    } catch (error) {
      toast.error('Failed to submit review', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleOpenHistoryList = () => {
    if (kardexHistory.length === 0) {
      toast.info('No History Available', {
        description: 'No kardex records have been saved yet.',
      });
      return;
    }
    setShowHistoryDialog(true);
    setSelectedHistoryEntry(null);
  };

  const addAllergy = () => {
    const entry = allergyDraft.trim();
    if (!entry) return;
    setAllergies((prev) =>
      prev.some((a) => a.toLowerCase() === entry.toLowerCase()) ? prev : [...prev, entry]
    );
    setAllergyDraft('');
  };

  const removeAllergy = (index: number) => {
    setAllergies((prev) => prev.filter((_, i) => i !== index));
  };

  const validateRequiredFields = () => {
    const errors: string[] = [];
    if (!firstName) errors.push('First Name');
    if (!lastName) errors.push('Last Name');
    if (!age) errors.push('Age');
    if (!gender) errors.push('Sex/Gender');
    if (!admissionDate) errors.push('Admission Date');
    if (!room) errors.push('Room');
    // Height/weight are optional, but if entered they must be in range —
    // same rule the backend enforces, checked here so a bad value shows up
    // as a normal "missing/invalid field" rather than a save round-trip.
    if (validateHeightCm(height)) errors.push('Height');
    if (validateWeightKg(weight)) errors.push('Weight');
    return errors;
  };

  const clearForm = () => {
    setLastName('');
    setFirstName('');
    setMiddleName('');
    setAge('');
    setGender('');
    setHeight('');
    setWeight('');
    setBirthday('');
    setReligion('');
    setRoom('');
    setBedNumber('');
    setAdmissionDate('');
    setAttendingPhysician('');
    setChiefComplaint('');
    setAdmittingDiagnosis('');
    setFinalDiagnosis('');
    setDiet('');
    setIvf('');
    setAllergies([]);
    setAllergyDraft('');
    setTemperature('');
    setPulseRate('');
    setRespiratoryRate('');
    setBloodPressure('');
    setOxygenSaturation('');
    setSpecialEndorsements('');
    setDoctorIds([]);
    setCareTeamResetKey((k) => k + 1);
  };

  const handleSaveClick = () => {
    const errors = validateRequiredFields();
    if (errors.length > 0) {
      toast.error('Missing Required Fields', {
        description: `Please fill in: ${errors.join(', ')}`,
      });
      return;
    }
    if (!careTeamValid) {
      toast.error('Incomplete Care Team', {
        description: 'Please assign at least one doctor to each selected department.',
      });
      return;
    }
    setDuplicateWarning(null);
    setShowConfirmDialog(true);
  };

  const handleConfirmSave = async (confirmDuplicate = false) => {
    setSaveSubmitting(true);
    try {
      const newEntry = await createKardexRecord({
        lastName,
        firstName,
        middleName,
        age,
        gender,
        heightCm: height,
        weightKg: weight,
        birthday,
        religion,
        room,
        bedNumber,
        admissionDate,
        attendingPhysician,
        chiefComplaint,
        admittingDiagnosis,
        finalDiagnosis,
        diet,
        ivf,
        allergies,
        temperature,
        pulseRate,
        respiratoryRate,
        bloodPressure,
        oxygenSaturation,
        specialEndorsements,
        confirmDuplicate,
      });

      if (newEntry.patientCode && doctorIds.length > 0) {
        await setPatientAssignedDoctors(newEntry.patientCode, doctorIds);
      }

      setKardexHistory((prev) => [newEntry, ...prev]);
      setShowConfirmDialog(false);
      setDuplicateWarning(null);
      if (newEntry.patientCode) {
        setSavedPatient({ id: newEntry.patientCode, name: newEntry.patientName || `${firstName} ${lastName}` });
      }

      toast.success('Kardex Saved Successfully!', {
        description: `${firstName} ${lastName} was added to your patient list.`,
      });

      clearForm();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const data = error.data as { possibleDuplicates?: DuplicatePatientMatch[] } | undefined;
        if (data?.possibleDuplicates?.length) {
          setDuplicateWarning(data.possibleDuplicates);
          return;
        }
      }
      toast.error('Failed to save kardex', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setSaveSubmitting(false);
    }
  };

  const buildPrintContent = () => {
    const printBmi = computeBmi(height, weight);
    const bmiLine = printBmi != null ? `${printBmi} (${bmiCategory(printBmi)})` : 'N/A';
    return `NURSELINK KARDEX
================
Patient: ${firstName} ${middleName} ${lastName}
Age: ${age} | Sex: ${gender} | Birthday: ${birthday ? formatDisplayDate(birthday) : 'N/A'}
Height: ${height ? `${height} cm` : 'N/A'} | Weight: ${weight ? `${weight} kg` : 'N/A'} | BMI: ${bmiLine}
Religion: ${religion || 'N/A'}
Room: ${room} | Bed: ${bedNumber || 'N/A'}
Admission Date: ${formatDisplayDate(admissionDate)}

Attending Physician: ${attendingPhysician || 'N/A'}
Chief Complaint: ${chiefComplaint || 'N/A'}
Admitting Diagnosis: ${admittingDiagnosis || 'N/A'}
Final Diagnosis: ${finalDiagnosis || 'N/A'}
Diet: ${diet || 'N/A'}
IVF: ${ivf || 'N/A'}
Allergies: ${allergies.length > 0 ? allergies.join(', ') : 'None known'}

VITAL SIGNS
Temp: ${temperature || 'N/A'} °C
Pulse: ${pulseRate || 'N/A'} bpm
RR: ${respiratoryRate || 'N/A'}
BP: ${bloodPressure || 'N/A'}
O2 Sat: ${oxygenSaturation || 'N/A'}%

SPECIAL ENDORSEMENTS
${specialEndorsements || 'None'}
`;
  };

  // Labs/active medications, for the saved-record Print action below — the
  // live draft form above has no patient to read these from yet (a fresh
  // admission has none), but a saved KardexHistory entry's linked patient
  // does (see KardexRecordSerializer's nested laboratories/medicationOrders).
  const buildLabsAndMedicationsPrintSection = (entry: KardexHistory): string => {
    const labs = entry.laboratories || [];
    const meds = (entry.medicationOrders || []).filter((m) => m.isActive);
    const labsText = labs.length
      ? labs
          .map((l) => `- ${l.testName} (${l.status}${l.dateDone ? `, done ${formatDisplayDate(l.dateDone)}` : ''})`)
          .join('\n')
      : 'None recorded';
    const medsText = meds.length
      ? meds
          .map((m) => {
            const lastGiven = m.lastGiven
              ? new Date(m.lastGiven).toLocaleString()
              : 'not yet given';
            return `- ${m.medicationName} ${m.dose} ${m.route} ${m.frequency} (last given: ${lastGiven})`;
          })
          .join('\n')
      : 'None active';
    return `\nLABORATORIES\n${labsText}\n\nACTIVE MEDICATIONS\n${medsText}\n`;
  };

  const handlePrintHistoryEntry = async (entry: KardexHistory) => {
    const bmiLine = entry.bmi != null ? `${entry.bmi} (${bmiCategory(entry.bmi)})` : 'N/A';
    const content = `NURSELINK KARDEX
================
Patient: ${entry.firstName} ${entry.middleName} ${entry.lastName}
Age: ${entry.age} | Sex: ${entry.gender} | Birthday: ${entry.birthday ? formatDisplayDate(entry.birthday) : 'N/A'}
Height: ${entry.heightCm ? `${entry.heightCm} cm` : 'N/A'} | Weight: ${entry.weightKg ? `${entry.weightKg} kg` : 'N/A'} | BMI: ${bmiLine}
Room: ${entry.room} | Bed: ${entry.bedNumber || 'N/A'}
Admission Date: ${formatDisplayDate(entry.admissionDate)}

Attending Physician: ${entry.attendingPhysician || 'N/A'}
Admitting Diagnosis: ${entry.admittingDiagnosis || 'N/A'}
Final Diagnosis: ${entry.finalDiagnosis || 'N/A'}
Allergies: ${entry.allergies?.length ? entry.allergies.join(', ') : 'None known'}
${buildLabsAndMedicationsPrintSection(entry)}`;

    toast.info('Printing Kardex...', { description: 'Share sheet will open shortly.' });
    try {
      await Share.share({ message: content, title: 'NurseLink Kardex' });
    } catch {
      toast.error('Failed to open share sheet.');
    }
  };

  const handlePrint = async () => {
    const errors = validateRequiredFields();
    if (errors.length > 0) {
      toast.error('Cannot Print - Missing Required Fields', {
        description: `Please fill in: ${errors.join(', ')}`,
      });
      return;
    }

    toast.info('Printing Kardex...', {
      description: 'Share sheet will open shortly.',
    });

    try {
      await Share.share({
        message: buildPrintContent(),
        title: 'NurseLink Kardex',
      });
    } catch {
      toast.error('Unable to open print/share dialog');
    }
  };


  const heightError = validateHeightCm(height);
  const weightError = validateWeightKg(weight);
  const liveBmi = computeBmi(height, weight);

  const isSupervisor = user?.role === 'head_nurse';
  const pendingReviewCount = kardexHistory.filter((e) => e.status === 'submitted').length;
  // Head nurses work through a queue — surface what needs a decision first,
  // without hiding or reordering anything a staff nurse would see.
  const displayedHistory = isSupervisor
    ? [...kardexHistory].sort((a, b) =>
        (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1)
      )
    : kardexHistory;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View>
        <Text style={styles.pageTitle}>Kardex</Text>
        <Text style={styles.pageSubtitle}>Patient Summary & Care Plan</Text>
      </View>

      {/* Patient quick summary — live preview of what's been entered so far */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeaderRow}>
          <UserRound size={16} color={Colors.blue700} />
          <Text style={styles.summaryEyebrow}>PATIENT</Text>
        </View>
        <View style={styles.summaryNameRow}>
          <Text style={styles.summaryName} numberOfLines={1}>
            {[firstName, middleName, lastName].filter(Boolean).join(' ') || 'New patient'}
          </Text>
          <View style={styles.statusChip}>
            <View style={styles.statusDotGreen} />
            <Text style={styles.statusChipText}>Admitted</Text>
          </View>
        </View>
        <View style={styles.summaryFactsRow}>
          <Text style={styles.summaryFact}>{age ? `${age} yrs` : 'Age —'}</Text>
          <Text style={styles.summaryDivider}>•</Text>
          <Text style={styles.summaryFact}>{gender || 'Sex —'}</Text>
          <Text style={styles.summaryDivider}>•</Text>
          <View style={styles.summaryFactIconRow}>
            <MapPin size={12} color={Colors.mutedForeground} />
            <Text style={styles.summaryFact}>{room ? `Room ${room}` : 'Room —'}</Text>
          </View>
          {bedNumber ? (
            <>
              <Text style={styles.summaryDivider}>•</Text>
              <View style={styles.summaryFactIconRow}>
                <BedDouble size={12} color={Colors.mutedForeground} />
                <Text style={styles.summaryFact}>Bed {bedNumber}</Text>
              </View>
            </>
          ) : null}
        </View>
        <View style={styles.summaryMetaRow}>
          <Text style={styles.summaryMeta}>
            Admitted: <Text style={styles.summaryMetaValue}>{admissionDate || 'Not yet entered'}</Text>
          </Text>
          <Text style={styles.summaryMeta}>
            Attending: <Text style={styles.summaryMetaValue}>{attendingPhysician || 'Not yet entered'}</Text>
          </Text>
        </View>
      </View>

      {/* Patient Demographics */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <User size={20} color={Colors.blue600} />
            <CardTitle>Patient Demographics</CardTitle>
          </View>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <Text style={styles.groupHeading}>Personal Information</Text>
          <View style={styles.rowWrap}>
            <View style={[styles.field, styles.colThird]}>
              <RequiredLabel text="Last Name" />
              <Input
                value={lastName}
                onChangeText={setLastName}
                placeholder="Enter last name"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <RequiredLabel text="First Name" />
              <Input
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Enter first name"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <FieldLabel text="Middle Name" />
              <Input
                value={middleName}
                onChangeText={setMiddleName}
                placeholder="Enter middle name"
              />
            </View>
          </View>

          <View style={styles.rowWrap}>
            <View style={[styles.field, styles.colThird]}>
              <RequiredLabel text="Age" />
              <Input
                value={age}
                onChangeText={setAge}
                placeholder="Age"
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <Select
                label="Sex/Gender *"
                value={gender}
                onValueChange={setGender}
                options={[
                  { label: 'Male', value: 'Male' },
                  { label: 'Female', value: 'Female' },
                ]}
                placeholder="Select"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <FieldLabel text="Religion" />
              <Input
                value={religion}
                onChangeText={setReligion}
                placeholder="Religion"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <DatePicker
                label="Birthday"
                value={birthday}
                onChange={setBirthday}
                maxDate={todayIso()}
                helperText="Cannot be in the future"
              />
            </View>
          </View>

          <View style={styles.rowWrap}>
            <View style={[styles.field, styles.colHalf]}>
              <FieldLabel text="Height (cm)" />
              <Input
                value={height}
                onChangeText={setHeight}
                placeholder="e.g. 165.0"
                keyboardType="decimal-pad"
                error={heightError || undefined}
              />
            </View>
            <View style={[styles.field, styles.colHalf]}>
              <FieldLabel text="Weight (kg)" />
              <Input
                value={weight}
                onChangeText={setWeight}
                placeholder="e.g. 62.5"
                keyboardType="decimal-pad"
                error={weightError || undefined}
              />
            </View>
          </View>
          {liveBmi != null ? (
            <Text style={styles.bmiPreview}>
              BMI: <Text style={styles.bmiPreviewValue}>{liveBmi}</Text> ({bmiCategory(liveBmi)})
            </Text>
          ) : null}

          <View style={styles.groupDivider} />
          <Text style={styles.groupHeading}>Admission Information</Text>
          <View style={styles.rowWrap}>
            <View style={[styles.field, styles.colThird]}>
              <DatePicker
                label="Admission Date"
                required
                value={admissionDate}
                onChange={setAdmissionDate}
                maxDate={todayIso()}
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <RequiredLabel text="Room" />
              <Input
                value={room}
                onChangeText={setRoom}
                placeholder="Room number"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <FieldLabel text="Bed Number" />
              <Input
                value={bedNumber}
                onChangeText={setBedNumber}
                placeholder="Bed number"
              />
            </View>
          </View>
        </CardContent>
      </Card>

      {/* Medical Information */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <FileText size={20} color={Colors.green600} />
            <CardTitle>Medical Information</CardTitle>
          </View>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <View style={styles.field}>
            <FieldLabel text="Attending Physician" />
            <Input
              value={attendingPhysician}
              onChangeText={setAttendingPhysician}
              placeholder="Physician name"
            />
          </View>

          <View style={styles.field}>
            <FieldLabel text="Chief Complaint" />
            <TextArea
              value={chiefComplaint}
              onChangeText={setChiefComplaint}
              placeholder="Enter chief complaint"
              minHeight={64}
            />
          </View>

          <View style={styles.field}>
            <FieldLabel text="Admitting Diagnosis" />
            <TextArea
              value={admittingDiagnosis}
              onChangeText={setAdmittingDiagnosis}
              placeholder="Enter admitting diagnosis"
              minHeight={64}
            />
          </View>

          <View style={styles.field}>
            <FieldLabel text="Final Diagnosis" />
            <TextArea
              value={finalDiagnosis}
              onChangeText={setFinalDiagnosis}
              placeholder="Enter final diagnosis"
              minHeight={64}
            />
          </View>

          <View style={styles.field}>
            <FieldLabel text="Diet" />
            <Input
              value={diet}
              onChangeText={setDiet}
              placeholder="e.g., NPO, Regular, Low-sodium"
            />
          </View>

          <View style={styles.field}>
            <FieldLabel text="IVF" />
            <Input
              value={ivf}
              onChangeText={setIvf}
              placeholder="e.g., D5LR 1L @ 80cc/hr"
            />
          </View>

          <View style={styles.field}>
            <FieldLabel text="Allergies" />
            <View style={styles.allergyInputRow}>
              <View style={{ flex: 1 }}>
                <Input
                  value={allergyDraft}
                  onChangeText={setAllergyDraft}
                  placeholder="e.g., Penicillin, Latex, Shellfish"
                  onSubmitEditing={addAllergy}
                  returnKeyType="done"
                />
              </View>
              <Pressable
                onPress={addAllergy}
                disabled={!allergyDraft.trim()}
                style={[styles.allergyAddBtn, !allergyDraft.trim() && styles.allergyAddBtnDisabled]}
              >
                <Plus size={16} color={Colors.white} />
              </Pressable>
            </View>
            {allergies.length > 0 ? (
              <View style={styles.allergyChipsRow}>
                {allergies.map((allergy, index) => (
                  <View key={`${allergy}-${index}`} style={styles.allergyChip}>
                    <AlertTriangle size={12} color={Colors.orange700} />
                    <Text style={styles.allergyChipText}>{allergy}</Text>
                    <Pressable onPress={() => removeAllergy(index)} hitSlop={6}>
                      <X size={13} color={Colors.orange700} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.allergyEmptyText}>No known allergies recorded.</Text>
            )}
          </View>
        </CardContent>
      </Card>

      {/* Vital Signs */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <HeartPulse size={20} color={Colors.red600} />
            <CardTitle>Latest Vital Signs</CardTitle>
          </View>
        </CardHeader>
        <CardContent>
          <VitalSignsGrid
            temperature={temperature}
            onTemperatureChange={setTemperature}
            pulseRate={pulseRate}
            onPulseRateChange={setPulseRate}
            respiratoryRate={respiratoryRate}
            onRespiratoryRateChange={setRespiratoryRate}
            bloodPressure={bloodPressure}
            onBloodPressureChange={setBloodPressure}
            oxygenSaturation={oxygenSaturation}
            onOxygenSaturationChange={setOxygenSaturation}
          />
        </CardContent>
      </Card>

      {/* Patient Care Team */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <Stethoscope size={20} color={Colors.blue600} />
            <CardTitle>Patient Care Team</CardTitle>
          </View>
          <CardDescription>
            Departments and doctors responsible for this patient&apos;s care.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PatientCareTeam
            key={careTeamResetKey}
            initialAssignedDoctors={[]}
            doctorIds={doctorIds}
            onChange={setDoctorIds}
            onValidityChange={setCareTeamValid}
          />
        </CardContent>
      </Card>

      {/* Special Endorsements */}
      <Card style={styles.endorsementsCard}>
        <CardHeader>
          <View style={styles.titleRow}>
            <AlertTriangle size={20} color={Colors.orange600} />
            <CardTitle>Special Endorsements</CardTitle>
          </View>
          <CardDescription>
            Important instructions, precautions, and patient-specific notes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TextArea
            value={specialEndorsements}
            onChangeText={setSpecialEndorsements}
            placeholder="Enter any special instructions, precautions, or important notes for this patient..."
            minHeight={100}
          />
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Card style={styles.actionCard}>
        <CardContent style={{ paddingTop: 20, gap: 12 }}>
          <View style={styles.actionRow}>
            <Button
              onPress={handleSaveClick}
              style={{ ...styles.actionBtn, ...styles.saveBtn, backgroundColor: Colors.blue600 }}
              size="lg"
            >
              <View style={styles.btnInner}>
                <Save size={20} color={Colors.white} />
                <Text style={styles.btnTextWhite}>Save Kardex</Text>
              </View>
            </Button>
            <Button
              onPress={handlePrint}
              variant="outline"
              style={{ ...styles.actionBtn, ...styles.printBtn }}
              size="lg"
            >
              <View style={styles.btnInner}>
                <Printer size={20} color={Colors.foreground} />
                <Text style={styles.btnTextDark}>Print Kardex</Text>
              </View>
            </Button>
          </View>

          <Button
            onPress={handleOpenHistoryList}
            variant="outline"
            style={styles.historyBtn}
            size="lg"
          >
            <View style={styles.btnInner}>
              <History size={20} color={Colors.purple600} />
              <Text style={styles.historyBtnText}>
                View Kardex History
                {kardexHistory.length > 0 ? ` (${kardexHistory.length})` : ''}
              </Text>
            </View>
          </Button>

          <Text style={styles.requiredHint}>
            <Text style={styles.required}>*</Text> Required fields must be filled before saving
          </Text>
        </CardContent>
      </Card>

      {/* Laboratories / Medication Intake for the patient just saved */}
      {savedPatient ? (
        <Card>
          <CardHeader>
            <View style={[styles.titleRow, { justifyContent: 'space-between' }]}>
              <View style={styles.titleRow}>
                <FlaskConical size={20} color={Colors.blue600} />
                <CardTitle>Laboratories &amp; Medication Intake — {savedPatient.name}</CardTitle>
              </View>
              <Pressable onPress={() => setSavedPatient(null)} hitSlop={8}>
                <X size={18} color={Colors.mutedForeground} />
              </Pressable>
            </View>
            <CardDescription>
              Add labs or medication orders for this patient now, or come back later via Edit or
              Kardex History.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KardexLabsAndMedications patientId={savedPatient.id} />
          </CardContent>
        </Card>
      ) : null}

      {/* Recent Kardex History */}
      {kardexHistory.length > 0 ? (
        <Card>
          <CardHeader>
            <View style={styles.titleRow}>
              <Clock size={20} color={Colors.purple600} />
              <CardTitle>Recent Kardex Activity</CardTitle>
            </View>
          </CardHeader>
          <CardContent style={{ gap: 0 }}>
            {kardexHistory.slice(0, 5).map((entry, index) => (
              <Pressable
                key={entry.id}
                style={styles.timelineRow}
                onPress={() => handleViewHistory(entry)}
              >
                <View style={styles.timelineRail}>
                  <View style={styles.timelineDot} />
                  {index < Math.min(kardexHistory.length, 5) - 1 ? (
                    <View style={styles.timelineLine} />
                  ) : null}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineDate}>
                    {new Date(entry.savedAt).toLocaleString()}
                  </Text>
                  <View style={styles.reviewStatusRow}>
                    <Text style={styles.timelineText}>
                      Kardex saved for <Text style={styles.summaryBold}>{entry.patientName}</Text>
                      {' '}(Room {entry.room}) by {entry.savedBy}
                    </Text>
                  </View>
                  <Badge variant={STATUS_BADGE[entry.status].variant}>
                    {STATUS_BADGE[entry.status].label}
                  </Badge>
                </View>
              </Pressable>
            ))}
            {kardexHistory.length > 5 ? (
              <Pressable onPress={handleOpenHistoryList} style={styles.viewAllRow}>
                <Text style={styles.viewAllText}>View Full History ({kardexHistory.length})</Text>
              </Pressable>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Confirmation Dialog */}
      <Modal
        visible={showConfirmDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmDialog(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowConfirmDialog(false)}
        >
          <Pressable
            style={[styles.confirmSheet, Shadows.xl]}
            onPress={(e) => e.stopPropagation()}
          >
            {duplicateWarning ? (
              <>
                <Text style={styles.modalTitle}>Possible Duplicate Patient</Text>
                <Text style={styles.modalDesc}>
                  A patient with similar information already exists. Please verify before creating
                  a new patient.
                </Text>
                <View style={styles.gap3}>
                  {duplicateWarning.map((match) => (
                    <View key={match.patientId} style={styles.reviewNotesBox}>
                      <Text style={styles.summaryLine}>
                        <Text style={styles.summaryBold}>{match.name}</Text> ({match.patientId})
                      </Text>
                      <Text style={styles.reviewNotesText}>
                        {match.age}y • {match.gender} • Room {match.room}
                        {match.admissionDate ? ` • Admitted ${match.admissionDate}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={styles.modalFooter}>
                  <Button
                    variant="outline"
                    style={{ flex: 1 }}
                    onPress={() => setDuplicateWarning(null)}
                  >
                    Back, Let Me Check
                  </Button>
                  <Button
                    style={{ flex: 1, backgroundColor: Colors.orange600 }}
                    disabled={saveSubmitting}
                    onPress={() => handleConfirmSave(true)}
                  >
                    <Text style={styles.btnTextWhite}>
                      {saveSubmitting ? 'Saving...' : 'Continue, This Is a New Patient'}
                    </Text>
                  </Button>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Confirm Save Kardex</Text>
                <Text style={styles.modalDesc}>
                  Are you sure you want to save this kardex? Please verify all information is correct
                  before proceeding.
                </Text>
                <View style={styles.confirmSummary}>
                  <Text style={styles.summaryLine}>
                    <Text style={styles.summaryBold}>Patient: </Text>
                    {firstName} {lastName}
                  </Text>
                  <Text style={styles.summaryLine}>
                    <Text style={styles.summaryBold}>Age: </Text>
                    {age} | <Text style={styles.summaryBold}>Sex: </Text>
                    {gender}
                  </Text>
                  <Text style={styles.summaryLine}>
                    <Text style={styles.summaryBold}>Room: </Text>
                    {room}
                  </Text>
                  <Text style={styles.summaryLine}>
                    <Text style={styles.summaryBold}>Admission Date: </Text>
                    {admissionDate}
                  </Text>
                </View>
                <View style={styles.modalFooter}>
                  <Button
                    variant="outline"
                    style={{ flex: 1 }}
                    onPress={() => setShowConfirmDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    style={{ flex: 1, backgroundColor: Colors.blue600 }}
                    disabled={saveSubmitting}
                    onPress={() => handleConfirmSave(false)}
                  >
                    <View style={styles.btnInner}>
                      <Save size={16} color={Colors.white} />
                      <Text style={styles.btnTextWhite}>
                        {saveSubmitting ? 'Saving...' : 'Confirm & Save'}
                      </Text>
                    </View>
                  </Button>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* History Dialog */}
      <Modal
        visible={showHistoryDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHistoryDialog(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.historySheet, Shadows.xl]}>
            <View style={styles.historyHeader}>
              <View style={[styles.titleRow, { flex: 1 }]}>
                <History size={20} color={Colors.purple600} />
                <Text style={styles.modalTitle}>
                  Kardex History ({kardexHistory.length})
                </Text>
              </View>
              <Pressable onPress={() => setShowHistoryDialog(false)} hitSlop={8}>
                <X size={20} color={Colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={styles.historyDesc}>
              {selectedHistoryEntry
                ? 'Complete kardex record - Read-only view for audit and verification'
                : 'View all saved kardex records'}
            </Text>

            {isSupervisor && !selectedHistoryEntry && pendingReviewCount > 0 ? (
              <View style={styles.pendingBanner}>
                <Clock size={15} color={Colors.blue700} />
                <Text style={styles.pendingBannerText}>
                  {pendingReviewCount} {pendingReviewCount === 1 ? 'record' : 'records'} awaiting
                  your review
                </Text>
              </View>
            ) : null}

            <ScrollView
              style={styles.historyScroll}
              contentContainerStyle={{ padding: 16, gap: 16 }}
              showsVerticalScrollIndicator={false}
            >
              {selectedHistoryEntry ? (
                <View style={styles.gap4}>
                  <View style={styles.metaBanner}>
                    <View style={styles.metaBannerItem}>
                      <Calendar size={16} color={Colors.purple600} />
                      <View>
                        <Text style={styles.metaBannerLabel}>Saved On</Text>
                        <Text style={styles.metaBannerValue}>
                          {new Date(selectedHistoryEntry.savedAt).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.metaBannerItem}>
                      <User size={16} color={Colors.purple600} />
                      <View>
                        <Text style={styles.metaBannerLabel}>Saved By</Text>
                        <Text style={styles.metaBannerValue}>
                          {selectedHistoryEntry.savedBy}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.reviewStatusRow}>
                    <Badge variant={STATUS_BADGE[selectedHistoryEntry.status].variant}>
                      {STATUS_BADGE[selectedHistoryEntry.status].label}
                    </Badge>
                    {selectedHistoryEntry.status !== 'submitted' && selectedHistoryEntry.reviewedBy ? (
                      <Text style={styles.reviewStatusText}>
                        by {selectedHistoryEntry.reviewedBy}
                        {selectedHistoryEntry.reviewedAt
                          ? ` · ${new Date(selectedHistoryEntry.reviewedAt).toLocaleString()}`
                          : ''}
                      </Text>
                    ) : null}
                  </View>
                  {selectedHistoryEntry.reviewNotes &&
                  (selectedHistoryEntry.status === 'returned' || selectedHistoryEntry.status === 'rejected') ? (
                    <View style={styles.reviewNotesBox}>
                      <Text style={styles.reviewNotesLabel}>
                        {selectedHistoryEntry.status === 'returned' ? 'Correction requested:' : 'Rejection reason:'}
                      </Text>
                      <Text style={styles.reviewNotesText}>{selectedHistoryEntry.reviewNotes}</Text>
                    </View>
                  ) : null}

                  <View style={styles.separator} />

                  <View>
                    <View style={[styles.titleRow, { marginBottom: 12 }]}>
                      <User size={20} color={Colors.blue600} />
                      <Text style={styles.sectionHeading}>Patient Demographics</Text>
                    </View>
                    <View style={styles.rowWrap}>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="Last Name"
                          value={selectedHistoryEntry.lastName}
                        />
                      </View>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="First Name"
                          value={selectedHistoryEntry.firstName}
                        />
                      </View>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="Middle Name"
                          value={selectedHistoryEntry.middleName}
                        />
                      </View>
                    </View>
                    <View style={[styles.rowWrap, { marginTop: 12 }]}>
                      <View style={[styles.field, styles.colQuarter]}>
                        <ReadOnlyField label="Age" value={selectedHistoryEntry.age} />
                      </View>
                      <View style={[styles.field, styles.colQuarter]}>
                        <ReadOnlyField
                          label="Sex/Gender"
                          value={selectedHistoryEntry.gender}
                        />
                      </View>
                      <View style={[styles.field, styles.colQuarter]}>
                        <ReadOnlyField
                          label="Religion"
                          value={selectedHistoryEntry.religion}
                        />
                      </View>
                      <View style={[styles.field, styles.colQuarter]}>
                        <ReadOnlyField
                          label="Birthday"
                          value={selectedHistoryEntry.birthday ? formatDisplayDate(selectedHistoryEntry.birthday) : 'N/A'}
                        />
                      </View>
                      <View style={[styles.field, styles.colQuarter]}>
                        <ReadOnlyField
                          label="Admission Date"
                          value={formatDisplayDate(selectedHistoryEntry.admissionDate)}
                        />
                      </View>
                    </View>
                    <View style={[styles.rowWrap, { marginTop: 12 }]}>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="Height"
                          value={selectedHistoryEntry.heightCm ? `${selectedHistoryEntry.heightCm} cm` : '—'}
                        />
                      </View>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="Weight"
                          value={selectedHistoryEntry.weightKg ? `${selectedHistoryEntry.weightKg} kg` : '—'}
                        />
                      </View>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="BMI"
                          value={
                            selectedHistoryEntry.bmi != null
                              ? `${selectedHistoryEntry.bmi} (${bmiCategory(selectedHistoryEntry.bmi)})`
                              : '—'
                          }
                        />
                      </View>
                    </View>
                    <View style={[styles.rowWrap, { marginTop: 12 }]}>
                      <View style={[styles.field, styles.colHalf]}>
                        <ReadOnlyField label="Room" value={selectedHistoryEntry.room} />
                      </View>
                      <View style={[styles.field, styles.colHalf]}>
                        <ReadOnlyField
                          label="Bed Number"
                          value={selectedHistoryEntry.bedNumber || 'N/A'}
                        />
                      </View>
                    </View>
                  </View>

                  <View style={styles.separator} />

                  <View>
                    <View style={[styles.titleRow, { marginBottom: 12 }]}>
                      <FileText size={20} color={Colors.green600} />
                      <Text style={styles.sectionHeading}>Medical Information</Text>
                    </View>
                    <View style={styles.gap4}>
                      <ReadOnlyField
                        label="Attending Physician"
                        value={selectedHistoryEntry.attendingPhysician || 'N/A'}
                      />
                      <View style={styles.field}>
                        <FieldLabel text="Chief Complaint" />
                        <TextArea
                          value={selectedHistoryEntry.chiefComplaint || 'N/A'}
                          editable={false}
                          minHeight={64}
                        />
                      </View>
                      <View style={styles.field}>
                        <FieldLabel text="Admitting Diagnosis" />
                        <TextArea
                          value={selectedHistoryEntry.admittingDiagnosis || 'N/A'}
                          editable={false}
                          minHeight={64}
                        />
                      </View>
                      <View style={styles.field}>
                        <FieldLabel text="Final Diagnosis" />
                        <TextArea
                          value={selectedHistoryEntry.finalDiagnosis || 'N/A'}
                          editable={false}
                          minHeight={64}
                        />
                      </View>
                      <ReadOnlyField
                        label="Diet"
                        value={selectedHistoryEntry.diet || 'N/A'}
                      />
                      <ReadOnlyField
                        label="IVF"
                        value={selectedHistoryEntry.ivf || 'N/A'}
                      />
                      <ReadOnlyField
                        label="Allergies"
                        value={
                          selectedHistoryEntry.allergies?.length
                            ? selectedHistoryEntry.allergies.join(', ')
                            : 'None known'
                        }
                      />
                    </View>
                  </View>

                  <View style={styles.separator} />

                  <View>
                    <View style={[styles.titleRow, { marginBottom: 12 }]}>
                      <HeartPulse size={20} color={Colors.red600} />
                      <Text style={styles.sectionHeading}>Vital Signs</Text>
                    </View>
                    <View style={styles.rowWrap}>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="Temperature (°C)"
                          value={selectedHistoryEntry.temperature || 'N/A'}
                        />
                      </View>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="Pulse Rate (bpm)"
                          value={selectedHistoryEntry.pulseRate || 'N/A'}
                        />
                      </View>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="Respiratory Rate"
                          value={selectedHistoryEntry.respiratoryRate || 'N/A'}
                        />
                      </View>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="Blood Pressure"
                          value={selectedHistoryEntry.bloodPressure || 'N/A'}
                        />
                      </View>
                      <View style={[styles.field, styles.colThird]}>
                        <ReadOnlyField
                          label="O2 Saturation (%)"
                          value={selectedHistoryEntry.oxygenSaturation || 'N/A'}
                        />
                      </View>
                    </View>
                  </View>

                  <View style={styles.separator} />

                  <View>
                    <View style={[styles.titleRow, { marginBottom: 12 }]}>
                      <AlertTriangle size={20} color={Colors.orange600} />
                      <Text style={styles.sectionHeading}>Special Endorsements</Text>
                    </View>
                    <TextArea
                      value={
                        selectedHistoryEntry.specialEndorsements ||
                        'No special endorsements recorded'
                      }
                      editable={false}
                      minHeight={100}
                    />
                  </View>

                  {selectedHistoryEntry.patientCode ? (
                    <>
                      <View style={styles.separator} />
                      <KardexLabsAndMedications patientId={selectedHistoryEntry.patientCode} />
                    </>
                  ) : null}

                  {user?.role === 'head_nurse' && selectedHistoryEntry.status === 'submitted' ? (
                    <>
                      <View style={styles.separator} />
                      <View style={styles.reviewPanel}>
                        <View style={styles.reviewPanelHeader}>
                          <View style={styles.titleRow}>
                            <FileText size={20} color={Colors.purple600} />
                            <Text style={styles.sectionHeading}>Head Nurse Review</Text>
                          </View>
                          <View style={styles.actionRequiredChip}>
                            <Text style={styles.actionRequiredText}>ACTION REQUIRED</Text>
                          </View>
                        </View>
                        {reviewActionPending ? (
                          <View style={styles.gap3}>
                            <Text style={styles.reviewNotesLabel}>
                              {reviewActionPending === 'returned'
                                ? 'What needs to be corrected?'
                                : 'Why is this being rejected?'}
                            </Text>
                            <TextArea
                              value={reviewNotesInput}
                              onChangeText={setReviewNotesInput}
                              placeholder="Explain what the nurse should fix..."
                              minHeight={80}
                            />
                            <View style={styles.reviewActionsRow}>
                              <Button
                                variant="outline"
                                size="sm"
                                onPress={() => {
                                  setReviewActionPending(null);
                                  setReviewNotesInput('');
                                }}
                                style={{ flex: 1 }}
                              >
                                <Text>Cancel</Text>
                              </Button>
                              <Button
                                size="sm"
                                onPress={() => handleReview(reviewActionPending)}
                                disabled={reviewSubmitting || !reviewNotesInput.trim()}
                                style={{
                                  flex: 1,
                                  backgroundColor:
                                    reviewActionPending === 'rejected' ? Colors.red600 : Colors.orange600,
                                }}
                              >
                                <Text style={styles.btnTextWhite}>
                                  {reviewSubmitting
                                    ? 'Submitting...'
                                    : reviewActionPending === 'returned'
                                      ? 'Confirm Return'
                                      : 'Confirm Reject'}
                                </Text>
                              </Button>
                            </View>
                          </View>
                        ) : (
                          <View style={styles.reviewActionsRow}>
                            <Button
                              size="sm"
                              onPress={() => handleReview('approved')}
                              disabled={reviewSubmitting}
                              style={{ flex: 1.3, backgroundColor: Colors.green600 }}
                            >
                              <View style={styles.btnInner}>
                                <CheckCircle2 size={16} color={Colors.white} />
                                <Text style={styles.btnTextWhite}>Approve</Text>
                              </View>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onPress={() => setReviewActionPending('returned')}
                              disabled={reviewSubmitting}
                              style={{ flex: 1, borderColor: Colors.orange600 }}
                            >
                              <View style={styles.btnInner}>
                                <RotateCcw size={16} color={Colors.orange600} />
                                <Text style={{ color: Colors.orange600, fontWeight: '700' }}>Return</Text>
                              </View>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onPress={() => setReviewActionPending('rejected')}
                              disabled={reviewSubmitting}
                              style={{ flex: 1, borderColor: Colors.red600 }}
                            >
                              <View style={styles.btnInner}>
                                <XCircle size={16} color={Colors.red600} />
                                <Text style={{ color: Colors.red600, fontWeight: '700' }}>Reject</Text>
                              </View>
                            </Button>
                          </View>
                        )}
                      </View>
                    </>
                  ) : null}
                </View>
              ) : (
                <View style={styles.gap3}>
                  {displayedHistory.map((entry) => (
                    <View
                      key={entry.id}
                      style={[
                        styles.historyListItem,
                        { borderLeftColor: STATUS_ACCENT[entry.status] },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={styles.historyListTop}>
                          <Text style={styles.historyListName}>{entry.patientName}</Text>
                          <Badge variant={STATUS_BADGE[entry.status].variant}>
                            {STATUS_BADGE[entry.status].label}
                          </Badge>
                          <Badge variant="secondary">
                            {`${entry.age}y • ${entry.gender}`}
                          </Badge>
                        </View>
                        <Text style={styles.historyListMeta}>
                          <Text style={styles.summaryBold}>Room: </Text>
                          {entry.room}
                          {entry.bedNumber ? ` - Bed ${entry.bedNumber}` : ''}
                        </Text>
                        <Text style={styles.historyListMeta}>
                          <Text style={styles.summaryBold}>Physician: </Text>
                          {entry.attendingPhysician || 'Not specified'}
                        </Text>
                        <View style={[styles.metaRow, { marginTop: 8 }]}>
                          <Calendar size={12} color={Colors.gray500} />
                          <Text style={styles.historyDate}>
                            {new Date(entry.savedAt).toLocaleString()}
                          </Text>
                          <Text style={styles.historyDate}>
                            <Text style={styles.summaryBold}>By: </Text>
                            {entry.savedBy}
                          </Text>
                        </View>
                      </View>
                      {isSupervisor && entry.status === 'submitted' ? (
                        <Button
                          size="sm"
                          onPress={() => handleViewHistory(entry)}
                          style={{ backgroundColor: Colors.blue600 }}
                        >
                          <View style={styles.btnInner}>
                            <CheckCircle2 size={16} color={Colors.white} />
                            <Text style={styles.btnTextWhite}>Review</Text>
                          </View>
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onPress={() => handleViewHistory(entry)}
                          style={styles.viewDetailsBtn}
                        >
                          <View style={styles.btnInner}>
                            <Eye size={16} color={Colors.purple600} />
                            <Text style={styles.historyBtnText}>View Details</Text>
                          </View>
                        </Button>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            <View style={styles.historyFooter}>
              {selectedHistoryEntry ? (
                <Button
                  variant="outline"
                  onPress={() => setSelectedHistoryEntry(null)}
                  style={{ marginRight: 'auto' }}
                >
                  ← Back to List
                </Button>
              ) : null}
              {selectedHistoryEntry ? (
                <Button variant="outline" onPress={() => handlePrintHistoryEntry(selectedHistoryEntry)}>
                  <View style={styles.btnInner}>
                    <Printer size={16} color={Colors.foreground} />
                    <Text style={styles.btnTextDark}>Print</Text>
                  </View>
                </Button>
              ) : null}
              <Button variant="outline" onPress={() => setShowHistoryDialog(false)}>
                <View style={styles.btnInner}>
                  <X size={16} color={Colors.foreground} />
                  <Text style={styles.btnTextDark}>Close</Text>
                </View>
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 24,
    maxWidth: 1024,
    width: '100%',
    alignSelf: 'center',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.gray900,
  },
  pageSubtitle: {
    fontSize: 14,
    color: Colors.gray600,
    marginTop: 2,
  },
  summaryCard: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.blue200,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 6,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.blue700,
    letterSpacing: 0.5,
  },
  summaryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryName: {
    flex: 1,
    fontSize: 19,
    fontWeight: '700',
    color: Colors.gray900,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.green50,
  },
  statusDotGreen: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.green600,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.green700,
  },
  summaryFactsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  summaryFactIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  summaryFact: {
    fontSize: 13,
    color: Colors.foreground,
    fontWeight: '500',
  },
  summaryDivider: {
    fontSize: 12,
    color: Colors.gray400,
  },
  summaryMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 2,
  },
  summaryMeta: {
    fontSize: 12,
    color: Colors.mutedForeground,
  },
  summaryMetaValue: {
    color: Colors.foreground,
    fontWeight: '600',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gap3: { gap: 12 },
  gap4: { gap: 16 },
  field: { gap: 6 },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  required: {
    color: Colors.red600,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  colThird: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 140,
  },
  colQuarter: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 120,
  },
  colHalf: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 140,
  },
  groupHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.blue700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  bmiPreview: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginTop: -6,
  },
  bmiPreviewValue: {
    fontWeight: '700',
    color: Colors.foreground,
  },
  groupDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 2,
  },
  textarea: {
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
  singleInput: {
    height: 40,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.inputBackground,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.foreground,
  },
  readOnlyInput: {
    backgroundColor: Colors.gray50,
  },
  actionCard: {
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
  },
  endorsementsCard: {
    borderColor: Colors.orange100,
  },
  allergyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  allergyAddBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.blue600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allergyAddBtnDisabled: {
    opacity: 0.5,
  },
  allergyChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  allergyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.orange50,
    borderWidth: 1,
    borderColor: Colors.orange100,
  },
  allergyChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.orange700,
  },
  allergyEmptyText: {
    fontSize: 12,
    color: Colors.gray500,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    minWidth: 140,
    height: 48,
  },
  saveBtn: {
    flex: 1.4,
  },
  printBtn: {
    borderWidth: 1,
  },
  historyBtn: {
    borderWidth: 1,
    borderColor: Colors.purple600,
    height: 48,
  },
  historyBtnText: {
    color: Colors.purple600,
    fontWeight: '600',
    fontSize: 14,
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btnTextWhite: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
  btnTextDark: {
    color: Colors.foreground,
    fontWeight: '600',
    fontSize: 14,
  },
  requiredHint: {
    fontSize: 11,
    color: Colors.gray600,
    textAlign: 'center',
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  historyDate: {
    fontSize: 11,
    color: Colors.gray500,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineRail: {
    alignItems: 'center',
    width: 12,
  },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.purple600,
    marginTop: 4,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: Colors.border,
    marginTop: 2,
  },
  timelineContent: {
    flex: 1,
    gap: 4,
    paddingBottom: 16,
  },
  timelineDate: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.gray500,
  },
  timelineText: {
    fontSize: 13,
    color: Colors.foreground,
    lineHeight: 18,
  },
  viewAllRow: {
    alignItems: 'center',
    paddingTop: 4,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.purple600,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  confirmSheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 24,
    width: '100%',
    maxWidth: 420,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 14,
    color: Colors.mutedForeground,
    lineHeight: 20,
    marginBottom: 16,
  },
  confirmSummary: {
    backgroundColor: Colors.blue50,
    padding: 16,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.blue200,
    gap: 8,
    marginBottom: 20,
  },
  summaryLine: {
    fontSize: 13,
    color: Colors.foreground,
  },
  summaryBold: {
    fontWeight: '700',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
  },
  historySheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    width: '100%',
    maxWidth: 720,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  historyDesc: {
    fontSize: 13,
    color: Colors.mutedForeground,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  historyScroll: {
    flexGrow: 0,
  },
  historyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    // Up to 3 auto-width buttons ("Back to List", "Print", "Close") — on a
    // narrow phone they don't all fit on one line. Without wrap, Yoga
    // doesn't shrink auto-width siblings, so the row overflows past the
    // screen edge and the last button(s) get clipped instead of wrapping.
    flexWrap: 'wrap',
    rowGap: 8,
    gap: 8,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.white,
  },
  metaBanner: {
    backgroundColor: Colors.purple50,
    borderWidth: 2,
    borderColor: Colors.purple100,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 12,
  },
  metaBannerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaBannerLabel: {
    fontSize: 11,
    color: Colors.gray600,
  },
  metaBannerValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.gray900,
  },
  reviewStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewStatusText: { fontSize: 12, color: Colors.gray500 },
  reviewNotesBox: {
    backgroundColor: Colors.orange50,
    borderWidth: 1,
    borderColor: Colors.orange100,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
  },
  reviewNotesLabel: { fontSize: 12, fontWeight: '700', color: Colors.gray700 },
  reviewNotesText: { fontSize: 13, color: Colors.gray700, lineHeight: 18 },
  reviewPanel: {
    backgroundColor: Colors.purple50,
    borderWidth: 1,
    borderColor: Colors.purple100,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 12,
  },
  reviewPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionRequiredChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Colors.purple600,
  },
  actionRequiredText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.white,
    letterSpacing: 0.4,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
  },
  pendingBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.blue700,
  },
  reviewActionsRow: { flexDirection: 'row', gap: 8 },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.gray900,
  },
  historyListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    borderRadius: Radius.lg,
    gap: 12,
  },
  historyListTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  historyListName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.gray900,
  },
  historyListMeta: {
    fontSize: 13,
    color: Colors.gray600,
    marginTop: 2,
  },
  viewDetailsBtn: {
    borderWidth: 1,
    borderColor: Colors.purple600,
  },
});
