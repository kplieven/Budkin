import { describe, expect, it } from 'vitest';

import {
  IDLE_WHEEL_PAGER,
  WHEEL_GESTURE_GAP_MS,
  WHEEL_STEP_PX,
  pageFromOffset,
  readWheel,
  type WheelPagerState,
} from '@/features/walkthrough/pager';

describe('pageFromOffset', () => {
  it('maps exact multiples of the page width to their page', () => {
    expect(pageFromOffset(0, 400, 5)).toBe(0);
    expect(pageFromOffset(400, 400, 5)).toBe(1);
    expect(pageFromOffset(1600, 400, 5)).toBe(4);
  });

  it('rounds a part-scrolled offset to the nearest page', () => {
    expect(pageFromOffset(180, 400, 5)).toBe(0);
    expect(pageFromOffset(220, 400, 5)).toBe(1);
  });

  it('clamps past either end (overscroll must not produce a phantom page)', () => {
    expect(pageFromOffset(-90, 400, 5)).toBe(0);
    expect(pageFromOffset(9999, 400, 5)).toBe(4);
  });

  it('returns 0 before the pager has been measured', () => {
    expect(pageFromOffset(0, 0, 5)).toBe(0);
  });
});

/** Feed a burst of wheel events through the reducer, collecting every step it emits. */
function burst(
  deltas: readonly number[],
  { from = IDLE_WHEEL_PAGER, at = 1000, gapMs = 16 } = {},
): { state: WheelPagerState; steps: number[] } {
  let state = from;
  let now = at;
  const steps: number[] = [];
  for (const deltaY of deltas) {
    const r = readWheel(state, { deltaX: 0, deltaY }, now);
    state = r.state;
    if (r.step !== 0) steps.push(r.step);
    now += gapMs;
  }
  return { state, steps };
}

describe('readWheel', () => {
  it('ignores jitter below the step threshold', () => {
    expect(burst([2, 3, 2]).steps).toEqual([]);
  });

  it('turns one page once accumulated travel crosses the threshold', () => {
    expect(burst([WHEEL_STEP_PX]).steps).toEqual([1]);
  });

  it('turns exactly one page for a long continuous fling', () => {
    // The reported bug: a trackpad fling emits dozens of deltas and used to skip
    // several slides at once. One gesture must move one slide.
    expect(burst(Array(40).fill(30)).steps).toEqual([1]);
  });

  it('allows the next gesture once the wheel has gone quiet', () => {
    const first = burst(Array(20).fill(30));
    expect(first.steps).toEqual([1]);

    const second = burst(Array(20).fill(30), {
      from: first.state,
      at: first.state.lastAt + WHEEL_GESTURE_GAP_MS + 1,
    });
    expect(second.steps).toEqual([1]);
  });

  it('steps backwards on a reversed gesture', () => {
    expect(burst(Array(40).fill(-30)).steps).toEqual([-1]);
  });

  it('reads a horizontal trackpad swipe when it dominates the vertical delta', () => {
    const { step } = readWheel(IDLE_WHEEL_PAGER, { deltaX: -WHEEL_STEP_PX, deltaY: 3 }, 1000);
    expect(step).toBe(-1);
  });

  it('reads a plain mouse wheel, which only ever reports deltaY', () => {
    const { step } = readWheel(IDLE_WHEEL_PAGER, { deltaX: 0, deltaY: WHEEL_STEP_PX }, 1000);
    expect(step).toBe(1);
  });

  it('does not carry stale travel from an abandoned gesture into the next one', () => {
    const stalled = burst([WHEEL_STEP_PX - 1]);
    expect(stalled.steps).toEqual([]);

    // Same amount again, but long after — on its own it is still under the
    // threshold, so it must not tip the pager over by summing with the old travel.
    const later = burst([WHEEL_STEP_PX - 1], {
      from: stalled.state,
      at: stalled.state.lastAt + WHEEL_GESTURE_GAP_MS + 1,
    });
    expect(later.steps).toEqual([]);
  });
});
