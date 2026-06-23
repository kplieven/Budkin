import type { MeasurementKind } from '@/types/models';

/**
 * Display metadata for growth measurements. Units are the common metric
 * defaults; the actual unit follows the server's configured units.
 */
export const MEAS_META: Record<
  MeasurementKind,
  { label: string; short: string; unit: string; color: string }
> = {
  weight: { label: 'Weight', short: 'Weight', unit: 'kg', color: '#C9A227' },
  height: { label: 'Height', short: 'Height', unit: 'cm', color: '#5FA8D3' },
  head: { label: 'Head circumference', short: 'Head circ.', unit: 'cm', color: '#9F94D4' },
  bmi: { label: 'BMI', short: 'BMI', unit: '', color: '#6FC0A6' },
};

export const MEAS_KINDS: MeasurementKind[] = ['weight', 'height', 'head', 'bmi'];
