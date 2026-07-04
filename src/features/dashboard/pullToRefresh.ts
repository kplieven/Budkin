/**
 * Pure geometry for the touch-web pull-to-refresh gesture (see
 * {@link ./useWebPullToRefresh}). Split out from the hook so the thresholds are
 * unit-testable in the node environment, mirroring how `breakpoints.ts` holds
 * the pure decision behind `useDesktopShell`.
 */

/** Finger travel is damped by this factor to get the indicator's travel. */
export const PULL_RESISTANCE = 0.5;
/** The indicator stops growing past this offset (px). */
export const PULL_MAX_PX = 96;
/** Releasing at/above this indicator offset (px) triggers a refresh. */
export const PULL_TRIGGER_PX = 64;

/** Indicator offset (px) for a raw downward finger travel `dyPx`. */
export function pullOffset(dyPx: number): number {
  if (dyPx <= 0) return 0;
  return Math.min(dyPx * PULL_RESISTANCE, PULL_MAX_PX);
}

/** Whether releasing at indicator `offsetPx` is far enough to trigger a refresh. */
export function shouldTrigger(offsetPx: number): boolean {
  return offsetPx >= PULL_TRIGGER_PX;
}
