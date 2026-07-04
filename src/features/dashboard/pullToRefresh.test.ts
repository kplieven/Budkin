import { describe, expect, it } from 'vitest';

import {
  PULL_MAX_PX,
  PULL_TRIGGER_PX,
  pullOffset,
  shouldTrigger,
} from '@/features/dashboard/pullToRefresh';

describe('pullOffset', () => {
  it('is 0 for non-positive travel (upward drag / no drag)', () => {
    expect(pullOffset(0)).toBe(0);
    expect(pullOffset(-40)).toBe(0);
  });

  it('applies resistance to the finger travel', () => {
    expect(pullOffset(100)).toBe(50); // 100 * 0.5
  });

  it('clamps at the maximum', () => {
    expect(pullOffset(10_000)).toBe(PULL_MAX_PX);
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

  it('the trigger point is reachable before the indicator maxes out', () => {
    expect(PULL_TRIGGER_PX).toBeLessThanOrEqual(PULL_MAX_PX);
  });
});
