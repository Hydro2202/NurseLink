import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Colors, Radius } from '../constants/colors';

interface VitalSignsGridProps {
  temperature: string;
  onTemperatureChange: (v: string) => void;
  pulseRate: string;
  onPulseRateChange: (v: string) => void;
  respiratoryRate: string;
  onRespiratoryRateChange: (v: string) => void;
  bloodPressure: string;
  onBloodPressureChange: (v: string) => void;
  oxygenSaturation: string;
  onOxygenSaturationChange: (v: string) => void;
}

// keyboardType only swaps which on-screen keyboard a phone shows — it never
// blocks what actually lands in the field, and does nothing at all on web or
// with a physical keyboard, so a nurse can type letters into every one of
// these without it. Strip anything that isn't a legal character for that
// field's own shape as it's typed, rather than only validating on submit.
function sanitizeWholeNumber(v: string): string {
  return v.replace(/[^0-9]/g, '');
}
function sanitizeDecimal(v: string): string {
  const cleaned = v.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}
// "120/80" — digits either side of a single slash.
function sanitizeBloodPressure(v: string): string {
  const cleaned = v.replace(/[^0-9/]/g, '');
  const firstSlash = cleaned.indexOf('/');
  if (firstSlash === -1) return cleaned;
  return cleaned.slice(0, firstSlash + 1) + cleaned.slice(firstSlash + 1).replace(/\//g, '');
}

// Conservative adult reference ranges — flags a value as worth a second look
// without diagnosing anything. Blank fields are never flagged.
const isTemperatureAbnormal = (v: string) => {
  const n = parseFloat(v);
  return !Number.isNaN(n) && (n < 36.1 || n > 37.5);
};
const isPulseAbnormal = (v: string) => {
  const n = parseFloat(v);
  return !Number.isNaN(n) && (n < 60 || n > 100);
};
const isRespiratoryAbnormal = (v: string) => {
  const n = parseFloat(v);
  return !Number.isNaN(n) && (n < 12 || n > 20);
};
const isBloodPressureAbnormal = (v: string) => {
  const match = v.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!match) return false;
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  return systolic < 90 || systolic > 140 || diastolic < 60 || diastolic > 90;
};
const isOxygenAbnormal = (v: string) => {
  const n = parseFloat(v);
  return !Number.isNaN(n) && n < 95;
};

function VitalBlock({
  label,
  value,
  onChangeText,
  placeholder,
  unit,
  keyboardType,
  abnormal,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  unit: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  abnormal: boolean;
  style?: object;
}) {
  return (
    <View style={[styles.vitalBlock, abnormal && styles.vitalBlockAbnormal, style]}>
      <Text style={styles.vitalLabel}>{label}</Text>
      <View style={styles.vitalValueRow}>
        <TextInput
          style={[styles.vitalInput, abnormal && styles.vitalInputAbnormal]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.gray400}
          keyboardType={keyboardType}
        />
        <Text style={styles.vitalUnit}>{unit}</Text>
      </View>
      {abnormal ? <Text style={styles.vitalFlag}>Outside typical range</Text> : null}
    </View>
  );
}

export function VitalSignsGrid({
  temperature,
  onTemperatureChange,
  pulseRate,
  onPulseRateChange,
  respiratoryRate,
  onRespiratoryRateChange,
  bloodPressure,
  onBloodPressureChange,
  oxygenSaturation,
  onOxygenSaturationChange,
}: VitalSignsGridProps) {
  return (
    <View style={styles.gap3}>
      <View style={styles.vitalRow}>
        <VitalBlock
          label="Temperature"
          value={temperature}
          onChangeText={(v) => onTemperatureChange(sanitizeDecimal(v))}
          placeholder="36.5"
          unit="°C"
          keyboardType="decimal-pad"
          abnormal={isTemperatureAbnormal(temperature)}
          style={styles.vitalThird}
        />
        <VitalBlock
          label="Pulse Rate"
          value={pulseRate}
          onChangeText={(v) => onPulseRateChange(sanitizeWholeNumber(v))}
          placeholder="80"
          unit="bpm"
          keyboardType="numeric"
          abnormal={isPulseAbnormal(pulseRate)}
          style={styles.vitalThird}
        />
        <VitalBlock
          label="Resp. Rate"
          value={respiratoryRate}
          onChangeText={(v) => onRespiratoryRateChange(sanitizeWholeNumber(v))}
          placeholder="18"
          unit="/min"
          keyboardType="numeric"
          abnormal={isRespiratoryAbnormal(respiratoryRate)}
          style={styles.vitalThird}
        />
      </View>
      <View style={styles.vitalRow}>
        <VitalBlock
          label="Blood Pressure"
          value={bloodPressure}
          onChangeText={(v) => onBloodPressureChange(sanitizeBloodPressure(v))}
          placeholder="120/80"
          unit="mmHg"
          abnormal={isBloodPressureAbnormal(bloodPressure)}
          style={styles.vitalHalf}
        />
        <VitalBlock
          label="O2 Saturation"
          value={oxygenSaturation}
          onChangeText={(v) => onOxygenSaturationChange(sanitizeWholeNumber(v))}
          placeholder="98"
          unit="%"
          keyboardType="numeric"
          abnormal={isOxygenAbnormal(oxygenSaturation)}
          style={styles.vitalHalf}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap3: { gap: 12 },
  vitalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  vitalThird: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 110,
  },
  vitalHalf: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 150,
  },
  vitalBlock: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray50,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  vitalBlockAbnormal: {
    borderColor: Colors.orange300,
    backgroundColor: Colors.orange50,
  },
  vitalLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  vitalValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  vitalInput: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.gray900,
    padding: 0,
    minWidth: 40,
  },
  vitalInputAbnormal: {
    color: Colors.orange700,
  },
  vitalUnit: {
    fontSize: 12,
    color: Colors.mutedForeground,
  },
  vitalFlag: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.orange700,
  },
});
