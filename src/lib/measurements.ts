import type { MeasurementKind } from '@/types/models';

/**
 * Display metadata for growth measurements: label, short label, and accent
 * color. The UNIT is intentionally NOT here — it depends on the user's
 * metric/imperial preference and comes from `unitLabel(kind, system)` in
 * `@/lib/units`. Stored values are always canonical metric (kg/cm); imperial is
 * a display lens applied at render.
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

export const MEAS_KINDS: MeasurementKind[] = ['weight', 'height', 'head', 'bmi'];
