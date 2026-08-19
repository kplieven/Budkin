import { describe, expect, it } from 'vitest';

import {
  FLICK_MS,
  IDLE_WHEEL_PAGER,
  WHEEL_GESTURE_GAP_MS,
  WHEEL_STEP_PX,
  dragScrollLeft,
  pageFromOffset,
  readWheel,
  stepFromDrag,
  stepFromKey,
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

const W = 400; // page width used throughout the drag tests
const COUNT = 5;

describe('dragScrollLeft', () => {
  it('tracks the finger 1:1', () => {
    expect(dragScrollLeft(W, -120, W, COUNT)).toBe(W + 120);
    expect(dragScrollLeft(W, 120, W, COUNT)).toBe(W - 120);
  });

  it('never travels more than one page from where the drag began', () => {
    // Even an absurd finger travel can only reach the neighbouring slide.
    expect(dragScrollLeft(W, -5000, W, COUNT)).toBe(2 * W);
    expect(dragScrollLeft(W, 5000, W, COUNT)).toBe(0);
  });

  it('does not scroll past either end of the deck', () => {
    expect(dragScrollLeft(0, 400, W, COUNT)).toBe(0);
    expect(dragScrollLeft(4 * W, -400, W, COUNT)).toBe(4 * W);
  });

  it('anchors to the nearest page when a drag starts mid-animation', () => {
    // Started 10px shy of page 1, so the one-page budget is measured from page 1.
    expect(dragScrollLeft(W - 10, -5000, W, COUNT)).toBe(2 * W);
  });

  it('returns 0 before the pager has been measured', () => {
    expect(dragScrollLeft(0, -100, 0, COUNT)).toBe(0);
  });
});

describe('stepFromDrag', () => {
  const SLOW = FLICK_MS + 100;

  it('commits a page once the finger passes the ratio', () => {
    expect(stepFromDrag(-W * 0.25, W, SLOW)).toBe(1);
    expect(stepFromDrag(W * 0.25, W, SLOW)).toBe(-1);
  });

  it('eases back when a slow drag falls short', () => {
    expect(stepFromDrag(-W * 0.1, W, SLOW)).toBe(0);
  });

  it('commits a short quick flick that falls under the ratio', () => {
    expect(stepFromDrag(-40, W, 120)).toBe(1);
    expect(stepFromDrag(40, W, 120)).toBe(-1);
  });

  it('ignores the jitter of a tap', () => {
    expect(stepFromDrag(-3, W, 60)).toBe(0);
  });

  it('never reports more than one page, however far the finger went', () => {
    expect(stepFromDrag(-5000, W, 80)).toBe(1);
    expect(stepFromDrag(5000, W, 80)).toBe(-1);
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
    // A trackpad fling emits dozens of deltas, and one gesture must move one slide.
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

    // Same amount again, but long after. On its own it is still under the threshold,
    // so it must not tip the pager over by summing with the old travel.
    const later = burst([WHEEL_STEP_PX - 1], {
      from: stalled.state,
      at: stalled.state.lastAt + WHEEL_GESTURE_GAP_MS + 1,
    });
    expect(later.steps).toEqual([]);
  });
});

describe('readWheel consumption', () => {
  // The listeners cover the whole walkthrough region, so preventing the default on
  // every wheel event there would swallow scrolling the page as well.
  it('does not claim vertical travel that has not yet turned a page', () => {
    const { consumed } = readWheel(IDLE_WHEEL_PAGER, { deltaX: 0, deltaY: 4 }, 1000);
    expect(consumed).toBe(false);
  });

  it('claims the event that turns a page', () => {
    const { consumed } = readWheel(IDLE_WHEEL_PAGER, { deltaX: 0, deltaY: WHEEL_STEP_PX }, 1000);
    expect(consumed).toBe(true);
  });

  it('claims the rest of a gesture it has already paged on', () => {
    const turned = readWheel(IDLE_WHEEL_PAGER, { deltaX: 0, deltaY: WHEEL_STEP_PX }, 1000);
    const tail = readWheel(turned.state, { deltaX: 0, deltaY: 30 }, 1016);
    expect(tail.step).toBe(0);
    expect(tail.consumed).toBe(true);
  });

  it('claims a sideways swipe from its first event, so the browser cannot go back', () => {
    const { step, consumed } = readWheel(IDLE_WHEEL_PAGER, { deltaX: 5, deltaY: 1 }, 1000);
    expect(step).toBe(0);
    expect(consumed).toBe(true);
  });

  it('lets a settled wheel go once the gesture has lapsed', () => {
    const turned = readWheel(IDLE_WHEEL_PAGER, { deltaX: 0, deltaY: WHEEL_STEP_PX }, 1000);
    const later = readWheel(turned.state, { deltaX: 0, deltaY: 4 }, 1000 + WHEEL_GESTURE_GAP_MS + 1);
    expect(later.consumed).toBe(false);
  });
});

describe('stepFromKey', () => {
  it('pages forwards and back on the arrow keys', () => {
    expect(stepFromKey('ArrowRight')).toBe(1);
    expect(stepFromKey('ArrowLeft')).toBe(-1);
  });

  it('leaves every other key alone', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'Escape', 'Tab', 'a']) {
      expect(stepFromKey(key)).toBe(0);
    }
  });
});
