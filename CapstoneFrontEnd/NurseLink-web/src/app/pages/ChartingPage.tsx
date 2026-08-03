import React, { useState } from 'react';
import { mockChartingNotes, mockPatients } from '../data/mockData';
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
  X,
  User,
  Stethoscope,
  Edit2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Alert, AlertDescription } from '../components/ui/alert';
import { toast } from 'sonner';
import { StructuredNursingNote } from '../components/StructuredNursingNote';
import { useAuth } from '../contexts/AuthContext';

interface ChartingNote {
  id: string;
  patientId: string;
  patientName: string;
  content: string;
  nurseName: string;
  timestamp: string;
  aiGenerated: boolean;
  edited: boolean;
  attendingPhysician?: string;
}

export default function ChartingPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<ChartingNote[]>(mockChartingNotes);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [inputText, setInputText] = useState('');
  const [aiGeneratedNote, setAiGeneratedNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewNoteDialog, setViewNoteDialog] = useState(false);
  const [selectedNote, setSelectedNote] = useState<ChartingNote | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [structuredData, setStructuredData] = useState<any>(null);

  // Get formatted nurse name with credentials
  const getNurseName = () => {
    if (!user) return 'Unknown Nurse, RN';
    return `${user.name}, RN`;
  };

  // Get attending physician based on patient diagnosis
  const getAttendingPhysician = (diagnosis: string) => {
    if (diagnosis.toLowerCase().includes('cardiac') || diagnosis.toLowerCase().includes('heart')) {
      return 'Dr. Sarah Mitchell, Cardiologist';
    } else if (diagnosis.toLowerCase().includes('septic') || diagnosis.toLowerCase().includes('infection')) {
      return 'Dr. James Rodriguez, Infectious Disease Specialist';
    } else if (diagnosis.toLowerCase().includes('pneumonia') || diagnosis.toLowerCase().includes('respiratory')) {
      return 'Dr. Emily Chen, Pulmonologist';
    } else {
      return 'Dr. Michael Anderson, Internal Medicine';
    }
  };

  const handleGenerateNote = () => {
    if (!inputText || !selectedPatient) {
      toast.error('Please select a patient and enter assessment data');
      return;
    }

    setIsGenerating(true);

    // Simulate AI generation
    setTimeout(() => {
      const patient = mockPatients.find(p => p.id === selectedPatient);
      if (!patient) return;

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      const attendingPhysician = getAttendingPhysician(patient.diagnosis);
      const nurseName = getNurseName();

      // Generate structured professional note
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

      // Also generate structured data for the modern UI
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
        patientResponse: 'Patient responded appropriately to interventions. Vital signs remain within acceptable parameters. Patient appears comfortable and cooperative with care plan.',
        clinicalSummary: `Patient condition assessed and deemed stable. All vital signs trending appropriately. Continue current treatment regimen as ordered by ${attendingPhysician}. Will continue to monitor closely and report any significant changes to attending physician.`,
        plan: 'Continue current medications, monitor vital signs per protocol, reassess in 4 hours or PRN.',
        timestamp: now.toISOString(),
      });

      setShowPreview(true);
      setIsGenerating(false);
    }, 2000);
  };

  const handleApproveNote = () => {
    const patient = mockPatients.find(p => p.id === selectedPatient);
    const attendingPhysician = patient ? getAttendingPhysician(patient.diagnosis) : undefined;

    const newNote: ChartingNote = {
      id: `note-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient?.name || 'Unknown Patient',
      content: aiGeneratedNote,
      nurseName: user?.name || 'Unknown Nurse',
      timestamp: new Date().toISOString(),
      aiGenerated: true,
      edited: false,
      attendingPhysician,
    };

    setNotes([newNote, ...notes]);

    toast.success('Note approved and added to patient record', {
      description: `Charting note for ${patient?.name} has been saved.`,
    });

    setInputText('');
    setAiGeneratedNote('');
    setShowPreview(false);
    setSelectedPatient('');
    setIsEditMode(false);
    setStructuredData(null);
  };

  // Parse note content to extract structured data
  const parseNoteContent = (content: string, note: ChartingNote) => {
    // Extract patient info
    const patientNameMatch = content.match(/Patient Name: (.+)/);
    const patientIdMatch = content.match(/Patient ID: (.+)/);
    const roomMatch = content.match(/Room: (.+)/);
    const dateMatch = content.match(/Date: (.+)/);
    const timeMatch = content.match(/Time: (.+)/);
    const physicianMatch = content.match(/Attending Physician: (.+)/);
    const nurseMatch = content.match(/Nurse: (.+)/);

    // Extract vital signs
    const hrMatch = content.match(/Heart Rate: (.+)/);
    const bpMatch = content.match(/Blood Pressure: (.+)/);
    const tempMatch = content.match(/Temperature: (.+)/);
    const spo2Match = content.match(/Oxygen Saturation: (.+)/);
    const rrMatch = content.match(/Respiratory Rate: (.+)/);

    // Extract sections
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
      date: dateMatch?.[1]?.trim() || new Date(note.timestamp).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      time: timeMatch?.[1]?.trim() || new Date(note.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }),
      attendingPhysician: physicianMatch?.[1]?.trim() || note.attendingPhysician || 'Not specified',
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

  const filteredNotes = notes.filter(note =>
    note.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    note.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    note.nurseName.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
                {mockPatients.map(patient => (
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
            <p className="text-sm text-purple-800 font-medium ml-6">
              {getNurseName()}
            </p>
            <p className="text-xs text-purple-600 ml-6 italic">Auto-assigned from current session</p>
          </div>

          {/* Doctor Information - Show when patient is selected */}
          {selectedPatient && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-semibold text-blue-900">Attending Physician</span>
              </div>
              <p className="text-sm text-blue-800 font-medium ml-6">
                {getAttendingPhysician(mockPatients.find(p => p.id === selectedPatient)?.diagnosis || '')}
              </p>
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
                <Sparkles className="w-4 h-4 mr-2 animate-spin" />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditMode(!isEditMode)}
                className="gap-2"
              >
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
                    className="resize-none border-0 focus:ring-0 p-0 font-mono text-sm leading-relaxed"
                  />
                </div>
              </div>
            ) : (
              structuredData && (
                <div className="max-h-[600px] overflow-y-auto pr-2">
                  <StructuredNursingNote {...structuredData} isDraft={true} />
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
              <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={handleApproveNote}>
                <Check className="w-4 h-4 mr-2" />
                Approve & Submit
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
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {filteredNotes.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              No charting notes found
            </div>
          ) : (
            filteredNotes.map(note => (
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
                        <p className="text-xs text-blue-700 dark:text-blue-400 flex items-center gap-2">
                          <Stethoscope className="w-3 h-3" />
                          {note.attendingPhysician}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
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
                  {note.content.replace(/═+/g, '').replace(/={3,}/g, '').replace(/\n{3,}/g, '\n\n').substring(0, 200)}...
                </div>

                {/* Audit Trail */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                  <span>Authored by: {note.nurseName}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                    onClick={() => handleViewFullNote(note)}
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    View Full Note
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
              <div className="flex gap-2">
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
              <StructuredNursingNote {...parseNoteContent(selectedNote.content, selectedNote)} />

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2 sticky bottom-0 bg-white py-3 border-t">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    // Copy to clipboard
                    navigator.clipboard.writeText(selectedNote.content);
                    toast.success('Note copied to clipboard');
                  }}
                >
                  Copy Note
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setViewNoteDialog(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}