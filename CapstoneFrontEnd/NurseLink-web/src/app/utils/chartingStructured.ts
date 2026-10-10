import type { ChartingNote, ChartingStructuredData, ChartingVitalSigns } from '../types/domain';

export type StructuredNursingNoteView = {
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
};

export type FDARFields = { focus: string; data: string; action: string; response: string };

export type FDARNoteView = {
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
  diagnosis: string;
  riskLevel: string;
  allergies: string;
  medications: string;
  alerts: string;
  focus: string;
  data: string;
  action: string;
  response: string;
  plan: string;
  clinicalSummary: string;
  timestamp: string;
};

function asTrimmedString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function formatVitalValue(key: string, value: unknown): string {
  const raw = asTrimmedString(value);
  if (!raw) return '';
  // Already has a unit from the client preview path.
  if (/[a-zA-Z%°]/.test(raw)) return raw;
  switch (key) {
    case 'heartRate':
      return `${raw} bpm`;
    case 'bloodPressure':
      return `${raw} mmHg`;
    case 'temperature':
      return `${raw}°C`;
    case 'oxygenSaturation':
      return `${raw}%`;
    case 'respiratoryRate':
      return `${raw} breaths/min`;
    default:
      return raw;
  }
}

function normalizeVitalSigns(raw: unknown): ChartingVitalSigns {
  if (!raw || typeof raw !== 'object') return {};
  const v = raw as Record<string, unknown>;
  const out: ChartingVitalSigns = {};
  const heartRate = formatVitalValue('heartRate', v.heartRate);
  const bloodPressure = formatVitalValue('bloodPressure', v.bloodPressure);
  const temperature = formatVitalValue('temperature', v.temperature);
  const oxygenSaturation = formatVitalValue('oxygenSaturation', v.oxygenSaturation);
  const respiratoryRate = formatVitalValue('respiratoryRate', v.respiratoryRate);
  if (heartRate) out.heartRate = heartRate;
  if (bloodPressure) out.bloodPressure = bloodPressure;
  if (temperature) out.temperature = temperature;
  if (oxygenSaturation) out.oxygenSaturation = oxygenSaturation;
  if (respiratoryRate) out.respiratoryRate = respiratoryRate;
  return out;
}

function normalizeInterventions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => asTrimmedString(item)).filter(Boolean);
}

/** Normalize workflow/API structured payload without inventing clinical facts. */
export function normalizeStructuredData(
  raw: Partial<ChartingStructuredData> | Record<string, unknown> | null | undefined
): ChartingStructuredData {
  const src = (raw ?? {}) as Record<string, unknown>;
  const interventions = normalizeInterventions(src.interventions);
  const vitalSigns = normalizeVitalSigns(src.vitalSigns);

  const result: ChartingStructuredData = {};
  const patientName = asTrimmedString(src.patientName);
  const patientId = asTrimmedString(src.patientId);
  const room = asTrimmedString(src.room);
  const date = asTrimmedString(src.date);
  const time = asTrimmedString(src.time);
  const attendingPhysician = asTrimmedString(src.attendingPhysician);
  const nurseName = asTrimmedString(src.nurseName);
  const assessment = asTrimmedString(src.assessment) || asTrimmedString(src.sourceAssessment);
  const diagnosis = asTrimmedString(src.diagnosis);
  const riskLevel = asTrimmedString(src.riskLevel);
  const allergies = asTrimmedString(src.allergies);
  const medications = asTrimmedString(src.medications);
  const alerts = asTrimmedString(src.alerts);
  const patientResponse = asTrimmedString(src.patientResponse);
  const clinicalSummary = asTrimmedString(src.clinicalSummary);
  const plan = asTrimmedString(src.plan);
  const timestamp = asTrimmedString(src.timestamp);

  if (patientName) result.patientName = patientName;
  if (patientId) result.patientId = patientId;
  if (room) result.room = room;
  if (date) result.date = date;
  if (time) result.time = time;
  if (attendingPhysician) result.attendingPhysician = attendingPhysician;
  if (nurseName) result.nurseName = nurseName;
  if (Object.keys(vitalSigns).length > 0) result.vitalSigns = vitalSigns;
  if (assessment) result.assessment = assessment;
  if (diagnosis) result.diagnosis = diagnosis;
  if (riskLevel) result.riskLevel = riskLevel;
  if (allergies) result.allergies = allergies;
  if (medications) result.medications = medications;
  if (alerts) result.alerts = alerts;
  if (interventions.length > 0) result.interventions = interventions;
  if (patientResponse) result.patientResponse = patientResponse;
  if (clinicalSummary) result.clinicalSummary = clinicalSummary;
  if (plan) result.plan = plan;
  if (timestamp) result.timestamp = timestamp;
  return result;
}

export function structuredHasClinicalContent(structured: ChartingStructuredData | null | undefined): boolean {
  if (!structured) return false;
  if (structured.assessment?.trim()) return true;
  if (structured.patientResponse?.trim()) return true;
  if (structured.clinicalSummary?.trim()) return true;
  if (structured.plan?.trim()) return true;
  if ((structured.interventions ?? []).some((i) => i.trim())) return true;
  const vitals = structured.vitalSigns ?? {};
  if (Object.values(vitals).some((v) => asTrimmedString(v))) return true;
  if (structured.diagnosis?.trim()) return true;
  if (structured.allergies?.trim()) return true;
  if (structured.medications?.trim()) return true;
  if (structured.alerts?.trim()) return true;
  return false;
}

/** Build a readable narrative backup for list preview / copy when note text is empty. */
export function contentFromStructured(structured: ChartingStructuredData): string {
  const lines: string[] = [];
  if (structured.patientName || structured.patientId || structured.room) {
    lines.push('NURSING PROGRESS NOTE');
    if (structured.patientName) lines.push(`Patient Name: ${structured.patientName}`);
    if (structured.patientId) lines.push(`Patient ID: ${structured.patientId}`);
    if (structured.room) lines.push(`Room: ${structured.room}`);
    if (structured.date) lines.push(`Date: ${structured.date}`);
    if (structured.time) lines.push(`Time: ${structured.time}`);
    if (structured.attendingPhysician) {
      lines.push(`Attending Physician: ${structured.attendingPhysician}`);
    }
    if (structured.nurseName) lines.push(`Nurse: ${structured.nurseName}`);
    lines.push('');
  }
  const vitals = structured.vitalSigns ?? {};
  const vitalEntries: [string, string | undefined][] = [
    ['Heart Rate', vitals.heartRate],
    ['Blood Pressure', vitals.bloodPressure],
    ['Temperature', vitals.temperature],
    ['Oxygen Saturation', vitals.oxygenSaturation],
    ['Respiratory Rate', vitals.respiratoryRate],
  ];
  const presentVitals = vitalEntries.filter(([, v]) => asTrimmedString(v));
  if (presentVitals.length > 0) {
    lines.push('VITAL SIGNS');
    for (const [label, value] of presentVitals) {
      lines.push(`${label}: ${value}`);
    }
    lines.push('');
  }
  if (structured.assessment?.trim()) {
    lines.push('ASSESSMENT & OBSERVATIONS');
    lines.push(structured.assessment.trim());
    lines.push('');
  }
  for (const [label, value] of [
    ['Current Diagnosis', structured.diagnosis],
    ['Risk Level', structured.riskLevel],
    ['Allergies', structured.allergies],
    ['Active Medications', structured.medications],
    ['Alerts', structured.alerts],
  ] as const) {
    if (value?.trim()) lines.push(`${label}: ${value.trim()}`);
  }
  const interventions = (structured.interventions ?? []).map((i) => i.trim()).filter(Boolean);
  if (interventions.length > 0) {
    lines.push('');
    lines.push('INTERVENTIONS');
    for (const item of interventions) lines.push(`- ${item}`);
  }
  if (structured.patientResponse?.trim()) {
    lines.push('');
    lines.push('PATIENT RESPONSE');
    lines.push(structured.patientResponse.trim());
  }
  if (structured.clinicalSummary?.trim()) {
    lines.push('');
    lines.push('CLINICAL SUMMARY');
    lines.push(structured.clinicalSummary.trim());
  }
  if (structured.plan?.trim()) {
    lines.push('');
    lines.push(`Plan: ${structured.plan.trim()}`);
  }
  return lines.join('\n').trim();
}

const NOTE_TYPE_LABELS: Record<string, string> = {
  progress: 'Progress',
  assessment: 'Assessment',
  medication: 'Medication',
  vital_signs: 'Vital Signs',
};

function firstClause(text: string, limit = 80): string {
  if (!text) return '';
  for (const sep of ['.', ';', '\n']) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx <= limit) return text.slice(0, idx).trim();
  }
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

/**
 * Deterministic Focus/Data/Action/Response derivation from whatever
 * structured/vitals/assessment/interventions/patientResponse data IS
 * available — the FDAR analogue of contentFromStructured. Never invents
 * clinical facts; only reorganizes what's already present. Mirrors the
 * backend's fdar_from_structured (api/serializers.py) so the client preview
 * matches what gets persisted.
 */
export function fdarFromStructured(structured: ChartingStructuredData, noteType = 'progress'): FDARFields {
  if (!structuredHasClinicalContent(structured)) {
    return { focus: '', data: '', action: '', response: '' };
  }

  const diagnosis = structured.diagnosis?.trim() ?? '';
  const assessment = structured.assessment?.trim() ?? '';
  const focus = diagnosis || NOTE_TYPE_LABELS[noteType] || firstClause(assessment) || '';

  const dataLines: string[] = [];
  const vitals = structured.vitalSigns ?? {};
  const vitalBits = (
    [
      ['HR', vitals.heartRate],
      ['BP', vitals.bloodPressure],
      ['Temp', vitals.temperature],
      ['SpO2', vitals.oxygenSaturation],
      ['RR', vitals.respiratoryRate],
    ] as const
  )
    .filter(([, v]) => asTrimmedString(v))
    .map(([label, v]) => `${label} ${v}`);
  if (vitalBits.length) dataLines.push(`Vital Signs: ${vitalBits.join(', ')}`);
  if (assessment) dataLines.push(assessment);

  const action = (structured.interventions ?? [])
    .map((i) => i.trim())
    .filter(Boolean)
    .map((i) => `- ${i}`)
    .join('\n');

  const responseLines: string[] = [];
  if (structured.patientResponse?.trim()) responseLines.push(structured.patientResponse.trim());
  if (structured.clinicalSummary?.trim()) responseLines.push(`Clinical Summary: ${structured.clinicalSummary.trim()}`);
  if (structured.plan?.trim()) responseLines.push(`Plan / Follow-up: ${structured.plan.trim()}`);

  return { focus, data: dataLines.join('\n\n'), action, response: responseLines.join('\n\n') };
}

export function fdarHasContent(fdar: Partial<FDARFields>): boolean {
  return Boolean(fdar.focus?.trim() || fdar.data?.trim() || fdar.action?.trim() || fdar.response?.trim());
}

/** Synthesize a searchable narrative from F/D/A/R for read-compat (list previews, copy, search). */
export function contentFromFDAR(focus: string, data: string, action: string, response: string): string {
  const parts: string[] = [];
  if (focus?.trim()) parts.push(`FOCUS: ${focus.trim()}`);
  if (data?.trim()) parts.push(`DATA:\n${data.trim()}`);
  if (action?.trim()) parts.push(`ACTION:\n${action.trim()}`);
  if (response?.trim()) parts.push(`RESPONSE:\n${response.trim()}`);
  return parts.join('\n\n');
}

/**
 * Prefer persisted structured/FDAR data for View Full Note. Fall back to
 * metadata + assessment-from-content only — never invent interventions or
 * clinical facts. Branches on note.noteFormat: 'legacy' notes render via the
 * original StructuredNursingNote view (unchanged); anything else (including
 * absent/undefined, the safe default going forward) is FDAR.
 */
export function resolveNoteForDisplay(
  note: ChartingNote
): { kind: 'legacy'; view: StructuredNursingNoteView } | { kind: 'fdar'; view: FDARNoteView } {
  const structured = normalizeStructuredData(note.structured ?? undefined);
  const stamp = note.timestamp;
  const dateFallback = new Date(stamp).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeFallback = new Date(stamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const vitals = structured.vitalSigns ?? {};
  const resolvedVitals = {
    heartRate: vitals.heartRate || '',
    bloodPressure: vitals.bloodPressure || '',
    temperature: vitals.temperature || '',
    oxygenSaturation: vitals.oxygenSaturation || '',
    respiratoryRate: vitals.respiratoryRate || '',
  };

  if (note.noteFormat === 'legacy') {
    if (structuredHasClinicalContent(structured) || structured.patientName || structured.assessment) {
      return {
        kind: 'legacy',
        view: {
          patientName: structured.patientName || note.patientName || '',
          patientId: structured.patientId || note.patientId || '',
          room: structured.room || '',
          date: structured.date || dateFallback,
          time: structured.time || timeFallback,
          attendingPhysician: structured.attendingPhysician || note.attendingPhysician || '',
          nurseName: structured.nurseName || note.nurseName || '',
          vitalSigns: resolvedVitals,
          assessment: structured.assessment || '',
          diagnosis: structured.diagnosis || '',
          riskLevel: structured.riskLevel || '',
          allergies: structured.allergies || '',
          medications: structured.medications || '',
          alerts: structured.alerts || '',
          interventions: structured.interventions ?? [],
          patientResponse: structured.patientResponse || '',
          clinicalSummary: structured.clinicalSummary || '',
          plan: structured.plan || '',
          timestamp: structured.timestamp || stamp,
        },
      };
    }

    // Legacy note with no structured data at all: show stored narrative as
    // assessment; no fabricated sections.
    const content = (note.content || '').trim();
    return {
      kind: 'legacy',
      view: {
        patientName: note.patientName || '',
        patientId: note.patientId || '',
        room: '',
        date: dateFallback,
        time: timeFallback,
        attendingPhysician: note.attendingPhysician || '',
        nurseName: note.nurseName || '',
        vitalSigns: { heartRate: '', bloodPressure: '', temperature: '', oxygenSaturation: '', respiratoryRate: '' },
        assessment: content,
        diagnosis: '',
        riskLevel: '',
        allergies: '',
        medications: '',
        alerts: '',
        interventions: [],
        patientResponse: '',
        clinicalSummary: '',
        plan: '',
        timestamp: stamp,
      },
    };
  }

  return {
    kind: 'fdar',
    view: {
      patientName: structured.patientName || note.patientName || '',
      patientId: structured.patientId || note.patientId || '',
      room: structured.room || '',
      date: structured.date || dateFallback,
      time: structured.time || timeFallback,
      attendingPhysician: structured.attendingPhysician || note.attendingPhysician || '',
      nurseName: structured.nurseName || note.nurseName || '',
      vitalSigns: resolvedVitals,
      diagnosis: structured.diagnosis || '',
      riskLevel: structured.riskLevel || '',
      allergies: structured.allergies || '',
      medications: structured.medications || '',
      alerts: structured.alerts || '',
      focus: note.focus || '',
      data: note.data || '',
      action: note.action || '',
      response: note.response || '',
      plan: structured.plan || '',
      clinicalSummary: structured.clinicalSummary || '',
      timestamp: structured.timestamp || stamp,
    },
  };
}

export function formatPatientVitalSigns(patient: {
  vitalSigns?: {
    heartRate?: number | string;
    bloodPressure?: string;
    temperature?: number | string;
    oxygenSaturation?: number | string;
    respiratoryRate?: number | string;
  };
}): ChartingVitalSigns {
  const vs = patient.vitalSigns;
  if (!vs) return {};
  const out: ChartingVitalSigns = {};
  if (vs.heartRate != null && String(vs.heartRate).trim() !== '') {
    out.heartRate = `${vs.heartRate} bpm`;
  }
  if (vs.bloodPressure != null && String(vs.bloodPressure).trim() !== '') {
    out.bloodPressure = `${vs.bloodPressure} mmHg`;
  }
  if (vs.temperature != null && String(vs.temperature).trim() !== '') {
    out.temperature = `${vs.temperature}°C`;
  }
  if (vs.oxygenSaturation != null && String(vs.oxygenSaturation).trim() !== '') {
    out.oxygenSaturation = `${vs.oxygenSaturation}%`;
  }
  if (vs.respiratoryRate != null && String(vs.respiratoryRate).trim() !== '') {
    out.respiratoryRate = `${vs.respiratoryRate} breaths/min`;
  }
  return out;
}
