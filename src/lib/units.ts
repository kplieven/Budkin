import type { MeasurementKind } from '@/types/models';

/**
 * Budkin-local units preference. This is a DISPLAY LENS only: measurement and
 * temperature values are always stored/persisted as canonical metric
 * (kg / cm / °C — Baby Buddy has no units field and stores bare numbers). The
 * imperial system converts on display and converts a typed value back to metric
 * on input. This module is the single source of truth for those conversions and
 * for the unit labels.
 */
export type UnitSystem = 'metric' | 'imperial';

/** The measurable quantities that carry a unit. Temperature is not a growth
 *  `MeasurementKind` (it rides on an Entry) but converts the same way, so it
 *  joins the kind union here. */
export type UnitKind = MeasurementKind | 'temperature';

// Pure ratios (metric per imperial). Temperature is deliberately NOT a ratio —
// it has an additive offset, handled explicitly below.
const LB_PER_KG = 2.2046226; // 1 kg = 2.2046226 lb
const CM_PER_IN = 2.54; // 1 in = 2.54 cm

/** The unit label shown for `kind` in the given system (BMI is dimensionless → ''). */
export function unitLabel(kind: UnitKind, system: UnitSystem): string {
  if (kind === 'bmi') return '';
  if (system === 'metric') {
    if (kind === 'weight') return 'kg';
    if (kind === 'temperature') return '°C';
    return 'cm'; // height, head
  }
  if (kind === 'weight') return 'lb';
  if (kind === 'temperature') return '°F';
  return 'in'; // height, head
}

/** Convert a canonical-metric value into the given system for display. */
export function toDisplay(kind: UnitKind, metricValue: number, system: UnitSystem): number {
  if (system === 'metric') return metricValue;
  switch (kind) {
    case 'weight':
      return metricValue * LB_PER_KG;
    case 'height':
    case 'head':
      return metricValue / CM_PER_IN;
    case 'temperature':
      return (metricValue * 9) / 5 + 32; // NOTE the +32 offset (not a pure ratio)
    case 'bmi':
      return metricValue; // dimensionless — never converted
  }
}

/** Convert a value typed in the given system back to canonical metric for storage. */
export function toMetric(kind: UnitKind, displayValue: number, system: UnitSystem): number {
  if (system === 'metric') return displayValue;
  switch (kind) {
    case 'weight':
      return displayValue / LB_PER_KG;
    case 'height':
    case 'head':
      return displayValue * CM_PER_IN;
    case 'temperature':
      return ((displayValue - 32) * 5) / 9; // inverse of the +32 offset
    case 'bmi':
      return displayValue; // dimensionless — never converted
  }
}

/**
 * A readable display string for a canonical-metric value in the given system.
 * Metric and BMI (dimensionless, never converted) are shown exactly as stored;
 * a converted imperial value is rounded to 1 decimal so it doesn't render as a
 * long binary float. Keep the raw `toDisplay`/`toMetric` for exact math (e.g.
 * round-tripping an input) — this is only for on-screen numbers.
 */
export function fmtValue(kind: UnitKind, metricValue: number, system: UnitSystem): string {
  const v = toDisplay(kind, metricValue, system);
  if (system === 'metric' || kind === 'bmi') return String(v);
  return String(Math.round(v * 10) / 10);
}
