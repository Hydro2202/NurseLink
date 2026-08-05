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
  ActivityIndicator,
} from 'react-native';
import {
  Sparkles,
  FileText,
  Edit as EditIcon,
  Check,
  Clock,
  Eye,
  AlertCircle,
  Search,
  User,
  Stethoscope,
  Edit2,
  X,
} from 'lucide-react-native';
import {
  fetchPatients,
  fetchChartingNotes,
  createChartingNote,
  updateChartingNote,
  ApiError,
} from '../../services/api';
import type { ChartingNote, Patient } from '../../types/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Alert, AlertDescription } from '../../components/Alert';
import { StructuredNursingNote } from '../../components/StructuredNursingNote';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Colors, Radius, Shadows } from '../../constants/colors';

interface StructuredData {
  patientName: string;
  patientId: string;
  room: string;
  date: string;
  time: string;
  attendingPhysician: string;
  nurseName: string;
  vitalSigns: {
    heartRate: string;
    bloodPressure: string;
    temperature: string;
    oxygenSaturation: string;
    respiratoryRate: string;
  };
  assessment: string;
  diagnosis: string;
  riskLevel: string;
  allergies: string;
  medications: string;
  alerts: string;
  interventions: string[];
  patientResponse: string;
  clinicalSummary: string;
  plan: string;
  timestamp: string;
}

export default function ChartingScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [notes, setNotes] = useState<ChartingNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [inputText, setInputText] = useState('');
  const [aiGeneratedNote, setAiGeneratedNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewNoteDialog, setViewNoteDialog] = useState(false);
  const [selectedNote, setSelectedNote] = useState<ChartingNote | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [structuredData, setStructuredData] = useState<StructuredData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [patientData, noteData] = await Promise.all([
          fetchPatients({ mine: true }),
          fetchChartingNotes(),
        ]);
        if (!cancelled) {
          setPatients(patientData);
          setNotes(noteData);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error('Failed to load charting data', {
            description: error instanceof ApiError ? error.message : 'Please try again.',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getNurseName = () => {
    if (!user) return 'Unknown Nurse, RN';
    return `${user.name}, RN`;
  };

  const getAttendingPhysician = (patient?: Patient | null) => {
    return patient?.attendingPhysician || 'Attending Physician';
  };

  const handleGenerateNote = () => {
    if (!inputText || !selectedPatient) {
      toast.error('Please select a patient and enter assessment data');
      return;
    }

    setIsGenerating(true);

    setTimeout(() => {
      const patient = patients.find((p) => p.id === selectedPatient);
      if (!patient) {
        setIsGenerating(false);
        return;
      }

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      const attendingPhysician = getAttendingPhysician(patient);
      const nurseName = getNurseName();

      const generatedNote = `NURSING PROGRESS NOTE

═══════════════════════════════════════════════════════════════

PATIENT INFORMATION
Patient Name: ${patient.name}
Patient ID: ${patient.id}
Room: ${patient.room}
Date: ${dateStr}
Time: ${timeStr}
Attending Physician: ${attendingPhysician}
Nurse: ${nurseName}

═══════════════════════════════════════════════════════════════

VITAL SIGNS
• Heart Rate: ${patient.vitalSigns.heartRate} bpm
• Blood Pressure: ${patient.vitalSigns.bloodPressure} mmHg
• Temperature: ${patient.vitalSigns.temperature}°C
• Oxygen Saturation: ${patient.vitalSigns.oxygenSaturation}%
• Respiratory Rate: ${patient.vitalSigns.respiratoryRate} breaths/min

═══════════════════════════════════════════════════════════════

ASSESSMENT & OBSERVATIONS
${inputText}

Current Diagnosis: ${patient.diagnosis}
Risk Level: ${patient.riskLevel.charAt(0).toUpperCase() + patient.riskLevel.slice(1)}

Allergies: ${patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None known'}

Active Medications: ${patient.medications.join(', ')}

Alerts: ${patient.alerts.join('; ')}

═══════════════════════════════════════════════════════════════

INTERVENTIONS PERFORMED
• Comprehensive patient assessment completed
• Vital signs monitored and recorded
• Medication administration as prescribed
• Patient safety measures verified
• Documentation updated in electronic medical record

═══════════════════════════════════════════════════════════════

PATIENT RESPONSE
Patient responded appropriately to interventions. Vital signs remain within acceptable parameters. Patient appears comfortable and cooperative with care plan.

═══════════════════════════════════════════════════════════════

CLINICAL SUMMARY
Patient condition assessed and deemed stable. All vital signs trending appropriately. Continue current treatment regimen as ordered by ${attendingPhysician}. Will continue to monitor closely and report any significant changes to attending physician.

Plan: Continue current medications, monitor vital signs per protocol, reassess in 4 hours or PRN.

═══════════════════════════════════════════════════════════════

Electronically signed by: ${nurseName}
Timestamp: ${now.toISOString()}
`;

      setAiGeneratedNote(generatedNote);

      setStructuredData({
        patientName: patient.name,
        patientId: patient.id,
        room: patient.room,
        date: dateStr,
        time: timeStr,
        attendingPhysician,
        nurseName,
        vitalSigns: {
          heartRate: `${patient.vitalSigns.heartRate} bpm`,
          bloodPressure: `${patient.vitalSigns.bloodPressure} mmHg`,
          temperature: `${patient.vitalSigns.temperature}°C`,
          oxygenSaturation: `${patient.vitalSigns.oxygenSaturation}%`,
          respiratoryRate: `${patient.vitalSigns.respiratoryRate} breaths/min`,
        },
        assessment: inputText,
        diagnosis: patient.diagnosis,
        riskLevel: patient.riskLevel.charAt(0).toUpperCase() + patient.riskLevel.slice(1),
        allergies: patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None known',
        medications: patient.medications.join(', '),
        alerts: patient.alerts.join('; '),
        interventions: [
          'Comprehensive patient assessment completed',
          'Vital signs monitored and recorded',
          'Medication administration as prescribed',
          'Patient safety measures verified',
          'Documentation updated in electronic medical record',
        ],
        patientResponse:
          'Patient responded appropriately to interventions. Vital signs remain within acceptable parameters. Patient appears comfortable and cooperative with care plan.',
        clinicalSummary: `Patient condition assessed and deemed stable. All vital signs trending appropriately. Continue current treatment regimen as ordered by ${attendingPhysician}. Will continue to monitor closely and report any significant changes to attending physician.`,
        plan: 'Continue current medications, monitor vital signs per protocol, reassess in 4 hours or PRN.',
        timestamp: now.toISOString(),
      });

      setShowPreview(true);
      setIsGenerating(false);
    }, 2000);
  };

  const handleApproveNote = async () => {
    const patient = patients.find((p) => p.id === selectedPatient);
    const attendingPhysician = getAttendingPhysician(patient);

    try {
      const newNote = await createChartingNote({
        patientId: selectedPatient,
        patientName: patient?.name || 'Unknown Patient',
        nurseId: user?.id || 'unknown',
        nurseName: user?.name || 'Unknown Nurse',
        content: aiGeneratedNote,
        timestamp: new Date().toISOString(),
        type: 'progress',
        aiGenerated: true,
        edited: false,
        attendingPhysician,
        editHistory: [],
      });

      setNotes((prev) => [newNote, ...prev]);

      toast.success('Note approved and added to patient record', {
        description: `Charting note for ${patient?.name} has been saved.`,
      });

      setInputText('');
      setAiGeneratedNote('');
      setShowPreview(false);
      setSelectedPatient('');
      setIsEditMode(false);
      setStructuredData(null);
    } catch (error) {
      toast.error('Failed to save note', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    }
  };

  const parseNoteContent = (content: string, note: ChartingNote): StructuredData => {
    const patientNameMatch = content.match(/Patient Name: (.+)/);
    const patientIdMatch = content.match(/Patient ID: (.+)/);
    const roomMatch = content.match(/Room: (.+)/);
    const dateMatch = content.match(/Date: (.+)/);
    const timeMatch = content.match(/Time: (.+)/);
    const physicianMatch = content.match(/Attending Physician: (.+)/);
    const nurseMatch = content.match(/Nurse: (.+)/);

    const hrMatch = content.match(/Heart Rate: (.+)/);
    const bpMatch = content.match(/Blood Pressure: (.+)/);
    const tempMatch = content.match(/Temperature: (.+)/);
    const spo2Match = content.match(/Oxygen Saturation: (.+)/);
    const rrMatch = content.match(/Respiratory Rate: (.+)/);

    const assessmentMatch = content.match(/ASSESSMENT & OBSERVATIONS\n(.+?)(?=\n\nCurrent Diagnosis:)/s);
    const diagnosisMatch = content.match(/Current Diagnosis: (.+)/);
    const riskMatch = content.match(/Risk Level: (.+)/);
    const allergiesMatch = content.match(/Allergies: (.+)/);
    const medsMatch = content.match(/Active Medications: (.+)/);
    const alertsMatch = content.match(/Alerts: (.+)/);
    const responseMatch = content.match(/PATIENT RESPONSE\n(.+?)(?=\n\n═|$)/s);
    const summaryMatch = content.match(/CLINICAL SUMMARY\n(.+?)(?=\n\nPlan:|$)/s);
    const planMatch = content.match(/Plan: (.+?)(?=\n\n═|$)/s);

    return {
      patientName: patientNameMatch?.[1]?.trim() || note.patientName,
      patientId: patientIdMatch?.[1]?.trim() || note.patientId,
      room: roomMatch?.[1]?.trim() || '',
      date:
        dateMatch?.[1]?.trim() ||
        new Date(note.timestamp).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      time:
        timeMatch?.[1]?.trim() ||
        new Date(note.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
      attendingPhysician:
        physicianMatch?.[1]?.trim() || note.attendingPhysician || 'Not specified',
      nurseName: nurseMatch?.[1]?.trim() || note.nurseName,
      vitalSigns: {
        heartRate: hrMatch?.[1]?.trim() || 'Not recorded',
        bloodPressure: bpMatch?.[1]?.trim() || 'Not recorded',
        temperature: tempMatch?.[1]?.trim() || 'Not recorded',
        oxygenSaturation: spo2Match?.[1]?.trim() || 'Not recorded',
        respiratoryRate: rrMatch?.[1]?.trim() || 'Not recorded',
      },
      assessment: assessmentMatch?.[1]?.trim() || 'No assessment recorded',
      diagnosis: diagnosisMatch?.[1]?.trim() || 'Not specified',
      riskLevel: riskMatch?.[1]?.trim() || 'Not specified',
      allergies: allergiesMatch?.[1]?.trim() || 'None known',
      medications: medsMatch?.[1]?.trim() || 'None recorded',
      alerts: alertsMatch?.[1]?.trim() || 'None',
      interventions: [
        'Comprehensive patient assessment completed',
        'Vital signs monitored and recorded',
        'Medication administration as prescribed',
        'Patient safety measures verified',
        'Documentation updated in electronic medical record',
      ],
      patientResponse: responseMatch?.[1]?.trim() || '',
      clinicalSummary: summaryMatch?.[1]?.trim() || '',
      plan: planMatch?.[1]?.trim() || '',
      timestamp: note.timestamp,
    };
  };

  const handleViewFullNote = (note: ChartingNote) => {
    setSelectedNote(note);
    setViewNoteDialog(true);
  };

  const handleCopyNote = async (content: string) => {
    try {
      await Share.share({ message: content });
      toast.success('Note shared / copied');
    } catch {
      toast.error('Unable to copy note');
    }
  };

  const filteredNotes = notes.filter(
    (note) =>
      note.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.nurseName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const patientOptions = patients.map((patient) => ({
    label: `${patient.name} • ${patient.room}`,
    value: patient.id,
  }));

  const selectedPatientRecord = patients.find((p) => p.id === selectedPatient);
  const selectedPatientDiagnosis = selectedPatientRecord?.diagnosis || '';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View>
        <Text style={styles.pageTitle}>Charting</Text>
        <Text style={styles.pageSubtitle}>AI-assisted documentation</Text>
      </View>

      {/* AI Info Alert */}
      <Alert variant="default">
        <AlertDescription>
          <Text style={styles.alertBlue}>
            Input your patient assessment data, and AI will generate a structured nursing note.
            Review and approve before submission.
          </Text>
        </AlertDescription>
      </Alert>

      {/* Create New Note */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <FileText size={20} color={Colors.blue600} />
            <CardTitle>Create New Nursing Note</CardTitle>
          </View>
          <CardDescription>AI will help structure your documentation</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <Select
            label="Select Patient"
            value={selectedPatient}
            onValueChange={setSelectedPatient}
            options={patientOptions}
            placeholder="Choose a patient"
          />

          <View style={styles.nurseBox}>
            <View style={styles.titleRow}>
              <User size={16} color={Colors.purple600} />
              <Text style={styles.nurseLabel}>Documenting Nurse</Text>
            </View>
            <Text style={styles.nurseName}>{getNurseName()}</Text>
            <Text style={styles.nurseHint}>Auto-assigned from current session</Text>
          </View>

          {selectedPatient ? (
            <View style={styles.physicianBox}>
              <View style={styles.titleRow}>
                <Stethoscope size={16} color={Colors.blue600} />
                <Text style={styles.physicianLabel}>Attending Physician</Text>
              </View>
              <Text style={styles.physicianName}>
                {getAttendingPhysician(selectedPatientRecord)}
              </Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Assessment & Observations</Text>
            <TextInput
              style={styles.textarea}
              placeholder="Enter patient assessment, vital signs, observations, interventions performed, patient response, etc. The AI will structure this into a complete nursing note."
              placeholderTextColor={Colors.mutedForeground}
              value={inputText}
              onChangeText={setInputText}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
            <Text style={styles.hint}>
              Example: &quot;Patient ambulated to chair, tolerated well. No complaints of pain.
              Wound dressing changed, site clean and dry.&quot;
            </Text>
          </View>

          <Button
            onPress={handleGenerateNote}
            disabled={isGenerating || !inputText || !selectedPatient}
            style={{ backgroundColor: Colors.blue600 }}
          >
            {isGenerating ? (
              <View style={styles.btnInner}>
                <ActivityIndicator size="small" color={Colors.white} />
                <Text style={styles.btnTextWhite}>Generating AI Note...</Text>
              </View>
            ) : (
              <View style={styles.btnInner}>
                <Sparkles size={16} color={Colors.white} />
                <Text style={styles.btnTextWhite}>Generate Structured Note</Text>
              </View>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* AI Generated Preview */}
      {showPreview ? (
        <Card style={styles.previewCard}>
          <CardHeader>
            <View style={styles.previewHeader}>
              <View style={[styles.titleRow, { flex: 1 }]}>
                <Sparkles size={20} color={Colors.blue600} />
                <CardTitle style={{ fontSize: 17 }}>AI-Generated Draft</CardTitle>
              </View>
              <Badge
                variant="outline"
                style={{ backgroundColor: Colors.blue100, borderColor: Colors.blue300 }}
              >
                <View style={styles.badgeInner}>
                  <Eye size={12} color={Colors.foreground} />
                  <Text style={styles.badgeText}>Preview</Text>
                </View>
              </Badge>
            </View>
            <CardDescription>Review and edit before approving</CardDescription>
          </CardHeader>
          <CardContent style={styles.gap4}>
            <View style={styles.editToggleRow}>
              <Button
                variant="outline"
                size="sm"
                onPress={() => setIsEditMode(!isEditMode)}
              >
                <View style={styles.btnInner}>
                  {isEditMode ? (
                    <>
                      <Eye size={16} color={Colors.foreground} />
                      <Text style={styles.btnTextDark}>View Structured Note</Text>
                    </>
                  ) : (
                    <>
                      <Edit2 size={16} color={Colors.foreground} />
                      <Text style={styles.btnTextDark}>Edit Raw Text</Text>
                    </>
                  )}
                </View>
              </Button>
            </View>

            {isEditMode ? (
              <View style={styles.editBox}>
                <View style={styles.editBoxHeader}>
                  <FileText size={16} color={Colors.white} />
                  <Text style={styles.editBoxTitle}>Nursing Progress Note - Edit Mode</Text>
                </View>
                <TextInput
                  style={styles.editTextarea}
                  value={aiGeneratedNote}
                  onChangeText={setAiGeneratedNote}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            ) : (
              structuredData && (
                <StructuredNursingNote {...structuredData} isDraft={true} />
              )
            )}

            <View style={styles.actionsRow}>
              <Button
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => {
                  setShowPreview(false);
                  setIsEditMode(false);
                  setStructuredData(null);
                }}
              >
                Cancel
              </Button>
              <Button
                style={{ flex: 1, backgroundColor: Colors.green600 }}
                onPress={handleApproveNote}
              >
                <View style={styles.btnInner}>
                  <Check size={16} color={Colors.white} />
                  <Text style={styles.btnTextWhite}>Approve & Submit</Text>
                </View>
              </Button>
            </View>

            <Alert>
              <AlertDescription>
                <Text style={styles.alertXs}>
                  Once approved, this note will be added to the patient&apos;s record with your
                  digital signature and timestamp. An audit trail entry will be created.
                </Text>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      ) : null}

      {/* Recent Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Charting Notes</CardTitle>
          <CardDescription>Your submitted documentation</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap3}>
          <Input
            placeholder="Search notes by patient, content, or date..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            leftIcon={<Search size={16} color={Colors.gray500} />}
          />

          {filteredNotes.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No charting notes found</Text>
            </View>
          ) : (
            filteredNotes.map((note) => (
              <View key={note.id} style={styles.noteCard}>
                <View style={styles.noteHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.notePatient}>{note.patientName}</Text>
                    <View style={styles.noteMeta}>
                      <View style={styles.metaRow}>
                        <Clock size={12} color={Colors.mutedForeground} />
                        <Text style={styles.metaText}>
                          {new Date(note.timestamp).toLocaleString()}
                        </Text>
                      </View>
                      {note.attendingPhysician ? (
                        <View style={styles.metaRow}>
                          <Stethoscope size={12} color={Colors.blue700} />
                          <Text style={styles.physicianMeta}>{note.attendingPhysician}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.badgeCol}>
                    {note.aiGenerated ? (
                      <Badge
                        variant="outline"
                        style={{
                          backgroundColor: Colors.blue100,
                          borderColor: Colors.blue300,
                        }}
                        textStyle={{ color: Colors.blue700 }}
                      >
                        <View style={styles.badgeInner}>
                          <Sparkles size={12} color={Colors.blue700} />
                          <Text style={[styles.badgeText, { color: Colors.blue700 }]}>
                            AI-Assisted
                          </Text>
                        </View>
                      </Badge>
                    ) : null}
                    {note.edited ? (
                      <Badge variant="outline">
                        <View style={styles.badgeInner}>
                          <EditIcon size={12} color={Colors.foreground} />
                          <Text style={styles.badgeText}>Edited</Text>
                        </View>
                      </Badge>
                    ) : null}
                  </View>
                </View>

                <View style={styles.previewBox}>
                  <Text style={styles.previewMono}>
                    {note.content
                      .replace(/═+/g, '')
                      .replace(/={3,}/g, '')
                      .replace(/\n{3,}/g, '\n\n')
                      .substring(0, 200)}
                    ...
                  </Text>
                </View>

                <View style={styles.noteFooter}>
                  <Text style={styles.authored}>Authored by: {note.nurseName}</Text>
                  <Pressable
                    onPress={() => handleViewFullNote(note)}
                    style={styles.viewBtn}
                    hitSlop={8}
                  >
                    <Eye size={16} color={Colors.blue600} />
                    <Text style={styles.viewBtnText}>View Full Note</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </CardContent>
      </Card>

      {/* View Full Note Dialog */}
      <Modal
        visible={viewNoteDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setViewNoteDialog(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, Shadows.xl]}>
            <View style={styles.modalHeader}>
              <View style={[styles.titleRow, { flex: 1 }]}>
                <FileText size={20} color={Colors.blue600} />
                <Text style={styles.modalTitle}>Complete Nursing Documentation</Text>
              </View>
              <Pressable onPress={() => setViewNoteDialog(false)} hitSlop={8}>
                <X size={20} color={Colors.mutedForeground} />
              </Pressable>
            </View>
            {selectedNote ? (
              <Text style={styles.modalDesc}>
                {selectedNote.patientName} • {new Date(selectedNote.timestamp).toLocaleString()}
              </Text>
            ) : null}

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {selectedNote ? (
                <View style={styles.gap4}>
                  <View style={styles.badgeRow}>
                    {selectedNote.aiGenerated ? (
                      <Badge
                        variant="outline"
                        style={{
                          backgroundColor: Colors.blue50,
                          borderColor: Colors.blue200,
                        }}
                        textStyle={{ color: Colors.blue700 }}
                      >
                        <View style={styles.badgeInner}>
                          <Sparkles size={12} color={Colors.blue700} />
                          <Text style={[styles.badgeText, { color: Colors.blue700 }]}>
                            AI-Assisted Documentation
                          </Text>
                        </View>
                      </Badge>
                    ) : null}
                    {selectedNote.edited ? (
                      <Badge variant="outline">
                        <View style={styles.badgeInner}>
                          <EditIcon size={12} color={Colors.foreground} />
                          <Text style={styles.badgeText}>Manually Edited</Text>
                        </View>
                      </Badge>
                    ) : null}
                  </View>

                  <StructuredNursingNote
                    {...parseNoteContent(selectedNote.content, selectedNote)}
                  />
                </View>
              ) : null}
            </ScrollView>

            {selectedNote ? (
              <View style={styles.modalFooter}>
                <Button
                  variant="outline"
                  style={{ flex: 1 }}
                  onPress={() => handleCopyNote(selectedNote.content)}
                >
                  Copy Note
                </Button>
                <Button
                  variant="outline"
                  style={{ flex: 1 }}
                  onPress={() => setViewNoteDialog(false)}
                >
                  Close
                </Button>
              </View>
            ) : null}
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
    maxWidth: 896,
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
  alertBlue: {
    fontSize: 13,
    color: Colors.blue900,
    lineHeight: 18,
  },
  alertXs: {
    fontSize: 11,
    color: Colors.mutedForeground,
    lineHeight: 16,
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
  textarea: {
    minHeight: 140,
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
  hint: {
    fontSize: 11,
    color: Colors.gray500,
    lineHeight: 16,
  },
  nurseBox: {
    backgroundColor: Colors.purple50,
    borderWidth: 1,
    borderColor: Colors.purple100,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 6,
  },
  nurseLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.purple700,
  },
  nurseName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.purple700,
    marginLeft: 24,
  },
  nurseHint: {
    fontSize: 11,
    fontStyle: 'italic',
    color: Colors.purple600,
    marginLeft: 24,
  },
  physicianBox: {
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 6,
  },
  physicianLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.blue900,
  },
  physicianName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.blue800,
    marginLeft: 24,
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
    fontSize: 13,
  },
  previewCard: {
    borderWidth: 2,
    borderColor: Colors.blue300,
    backgroundColor: Colors.blue50,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  editToggleRow: {
    alignItems: 'flex-end',
  },
  editBox: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.blue200,
    overflow: 'hidden',
  },
  editBoxHeader: {
    backgroundColor: Colors.blue600,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editBoxTitle: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
  editTextarea: {
    minHeight: 320,
    maxHeight: 480,
    padding: 16,
    fontSize: 13,
    fontFamily: 'monospace',
    color: Colors.foreground,
    lineHeight: 20,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  badgeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.foreground,
  },
  badgeCol: {
    gap: 6,
    alignItems: 'flex-end',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emptyState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    color: Colors.gray500,
    fontSize: 14,
  },
  noteCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    gap: 12,
    backgroundColor: Colors.white,
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  notePatient: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.foreground,
  },
  noteMeta: {
    marginTop: 4,
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 13,
    color: Colors.mutedForeground,
  },
  physicianMeta: {
    fontSize: 11,
    color: Colors.blue700,
  },
  previewBox: {
    padding: 12,
    backgroundColor: Colors.muted,
    borderRadius: Radius.sm,
  },
  previewMono: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: Colors.foreground,
    lineHeight: 18,
  },
  noteFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  authored: {
    fontSize: 11,
    color: Colors.mutedForeground,
    flex: 1,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewBtnText: {
    fontSize: 13,
    color: Colors.blue600,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalSheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    width: '100%',
    maxWidth: 640,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
    flexShrink: 1,
  },
  modalDesc: {
    fontSize: 13,
    color: Colors.mutedForeground,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalScrollContent: {
    padding: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.white,
  },
});
