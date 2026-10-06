import type { MeasurementKind } from '@/types/models';

/**
 * Names the unit of the numbers in Baby Buddy, which stores them bare with no units
 * field. A family records in one system, through Budkin or any other client, so the
 * setting only LABELS what is stored: switching it never converts a value.
 */
export type UnitSystem = 'metric' | 'imperial';

/** Temperature and volume are not growth `MeasurementKind`s (they ride on an Entry) but
 *  carry a unit label the same way, so they join the kind union here. */
export type UnitKind = MeasurementKind | 'temperature' | 'volume';

// Pure ratios, metric per imperial.
const LB_PER_KG = 2.2046226;
const CM_PER_IN = 2.54;

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

/**
 * Brings data that really is metric, such as the WHO reference curves, into the user's
 * units. Never for a stored value: those are already in the user's units.
 */
export function fromMetric(kind: MeasurementKind, metricValue: number, system: UnitSystem): number {
  if (system === 'metric') return metricValue;
  switch (kind) {
    case 'weight':
      return metricValue * LB_PER_KG;
    case 'height':
    case 'head':
      return metricValue / CM_PER_IN;
    case 'bmi':
      return metricValue; // kg/m² in both systems
  }
}

/**
 * On-screen numbers only. Three decimals keeps a weight recorded to the gram (3.475 kg)
 * and hides the float tails older Budkin versions stored when they converted, such as
 * 103.50725 for 3.5 fl oz.
 */
export function fmtValue(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Null for non-numeric input, which the caller treats as "cancel the save".
 *
 * Text unchanged from its display returns the original value untouched, so a no-op edit
 * never rounds away digits the display trims.
 */
export function resolveInput(text: string, original?: number): number | null {
  const v = parseFloat(text.replace(',', '.'));
  if (Number.isNaN(v)) return null;
  if (original != null && text.trim() === fmtValue(original)) return original;
  return v;
}

/** One press of the amount stepper, in the user's units. */
export const VOLUME_STEP: Record<UnitSystem, number> = { metric: 10, imperial: 0.5 };

/** What a new pumping sheet starts on, in the user's units. */
export const DEFAULT_PUMP_AMOUNT: Record<UnitSystem, number> = { metric: 90, imperial: 3 };

/** What a new temperature sheet starts on, in the user's units. */
export const DEFAULT_TEMPERATURE: Record<UnitSystem, number> = { metric: 37.0, imperial: 98.6 };

// Float slack for testing whether a value already sits on the step grid, so a value a
// hair off a mark (float noise from whichever client wrote it) still moves a whole step
// instead of snapping in place.
const GRID_EPS = 1e-9;

/**
 * Snapping to the grid makes repeated presses land on round numbers even from an
 * off-grid start such as a typed 137 ml, and recomputing from the stored value each
 * press keeps float error from accumulating.
 */
export function stepVolume(amount: number, dir: 1 | -1, system: UnitSystem): number {
  const step = VOLUME_STEP[system];
  const grid = amount / step;
  const next = dir > 0 ? Math.floor(grid + GRID_EPS) + 1 : Math.ceil(grid - GRID_EPS) - 1;
  return Math.max(0, next * step);
}
