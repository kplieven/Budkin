/**
 * Pure paging decisions for the walkthrough carousel (see {@link ./Walkthrough}).
 * Split out from the component so the gesture thresholds are unit-testable in the
 * node environment, mirroring how `pullToRefresh.ts` holds the geometry behind
 * `useWebPullToRefresh`.
 */

/** Travel (px) accumulated within one wheel gesture before it turns a page. */
export const WHEEL_STEP_PX = 24;
/**
 * Quiet time (ms) that ends a wheel gesture. A trackpad fling arrives as a long
 * burst of events roughly a frame apart, so anything within this gap counts as
 * the same gesture and cannot turn a second page.
 */
export const WHEEL_GESTURE_GAP_MS = 140;

/**
 * Nearest page for a horizontal scroll offset, clamped to the deck. `pageWidth`
 * is 0 until the pager has been measured, which would otherwise divide by zero.
 */
export function pageFromOffset(offsetX: number, pageWidth: number, count: number): number {
  if (pageWidth <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offsetX / pageWidth)));
}

/**
 * Accumulated travel of the wheel gesture in flight. `locked` means this gesture
 * has already turned its page and the rest of its events are being swallowed.
 */
export interface WheelPagerState {
  acc: number;
  lastAt: number;
  locked: boolean;
}

export const IDLE_WHEEL_PAGER: WheelPagerState = { acc: 0, lastAt: -Infinity, locked: false };

/**
 * Fold one wheel event into the gesture, returning how many pages to move: at
 * most one, and only on the event that crosses {@link WHEEL_STEP_PX}. Every
 * later event in the same gesture returns 0, so a hard fling advances exactly
 * one slide instead of skipping several the way CSS scroll-snap does. Reversing
 * the gesture steps back.
 *
 * Timestamps are passed in rather than read from the clock so the reducer stays
 * pure and testable.
 */
export function readWheel(
  state: WheelPagerState,
  e: { deltaX: number; deltaY: number },
  at: number,
): { state: WheelPagerState; step: -1 | 0 | 1 } {
  // A plain mouse only reports deltaY, so vertical travel has to drive a
  // horizontal deck; a trackpad's horizontal swipe wins when it is the larger.
  const travel = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const continuing = at - state.lastAt <= WHEEL_GESTURE_GAP_MS;

  if (continuing && state.locked) return { state: { acc: 0, lastAt: at, locked: true }, step: 0 };

  // Travel from an abandoned gesture is dropped, not carried forward.
  const acc = (continuing ? state.acc : 0) + travel;
  if (Math.abs(acc) >= WHEEL_STEP_PX) {
    return { state: { acc: 0, lastAt: at, locked: true }, step: acc > 0 ? 1 : -1 };
  }
  return { state: { acc, lastAt: at, locked: false }, step: 0 };
}
