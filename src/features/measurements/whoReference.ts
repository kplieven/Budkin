/**
 * WHO Child Growth Standards, applied to a child's growth chart. The reference
 * is drawn only for a recorded girl/boy gender and only for ages 0 to 60
 * months (WHO's range). Curves are computed from the LMS parameters in
 * `whoLms.ts` via the standard WHO formula.
 */

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
  // L can be exactly 0 (e.g. some BMI rows); the power form is undefined there.
  return Math.abs(L) < 1e-7 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
}

/** Does the visible time range cover any age in WHO's 0..60 month window? */
export function hasWhoAgeOverlap(birthMs: number, tMin: number, tMax: number): boolean {
  const ageMinMonths = (tMin - birthMs) / MONTH_MS;
  const ageMaxMonths = (tMax - birthMs) / MONTH_MS;
  return ageMaxMonths >= 0 && ageMinMonths <= 60;
}
