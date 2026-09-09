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
  Search,
  User,
  Stethoscope,
  Edit2,
  X,
  Trash2,
  CheckCircle2,
  ClipboardList,
  ChevronLeft,
} from 'lucide-react-native';
import {
  fetchPatients,
  fetchChartingNotes,
  fetchChartingHistoryDates,
  createChartingNote,
  updateChartingNote,
  confirmChartingNote,
  deleteChartingNote,
  structureChartRequest,
  ApiError,
} from '../../services/api';
import type {
  ChartingHistoryDate,
  ChartingNote,
  ChartingStructuredData,
  Patient,
} from '../../types/domain';
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
import {
  contentFromStructured,
  formatPatientVitalSigns,
  normalizeStructuredData,
  resolveNoteForDisplay,
  structuredHasClinicalContent,
} from '../../utils/chartingStructured';

type StructuredData = Required<
  Pick<
    ChartingStructuredData,
    | 'patientName'
    | 'patientId'
    | 'room'
    | 'date'
    | 'time'
    | 'attendingPhysician'
    | 'nurseName'
    | 'assessment'
    | 'diagnosis'
    | 'riskLevel'
    | 'allergies'
    | 'medications'
    | 'alerts'
    | 'interventions'
    | 'patientResponse'
    | 'clinicalSummary'
    | 'plan'
    | 'timestamp'
  >
> & {
  vitalSigns: {
    heartRate: string;
    bloodPressure: string;
    temperature: string;
    oxygenSaturation: string;
    respiratoryRate: string;
  };
};

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
  const [isApproving, setIsApproving] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChartingNote | null>(null);
  const [editTarget, setEditTarget] = useState<ChartingNote | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editAssessment, setEditAssessment] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDates, setHistoryDates] = useState<ChartingHistoryDate[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySelectedDate, setHistorySelectedDate] = useState<ChartingHistoryDate | null>(
    null
  );
  const [historyNotes, setHistoryNotes] = useState<ChartingNote[]>([]);
  const [historyNotesLoading, setHistoryNotesLoading] = useState(false);
  const [historyDateSearch, setHistoryDateSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [patientData, noteData] = await Promise.all([
          fetchPatients({ mine: true }),
          fetchChartingNotes({ mine: true }),
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
    return patient?.attendingPhysician || '';
  };

  const toPreviewStructured = (
    structured: ChartingStructuredData,
    patient: Patient,
    nurseInput: string
  ): StructuredData => {
    const now = new Date();
    const patientVitals = formatPatientVitalSigns(patient);
    const workflowVitals = structured.vitalSigns ?? {};
    // Prefer workflow vitals when present; otherwise use vitals already on the
    // patient record (real data). Never invent values.
    const vitalSigns = {
      heartRate: workflowVitals.heartRate || patientVitals.heartRate || '',
      bloodPressure: workflowVitals.bloodPressure || patientVitals.bloodPressure || '',
      temperature: workflowVitals.temperature || patientVitals.temperature || '',
      oxygenSaturation: workflowVitals.oxygenSaturation || patientVitals.oxygenSaturation || '',
      respiratoryRate: workflowVitals.respiratoryRate || patientVitals.respiratoryRate || '',
    };

    return {
      patientName: structured.patientName || patient.name,
      patientId: structured.patientId || patient.id,
      room: structured.room || patient.room || '',
      date:
        structured.date ||
        now.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      time:
        structured.time ||
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
      attendingPhysician: structured.attendingPhysician || getAttendingPhysician(patient),
      nurseName: structured.nurseName || getNurseName(),
      vitalSigns,
      // Nurse input is authoritative when the workflow omits assessment.
      assessment: structured.assessment || nurseInput,
      diagnosis: structured.diagnosis || patient.diagnosis || '',
      riskLevel:
        structured.riskLevel ||
        (patient.riskLevel
          ? patient.riskLevel.charAt(0).toUpperCase() + patient.riskLevel.slice(1)
          : ''),
      allergies:
        structured.allergies ||
        (patient.allergies?.length ? patient.allergies.join(', ') : ''),
      medications:
        structured.medications ||
        (patient.medications?.length ? patient.medications.join(', ') : ''),
      alerts: structured.alerts || (patient.alerts?.length ? patient.alerts.join('; ') : ''),
      // Only interventions returned by the workflow / nurse — never invent any.
      interventions: structured.interventions ?? [],
      patientResponse: structured.patientResponse || '',
      clinicalSummary: structured.clinicalSummary || '',
      plan: structured.plan || '',
      timestamp: structured.timestamp || now.toISOString(),
    };
  };

  /**
   * Autocharting. The backend attaches the patient's demographics and current
   * vitals, runs the n8n structure-chart workflow, and returns the generated
   * note plus the section-by-section structure this screen renders.
   */
  const handleGenerateNote = async () => {
    if (!inputText || !selectedPatient) {
      toast.error('Please select a patient and enter assessment data');
      return;
    }

    const patient = patients.find((p) => p.id === selectedPatient);
    if (!patient) {
      toast.error('Select a patient before generating a note');
      return;
    }

    setIsGenerating(true);

    try {
      const res = await structureChartRequest({
        patientId: patient.id,
        assessment: inputText,
        noteType: 'progress',
      });

      const structured = normalizeStructuredData(res.structured);
      const preview = toPreviewStructured(structured, patient, inputText);

      if (!structuredHasClinicalContent(preview) && !(res.note || '').trim()) {
        toast.error('Could not generate the note', {
          description:
            'The charting workflow returned no usable clinical content. Please try again.',
        });
        return;
      }

      // Prefer workflow narrative; otherwise build from structured sections so
      // Approve always has something real to persist.
      setAiGeneratedNote((res.note || '').trim() || contentFromStructured(preview));
      setStructuredData(preview);
      setShowPreview(true);
    } catch (error) {
      // 503 means the n8n workflow is not listening. Surface that plainly
      // rather than leaving the nurse staring at a spinner.
      toast.error('Could not generate the note', {
        description:
          error instanceof ApiError
            ? error.message
            : 'The charting workflow is unavailable. Please try again.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApproveNote = async () => {
    const patient = patients.find((p) => p.id === selectedPatient);
    if (!patient || !selectedPatient) {
      toast.error('Select a patient before approving the note');
      return;
    }
    if (!structuredData) {
      toast.error('No structured chart to save', {
        description: 'Generate a note first, then approve it.',
      });
      return;
    }

    const content =
      (aiGeneratedNote || '').trim() || contentFromStructured(structuredData);
    if (!content.trim() && !structuredHasClinicalContent(structuredData)) {
      toast.error('Cannot save an empty chart', {
        description: 'The generated note has no clinical content to persist.',
      });
      return;
    }

    const attendingPhysician =
      structuredData.attendingPhysician || getAttendingPhysician(patient);
    const structuredPayload = normalizeStructuredData(structuredData);

    setIsApproving(true);
    try {
      const newNote = await createChartingNote({
        patientId: selectedPatient,
        patientName: patient.name,
        nurseId: user?.id || 'unknown',
        nurseName: user?.name || 'Unknown Nurse',
        content,
        structured: structuredPayload,
        timestamp: structuredData.timestamp || new Date().toISOString(),
        type: 'progress',
        aiGenerated: true,
        edited: false,
        attendingPhysician,
        editHistory: [],
      });

      if (!newNote?.id) {
        toast.error('Failed to save note', {
          description: 'The server did not return a saved chart record.',
        });
        return;
      }

      setNotes((prev) => [newNote, ...prev]);

      toast.success('Note approved and added to patient record', {
        description: `Charting note for ${patient.name} has been saved.`,
      });

      setInputText('');
      setAiGeneratedNote('');
      setShowPreview(false);
      setSelectedPatient('');
      setIsEditMode(false);
      setStructuredData(null);
      // Keep history dates fresh if the nurse already opened that panel.
      if (historyOpen) {
        fetchChartingHistoryDates()
          .then(setHistoryDates)
          .catch(() => undefined);
      }
    } catch (error) {
      toast.error('Failed to save note', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handleViewFullNote = (note: ChartingNote) => {
    setSelectedNote(note);
    setViewNoteDialog(true);
  };

  const handleConfirmNote = async (note: ChartingNote) => {
    if (note.confirmed) {
      toast.success('Already confirmed', {
        description: 'This charting note is already marked as confirmed.',
      });
      return;
    }
    setActionBusyId(note.id);
    try {
      const updated = await confirmChartingNote(note.id);
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      if (selectedNote?.id === updated.id) setSelectedNote(updated);
      toast.success('Charting note confirmed');
    } catch (error) {
      toast.error('Could not confirm note', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleOpenEdit = (note: ChartingNote) => {
    const structured = normalizeStructuredData(note.structured ?? undefined);
    setEditTarget(note);
    setEditContent(note.content || contentFromStructured(structured));
    setEditAssessment(structured.assessment || '');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    const content = editContent.trim();
    if (!content) {
      toast.error('Cannot save an empty chart');
      return;
    }
    const structured = normalizeStructuredData({
      ...(editTarget.structured ?? {}),
      assessment: editAssessment.trim() || undefined,
    });
    if (editAssessment.trim()) {
      structured.assessment = editAssessment.trim();
    }

    setIsSavingEdit(true);
    try {
      const updated = await updateChartingNote(editTarget.id, {
        content,
        structured,
      });
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      if (selectedNote?.id === updated.id) setSelectedNote(updated);
      if (historySelectedDate) {
        setHistoryNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      }
      setEditTarget(null);
      toast.success('Charting note updated');
    } catch (error) {
      toast.error('Could not save edits', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setActionBusyId(id);
    try {
      await deleteChartingNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setHistoryNotes((prev) => prev.filter((n) => n.id !== id));
      if (selectedNote?.id === id) {
        setSelectedNote(null);
        setViewNoteDialog(false);
      }
      setDeleteTarget(null);
      toast.success('Charting note deleted');
      if (historyOpen) {
        const dates = await fetchChartingHistoryDates();
        setHistoryDates(dates);
        if (historySelectedDate) {
          const still = dates.find((d) => d.date === historySelectedDate.date);
          if (!still) {
            setHistorySelectedDate(null);
            setHistoryNotes([]);
          } else {
            setHistorySelectedDate(still);
          }
        }
      }
    } catch (error) {
      toast.error('Could not delete note', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setActionBusyId(null);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistorySelectedDate(null);
    setHistoryNotes([]);
    setHistoryDateSearch('');
    setHistoryLoading(true);
    try {
      const dates = await fetchChartingHistoryDates();
      setHistoryDates(dates);
    } catch (error) {
      toast.error('Could not load charting history', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const selectHistoryDate = async (entry: ChartingHistoryDate) => {
    setHistorySelectedDate(entry);
    setHistoryNotesLoading(true);
    try {
      const dayNotes = await fetchChartingNotes({ mine: true, date: entry.date });
      setHistoryNotes(dayNotes);
    } catch (error) {
      toast.error('Could not load notes for that date', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
      setHistoryNotes([]);
    } finally {
      setHistoryNotesLoading(false);
    }
  };

  const formatHistoryDateLabel = (isoDate: string) => {
    const [y, m, d] = isoDate.split('-').map(Number);
    if (!y || !m || !d) return isoDate;
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  };

  const filteredHistoryDates = historyDates.filter((entry) => {
    const q = historyDateSearch.trim().toLowerCase();
    if (!q) return true;
    const label = formatHistoryDateLabel(entry.date).toLowerCase();
    const iso = entry.date.toLowerCase();
    const todayMatch = entry.isToday && 'today'.includes(q);
    return label.includes(q) || iso.includes(q) || todayMatch || q.includes(iso);
  });

  const notePreviewText = (note: ChartingNote) => {
    const raw =
      (note.content || '').trim() ||
      contentFromStructured(normalizeStructuredData(note.structured ?? undefined));
    return raw
      .replace(/═+/g, '')
      .replace(/={3,}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .substring(0, 200);
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
    keywords: `${patient.id} ${patient.room} ${patient.diagnosis}`,
  }));

  const selectedPatientRecord = patients.find((p) => p.id === selectedPatient);

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
            searchable
            searchPlaceholder="Search by name, ID, or room..."
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
                disabled={isApproving || !structuredData}
              >
                <View style={styles.btnInner}>
                  {isApproving ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Check size={16} color={Colors.white} />
                  )}
                  <Text style={styles.btnTextWhite}>
                    {isApproving ? 'Saving...' : 'Approve & Submit'}
                  </Text>
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

      {/* My Charting History — view-only archive by date */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <ClipboardList size={20} color={Colors.blue600} />
            <CardTitle>My Charting History</CardTitle>
          </View>
          <CardDescription>
            Review your past charting notes by date (view only)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Pressable
            onPress={openHistory}
            style={styles.historyLaunch}
            accessibilityRole="button"
          >
            <View style={styles.titleRow}>
              <ClipboardList size={18} color={Colors.blue700} />
              <Text style={styles.historyLaunchText}>My Charting History</Text>
            </View>
            <Text style={styles.historyLaunchHint}>Tap to browse dates</Text>
          </Pressable>
        </CardContent>
      </Card>

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
                    {note.confirmed ? (
                      <Badge
                        variant="outline"
                        style={{
                          backgroundColor: Colors.green100,
                          borderColor: Colors.green200,
                        }}
                        textStyle={{ color: Colors.green700 }}
                      >
                        <View style={styles.badgeInner}>
                          <CheckCircle2 size={12} color={Colors.green700} />
                          <Text style={[styles.badgeText, { color: Colors.green700 }]}>
                            Confirmed
                          </Text>
                        </View>
                      </Badge>
                    ) : null}
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
                    {notePreviewText(note)}
                    ...
                  </Text>
                </View>

                <View style={styles.noteFooter}>
                  <Text style={styles.authored}>Authored by: {note.nurseName}</Text>
                </View>

                <View style={styles.actionRow}>
                  <Pressable
                    onPress={() => handleConfirmNote(note)}
                    style={[
                      styles.actionBtn,
                      note.confirmed ? styles.actionBtnDisabled : null,
                    ]}
                    disabled={actionBusyId === note.id || Boolean(note.confirmed)}
                    hitSlop={6}
                  >
                    {actionBusyId === note.id ? (
                      <ActivityIndicator size="small" color={Colors.green600} />
                    ) : (
                      <Check size={16} color={note.confirmed ? Colors.gray500 : Colors.green600} />
                    )}
                    <Text
                      style={[
                        styles.actionBtnText,
                        { color: note.confirmed ? Colors.gray500 : Colors.green600 },
                      ]}
                    >
                      Confirm
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleOpenEdit(note)}
                    style={styles.actionBtn}
                    disabled={actionBusyId === note.id}
                    hitSlop={6}
                  >
                    <Edit2 size={16} color={Colors.blue600} />
                    <Text style={[styles.actionBtnText, { color: Colors.blue600 }]}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDeleteTarget(note)}
                    style={styles.actionBtn}
                    disabled={actionBusyId === note.id}
                    hitSlop={6}
                  >
                    <Trash2 size={16} color={Colors.red600} />
                    <Text style={[styles.actionBtnText, { color: Colors.red600 }]}>Delete</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleViewFullNote(note)}
                    style={styles.actionBtn}
                    hitSlop={6}
                  >
                    <Eye size={16} color={Colors.blue600} />
                    <Text style={[styles.actionBtnText, { color: Colors.blue600 }]}>View</Text>
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
                    {selectedNote.confirmed ? (
                      <Badge
                        variant="outline"
                        style={{
                          backgroundColor: Colors.green100,
                          borderColor: Colors.green200,
                        }}
                        textStyle={{ color: Colors.green700 }}
                      >
                        <View style={styles.badgeInner}>
                          <CheckCircle2 size={12} color={Colors.green700} />
                          <Text style={[styles.badgeText, { color: Colors.green700 }]}>
                            Confirmed
                          </Text>
                        </View>
                      </Badge>
                    ) : null}
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

                  <StructuredNursingNote {...resolveNoteForDisplay(selectedNote)} />
                </View>
              ) : null}
            </ScrollView>

            {selectedNote ? (
              <View style={styles.modalFooter}>
                <Button
                  variant="outline"
                  style={{ flex: 1 }}
                  onPress={() =>
                    handleCopyNote(
                      (selectedNote.content || '').trim() ||
                        contentFromStructured(
                          normalizeStructuredData(selectedNote.structured ?? undefined)
                        )
                    )
                  }
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

      {/* Delete confirmation */}
      <Modal
        visible={Boolean(deleteTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.confirmSheet, Shadows.xl]}>
            <Text style={styles.confirmTitle}>Delete charting record?</Text>
            <Text style={styles.confirmBody}>
              Are you sure you want to delete this charting record
              {deleteTarget ? ` for ${deleteTarget.patientName}` : ''}? This cannot be undone.
            </Text>
            <View style={styles.actionsRow}>
              <Button
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setDeleteTarget(null)}
                disabled={actionBusyId === deleteTarget?.id}
              >
                Cancel
              </Button>
              <Button
                style={{ flex: 1, backgroundColor: Colors.red600 }}
                onPress={handleDeleteConfirmed}
                disabled={actionBusyId === deleteTarget?.id}
              >
                <View style={styles.btnInner}>
                  {actionBusyId === deleteTarget?.id ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Trash2 size={16} color={Colors.white} />
                  )}
                  <Text style={styles.btnTextWhite}>Delete</Text>
                </View>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit existing note */}
      <Modal
        visible={Boolean(editTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setEditTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, Shadows.xl]}>
            <View style={styles.modalHeader}>
              <View style={[styles.titleRow, { flex: 1 }]}>
                <Edit2 size={20} color={Colors.blue600} />
                <Text style={styles.modalTitle}>Edit Charting Note</Text>
              </View>
              <Pressable onPress={() => setEditTarget(null)} hitSlop={8}>
                <X size={20} color={Colors.mutedForeground} />
              </Pressable>
            </View>
            {editTarget ? (
              <Text style={styles.modalDesc}>
                {editTarget.patientName} • {new Date(editTarget.timestamp).toLocaleString()}
              </Text>
            ) : null}
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.gap4}>
                <View style={styles.field}>
                  <Text style={styles.label}>Assessment</Text>
                  <TextInput
                    style={styles.textarea}
                    value={editAssessment}
                    onChangeText={setEditAssessment}
                    multiline
                    textAlignVertical="top"
                    placeholder="Assessment & observations from the saved record"
                    placeholderTextColor={Colors.mutedForeground}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Full note content</Text>
                  <TextInput
                    style={[styles.textarea, { minHeight: 220 }]}
                    value={editContent}
                    onChangeText={setEditContent}
                    multiline
                    textAlignVertical="top"
                    placeholder="Saved charting content"
                    placeholderTextColor={Colors.mutedForeground}
                  />
                </View>
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setEditTarget(null)}
                disabled={isSavingEdit}
              >
                Cancel
              </Button>
              <Button
                style={{ flex: 1, backgroundColor: Colors.blue600 }}
                onPress={handleSaveEdit}
                disabled={isSavingEdit}
              >
                <View style={styles.btnInner}>
                  {isSavingEdit ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Check size={16} color={Colors.white} />
                  )}
                  <Text style={styles.btnTextWhite}>
                    {isSavingEdit ? 'Saving...' : 'Save Changes'}
                  </Text>
                </View>
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* My Charting History browser */}
      <Modal
        visible={historyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHistoryOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, Shadows.xl]}>
            <View style={styles.modalHeader}>
              <View style={[styles.titleRow, { flex: 1 }]}>
                {historySelectedDate ? (
                  <Pressable
                    onPress={() => {
                      setHistorySelectedDate(null);
                      setHistoryNotes([]);
                    }}
                    hitSlop={8}
                    style={styles.titleRow}
                  >
                    <ChevronLeft size={20} color={Colors.blue600} />
                    <Text style={styles.modalTitle}>
                      {historySelectedDate.isToday
                        ? 'Today'
                        : formatHistoryDateLabel(historySelectedDate.date)}
                    </Text>
                  </Pressable>
                ) : (
                  <>
                    <ClipboardList size={20} color={Colors.blue600} />
                    <Text style={styles.modalTitle}>My Charting History</Text>
                  </>
                )}
              </View>
              <Pressable onPress={() => setHistoryOpen(false)} hitSlop={8}>
                <X size={20} color={Colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={styles.modalDesc}>
              {historySelectedDate
                ? `${formatHistoryDateLabel(historySelectedDate.date)} • view only`
                : 'Select a date to view your saved notes'}
            </Text>

            {!historySelectedDate ? (
              <View style={styles.historySearchWrap}>
                <Input
                  placeholder="Search date (e.g. 09/08/2026 or Today)..."
                  value={historyDateSearch}
                  onChangeText={setHistoryDateSearch}
                  leftIcon={<Search size={16} color={Colors.gray500} />}
                />
              </View>
            ) : null}

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {historyLoading || historyNotesLoading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator color={Colors.blue600} />
                </View>
              ) : historySelectedDate ? (
                historyNotes.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>No charting notes for this date</Text>
                  </View>
                ) : (
                  <View style={styles.gap3}>
                    {historyNotes.map((note) => (
                      <View key={note.id} style={styles.noteCard}>
                        <Text style={styles.notePatient}>{note.patientName}</Text>
                        <View style={styles.metaRow}>
                          <Clock size={12} color={Colors.mutedForeground} />
                          <Text style={styles.metaText}>
                            {new Date(note.timestamp).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            })}
                          </Text>
                        </View>
                        <View style={styles.previewBox}>
                          <Text style={styles.previewMono}>
                            {notePreviewText(note)}
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
                            <Text style={styles.viewBtnText}>View</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )
              ) : historyDates.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No charting history yet</Text>
                </View>
              ) : filteredHistoryDates.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No dates match your search</Text>
                </View>
              ) : (
                <View style={styles.gap3}>
                  {filteredHistoryDates.map((entry) => (
                    <Pressable
                      key={entry.date}
                      onPress={() => selectHistoryDate(entry)}
                      style={styles.historyDateCard}
                    >
                      {entry.isToday ? (
                        <Text style={styles.historyTodayLabel}>Today</Text>
                      ) : null}
                      <Text style={styles.historyDateText}>
                        {formatHistoryDateLabel(entry.date)}
                      </Text>
                      <Text style={styles.historyCountText}>
                        {entry.count} charting record{entry.count === 1 ? '' : 's'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
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
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  actionBtnDisabled: {
    opacity: 0.55,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  historyLaunch: {
    borderWidth: 1,
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 4,
  },
  historyLaunchText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.blue800,
  },
  historyLaunchHint: {
    fontSize: 12,
    color: Colors.blue700,
    marginLeft: 26,
  },
  historySearchWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  historyDateCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: 16,
    backgroundColor: Colors.white,
    gap: 4,
  },
  historyTodayLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.blue700,
  },
  historyDateText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foreground,
  },
  historyCountText: {
    fontSize: 12,
    color: Colors.mutedForeground,
  },
  confirmSheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    width: '100%',
    maxWidth: 420,
    padding: 20,
    gap: 12,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foreground,
  },
  confirmBody: {
    fontSize: 14,
    color: Colors.mutedForeground,
    lineHeight: 20,
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
