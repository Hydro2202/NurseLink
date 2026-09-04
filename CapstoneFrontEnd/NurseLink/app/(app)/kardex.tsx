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
  Heart,
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
} from 'lucide-react-native';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/Card';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Badge } from '../../components/Badge';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Colors, Radius, Shadows } from '../../constants/colors';
import {
  createKardexRecord,
  fetchKardexRecords,
  reviewKardexRecord,
  ApiError,
} from '../../services/api';
import type { DuplicatePatientMatch, KardexHistory } from '../../types/domain';

const STATUS_BADGE: Record<
  KardexHistory['status'],
  { label: string; variant: 'info' | 'success' | 'warning' | 'destructive' }
> = {
  submitted: { label: 'Pending Review', variant: 'info' },
  approved: { label: 'Approved', variant: 'success' },
  returned: { label: 'Returned', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

export default function KardexScreen() {
  const { user } = useAuth();
  const toast = useToast();

  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [religion, setReligion] = useState('');
  const [room, setRoom] = useState('');
  const [bedNumber, setBedNumber] = useState('');
  const [admissionDate, setAdmissionDate] = useState('');

  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [admittingDiagnosis, setAdmittingDiagnosis] = useState('');
  const [finalDiagnosis, setFinalDiagnosis] = useState('');
  const [diet, setDiet] = useState('');

  const [temperature, setTemperature] = useState('');
  const [pulseRate, setPulseRate] = useState('');
  const [respiratoryRate, setRespiratoryRate] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [oxygenSaturation, setOxygenSaturation] = useState('');

  const [specialEndorsements, setSpecialEndorsements] = useState('');

  const [kardexHistory, setKardexHistory] = useState<KardexHistory[]>([]);

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

  const validateRequiredFields = () => {
    const errors: string[] = [];
    if (!firstName) errors.push('First Name');
    if (!lastName) errors.push('Last Name');
    if (!age) errors.push('Age');
    if (!gender) errors.push('Sex/Gender');
    if (!admissionDate) errors.push('Admission Date');
    if (!room) errors.push('Room');
    return errors;
  };

  const clearForm = () => {
    setLastName('');
    setFirstName('');
    setMiddleName('');
    setAge('');
    setGender('');
    setReligion('');
    setRoom('');
    setBedNumber('');
    setAdmissionDate('');
    setAttendingPhysician('');
    setChiefComplaint('');
    setAdmittingDiagnosis('');
    setFinalDiagnosis('');
    setDiet('');
    setTemperature('');
    setPulseRate('');
    setRespiratoryRate('');
    setBloodPressure('');
    setOxygenSaturation('');
    setSpecialEndorsements('');
  };

  const handleSaveClick = () => {
    const errors = validateRequiredFields();
    if (errors.length > 0) {
      toast.error('Missing Required Fields', {
        description: `Please fill in: ${errors.join(', ')}`,
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
        religion,
        room,
        bedNumber,
        admissionDate,
        attendingPhysician,
        chiefComplaint,
        admittingDiagnosis,
        finalDiagnosis,
        diet,
        temperature,
        pulseRate,
        respiratoryRate,
        bloodPressure,
        oxygenSaturation,
        specialEndorsements,
        confirmDuplicate,
      });

      setKardexHistory((prev) => [newEntry, ...prev]);
      setShowConfirmDialog(false);
      setDuplicateWarning(null);

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
    return `NURSELINK KARDEX
================
Patient: ${firstName} ${middleName} ${lastName}
Age: ${age} | Sex: ${gender}
Religion: ${religion || 'N/A'}
Room: ${room} | Bed: ${bedNumber || 'N/A'}
Admission Date: ${admissionDate}

Attending Physician: ${attendingPhysician || 'N/A'}
Chief Complaint: ${chiefComplaint || 'N/A'}
Admitting Diagnosis: ${admittingDiagnosis || 'N/A'}
Final Diagnosis: ${finalDiagnosis || 'N/A'}
Diet: ${diet || 'N/A'}

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

  const RequiredLabel = ({ text }: { text: string }) => (
    <Text style={styles.label}>
      {text} <Text style={styles.required}>*</Text>
    </Text>
  );

  const FieldLabel = ({ text }: { text: string }) => (
    <Text style={styles.label}>{text}</Text>
  );

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
      style={[
        styles.textarea,
        { minHeight },
        !editable && styles.readOnlyInput,
      ]}
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
      <TextInput
        style={[styles.singleInput, styles.readOnlyInput]}
        value={value}
        editable={false}
      />
    </View>
  );

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

      {/* Patient Demographics */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <User size={20} color={Colors.blue600} />
            <CardTitle>Patient Demographics</CardTitle>
          </View>
        </CardHeader>
        <CardContent style={styles.gap4}>
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
            <View style={[styles.field, styles.colQuarter]}>
              <RequiredLabel text="Age" />
              <Input
                value={age}
                onChangeText={setAge}
                placeholder="Age"
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.field, styles.colQuarter]}>
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
            <View style={[styles.field, styles.colQuarter]}>
              <FieldLabel text="Religion" />
              <Input
                value={religion}
                onChangeText={setReligion}
                placeholder="Religion"
              />
            </View>
            <View style={[styles.field, styles.colQuarter]}>
              <RequiredLabel text="Admission Date" />
              <Input
                value={admissionDate}
                onChangeText={setAdmissionDate}
                placeholder="YYYY-MM-DD"
              />
            </View>
          </View>

          <View style={styles.rowWrap}>
            <View style={[styles.field, styles.colHalf]}>
              <RequiredLabel text="Room" />
              <Input
                value={room}
                onChangeText={setRoom}
                placeholder="Room number"
              />
            </View>
            <View style={[styles.field, styles.colHalf]}>
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
        </CardContent>
      </Card>

      {/* Vital Signs */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <Heart size={20} color={Colors.red600} />
            <CardTitle>Latest Vital Signs</CardTitle>
          </View>
        </CardHeader>
        <CardContent>
          <View style={styles.rowWrap}>
            <View style={[styles.field, styles.colThird]}>
              <FieldLabel text="Temperature (°C)" />
              <Input
                value={temperature}
                onChangeText={setTemperature}
                placeholder="36.5"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <FieldLabel text="Pulse Rate (bpm)" />
              <Input
                value={pulseRate}
                onChangeText={setPulseRate}
                placeholder="80"
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <FieldLabel text="Respiratory Rate" />
              <Input
                value={respiratoryRate}
                onChangeText={setRespiratoryRate}
                placeholder="18"
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <FieldLabel text="Blood Pressure" />
              <Input
                value={bloodPressure}
                onChangeText={setBloodPressure}
                placeholder="120/80"
              />
            </View>
            <View style={[styles.field, styles.colThird]}>
              <FieldLabel text="O2 Saturation (%)" />
              <Input
                value={oxygenSaturation}
                onChangeText={setOxygenSaturation}
                placeholder="98"
                keyboardType="numeric"
              />
            </View>
          </View>
        </CardContent>
      </Card>

      {/* Special Endorsements */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <AlertTriangle size={20} color={Colors.orange600} />
            <CardTitle>Special Endorsements</CardTitle>
          </View>
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
              style={{ ...styles.actionBtn, backgroundColor: Colors.blue600 }}
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

      {/* Recent Kardex History */}
      {kardexHistory.length > 0 ? (
        <Card>
          <CardHeader>
            <View style={styles.titleRow}>
              <Clock size={20} color={Colors.purple600} />
              <CardTitle>Recent Kardex History</CardTitle>
            </View>
          </CardHeader>
          <CardContent style={styles.gap3}>
            {kardexHistory.map((entry) => (
              <Pressable
                key={entry.id}
                style={styles.historyItem}
                onPress={() => handleViewHistory(entry)}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.reviewStatusRow}>
                    <Text style={styles.historyName}>{entry.patientName}</Text>
                    <Badge variant={STATUS_BADGE[entry.status].variant}>
                      {STATUS_BADGE[entry.status].label}
                    </Badge>
                  </View>
                  <Text style={styles.historyRoom}>Room: {entry.room}</Text>
                  <View style={styles.metaRow}>
                    <Calendar size={12} color={Colors.gray500} />
                    <Text style={styles.historyDate}>
                      {new Date(entry.savedAt).toLocaleString()}
                    </Text>
                  </View>
                </View>
                <View style={styles.historyRight}>
                  <Text style={styles.savedByLabel}>Saved by</Text>
                  <Text style={styles.savedByName}>{entry.savedBy}</Text>
                </View>
              </Pressable>
            ))}
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
                          label="Admission Date"
                          value={selectedHistoryEntry.admissionDate}
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
                    </View>
                  </View>

                  <View style={styles.separator} />

                  <View>
                    <View style={[styles.titleRow, { marginBottom: 12 }]}>
                      <Heart size={20} color={Colors.red600} />
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

                  {user?.role === 'supervisor' && selectedHistoryEntry.status === 'submitted' ? (
                    <>
                      <View style={styles.separator} />
                      <View style={styles.reviewPanel}>
                        <View style={[styles.titleRow, { marginBottom: 12 }]}>
                          <FileText size={20} color={Colors.purple600} />
                          <Text style={styles.sectionHeading}>Supervisor Review</Text>
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
                              style={{ flex: 1, backgroundColor: Colors.green600 }}
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
                  {kardexHistory.map((entry) => (
                    <View key={entry.id} style={styles.historyListItem}>
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
    borderWidth: 2,
    borderColor: Colors.blue200,
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
  printBtn: {
    borderWidth: 2,
  },
  historyBtn: {
    borderWidth: 2,
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
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    gap: 12,
  },
  historyName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.gray900,
  },
  historyRoom: {
    fontSize: 13,
    color: Colors.gray600,
    marginTop: 2,
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
  historyRight: {
    alignItems: 'flex-end',
  },
  savedByLabel: {
    fontSize: 13,
    color: Colors.gray600,
  },
  savedByName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.gray900,
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
    borderWidth: 2,
    borderColor: Colors.purple100,
    borderRadius: Radius.lg,
    padding: 16,
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
    borderWidth: 2,
    borderColor: Colors.border,
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
    borderWidth: 2,
    borderColor: Colors.purple600,
  },
});
