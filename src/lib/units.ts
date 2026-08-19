import type { MeasurementKind } from '@/types/models';

/**
 * A DISPLAY LENS only: values are always stored as canonical metric (kg / cm / °C),
 * because Baby Buddy has no units field and stores bare numbers.
 */
export type UnitSystem = 'metric' | 'imperial';

/** Temperature and volume are not growth `MeasurementKind`s (they ride on an Entry) but
 *  convert the same way, so they join the kind union here. */
export type UnitKind = MeasurementKind | 'temperature' | 'volume';

// Pure ratios, metric per imperial. Temperature is not one: it has an additive offset,
// handled explicitly below.
const LB_PER_KG = 2.2046226;
const CM_PER_IN = 2.54;
const ML_PER_FLOZ = 29.5735; // US fluid ounce

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

export function toDisplay(kind: UnitKind, metricValue: number, system: UnitSystem): number {
  if (system === 'metric') return metricValue;
  switch (kind) {
    case 'weight':
      return metricValue * LB_PER_KG;
    case 'height':
    case 'head':
      return metricValue / CM_PER_IN;
    case 'temperature':
      return (metricValue * 9) / 5 + 32;
    case 'volume':
      return metricValue / ML_PER_FLOZ;
    case 'bmi':
      return metricValue; // dimensionless
  }
}

export function toMetric(kind: UnitKind, displayValue: number, system: UnitSystem): number {
  if (system === 'metric') return displayValue;
  switch (kind) {
    case 'weight':
      return displayValue / LB_PER_KG;
    case 'height':
    case 'head':
      return displayValue * CM_PER_IN;
    case 'temperature':
      return ((displayValue - 32) * 5) / 9;
    case 'volume':
      return displayValue * ML_PER_FLOZ;
    case 'bmi':
      return displayValue; // dimensionless
  }
}

/**
 * On-screen numbers only: use the raw `toDisplay`/`toMetric` for exact math.
 *
 * Volume rounds in both systems, where everything else rounds only in imperial. Every
 * other quantity is typed by a human in metric, so the stored number is already short. A
 * volume stepped in fl oz stores the exact conversion (3.5 fl oz is 103.50725 ml), and
 * flipping the lens back to ml must not surface that raw.
 */
export function fmtValue(kind: UnitKind, metricValue: number, system: UnitSystem): string {
  const v = toDisplay(kind, metricValue, system);
  if (kind === 'bmi') return String(v);
  if (system === 'metric' && kind !== 'volume') return String(v);
  return String(Math.round(v * 10) / 10);
}

/**
 * Null for non-numeric input, which the caller treats as "cancel the save".
 *
 * Text unchanged from its display returns the original metric value untouched:
 * re-deriving it from the 1-decimal display would nudge the stored canonical value on a
 * no-op edit, since 5.2 kg shown as "11.5" lb comes back as 5.216 kg.
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

// Float slack for testing whether a value already sits on the step grid. 103.50725 ml
// round-trips to 3.5000000000000004 fl oz, which must still count as exactly 3.5 or a
// press would snap in place instead of moving a step.
const GRID_EPS = 1e-9;

/**
 * Works in display space and converts back to canonical ml on commit, so pressing + in
 * imperial adds 0.5 fl oz, not 10 ml. Snapping to the grid makes repeated presses land on
 * clean halves even from an off-grid start such as the 90 ml pumping default (3.0433 fl
 * oz), and recomputing from the stored value each press keeps float error from
 * accumulating.
 */
export function stepVolume(metricMl: number, dir: 1 | -1, system: UnitSystem): number {
  const step = VOLUME_STEP[system];
  const grid = toDisplay('volume', metricMl, system) / step;
  const next = dir > 0 ? Math.floor(grid + GRID_EPS) + 1 : Math.ceil(grid - GRID_EPS) - 1;
  return toMetric('volume', Math.max(0, next * step), system);
}

/**
 * The display lens rounds to one decimal, which can hide a press: stored 90 ml is 3.043
 * fl oz and shows as "3.0", and pressing minus correctly moves it to exactly 3.0 fl oz,
 * which also shows as "3.0". Snapping the draft on open makes shown and stored agree.
 * Only the in-memory draft is snapped; persisted entries stay as stored.
 *
 * An exact midpoint rounds up, and it takes the same `GRID_EPS` slack as `stepVolume` to
 * actually mean it: the ml round-trip lands a couple of imperial midpoints a hair below
 * their true value (5.75 fl oz is 170.0476…ml, back to 5.749999999999999), so a bare
 * `Math.round` would send those two down while the other 38 went up.
 */
export function snapVolume(metricMl: number, system: UnitSystem): number {
  const step = VOLUME_STEP[system];
  const grid = toDisplay('volume', metricMl, system) / step;
  return toMetric('volume', Math.max(0, Math.round(grid + GRID_EPS) * step), system);
}
