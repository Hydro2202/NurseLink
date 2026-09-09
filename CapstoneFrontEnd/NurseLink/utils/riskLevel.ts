/**
 * Mirrors CapstoneBackEnd/api/serializers.py's assess_risk_level() exactly —
 * same thresholds, same "only score what's actually filled in" rule — so a
 * live preview in the UI never disagrees with what the backend will
 * compute and store once the kardex is saved.
 *
 * Threshold-based, not a clinical judgment — a nurse's own assessment always
 * takes precedence.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface VitalsInput {
  temperature?: string;
  pulseRate?: string;
  respiratoryRate?: string;
  bloodPressure?: string;
  oxygenSaturation?: string;
}

function parseFloatOrNull(value?: string): number | null {
  if (!value || !value.trim()) return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function parseBloodPressure(value?: string): [number, number] | [null, null] {
  if (!value) return [null, null];
  const match = value.match(/^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/);
  if (!match) return [null, null];
  return [Number(match[1]), Number(match[2])];
}

export function assessRiskLevel({
  temperature,
  pulseRate,
  respiratoryRate,
  bloodPressure,
  oxygenSaturation,
}: VitalsInput): RiskLevel {
  const severities: RiskLevel[] = [];

  const temp = parseFloatOrNull(temperature);
  if (temp !== null) {
    if (temp < 34.0 || temp >= 40.0) severities.push('critical');
    else if (temp < 35.0 || temp >= 39.0) severities.push('high');
    else if (temp < 36.1 || temp >= 37.6) severities.push('medium');
  }

  const pulse = parseFloatOrNull(pulseRate);
  if (pulse !== null) {
    if (pulse < 40 || pulse > 150) severities.push('critical');
    else if (pulse < 50 || pulse > 130) severities.push('high');
    else if (pulse < 60 || pulse > 100) severities.push('medium');
  }

  const resp = parseFloatOrNull(respiratoryRate);
  if (resp !== null) {
    if (resp < 8 || resp > 30) severities.push('critical');
    else if (resp < 10 || resp > 28) severities.push('high');
    else if (resp < 12 || resp > 20) severities.push('medium');
  }

  const spo2 = parseFloatOrNull(oxygenSaturation);
  if (spo2 !== null) {
    if (spo2 < 85) severities.push('critical');
    else if (spo2 < 90) severities.push('high');
    else if (spo2 < 95) severities.push('medium');
  }

  const [systolic, diastolic] = parseBloodPressure(bloodPressure);
  if (systolic !== null && diastolic !== null) {
    if (systolic >= 200 || systolic < 80 || diastolic >= 130 || diastolic < 50) {
      severities.push('critical');
    } else if (systolic >= 180 || systolic < 90 || diastolic >= 120 || diastolic < 60) {
      severities.push('high');
    } else if (systolic >= 140 || diastolic >= 90) {
      severities.push('medium');
    }
  }

  if (severities.includes('critical')) return 'critical';
  if (severities.includes('high')) return 'high';
  if (severities.includes('medium')) return 'medium';
  return 'low';
}
