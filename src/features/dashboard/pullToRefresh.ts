/**
 * Pure geometry for the touch-web pull-to-refresh gesture (see
 * {@link ./useWebPullToRefresh}). Split out from the hook so the thresholds are
 * unit-testable in the node environment, mirroring how `breakpoints.ts` holds
 * the pure decision behind `useDesktopShell`.
 */

/** Finger travel is damped by this factor to get the indicator's travel. */
export const PULL_RESISTANCE = 0.5;
/** Soft ceiling: the indicator moves 1:1 (post-resistance) up to here (px). */
export const PULL_MAX_PX = 120;
/** Releasing at/above this indicator offset (px) triggers a refresh. */
export const PULL_TRIGGER_PX = 76;
/** Where the spinner rests (px) while a triggered refresh is running. */
export const PULL_REST_PX = 88;
/**
 * Rubber-band budget past {@link PULL_MAX_PX} (px). Past the soft ceiling the
 * indicator keeps creeping with ever-lower sensitivity, approaching
 * `PULL_MAX_PX + PULL_OVERSCROLL_PX` but never reaching it — the Android feel.
 */
export const PULL_OVERSCROLL_PX = 28;
/** Larger = the overscroll creep decays more slowly (stays sensitive longer). */
export const PULL_OVERSCROLL_SCALE = 70;

/**
 * Indicator offset (px) for a raw downward finger travel `dyPx`. Linear (with
 * resistance) up to the soft ceiling, then an exponential rubber-band that
 * asymptotes toward `PULL_MAX_PX + PULL_OVERSCROLL_PX`.
 */
export function pullOffset(dyPx: number): number {
  if (dyPx <= 0) return 0;
  const eased = dyPx * PULL_RESISTANCE;
  if (eased <= PULL_MAX_PX) return eased;
  const over = eased - PULL_MAX_PX;
  return PULL_MAX_PX + PULL_OVERSCROLL_PX * (1 - Math.exp(-over / PULL_OVERSCROLL_SCALE));
}

/** Whether releasing at indicator `offsetPx` is far enough to trigger a refresh. */
export function shouldTrigger(offsetPx: number): boolean {
  return offsetPx >= PULL_TRIGGER_PX;
}
