import { Input } from './ui/input';
import { Label } from './ui/label';

/** Systolic/Diastolic as two numeric inputs side by side, combined into the
 * single "120/80" string every caller (Patient.vitalSigns.bloodPressure,
 * KardexRecord.blood_pressure) still stores and expects — nothing
 * downstream needs to change. Split back out of that same string on
 * load/edit, so this works the same whether the value came from this
 * component or an older plain-text entry. Validates client-side the same
 * way the backend's validate_blood_pressure_format does (systolic 50-300,
 * diastolic 30-200, systolic > diastolic, both-or-neither), purely so the
 * nurse sees the problem immediately rather than only after submitting.
 */

function splitBloodPressure(value: string): [string, string] {
  const [systolic = '', diastolic = ''] = (value || '').split('/');
  return [systolic.replace(/[^0-9]/g, ''), diastolic.replace(/[^0-9]/g, '')];
}

function bloodPressureError(systolic: string, diastolic: string): string {
  if (!systolic && !diastolic) return '';
  if (!systolic || !diastolic) return 'Enter both systolic and diastolic.';
  const sys = Number(systolic);
  const dia = Number(diastolic);
  if (sys < 50 || sys > 300) return 'Systolic must be 50-300.';
  if (dia < 30 || dia > 200) return 'Diastolic must be 30-200.';
  if (sys <= dia) return 'Systolic must be higher than diastolic.';
  return '';
}

interface BloodPressureInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
}

export function BloodPressureInput({ value, onChange, label = 'Blood Pressure', id }: BloodPressureInputProps) {
  const [systolic, diastolic] = splitBloodPressure(value);
  const error = bloodPressureError(systolic, diastolic);

  const setSystolic = (v: string) => onChange(`${v.replace(/[^0-9]/g, '')}/${diastolic}`);
  const setDiastolic = (v: string) => onChange(`${systolic}/${v.replace(/[^0-9]/g, '')}`);

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="numeric"
          value={systolic}
          onChange={(e) => setSystolic(e.target.value)}
          placeholder="120"
          className={error ? 'border-red-500' : ''}
        />
        <span className="text-lg font-bold text-gray-400">/</span>
        <Input
          inputMode="numeric"
          value={diastolic}
          onChange={(e) => setDiastolic(e.target.value)}
          placeholder="80"
          className={error ? 'border-red-500' : ''}
        />
        <span className="text-sm text-muted-foreground whitespace-nowrap">mmHg</span>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
