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

/** The measurable quantities that carry a unit. Temperature and volume are not
 *  growth `MeasurementKind`s (they ride on an Entry) but convert the same way,
 *  so they join the kind union here. */
export type UnitKind = MeasurementKind | 'temperature' | 'volume';

// Pure ratios (metric per imperial). Temperature is deliberately NOT a ratio —
// it has an additive offset, handled explicitly below.
const LB_PER_KG = 2.2046226; // 1 kg = 2.2046226 lb
const CM_PER_IN = 2.54; // 1 in = 2.54 cm
const ML_PER_FLOZ = 29.5735; // 1 US fluid ounce = 29.5735 ml

/** The unit label shown for `kind` in the given system (BMI is dimensionless → ''). */
export function unitLabel(kind: UnitKind, system: UnitSystem): string {
  if (kind === 'bmi') return '';
  if (system === 'metric') {
    if (kind === 'weight') return 'kg';
    if (kind === 'temperature') return '°C';
    if (kind === 'volume') return 'ml';
    return 'cm'; // height, head
  }
  if (kind === 'weight') return 'lb';
  if (kind === 'temperature') return '°F';
  if (kind === 'volume') return 'fl oz';
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
    case 'volume':
      return metricValue / ML_PER_FLOZ;
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
    case 'volume':
      return displayValue * ML_PER_FLOZ;
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
 *
 * Volume is the exception that rounds in BOTH systems. Every other quantity is
 * typed by a human in metric, so the stored number is already short. A volume
 * stepped in fl oz stores the exact conversion (3.5 fl oz is 103.50725 ml), and
 * flipping the lens back to ml must not surface that raw.
 */
export function fmtValue(kind: UnitKind, metricValue: number, system: UnitSystem): string {
  const v = toDisplay(kind, metricValue, system);
  if (kind === 'bmi') return String(v);
  if (system === 'metric' && kind !== 'volume') return String(v);
  return String(Math.round(v * 10) / 10);
}

/**
 * Resolve the canonical-metric value to persist from a sheet's text input.
 * Returns null for non-numeric input (the caller should cancel the save).
 *
 * When editing an existing value whose text is UNCHANGED from its display
 * (`fmtValue(original)`), the original metric value is returned untouched —
 * otherwise re-deriving it from the 1-decimal display would nudge the stored
 * canonical value on a no-op edit (e.g. 5.2 kg → shown "11.5" lb → 5.216 kg).
 * A genuinely edited value is converted back to metric.
 */
export function resolveMetricInput(
  kind: UnitKind,
  text: string,
  system: UnitSystem,
  original?: number,
): number | null {
  const v = parseFloat(text.replace(',', '.'));
  if (Number.isNaN(v)) return null;
  if (original != null && text.trim() === fmtValue(kind, original, system)) return original;
  return toMetric(kind, v, system);
}

/** One press of the amount stepper, measured in DISPLAY units. */
export const VOLUME_STEP: Record<UnitSystem, number> = { metric: 10, imperial: 0.5 };

// Float slack when testing whether a value already sits on the step grid.
// 103.50725 ml round-trips to 3.5000000000000004 fl oz, which must still count
// as "exactly 3.5" or a press would snap in place instead of moving a step.
const GRID_EPS = 1e-9;

/**
 * Step a canonical-ml amount by one press, in the direction `dir` (+1 / -1).
 *
 * The stepper works in DISPLAY space and converts back to canonical ml on
 * commit: pressing + in imperial adds 0.5 fl oz, not 10 ml. The result is
 * snapped onto the display step grid, so repeated presses land on clean halves
 * (3.0, 3.5, 4.0 fl oz) even from an off-grid start such as the 90 ml pumping
 * default (3.0433 fl oz). Float error cannot accumulate either: every press is
 * recomputed from the stored value rather than added to the previous display
 * number. An off-grid value moves to the next grid point in the pressed
 * direction, so a press always changes the amount. Clamped at zero, matching
 * the old metric-only behaviour.
 */
export function stepVolume(metricMl: number, dir: 1 | -1, system: UnitSystem): number {
  const step = VOLUME_STEP[system];
  const grid = toDisplay('volume', metricMl, system) / step;
  const next = dir > 0 ? Math.floor(grid + GRID_EPS) + 1 : Math.ceil(grid - GRID_EPS) - 1;
  return toMetric('volume', Math.max(0, next * step), system);
}
