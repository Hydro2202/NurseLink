/**
 * Mirrors CapstoneBackEnd/api/models.py's compute_bmi() and the height/weight
 * range checks in api/serializers.py exactly — same formula, same rounding,
 * same bounds — so a live preview here never disagrees with what the
 * backend will compute and validate once the kardex is saved.
 */

export const HEIGHT_MIN_CM = 30;
export const HEIGHT_MAX_CM = 250;
export const WEIGHT_MIN_KG = 0.5;
export const WEIGHT_MAX_KG = 350;

export type BmiCategory = 'Underweight' | 'Normal' | 'Overweight' | 'Obese';

/** weight_kg / (height_cm/100)**2, rounded to 1 decimal. null if either
 * measurement is missing, blank, non-numeric, or height isn't positive. */
export function computeBmi(heightCm?: string | number | null, weightKg?: string | number | null): number | null {
  const height = typeof heightCm === 'number' ? heightCm : parseFloat(String(heightCm ?? ''));
  const weight = typeof weightKg === 'number' ? weightKg : parseFloat(String(weightKg ?? ''));
  if (!Number.isFinite(height) || !Number.isFinite(weight) || height <= 0) return null;
  const heightM = height / 100;
  return Math.round((weight / (heightM * heightM)) * 10) / 10;
}

export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

/** Error message for an out-of-range height, or null if blank/valid —
 * blank is valid here since height is optional on the Kardex. */
export function validateHeightCm(value: string): string | null {
  if (!value.trim()) return null;
  const n = parseFloat(value);
  if (Number.isNaN(n)) return 'Enter a valid number.';
  if (n < HEIGHT_MIN_CM || n > HEIGHT_MAX_CM) {
    return `Height must be between ${HEIGHT_MIN_CM} and ${HEIGHT_MAX_CM} cm.`;
  }
  return null;
}

export function validateWeightKg(value: string): string | null {
  if (!value.trim()) return null;
  const n = parseFloat(value);
  if (Number.isNaN(n)) return 'Enter a valid number.';
  if (n < WEIGHT_MIN_KG || n > WEIGHT_MAX_KG) {
    return `Weight must be between ${WEIGHT_MIN_KG} and ${WEIGHT_MAX_KG} kg.`;
  }
  return null;
}
