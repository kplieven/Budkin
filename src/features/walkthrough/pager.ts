/**
 * Pure paging decisions for the walkthrough carousel (see {@link ./Walkthrough}).
 * Split out from the component so the gesture thresholds are unit-testable in the
 * node environment.
 */

/** Travel (px) accumulated within one wheel gesture before it turns a page. */
export const WHEEL_STEP_PX = 24;
/**
 * Quiet time (ms) that ends a wheel gesture. A trackpad fling arrives as a long burst of
 * events roughly a frame apart, so anything within this gap is the same gesture.
 */
export const WHEEL_GESTURE_GAP_MS = 140;

/** Fraction of a page a finger must travel before releasing commits the turn. */
export const DRAG_COMMIT_RATIO = 0.2;
/** A drag shorter than this (ms) counts as a flick and commits on distance alone. */
export const FLICK_MS = 250;
/** Minimum travel (px) for a flick to count, so a tap never turns a page. */
export const FLICK_MIN_PX = 12;

/** `pageWidth` is 0 until the pager has been measured, which would divide by zero. */
export function pageFromOffset(offsetX: number, pageWidth: number, count: number): number {
  if (pageWidth <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offsetX / pageWidth)));
}

/**
 * Tracks the finger 1:1 but never further than one page from the slide the drag started
 * on. That bound is what makes a hard flick physically unable to skip, rather than
 * something corrected after the fact.
 */
export function dragScrollLeft(
  startScroll: number,
  dx: number,
  pageWidth: number,
  count: number,
): number {
  if (pageWidth <= 0) return 0;
  const anchor = pageFromOffset(startScroll, pageWidth, count) * pageWidth;
  const lo = Math.max(0, anchor - pageWidth);
  const hi = Math.min((count - 1) * pageWidth, anchor + pageWidth);
  return Math.max(lo, Math.min(hi, startScroll - dx));
}

/**
 * One slide at most, or 0 to ease back. Dragging left (negative `dx`) moves the deck
 * forward, the way the content follows the finger. A short flick commits on distance
 * alone so a quick nudge is not swallowed for falling under the ratio.
 */
export function stepFromDrag(dx: number, pageWidth: number, elapsedMs: number): -1 | 0 | 1 {
  if (pageWidth <= 0) return 0;
  const far = Math.abs(dx) >= pageWidth * DRAG_COMMIT_RATIO;
  const flicked = elapsedMs <= FLICK_MS && Math.abs(dx) >= FLICK_MIN_PX;
  if (!far && !flicked) return 0;
  return dx < 0 ? 1 : -1;
}

/** Every key other than the arrows is left to the browser. */
export function stepFromKey(key: string): -1 | 0 | 1 {
  if (key === 'ArrowRight') return 1;
  if (key === 'ArrowLeft') return -1;
  return 0;
}

/** `locked` means this gesture already turned its page; the rest is swallowed. */
export interface WheelPagerState {
  acc: number;
  lastAt: number;
  locked: boolean;
}

export const IDLE_WHEEL_PAGER: WheelPagerState = { acc: 0, lastAt: -Infinity, locked: false };

/**
 * At most one page, and only on the event that crosses {@link WHEEL_STEP_PX}, so a hard
 * fling advances exactly one slide instead of skipping several the way CSS scroll-snap
 * does.
 *
 * `consumed` is what the caller suppresses the browser default on. The listeners cover
 * the whole walkthrough region, so suppressing unconditionally would swallow scrolling
 * the page over all of it. Sideways travel is claimed outright, since letting it through
 * invites the browser's swipe-to-go-back; vertical travel is claimed only once it has
 * actually turned a page, plus the tail of that same gesture.
 */
export function readWheel(
  state: WheelPagerState,
  e: { deltaX: number; deltaY: number },
  at: number,
): { state: WheelPagerState; step: -1 | 0 | 1; consumed: boolean } {
  // A plain mouse only reports deltaY, so vertical travel has to drive a horizontal deck.
  // A trackpad's horizontal swipe wins when it is the larger.
  const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const travel = sideways ? e.deltaX : e.deltaY;
  const continuing = at - state.lastAt <= WHEEL_GESTURE_GAP_MS;

  if (continuing && state.locked) {
    return { state: { acc: 0, lastAt: at, locked: true }, step: 0, consumed: true };
  }

  // Travel from an abandoned gesture is dropped, not carried forward.
  const acc = (continuing ? state.acc : 0) + travel;
  if (Math.abs(acc) >= WHEEL_STEP_PX) {
    return { state: { acc: 0, lastAt: at, locked: true }, step: acc > 0 ? 1 : -1, consumed: true };
  }
  return { state: { acc, lastAt: at, locked: false }, step: 0, consumed: sideways };
}
