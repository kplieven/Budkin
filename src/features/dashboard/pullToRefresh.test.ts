import { describe, expect, it } from 'vitest';

import {
  PULL_MAX_PX,
  PULL_OVERSCROLL_PX,
  PULL_TRIGGER_PX,
  pullOffset,
  shouldTrigger,
} from '@/features/dashboard/pullToRefresh';

describe('pullOffset', () => {
  it('is 0 for non-positive travel (upward drag / no drag)', () => {
    expect(pullOffset(0)).toBe(0);
    expect(pullOffset(-40)).toBe(0);
  });

  it('applies resistance in the linear region', () => {
    expect(pullOffset(100)).toBe(50); // 100 * 0.5, below the soft ceiling
  });

  it('reaches the soft ceiling exactly at its resisted travel', () => {
    expect(pullOffset(PULL_MAX_PX / 0.5)).toBeCloseTo(PULL_MAX_PX);
  });

  it('rubber-bands past the ceiling toward the asymptote', () => {
    const asymptote = PULL_MAX_PX + PULL_OVERSCROLL_PX;
    const pulled = pullOffset(1000); // a big but physically realistic drag
    expect(pulled).toBeGreaterThan(PULL_MAX_PX);
    expect(pulled).toBeLessThan(asymptote);
    // even an extreme drag is bounded by the asymptote
    expect(pullOffset(1_000_000)).toBeLessThanOrEqual(asymptote);
  });

  it('is monotonically increasing through the overscroll region', () => {
    expect(pullOffset(400)).toBeGreaterThan(pullOffset(300));
    expect(pullOffset(300)).toBeGreaterThan(pullOffset(260));
  });
});

describe('shouldTrigger', () => {
  it('is false below the trigger threshold', () => {
    expect(shouldTrigger(PULL_TRIGGER_PX - 1)).toBe(false);
  });

  it('is true at or above the trigger threshold', () => {
    expect(shouldTrigger(PULL_TRIGGER_PX)).toBe(true);
    expect(shouldTrigger(PULL_MAX_PX)).toBe(true);
  });

  it('the trigger point is reachable before the soft ceiling', () => {
    expect(PULL_TRIGGER_PX).toBeLessThanOrEqual(PULL_MAX_PX);
  });
});
