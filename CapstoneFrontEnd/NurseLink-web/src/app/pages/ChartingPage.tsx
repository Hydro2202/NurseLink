import React, { useState, useEffect } from 'react';
import type { ChartingHistoryDate, ChartingNote, ChartingStructuredData, Patient } from '../types/domain';
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
} from '../api/nurselink';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
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
  Trash2,
  CheckCircle2,
  ClipboardList,
  ChevronLeft,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Alert, AlertDescription } from '../components/ui/alert';
import { toast } from 'sonner';
import { StructuredNursingNote } from '../components/StructuredNursingNote';
import { FDARNursingNote } from '../components/FDARNursingNote';
import { useAuth } from '../contexts/AuthContext';
import {
  contentFromFDAR,
  contentFromStructured,
  fdarFromStructured,
  fdarHasContent,
  formatPatientVitalSigns,
  normalizeStructuredData,
  resolveNoteForDisplay,
  structuredHasClinicalContent,
} from '../utils/chartingStructured';

type PreviewStructured = Required<
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
  focus: string;
  data: string;
  action: string;
  response: string;
};

export default function ChartingPage() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [notes, setNotes] = useState<ChartingNote[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [inputText, setInputText] = useState('');
  const [aiGeneratedNote, setAiGeneratedNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewNoteDialog, setViewNoteDialog] = useState(false);
  const [selectedNote, setSelectedNote] = useState<ChartingNote | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [structuredData, setStructuredData] = useState<PreviewStructured | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChartingNote | null>(null);
  const [editTarget, setEditTarget] = useState<ChartingNote | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editAssessment, setEditAssessment] = useState('');
  const [editFocus, setEditFocus] = useState('');
  const [editData, setEditData] = useState('');
  const [editAction, setEditAction] = useState('');
  const [editResponse, setEditResponse] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDates, setHistoryDates] = useState<ChartingHistoryDate[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySelectedDate, setHistorySelectedDate] = useState<ChartingHistoryDate | null>(null);
  const [historyNotes, setHistoryNotes] = useState<ChartingNote[]>([]);
  const [historyNotesLoading, setHistoryNotesLoading] = useState(false);
  const [historyDateSearch, setHistoryDateSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [plist, nlist] = await Promise.all([
          fetchPatients({ mine: true }),
          fetchChartingNotes({ mine: true }),
        ]);
        if (!cancelled) {
          setPatients(plist);
          setNotes(nlist);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error('Failed to load charting data', {
            description: error instanceof ApiError ? error.message : 'Please try again.',
          });
        }
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

  const getAttendingPhysician = (patient?: Patient | null) => patient?.attendingPhysician || '';

  const toPreviewStructured = (
    structured: ChartingStructuredData,
    patient: Patient,
    nurseInput: string,
    fdarFromWorkflow?: { focus?: string; data?: string; action?: string; response?: string }
  ): PreviewStructured => {
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
        now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      time:
        structured.time ||
        now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      attendingPhysician: structured.attendingPhysician || getAttendingPhysician(patient),
      nurseName: structured.nurseName || getNurseName(),
      vitalSigns,
      // Nurse input is authoritative when the workflow omits assessment.
      assessment: structured.assessment || nurseInput,
      diagnosis: structured.diagnosis || patient.diagnosis || '',
      riskLevel:
        structured.riskLevel ||
        (patient.riskLevel ? patient.riskLevel.charAt(0).toUpperCase() + patient.riskLevel.slice(1) : ''),
      allergies: structured.allergies || (patient.allergies?.length ? patient.allergies.join(', ') : ''),
      medications: structured.medications || (patient.medications?.length ? patient.medications.join(', ') : ''),
      alerts: structured.alerts || (patient.alerts?.length ? patient.alerts.join('; ') : ''),
      // Only interventions returned by the workflow / nurse — never invent any.
      interventions: structured.interventions ?? [],
      patientResponse: structured.patientResponse || '',
      clinicalSummary: structured.clinicalSummary || '',
      plan: structured.plan || '',
      timestamp: structured.timestamp || now.toISOString(),
      ...(() => {
        const fallback = fdarFromStructured(structured, 'progress');
        return {
          focus: fdarFromWorkflow?.focus?.trim() || fallback.focus,
          data: fdarFromWorkflow?.data?.trim() || fallback.data,
          action: fdarFromWorkflow?.action?.trim() || fallback.action,
          response: fdarFromWorkflow?.response?.trim() || fallback.response,
        };
      })(),
    };
  };

  /**
   * Autocharting. The backend attaches the patient's demographics and
   * current vitals, runs the n8n structure-chart workflow, and returns the
   * generated note plus the section-by-section structure this screen
   * renders. Replaces the old fake setTimeout template generator.
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
      const preview = toPreviewStructured(structured, patient, inputText, {
        focus: res.focus,
        data: res.data,
        action: res.action,
        response: res.response,
      });

      if (!structuredHasClinicalContent(preview) && !fdarHasContent(preview) && !(res.note || '').trim()) {
        toast.error('Could not generate the note', {
          description: 'The charting workflow returned no usable clinical content. Please try again.',
        });
        return;
      }

      // Prefer workflow narrative; otherwise build from FDAR/structured
      // sections so Approve always has something real to persist.
      setAiGeneratedNote(
        (res.note || '').trim() ||
          contentFromFDAR(preview.focus, preview.data, preview.action, preview.response) ||
          contentFromStructured(preview)
      );
      setStructuredData(preview);
      setShowPreview(true);
      if (res.fallback) {
        toast.warning('AI charting unavailable', {
          description: res.warning || 'The note was organised from your own text. Review it before approving.',
        });
      }
    } catch (error) {
      // A 503 means the n8n workflow is not listening — surface that plainly
      // instead of leaving the nurse staring at a spinner forever.
      toast.error('Could not generate the note', {
        description:
          error instanceof ApiError ? error.message : 'The charting workflow is unavailable. Please try again.',
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
      toast.error('No structured chart to save', { description: 'Generate a note first, then approve it.' });
      return;
    }

    const content =
      (aiGeneratedNote || '').trim() ||
      contentFromFDAR(structuredData.focus, structuredData.data, structuredData.action, structuredData.response) ||
      contentFromStructured(structuredData);
    if (!content.trim() && !structuredHasClinicalContent(structuredData) && !fdarHasContent(structuredData)) {
      toast.error('Cannot save an empty chart', { description: 'The generated note has no clinical content to persist.' });
      return;
    }

    const attendingPhysician = structuredData.attendingPhysician || getAttendingPhysician(patient);
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
        focus: structuredData.focus,
        data: structuredData.data,
        action: structuredData.action,
        response: structuredData.response,
        timestamp: structuredData.timestamp || new Date().toISOString(),
        type: 'progress',
        aiGenerated: true,
        edited: false,
        attendingPhysician,
        editHistory: [],
      });

      if (!newNote?.id) {
        toast.error('Failed to save note', { description: 'The server did not return a saved chart record.' });
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
      if (historyOpen) {
        fetchChartingHistoryDates().then(setHistoryDates).catch(() => undefined);
      }
    } catch (error) {
      toast.error('Failed to save note', { description: error instanceof ApiError ? error.message : 'Please try again.' });
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
      toast.success('Already confirmed', { description: 'This charting note is already marked as confirmed.' });
      return;
    }
    setActionBusyId(note.id);
    try {
      const updated = await confirmChartingNote(note.id);
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      if (selectedNote?.id === updated.id) setSelectedNote(updated);
      toast.success('Charting note confirmed');
    } catch (error) {
      toast.error('Could not confirm note', { description: error instanceof ApiError ? error.message : 'Please try again.' });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleOpenEdit = (note: ChartingNote) => {
    setEditTarget(note);
    if (note.noteFormat === 'legacy') {
      const structured = normalizeStructuredData(note.structured ?? undefined);
      setEditContent(note.content || contentFromStructured(structured));
      setEditAssessment(structured.assessment || '');
      return;
    }
    setEditFocus(note.focus || '');
    setEditData(note.data || '');
    setEditAction(note.action || '');
    setEditResponse(note.response || '');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;

    if (editTarget.noteFormat === 'legacy') {
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
        const updated = await updateChartingNote(editTarget.id, { content, structured });
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        if (selectedNote?.id === updated.id) setSelectedNote(updated);
        if (historySelectedDate) {
          setHistoryNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        }
        setEditTarget(null);
        toast.success('Charting note updated');
      } catch (error) {
        toast.error('Could not save edits', { description: error instanceof ApiError ? error.message : 'Please try again.' });
      } finally {
        setIsSavingEdit(false);
      }
      return;
    }

    const focus = editFocus.trim();
    const data = editData.trim();
    const action = editAction.trim();
    const response = editResponse.trim();
    if (!focus && !data && !action && !response) {
      toast.error('Cannot save an empty chart');
      return;
    }
    const content = contentFromFDAR(focus, data, action, response);

    setIsSavingEdit(true);
    try {
      const updated = await updateChartingNote(editTarget.id, { focus, data, action, response, content });
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      if (selectedNote?.id === updated.id) setSelectedNote(updated);
      if (historySelectedDate) {
        setHistoryNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      }
      setEditTarget(null);
      toast.success('Charting note updated');
    } catch (error) {
      toast.error('Could not save edits', { description: error instanceof ApiError ? error.message : 'Please try again.' });
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
      toast.error('Could not delete note', { description: error instanceof ApiError ? error.message : 'Please try again.' });
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
      toast.error('Could not load charting history', { description: error instanceof ApiError ? error.message : 'Please try again.' });
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
      toast.error('Could not load notes for that date', { description: error instanceof ApiError ? error.message : 'Please try again.' });
      setHistoryNotes([]);
    } finally {
      setHistoryNotesLoading(false);
    }
  };

  const formatHistoryDateLabel = (isoDate: string) => {
    const [y, m, d] = isoDate.split('-').map(Number);
    if (!y || !m || !d) return isoDate;
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
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
    const raw = (note.content || '').trim() || contentFromStructured(normalizeStructuredData(note.structured ?? undefined));
    return raw
      .replace(/═+/g, '')
      .replace(/={3,}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .substring(0, 200);
  };

  const handleCopyNote = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success('Note copied to clipboard');
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

  const selectedPatientRecord = patients.find((p) => p.id === selectedPatient);

  return (
    <div className="p-4 pb-24 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Charting</h1>
        <p className="text-gray-600">AI-assisted documentation</p>
      </div>

      {/* AI Info Alert */}
      <Alert className="border-l-4 border-blue-500 bg-blue-50">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          Input your patient assessment data, and AI will generate a structured nursing note. Review and approve before submission.
        </AlertDescription>
      </Alert>

      {/* Create New Note */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Create New Nursing Note
          </CardTitle>
          <CardDescription>AI will help structure your documentation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Patient Selection */}
          <div className="space-y-2">
            <Label htmlFor="patient">Select Patient</Label>
            <Select value={selectedPatient} onValueChange={setSelectedPatient}>
              <SelectTrigger id="patient">
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
          </div>

          {/* Documenting Nurse - Always visible */}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-semibold text-purple-900">Documenting Nurse</span>
            </div>
            <p className="text-sm text-purple-800 font-medium ml-6">{getNurseName()}</p>
            <p className="text-xs text-purple-600 ml-6 italic">Auto-assigned from current session</p>
          </div>

          {/* Doctor Information - Show when patient is selected */}
          {selectedPatient && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-semibold text-blue-900">Attending Physician</span>
              </div>
              <p className="text-sm text-blue-800 font-medium ml-6">{getAttendingPhysician(selectedPatientRecord)}</p>
            </div>
          )}

          {/* Input Field */}
          <div className="space-y-2">
            <Label htmlFor="assessment">Assessment & Observations</Label>
            <Textarea
              id="assessment"
              placeholder="Enter patient assessment, vital signs, observations, interventions performed, patient response, etc. The AI will structure this into a complete nursing note."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={6}
              className="resize-none"
            />
            <p className="text-xs text-gray-500">
              Example: "Patient ambulated to chair, tolerated well. No complaints of pain. Wound dressing changed, site clean and dry."
            </p>
          </div>

          {/* Generate Button */}
          <Button
            className="w-full bg-blue-600 hover:bg-blue-700"
            onClick={handleGenerateNote}
            disabled={isGenerating || !inputText || !selectedPatient}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating AI Note...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Structured Note
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* AI Generated Preview */}
      {showPreview && (
        <Card className="border-2 border-blue-300 bg-blue-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5 text-blue-600" />
                AI-Generated Draft
              </CardTitle>
              <Badge variant="outline" className="bg-blue-100 border-blue-300">
                <Eye className="w-3 h-3 mr-1" />
                Preview
              </Badge>
            </div>
            <CardDescription>Review and edit before approving</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Toggle between structured and edit view */}
            <div className="flex justify-end mb-2">
              <Button variant="outline" size="sm" onClick={() => setIsEditMode(!isEditMode)} className="gap-2">
                {isEditMode ? (
                  <>
                    <Eye className="w-4 h-4" />
                    View Structured Note
                  </>
                ) : (
                  <>
                    <Edit2 className="w-4 h-4" />
                    Edit Raw Text
                  </>
                )}
              </Button>
            </div>

            {/* Preview Content */}
            {isEditMode ? (
              <div className="bg-white rounded-lg border-2 border-blue-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white p-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Nursing Progress Note - Edit Mode
                  </h3>
                </div>
                <div className="p-4 max-h-[500px] overflow-y-auto">
                  <Textarea
                    value={aiGeneratedNote}
                    onChange={(e) => setAiGeneratedNote(e.target.value)}
                    rows={20}
                    className="resize-none border-0 focus-visible:ring-0 p-0 font-mono text-sm leading-relaxed"
                  />
                </div>
              </div>
            ) : (
              structuredData && (
                <div className="max-h-[600px] overflow-y-auto pr-2">
                  <FDARNursingNote {...structuredData} isDraft={true} />
                </div>
              )
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowPreview(false);
                  setIsEditMode(false);
                  setStructuredData(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleApproveNote}
                disabled={isApproving || !structuredData}
              >
                {isApproving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {isApproving ? 'Saving...' : 'Approve & Submit'}
              </Button>
            </div>

            {/* Notice */}
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Once approved, this note will be added to the patient's record with your digital signature and timestamp. An audit trail entry will be created.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* My Charting History — view-only archive by date */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-blue-600" />
            My Charting History
          </CardTitle>
          <CardDescription>Review your past charting notes by date (view only)</CardDescription>
        </CardHeader>
        <CardContent>
          <button
            type="button"
            onClick={openHistory}
            className="w-full text-left border border-blue-200 bg-blue-50 rounded-lg p-4 hover:bg-blue-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="w-[18px] h-[18px] text-blue-700" />
              <span className="text-[15px] font-bold text-blue-800">My Charting History</span>
            </div>
            <p className="text-xs text-blue-700 ml-6 mt-0.5">Tap to browse dates</p>
          </button>
        </CardContent>
      </Card>

      {/* Recent Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Charting Notes</CardTitle>
          <CardDescription>Your submitted documentation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Search Bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search notes by patient, content, or date..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {filteredNotes.length === 0 ? (
            <div className="py-12 text-center text-gray-500">No charting notes found</div>
          ) : (
            filteredNotes.map((note) => (
              <div key={note.id} className="p-4 border rounded-lg space-y-3 hover:bg-muted transition-colors">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold text-lg">{note.patientName}</h4>
                    <div className="flex flex-col gap-1 mt-1">
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        {new Date(note.timestamp).toLocaleString()}
                      </p>
                      {note.attendingPhysician && (
                        <p className="text-xs text-blue-700 flex items-center gap-2">
                          <Stethoscope className="w-3 h-3" />
                          {note.attendingPhysician}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {note.noteFormat === 'legacy' && (
                      <Badge variant="outline">
                        <ClipboardList className="w-3 h-3 mr-1" />
                        Legacy Note
                      </Badge>
                    )}
                    {note.confirmed && (
                      <Badge variant="outline" className="bg-green-100 border-green-200 text-green-700">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Confirmed
                      </Badge>
                    )}
                    {note.aiGenerated && (
                      <Badge variant="outline" className="bg-blue-100 border-blue-300 text-blue-700">
                        <Sparkles className="w-3 h-3 mr-1" />
                        AI-Assisted
                      </Badge>
                    )}
                    {note.edited && (
                      <Badge variant="outline">
                        <EditIcon className="w-3 h-3 mr-1" />
                        Edited
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Content Preview */}
                <div className="p-3 bg-muted rounded text-sm font-mono whitespace-pre-wrap break-words">
                  {notePreviewText(note)}...
                </div>

                {/* Audit Trail */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                  <span>Authored by: {note.nurseName}</span>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-green-600 disabled:text-gray-400"
                    onClick={() => handleConfirmNote(note)}
                    disabled={actionBusyId === note.id || Boolean(note.confirmed)}
                  >
                    {actionBusyId === note.id ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-1" />
                    )}
                    Confirm
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-blue-600"
                    onClick={() => handleOpenEdit(note)}
                    disabled={actionBusyId === note.id}
                  >
                    <Edit2 className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-red-600"
                    onClick={() => setDeleteTarget(note)}
                    disabled={actionBusyId === note.id}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-blue-600"
                    onClick={() => handleViewFullNote(note)}
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    View
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* View Full Note Dialog */}
      <Dialog open={viewNoteDialog} onOpenChange={setViewNoteDialog}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Complete Nursing Documentation
            </DialogTitle>
            <DialogDescription>
              {selectedNote && `${selectedNote.patientName} • ${new Date(selectedNote.timestamp).toLocaleString()}`}
            </DialogDescription>
          </DialogHeader>

          {selectedNote && (
            <div className="space-y-4 overflow-y-auto flex-1 p-4">
              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                {selectedNote.noteFormat === 'legacy' && (
                  <Badge variant="outline">
                    <ClipboardList className="w-3 h-3 mr-1" />
                    Legacy Note
                  </Badge>
                )}
                {selectedNote.confirmed && (
                  <Badge variant="outline" className="bg-green-100 border-green-200 text-green-700">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Confirmed
                  </Badge>
                )}
                {selectedNote.aiGenerated && (
                  <Badge variant="outline" className="bg-blue-50 border-blue-200 text-blue-700">
                    <Sparkles className="w-3 h-3 mr-1" />
                    AI-Assisted Documentation
                  </Badge>
                )}
                {selectedNote.edited && (
                  <Badge variant="outline">
                    <EditIcon className="w-3 h-3 mr-1" />
                    Manually Edited
                  </Badge>
                )}
              </div>

              {/* Structured Note Display */}
              {(() => {
                const resolved = resolveNoteForDisplay(selectedNote);
                return resolved.kind === 'legacy' ? (
                  <StructuredNursingNote {...resolved.view} />
                ) : (
                  <FDARNursingNote {...resolved.view} />
                );
              })()}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2 sticky bottom-0 bg-white py-3 border-t">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() =>
                    handleCopyNote(
                      (selectedNote.content || '').trim() ||
                        contentFromStructured(normalizeStructuredData(selectedNote.structured ?? undefined))
                    )
                  }
                >
                  Copy Note
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setViewNoteDialog(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete charting record?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this charting record
              {deleteTarget ? ` for ${deleteTarget.patientName}` : ''}? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusyId === deleteTarget?.id}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actionBusyId === deleteTarget?.id}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteConfirmed();
              }}
            >
              {actionBusyId === deleteTarget?.id ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit existing note */}
      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-blue-600" />
              Edit Charting Note
            </DialogTitle>
            <DialogDescription>
              {editTarget && `${editTarget.patientName} • ${new Date(editTarget.timestamp).toLocaleString()}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 py-2">
            {editTarget?.noteFormat === 'legacy' ? (
              <>
                <div className="space-y-2">
                  <Label>Assessment</Label>
                  <Textarea
                    value={editAssessment}
                    onChange={(e) => setEditAssessment(e.target.value)}
                    rows={4}
                    placeholder="Assessment & observations from the saved record"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Full note content</Label>
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={10}
                    placeholder="Saved charting content"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Focus</Label>
                  <Textarea
                    value={editFocus}
                    onChange={(e) => setEditFocus(e.target.value)}
                    rows={2}
                    placeholder="Primary concern, e.g. Pain management"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Data</Label>
                  <Textarea
                    value={editData}
                    onChange={(e) => setEditData(e.target.value)}
                    rows={4}
                    placeholder="Subjective and objective findings — vitals, assessment, patient statements"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Action</Label>
                  <Textarea
                    value={editAction}
                    onChange={(e) => setEditAction(e.target.value)}
                    rows={4}
                    placeholder="Interventions performed"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Response</Label>
                  <Textarea
                    value={editResponse}
                    onChange={(e) => setEditResponse(e.target.value)}
                    rows={4}
                    placeholder="Patient's outcome or reaction to the action taken"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={isSavingEdit}>
              Cancel
            </Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSaveEdit} disabled={isSavingEdit}>
              {isSavingEdit ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              {isSavingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* My Charting History browser */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {historySelectedDate ? (
                <button
                  type="button"
                  className="flex items-center gap-2"
                  onClick={() => {
                    setHistorySelectedDate(null);
                    setHistoryNotes([]);
                  }}
                >
                  <ChevronLeft className="w-5 h-5 text-blue-600" />
                  {historySelectedDate.isToday ? 'Today' : formatHistoryDateLabel(historySelectedDate.date)}
                </button>
              ) : (
                <>
                  <ClipboardList className="w-5 h-5 text-blue-600" />
                  My Charting History
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {historySelectedDate
                ? `${formatHistoryDateLabel(historySelectedDate.date)} • view only`
                : 'Select a date to view your saved notes'}
            </DialogDescription>
          </DialogHeader>

          {!historySelectedDate && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search date (e.g. 09/08/2026 or Today)..."
                value={historyDateSearch}
                onChange={(e) => setHistoryDateSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          )}

          <div className="overflow-y-auto flex-1 space-y-3">
            {historyLoading || historyNotesLoading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              </div>
            ) : historySelectedDate ? (
              historyNotes.length === 0 ? (
                <div className="py-12 text-center text-gray-500">No charting notes for this date</div>
              ) : (
                historyNotes.map((note) => (
                  <div key={note.id} className="p-4 border rounded-lg space-y-2">
                    <h4 className="font-semibold">{note.patientName}</h4>
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Clock className="w-3 h-3" />
                      {new Date(note.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </p>
                    <div className="p-3 bg-muted rounded text-sm font-mono whitespace-pre-wrap break-words">
                      {notePreviewText(note)}...
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="text-xs text-muted-foreground">Authored by: {note.nurseName}</span>
                      <Button variant="ghost" size="sm" className="h-7 text-blue-600" onClick={() => handleViewFullNote(note)}>
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                    </div>
                  </div>
                ))
              )
            ) : historyDates.length === 0 ? (
              <div className="py-12 text-center text-gray-500">No charting history yet</div>
            ) : filteredHistoryDates.length === 0 ? (
              <div className="py-12 text-center text-gray-500">No dates match your search</div>
            ) : (
              filteredHistoryDates.map((entry) => (
                <button
                  key={entry.date}
                  type="button"
                  onClick={() => selectHistoryDate(entry)}
                  className="w-full text-left border rounded-lg p-4 hover:bg-muted transition-colors space-y-0.5"
                >
                  {entry.isToday && <p className="text-sm font-bold text-blue-700">Today</p>}
                  <p className="text-base font-semibold text-gray-900">{formatHistoryDateLabel(entry.date)}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.count} charting record{entry.count === 1 ? '' : 's'}
                  </p>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
