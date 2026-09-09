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

/**
 * Prefer persisted structured data for View Full Note. Fall back to metadata +
 * assessment-from-content only — never invent interventions or clinical facts.
 */
export function resolveNoteForDisplay(note: ChartingNote): StructuredNursingNoteView {
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

  if (structuredHasClinicalContent(structured) || structured.patientName || structured.assessment) {
    const vitals = structured.vitalSigns ?? {};
    return {
      patientName: structured.patientName || note.patientName || '',
      patientId: structured.patientId || note.patientId || '',
      room: structured.room || '',
      date: structured.date || dateFallback,
      time: structured.time || timeFallback,
      attendingPhysician: structured.attendingPhysician || note.attendingPhysician || '',
      nurseName: structured.nurseName || note.nurseName || '',
      vitalSigns: {
        heartRate: vitals.heartRate || '',
        bloodPressure: vitals.bloodPressure || '',
        temperature: vitals.temperature || '',
        oxygenSaturation: vitals.oxygenSaturation || '',
        respiratoryRate: vitals.respiratoryRate || '',
      },
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
    };
  }

  // Legacy notes: show stored narrative as assessment; no fabricated sections.
  const content = (note.content || '').trim();
  return {
    patientName: note.patientName || '',
    patientId: note.patientId || '',
    room: '',
    date: dateFallback,
    time: timeFallback,
    attendingPhysician: note.attendingPhysician || '',
    nurseName: note.nurseName || '',
    vitalSigns: {
      heartRate: '',
      bloodPressure: '',
      temperature: '',
      oxygenSaturation: '',
      respiratoryRate: '',
    },
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
