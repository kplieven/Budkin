/**
 * WHO Child Growth Standards, applied to a child's growth chart. The reference is
 * drawn only for a recorded girl/boy gender and only for ages 0 to 60 months (WHO's
 * range), from the LMS parameters in `whoLms.ts`.
 */
import { toDisplay, type UnitSystem } from '@/lib/units';
import type { ChildGender, MeasurementKind } from '@/types/models';

import { WHO_LMS, type Sex } from './whoLms';

/** LMS parameters for one age: Box-Cox power (L), median (M), coeff. of var (S). */
export interface Lms {
  L: number;
  M: number;
  S: number;
}

/** Average month length; WHO ages are in completed months. 365.25/12 days. */
export const MONTH_MS = 30.4375 * 86_400_000;

/** The percentiles drawn, with their standard-normal z-scores. 50th emphasised. */
export const PCTS: { p: number; z: number; emphasis: boolean }[] = [
  { p: 3, z: -1.88079, emphasis: false },
  { p: 15, z: -1.03643, emphasis: false },
  { p: 50, z: 0, emphasis: true },
  { p: 85, z: 1.03643, emphasis: false },
  { p: 97, z: 1.88079, emphasis: false },
];

/** WHO LMS -> the measurement value at z standard deviations from the median. */
export function valueAtZ({ L, M, S }: Lms, z: number): number {
  // L can be exactly 0 (e.g. some BMI rows) and the power form is undefined there.
  return Math.abs(L) < 1e-7 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
}

/** Does the visible time range cover any age in WHO's 0..60 month window? */
export function hasWhoAgeOverlap(birthMs: number, tMin: number, tMax: number): boolean {
  const ageMinMonths = (tMin - birthMs) / MONTH_MS;
  const ageMaxMonths = (tMax - birthMs) / MONTH_MS;
  return ageMaxMonths >= 0 && ageMinMonths <= 60;
}

/** One percentile curve, sampled along the time axis in display units. */
export interface GrowthCurve {
  p: number;
  label: string;
  emphasis: boolean;
  points: { t: number; value: number }[];
}

/** LMS at a fractional age (months), linearly interpolating between rows. */
function lmsAtAge(table: Lms[], ageMonths: number): Lms {
  const a = Math.max(0, Math.min(60, ageMonths));
  const lo = Math.floor(a);
  const hi = Math.min(60, lo + 1);
  const f = a - lo;
  const A = table[lo];
  const B = table[hi];
  return { L: A.L + (B.L - A.L) * f, M: A.M + (B.M - A.M) * f, S: A.S + (B.S - A.S) * f };
}

/**
 * The five percentile curves for `kind` and `gender`, sampled monthly across the
 * visible range [tMin, tMax], clamped to ages 0..60 months, in the caller's display
 * units. Null when no reference applies (gender not girl/boy, or the range lies
 * entirely outside 0..60 months).
 */
export function referenceCurves(
  kind: MeasurementKind,
  gender: ChildGender | undefined,
  birthMs: number,
  tMin: number,
  tMax: number,
  unitSystem: UnitSystem,
): GrowthCurve[] | null {
  if (gender !== 'girl' && gender !== 'boy') return null;
  const table = WHO_LMS[kind]?.[gender as Sex];
  if (!table) return null;
  if (!hasWhoAgeOverlap(birthMs, tMin, tMax)) return null;

  const t0 = Math.max(tMin, birthMs); // clamp to age >= 0
  const t1 = Math.min(tMax, birthMs + 60 * MONTH_MS); // clamp to age <= 60
  if (t1 < t0) return null;

  // Sample at both endpoints plus every whole-month boundary strictly between, so the
  // polyline follows the smooth WHO curve rather than the sparse logs.
  const ts: number[] = [t0];
  const first = Math.floor((t0 - birthMs) / MONTH_MS) + 1;
  const last = Math.ceil((t1 - birthMs) / MONTH_MS) - 1;
  for (let m = first; m <= last; m++) ts.push(birthMs + m * MONTH_MS);
  if (t1 > t0) ts.push(t1);

  return PCTS.map(({ p, z, emphasis }) => ({
    p,
    label: String(p),
    emphasis,
    points: ts.map((t) => ({
      t,
      value: toDisplay(kind, valueAtZ(lmsAtAge(table, (t - birthMs) / MONTH_MS), z), unitSystem),
    })),
  }));
}
