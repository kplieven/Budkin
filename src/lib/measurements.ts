import type { MeasurementKind } from '@/types/models';

/**
 * The UNIT is deliberately NOT here: it depends on the user's metric/imperial
 * preference and comes from `unitLabel(kind, system)`. Stored values are always
 * canonical metric (kg/cm), and imperial is a display lens applied at render.
 */
export const MEAS_META: Record<
  MeasurementKind,
  { label: string; short: string; color: string }
> = {
  weight: { label: 'Weight', short: 'Weight', color: '#C9A227' },
  height: { label: 'Height', short: 'Height', color: '#5FA8D3' },
  head: { label: 'Head circumference', short: 'Head circ.', color: '#9F94D4' },
  bmi: { label: 'BMI', short: 'BMI', color: '#6FC0A6' },
};

/**
 * A label put mid-sentence: "Log weight", "Save head circ.". Acronyms are left alone,
 * because a plain toLowerCase() turns the BMI sheet into "Log bmi".
 */
export const lowerLabel = (label: string): string =>
  label === label.toUpperCase() ? label : label.toLowerCase();

export const MEAS_KINDS: MeasurementKind[] = ['weight', 'height', 'head', 'bmi'];
