import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { BloodPressureInput } from '../components/BloodPressureInput';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { Badge } from '../components/ui/badge';
import {
  User,
  Heart,
  Pill,
  Droplet,
  Microscope,
  Activity,
  FileText,
  AlertTriangle,
  Printer,
  Save,
  Plus,
  X,
  Clock,
  Calendar,
  History,
  Eye,
  CheckCircle2,
  XCircle,
  RotateCcw,
  UserRound,
  MapPin,
  BedDouble,
  FlaskConical,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { createKardexRecord, fetchKardexRecords, reviewKardexRecord, ApiError } from '../api/nurselink';
import type { DuplicatePatientMatch, KardexHistory } from '../types/domain';
import { computeBmi, bmiCategory, validateHeightCm, validateWeightKg } from '../utils/bmi';
import { KardexLabsAndMedications } from '../components/KardexLabsAndMedications';
import { VitalsScheduleCard } from '../components/VitalsScheduleCard';

const STATUS_BADGE: Record<
  KardexHistory['status'],
  { label: string; variant: 'info' | 'success' | 'warning' | 'destructive' }
> = {
  submitted: { label: 'Pending Review', variant: 'info' },
  approved: { label: 'Approved', variant: 'success' },
  returned: { label: 'Returned', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

// Left-edge accent on each History list row — lets a head nurse scanning a
// long list tell status apart at a glance, without reading every badge.
const STATUS_ACCENT: Record<KardexHistory['status'], string> = {
  submitted: 'border-l-blue-500',
  approved: 'border-l-green-600',
  returned: 'border-l-orange-600',
  rejected: 'border-l-red-600',
};

const RECENT_ACTIVITY_LIMIT = 5;

/** Local 'today' as ISO 'YYYY-MM-DD' — the max for date inputs that cannot be in the future. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO 'YYYY-MM-DD' -> 'MM/DD/YYYY' (same display format as mobile's
 * DatePicker.formatDisplayDate); anything unparseable is returned as-is. */
function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type PrintSection = { title: string; rows?: [string, string][]; lines?: string[] };

/** Everything a printed saved-record kardex shows — rendered both as a
 * print-friendly HTML page and as a plain-text fallback (clipboard) from the
 * same data, so the two never drift. Superset of mobile's share-sheet text:
 * mobile's export also carries labs/active meds, this adds the remaining
 * record fields so the printout is the complete record. */
function buildHistoryPrintSections(entry: KardexHistory): PrintSection[] {
  const na = (v: string | null | undefined, fallback = 'N/A') => (v && v.trim() ? v : fallback);
  const bmiLine = entry.bmi != null ? `${entry.bmi} (${bmiCategory(entry.bmi)})` : 'N/A';
  const labs = entry.laboratories || [];
  const meds = (entry.medicationOrders || []).filter((m) => m.isActive);

  return [
    {
      title: 'Patient',
      rows: [
        ['Name', [entry.firstName, entry.middleName, entry.lastName].filter(Boolean).join(' ')],
        ['Age', na(entry.age)],
        ['Sex', na(entry.gender)],
        ['Birthday', entry.birthday ? formatDisplayDate(entry.birthday) : 'N/A'],
        ['Height', entry.heightCm ? `${entry.heightCm} cm` : 'N/A'],
        ['Weight', entry.weightKg ? `${entry.weightKg} kg` : 'N/A'],
        ['BMI', bmiLine],
        ['Religion', na(entry.religion)],
        ['Room', na(entry.room)],
        ['Bed', na(entry.bedNumber)],
        ['Admission Date', na(formatDisplayDate(entry.admissionDate))],
      ],
    },
    {
      title: 'Medical Information',
      rows: [
        ['Attending Physician', na(entry.attendingPhysician)],
        ['Chief Complaint', na(entry.chiefComplaint)],
        ['Admitting Diagnosis', na(entry.admittingDiagnosis)],
        ['Final Diagnosis', na(entry.finalDiagnosis)],
        ['Diet', na(entry.diet)],
        ['IVF', na(entry.ivf)],
        ['Allergies', entry.allergies?.length ? entry.allergies.join(', ') : 'None known'],
      ],
    },
    {
      title: 'Vital Signs',
      rows: [
        ['Temp', entry.temperature ? `${entry.temperature} °C` : 'N/A'],
        ['Pulse', entry.pulseRate ? `${entry.pulseRate} bpm` : 'N/A'],
        ['RR', na(entry.respiratoryRate)],
        ['BP', na(entry.bloodPressure)],
        ['O2 Sat', entry.oxygenSaturation ? `${entry.oxygenSaturation}%` : 'N/A'],
      ],
    },
    {
      title: 'Special Endorsements',
      lines: [na(entry.specialEndorsements, 'None')],
    },
    {
      title: 'Laboratories',
      lines: labs.length
        ? labs.map(
            (l) => `${l.testName} (${l.status}${l.dateDone ? `, done ${formatDisplayDate(l.dateDone)}` : ''})`
          )
        : ['None recorded'],
    },
    {
      title: 'Active Medications',
      lines: meds.length
        ? meds.map((m) => {
            const lastGiven = m.lastGiven ? new Date(m.lastGiven).toLocaleString() : 'not yet given';
            return `${m.medicationName} ${m.dose} ${m.route} ${m.frequency} (last given: ${lastGiven})`;
          })
        : ['None active'],
    },
    {
      title: 'Record',
      rows: [
        ['Saved On', new Date(entry.savedAt).toLocaleString()],
        ['Saved By', na(entry.savedBy)],
        ['Status', STATUS_BADGE[entry.status].label],
        ...(entry.reviewedBy ? ([['Reviewed By', entry.reviewedBy]] as [string, string][]) : []),
        ...(entry.reviewNotes ? ([['Review Notes', entry.reviewNotes]] as [string, string][]) : []),
      ],
    },
  ];
}

function buildHistoryPrintText(entry: KardexHistory): string {
  const body = buildHistoryPrintSections(entry)
    .map((section) => {
      const content = section.rows
        ? section.rows.map(([label, value]) => `${label}: ${value}`)
        : (section.lines || []).map((line) => (section.title === 'Special Endorsements' ? line : `- ${line}`));
      return `${section.title.toUpperCase()}\n${content.join('\n')}`;
    })
    .join('\n\n');
  return `NURSELINK KARDEX\n================\n${body}\n`;
}

function buildHistoryPrintHtml(entry: KardexHistory): string {
  const sections = buildHistoryPrintSections(entry)
    .map((section) => {
      const content = section.rows
        ? `<table>${section.rows
            .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
            .join('')}</table>`
        : section.title === 'Special Endorsements'
          ? `<p class="pre">${escapeHtml((section.lines || []).join('\n'))}</p>`
          : `<ul>${(section.lines || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
      return `<section><h2>${escapeHtml(section.title)}</h2>${content}</section>`;
    })
    .join('');
  const title = `Kardex — ${escapeHtml(entry.patientName || `${entry.firstName} ${entry.lastName}`)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;margin:32px;font-size:13px}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#6b7280;margin:0 0 20px}
section{margin-bottom:18px;page-break-inside:avoid}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#374151;border-bottom:1px solid #d1d5db;padding-bottom:4px;margin:0 0 8px}
table{border-collapse:collapse;width:100%}
th{text-align:left;font-weight:600;color:#4b5563;width:180px;padding:3px 8px 3px 0;vertical-align:top}
td{padding:3px 0;vertical-align:top}
ul{margin:0;padding-left:18px}
li{margin:2px 0}
.pre{white-space:pre-wrap;margin:0}
@media print{body{margin:12mm}}
</style></head><body><h1>NurseLink Kardex</h1><p class="sub">${title}</p>${sections}</body></html>`;
}

export default function KardexPage() {
  const { user } = useAuth();

  // Patient Demographics
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [religion, setReligion] = useState('');
  const [birthday, setBirthday] = useState('');
  const [room, setRoom] = useState('');
  const [bedNumber, setBedNumber] = useState('');
  const [admissionDate, setAdmissionDate] = useState('');

  // Medical Information
  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [admittingDiagnosis, setAdmittingDiagnosis] = useState('');
  const [finalDiagnosis, setFinalDiagnosis] = useState('');
  const [diet, setDiet] = useState('');
  const [ivf, setIvf] = useState('');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [allergyDraft, setAllergyDraft] = useState('');

  // Vital Signs
  const [temperature, setTemperature] = useState('');
  const [pulseRate, setPulseRate] = useState('');
  const [respiratoryRate, setRespiratoryRate] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [oxygenSaturation, setOxygenSaturation] = useState('');

  // Special Endorsements
  const [specialEndorsements, setSpecialEndorsements] = useState('');

  // History
  const [kardexHistory, setKardexHistory] = useState<KardexHistory[]>([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicatePatientMatch[] | null>(null);
  const [saveSubmitting, setSaveSubmitting] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<KardexHistory | null>(null);

  // Set right after a successful save so Laboratories/Medication Intake can
  // be added immediately for that patient, without leaving this screen —
  // cleared by its own "X" action, not by clearForm() (the fields reset for
  // the next admission, but this panel should stay put until the nurse is
  // finished with it).
  const [savedPatient, setSavedPatient] = useState<{ id: string; name: string } | null>(null);

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
      toast.error(error instanceof ApiError ? error.message : 'Failed to submit review');
    } finally {
      setReviewSubmitting(false);
    }
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
    const errors = [];
    if (!firstName) errors.push('First Name');
    if (!lastName) errors.push('Last Name');
    if (!age) errors.push('Age');
    if (!gender) errors.push('Sex/Gender');
    if (!admissionDate) errors.push('Admission Date');
    if (!room) errors.push('Room');
    if (validateHeightCm(heightCm)) errors.push('Height');
    if (validateWeightKg(weightKg)) errors.push('Weight');

    return errors;
  };

  const handleSaveClick = () => {
    const errors = validateRequiredFields();
    
    if (errors.length > 0) {
      toast.error('Missing Required Fields', {
        description: `Please fill in: ${errors.join(', ')}`,
      });
      return;
    }

    // Show confirmation dialog
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
        heightCm,
        weightKg,
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

      setKardexHistory((prev) => [newEntry, ...prev]);
      setShowConfirmDialog(false);
      setDuplicateWarning(null);
      if (newEntry.patientCode) {
        setSavedPatient({ id: newEntry.patientCode, name: newEntry.patientName || `${firstName} ${lastName}` });
      }

      toast.success('Kardex Saved Successfully!', {
        description: `${firstName} ${lastName} was added to the patient list.`,
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
      toast.error(error instanceof ApiError ? error.message : 'Failed to save kardex');
    } finally {
      setSaveSubmitting(false);
    }
  };

  const handlePrint = () => {
    const errors = validateRequiredFields();
    
    if (errors.length > 0) {
      toast.error('Cannot Print - Missing Required Fields', {
        description: `Please fill in: ${errors.join(', ')}`,
      });
      return;
    }

    toast.info('Printing Kardex...', {
      description: 'Print dialog will open shortly.',
    });
    
    // In a real app, this would trigger print
    setTimeout(() => {
      window.print();
    }, 500);
  };

  const clearForm = () => {
    setLastName('');
    setFirstName('');
    setMiddleName('');
    setAge('');
    setGender('');
    setHeightCm('');
    setWeightKg('');
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
  };

  const heightError = validateHeightCm(heightCm);
  const weightError = validateWeightKg(weightKg);
  const liveBmi = computeBmi(heightCm, weightKg);

  const isSupervisor = user?.role === 'head_nurse';
  const pendingReviewCount = kardexHistory.filter((e) => e.status === 'submitted').length;
  // Head nurses work through a queue — surface what needs a decision first,
  // without hiding or reordering anything a staff nurse would see.
  const displayedHistory = isSupervisor
    ? [...kardexHistory].sort(
        (a, b) => (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1)
      )
    : kardexHistory;

  const handlePrintHistoryEntry = async (entry: KardexHistory) => {
    try {
      const printWindow = window.open('', '_blank');
      if (!printWindow) throw new Error('popup blocked');
      printWindow.document.write(buildHistoryPrintHtml(entry));
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    } catch {
      try {
        await navigator.clipboard.writeText(buildHistoryPrintText(entry));
        toast.info('Print window was blocked', {
          description: 'Copied a text version of this kardex to your clipboard instead.',
        });
      } catch {
        toast.error('Unable to print or copy this kardex');
      }
    }
  };

  return (
    <div className="p-4 pb-24 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Kardex</h1>
        <p className="text-gray-600">Patient Summary & Care Plan</p>
      </div>

      {/* Live patient summary — preview of what's been entered so far */}
      <div className="bg-white border border-blue-200 rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-1.5 text-blue-700">
          <UserRound className="w-4 h-4" />
          <span className="text-xs font-bold tracking-wide">PATIENT</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-gray-900 text-lg truncate">
            {[firstName, middleName, lastName].filter(Boolean).join(' ') || 'New patient'}
          </h3>
          <span className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 text-xs font-semibold px-2 py-1 rounded-full shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-green-600" />
            Admitted
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
          <span>{age ? `${age} yrs` : 'Age —'}</span>
          <span className="text-gray-300">•</span>
          <span>{gender || 'Sex —'}</span>
          <span className="text-gray-300">•</span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3 h-3 text-gray-400" />
            {room ? `Room ${room}` : 'Room —'}
          </span>
          {bedNumber && (
            <>
              <span className="text-gray-300">•</span>
              <span className="inline-flex items-center gap-1">
                <BedDouble className="w-3 h-3 text-gray-400" />
                Bed {bedNumber}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
          <span>
            Admitted: <strong className="text-gray-700">{admissionDate || 'Not yet entered'}</strong>
          </span>
          <span>
            Attending: <strong className="text-gray-700">{attendingPhysician || 'Not yet entered'}</strong>
          </span>
        </div>
      </div>

      {/* Patient Demographics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600" />
            Patient Demographics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lastName">
                Last Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Enter last name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstName">
                First Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Enter first name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="middleName">Middle Name</Label>
              <Input
                id="middleName"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
                placeholder="Enter middle name"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="age">
                Age <span className="text-red-500">*</span>
              </Label>
              <Input
                id="age"
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="Age"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">
                Sex/Gender <span className="text-red-500">*</span>
              </Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="religion">Religion</Label>
              <Input
                id="religion"
                value={religion}
                onChange={(e) => setReligion(e.target.value)}
                placeholder="Religion"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birthday">Birthday</Label>
              <Input
                id="birthday"
                type="date"
                value={birthday}
                max={todayIso()}
                onChange={(e) => setBirthday(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="heightCm">Height (cm)</Label>
              <Input
                id="heightCm"
                type="number"
                step="0.1"
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                placeholder="e.g. 165.0"
                aria-invalid={!!heightError}
              />
              {heightError && <p className="text-sm text-red-600">{heightError}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="weightKg">Weight (kg)</Label>
              <Input
                id="weightKg"
                type="number"
                step="0.1"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                placeholder="e.g. 62.5"
                aria-invalid={!!weightError}
              />
              {weightError && <p className="text-sm text-red-600">{weightError}</p>}
            </div>
          </div>
          {liveBmi != null && (
            <p className="text-sm text-muted-foreground -mt-2">
              BMI: <strong className="text-foreground">{liveBmi}</strong> ({bmiCategory(liveBmi)})
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="admissionDate">
                Admission Date <span className="text-red-500">*</span>
              </Label>
              <Input
                id="admissionDate"
                type="date"
                value={admissionDate}
                max={todayIso()}
                onChange={(e) => setAdmissionDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room">
                Room <span className="text-red-500">*</span>
              </Label>
              <Input
                id="room"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Room number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bedNumber">Bed Number</Label>
              <Input
                id="bedNumber"
                value={bedNumber}
                onChange={(e) => setBedNumber(e.target.value)}
                placeholder="Bed number"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Medical Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-green-600" />
            Medical Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="attendingPhysician">Attending Physician</Label>
            <Input
              id="attendingPhysician"
              value={attendingPhysician}
              onChange={(e) => setAttendingPhysician(e.target.value)}
              placeholder="Dr. name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="chiefComplaint">Chief Complaint</Label>
            <Textarea
              id="chiefComplaint"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="Enter chief complaint"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admittingDiagnosis">Admitting Diagnosis</Label>
            <Textarea
              id="admittingDiagnosis"
              value={admittingDiagnosis}
              onChange={(e) => setAdmittingDiagnosis(e.target.value)}
              placeholder="Enter admitting diagnosis"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="finalDiagnosis">Final Diagnosis</Label>
            <Textarea
              id="finalDiagnosis"
              value={finalDiagnosis}
              onChange={(e) => setFinalDiagnosis(e.target.value)}
              placeholder="Enter final diagnosis"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="diet">Diet</Label>
              <Input
                id="diet"
                value={diet}
                onChange={(e) => setDiet(e.target.value)}
                placeholder="e.g., NPO, Regular, Low-sodium"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ivf">IVF</Label>
              <Input
                id="ivf"
                value={ivf}
                onChange={(e) => setIvf(e.target.value)}
                placeholder="e.g., D5LR 1L @ 80cc/hr"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="allergyDraft">Allergies</Label>
            <div className="flex gap-2">
              <Input
                id="allergyDraft"
                value={allergyDraft}
                onChange={(e) => setAllergyDraft(e.target.value)}
                placeholder="e.g., Penicillin, Latex, Shellfish"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAllergy();
                  }
                }}
              />
              <Button type="button" onClick={addAllergy} disabled={!allergyDraft.trim()} size="icon">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {allergies.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {allergies.map((allergy, index) => (
                  <span
                    key={`${allergy}-${index}`}
                    className="inline-flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 text-xs font-medium px-2.5 py-1 rounded-full"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    {allergy}
                    <button
                      type="button"
                      onClick={() => removeAllergy(index)}
                      className="hover:text-orange-900"
                      aria-label={`Remove ${allergy}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No known allergies recorded.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Vital Signs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-red-600" />
            Latest Vital Signs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="temperature">Temperature (°C)</Label>
              <Input
                id="temperature"
                type="number"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="36.5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pulseRate">Pulse Rate (bpm)</Label>
              <Input
                id="pulseRate"
                type="number"
                value={pulseRate}
                onChange={(e) => setPulseRate(e.target.value)}
                placeholder="80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="respiratoryRate">Respiratory Rate</Label>
              <Input
                id="respiratoryRate"
                type="number"
                value={respiratoryRate}
                onChange={(e) => setRespiratoryRate(e.target.value)}
                placeholder="18"
              />
            </div>
            <BloodPressureInput
              id="bloodPressure"
              value={bloodPressure}
              onChange={setBloodPressure}
            />
            <div className="space-y-2">
              <Label htmlFor="oxygenSaturation">O2 Saturation (%)</Label>
              <Input
                id="oxygenSaturation"
                type="number"
                value={oxygenSaturation}
                onChange={(e) => setOxygenSaturation(e.target.value)}
                placeholder="98"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Special Endorsements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            Special Endorsements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={specialEndorsements}
            onChange={(e) => setSpecialEndorsements(e.target.value)}
            placeholder="Enter any special instructions, precautions, or important notes for this patient..."
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Action Buttons - Moved to Bottom */}
      <Card className="bg-blue-50 border-2 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handleSaveClick}
              className="flex-1 bg-blue-600 hover:bg-blue-700 h-12"
            >
              <Save className="w-5 h-5 mr-2" />
              Save Kardex
            </Button>
            <Button
              onClick={handlePrint}
              variant="outline"
              className="flex-1 h-12 border-2"
            >
              <Printer className="w-5 h-5 mr-2" />
              Print Kardex
            </Button>
          </div>
          
          {/* History Button */}
          <div className="mt-3">
            <Button
              onClick={handleOpenHistoryList}
              variant="outline"
              className="w-full h-12 border-2 border-purple-600 text-purple-600 hover:bg-purple-50"
            >
              <History className="w-5 h-5 mr-2" />
              View Kardex History {kardexHistory.length > 0 && `(${kardexHistory.length})`}
            </Button>
          </div>

          <p className="text-xs text-gray-600 mt-3 text-center">
            <span className="text-red-500">*</span> Required fields must be filled before saving
          </p>
        </CardContent>
      </Card>

      {/* Laboratories / Medication Intake for the patient just saved */}
      {savedPatient && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-blue-600" />
                Laboratories & Medication Intake — {savedPatient.name}
              </CardTitle>
              <button
                type="button"
                onClick={() => setSavedPatient(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <KardexLabsAndMedications patientId={savedPatient.id} />
          </CardContent>
        </Card>
      )}

      {/* Vital Signs Monitoring (as ordered) for the patient just saved */}
      {savedPatient && <VitalsScheduleCard patientId={savedPatient.id} />}

      {/* Recent Kardex Activity */}
      {kardexHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-purple-600" />
              Recent Kardex Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              {kardexHistory.slice(0, RECENT_ACTIVITY_LIMIT).map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleViewHistory(entry)}
                  className="flex items-start gap-3 w-full text-left py-2 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <div className="flex flex-col items-center pt-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
                    {index < Math.min(kardexHistory.length, RECENT_ACTIVITY_LIMIT) - 1 && (
                      <span className="w-px flex-1 bg-gray-200 mt-1" style={{ minHeight: '28px' }} />
                    )}
                  </div>
                  <div className="flex-1 pb-2 space-y-1">
                    <p className="text-xs text-gray-500">{new Date(entry.savedAt).toLocaleString()}</p>
                    <p className="text-sm text-gray-700">
                      Kardex saved for <span className="font-semibold text-gray-900">{entry.patientName}</span>{' '}
                      (Room {entry.room}) by {entry.savedBy}
                    </p>
                    <Badge variant={STATUS_BADGE[entry.status].variant} className="text-xs">
                      {STATUS_BADGE[entry.status].label}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
            {kardexHistory.length > RECENT_ACTIVITY_LIMIT && (
              <button
                type="button"
                onClick={handleOpenHistoryList}
                className="w-full text-center text-sm font-semibold text-purple-600 hover:text-purple-700 mt-1 pt-2 border-t"
              >
                View Full History ({kardexHistory.length})
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          {duplicateWarning ? (
            <>
              <DialogHeader>
                <DialogTitle>Possible Duplicate Patient</DialogTitle>
                <DialogDescription>
                  A patient with similar information already exists. Please verify before creating
                  a new patient.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {duplicateWarning.map((match) => (
                  <div key={match.patientId} className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <p className="text-sm">
                      <strong>{match.name}</strong> ({match.patientId})
                    </p>
                    <p className="text-sm text-gray-700">
                      {match.age}y • {match.gender} • Room {match.room}
                      {match.admissionDate ? ` • Admitted ${match.admissionDate}` : ''}
                    </p>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDuplicateWarning(null)}>
                  Back, Let Me Check
                </Button>
                <Button
                  onClick={() => handleConfirmSave(true)}
                  disabled={saveSubmitting}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  {saveSubmitting ? 'Saving...' : 'Continue, This Is a New Patient'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Confirm Save Kardex</DialogTitle>
                <DialogDescription>
                  Are you sure you want to save this kardex? Please verify all information is correct before proceeding.
                </DialogDescription>
              </DialogHeader>
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 space-y-2">
                <p className="text-sm"><strong>Patient:</strong> {firstName} {lastName}</p>
                <p className="text-sm"><strong>Age:</strong> {age} | <strong>Sex:</strong> {gender}</p>
                {liveBmi != null && (
                  <p className="text-sm"><strong>BMI:</strong> {liveBmi} ({bmiCategory(liveBmi)})</p>
                )}
                <p className="text-sm"><strong>Room:</strong> {room}</p>
                <p className="text-sm"><strong>Admission Date:</strong> {admissionDate}</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => handleConfirmSave(false)}
                  disabled={saveSubmitting}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saveSubmitting ? 'Saving...' : 'Confirm & Save'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-purple-600" />
              Kardex History ({kardexHistory.length})
            </DialogTitle>
            <DialogDescription>
              {selectedHistoryEntry 
                ? 'Complete kardex record - Read-only view for audit and verification' 
                : 'View all saved kardex records'}
            </DialogDescription>
          </DialogHeader>
          
          {selectedHistoryEntry ? (
            /* Detailed View */
            <div className="space-y-4 px-1">
              {/* Metadata Banner */}
              <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-purple-600" />
                    <div>
                      <p className="text-xs text-gray-600">Saved On</p>
                      <p className="font-semibold text-gray-900">{new Date(selectedHistoryEntry.savedAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-purple-600" />
                    <div>
                      <p className="text-xs text-gray-600">Saved By</p>
                      <p className="font-semibold text-gray-900">{selectedHistoryEntry.savedBy}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={STATUS_BADGE[selectedHistoryEntry.status].variant}>
                  {STATUS_BADGE[selectedHistoryEntry.status].label}
                </Badge>
                {selectedHistoryEntry.status !== 'submitted' && selectedHistoryEntry.reviewedBy && (
                  <p className="text-xs text-gray-500">
                    by {selectedHistoryEntry.reviewedBy}
                    {selectedHistoryEntry.reviewedAt &&
                      ` · ${new Date(selectedHistoryEntry.reviewedAt).toLocaleString()}`}
                  </p>
                )}
              </div>
              {selectedHistoryEntry.reviewNotes &&
                (selectedHistoryEntry.status === 'returned' || selectedHistoryEntry.status === 'rejected') && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <p className="text-xs font-bold text-gray-700 mb-1">
                      {selectedHistoryEntry.status === 'returned' ? 'Correction requested:' : 'Rejection reason:'}
                    </p>
                    <p className="text-sm text-gray-700">{selectedHistoryEntry.reviewNotes}</p>
                  </div>
                )}

              <Separator />

              {/* Patient Demographics Section */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <User className="w-5 h-5 text-blue-600" />
                  Patient Demographics
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Last Name</Label>
                    <Input value={selectedHistoryEntry.lastName} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>First Name</Label>
                    <Input value={selectedHistoryEntry.firstName} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Middle Name</Label>
                    <Input value={selectedHistoryEntry.middleName} readOnly className="bg-gray-50" />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label>Age</Label>
                    <Input value={selectedHistoryEntry.age} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Sex/Gender</Label>
                    <Input value={selectedHistoryEntry.gender} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Religion</Label>
                    <Input value={selectedHistoryEntry.religion} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Birthday</Label>
                    <Input
                      value={selectedHistoryEntry.birthday ? formatDisplayDate(selectedHistoryEntry.birthday) : 'N/A'}
                      readOnly
                      className="bg-gray-50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label>Height</Label>
                    <Input
                      value={selectedHistoryEntry.heightCm ? `${selectedHistoryEntry.heightCm} cm` : '—'}
                      readOnly
                      className="bg-gray-50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Weight</Label>
                    <Input
                      value={selectedHistoryEntry.weightKg ? `${selectedHistoryEntry.weightKg} kg` : '—'}
                      readOnly
                      className="bg-gray-50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>BMI</Label>
                    <Input
                      value={
                        selectedHistoryEntry.bmi != null
                          ? `${selectedHistoryEntry.bmi} (${bmiCategory(selectedHistoryEntry.bmi)})`
                          : '—'
                      }
                      readOnly
                      className="bg-gray-50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label>Admission Date</Label>
                    <Input
                      value={formatDisplayDate(selectedHistoryEntry.admissionDate)}
                      readOnly
                      className="bg-gray-50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Room</Label>
                    <Input value={selectedHistoryEntry.room} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Bed Number</Label>
                    <Input value={selectedHistoryEntry.bedNumber || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                </div>
              </div>

              <Separator />

              {selectedHistoryEntry.patientCode && (
                <>
                  <KardexLabsAndMedications patientId={selectedHistoryEntry.patientCode} />
                  <Separator />
                </>
              )}

              {/* Medical Information Section */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-green-600" />
                  Medical Information
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Attending Physician</Label>
                    <Input value={selectedHistoryEntry.attendingPhysician || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Chief Complaint</Label>
                    <Textarea value={selectedHistoryEntry.chiefComplaint || 'N/A'} readOnly className="bg-gray-50" rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Admitting Diagnosis</Label>
                    <Textarea value={selectedHistoryEntry.admittingDiagnosis || 'N/A'} readOnly className="bg-gray-50" rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Final Diagnosis</Label>
                    <Textarea value={selectedHistoryEntry.finalDiagnosis || 'N/A'} readOnly className="bg-gray-50" rows={2} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Diet</Label>
                      <Input value={selectedHistoryEntry.diet || 'N/A'} readOnly className="bg-gray-50" />
                    </div>
                    <div className="space-y-2">
                      <Label>IVF</Label>
                      <Input value={selectedHistoryEntry.ivf || 'N/A'} readOnly className="bg-gray-50" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Allergies</Label>
                    {selectedHistoryEntry.allergies?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedHistoryEntry.allergies.map((allergy, index) => (
                          <span
                            key={`${allergy}-${index}`}
                            className="inline-flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 text-xs font-medium px-2.5 py-1 rounded-full"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {allergy}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <Input value="None known" readOnly className="bg-gray-50" />
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              {/* Vital Signs Section */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Heart className="w-5 h-5 text-red-600" />
                  Vital Signs
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Temperature (°C)</Label>
                    <Input value={selectedHistoryEntry.temperature || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Pulse Rate (bpm)</Label>
                    <Input value={selectedHistoryEntry.pulseRate || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Respiratory Rate</Label>
                    <Input value={selectedHistoryEntry.respiratoryRate || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Blood Pressure</Label>
                    <Input value={selectedHistoryEntry.bloodPressure || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>O2 Saturation (%)</Label>
                    <Input value={selectedHistoryEntry.oxygenSaturation || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Special Endorsements Section */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  Special Endorsements
                </h3>
                <Textarea
                  value={selectedHistoryEntry.specialEndorsements || 'No special endorsements recorded'}
                  readOnly
                  className="bg-gray-50"
                  rows={4}
                />
              </div>

              {user?.role === 'head_nurse' && selectedHistoryEntry.status === 'submitted' && (
                <>
                  <Separator />
                  <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
                    <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-purple-600" />
                      Head Nurse Review
                    </h3>
                    {reviewActionPending ? (
                      <div className="space-y-3">
                        <p className="text-xs font-bold text-gray-700">
                          {reviewActionPending === 'returned'
                            ? 'What needs to be corrected?'
                            : 'Why is this being rejected?'}
                        </p>
                        <Textarea
                          value={reviewNotesInput}
                          onChange={(e) => setReviewNotesInput(e.target.value)}
                          placeholder="Explain what the nurse should fix..."
                          rows={3}
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="flex-1"
                            onClick={() => {
                              setReviewActionPending(null);
                              setReviewNotesInput('');
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            className={`flex-1 text-white ${
                              reviewActionPending === 'rejected'
                                ? 'bg-red-600 hover:bg-red-700'
                                : 'bg-orange-600 hover:bg-orange-700'
                            }`}
                            disabled={reviewSubmitting || !reviewNotesInput.trim()}
                            onClick={() => handleReview(reviewActionPending)}
                          >
                            {reviewSubmitting
                              ? 'Submitting...'
                              : reviewActionPending === 'returned'
                                ? 'Confirm Return'
                                : 'Confirm Reject'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                          disabled={reviewSubmitting}
                          onClick={() => handleReview('approved')}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 border-orange-600 text-orange-600 hover:bg-orange-50"
                          disabled={reviewSubmitting}
                          onClick={() => setReviewActionPending('returned')}
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Return
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 border-red-600 text-red-600 hover:bg-red-50"
                          disabled={reviewSubmitting}
                          onClick={() => setReviewActionPending('rejected')}
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            /* List View */
            <div className="space-y-3">
              {isSupervisor && pendingReviewCount > 0 && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <Clock className="w-4 h-4 text-blue-700" />
                  <p className="text-sm text-blue-800 font-medium">
                    {pendingReviewCount} {pendingReviewCount === 1 ? 'record' : 'records'} awaiting your
                    review
                  </p>
                </div>
              )}
              {displayedHistory.map((entry) => {
                const isPendingForReview = isSupervisor && entry.status === 'submitted';
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between p-4 border-2 border-l-4 rounded-lg hover:shadow-md transition-all ${STATUS_ACCENT[entry.status]}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="font-bold text-gray-900 text-lg">{entry.patientName}</h4>
                        <Badge variant={STATUS_BADGE[entry.status].variant} className="text-xs">
                          {STATUS_BADGE[entry.status].label}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {entry.age}y • {entry.gender}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                        <p className="text-gray-600">
                          <span className="font-semibold">Room:</span> {entry.room}
                          {entry.bedNumber && ` - Bed ${entry.bedNumber}`}
                        </p>
                        <p className="text-gray-600">
                          <span className="font-semibold">Physician:</span>{' '}
                          {entry.attendingPhysician || 'Not specified'}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(entry.savedAt).toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500">
                          <span className="font-semibold">By:</span> {entry.savedBy}
                        </p>
                      </div>
                    </div>
                    <div className="ml-4">
                      {isPendingForReview ? (
                        <Button
                          size="sm"
                          onClick={() => handleViewHistory(entry)}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Review
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewHistory(entry)}
                          className="border-2 border-purple-600 text-purple-600 hover:bg-purple-50"
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          View Details
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* List view (no selectedHistoryEntry) has nothing left to put
              here now that Close is gone — the Dialog's own built-in X,
              backdrop click, and Esc all still close it — so the footer
              itself is skipped rather than rendering empty. */}
          {selectedHistoryEntry && (
            <DialogFooter className="sticky bottom-0 bg-white pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => setSelectedHistoryEntry(null)}
                className="mr-auto"
              >
                ← Back to List
              </Button>
              <Button variant="outline" onClick={() => handlePrintHistoryEntry(selectedHistoryEntry)}>
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}