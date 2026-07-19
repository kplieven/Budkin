import { describe, expect, it, vi } from 'vitest';

import { detailFor } from '@/features/activity/detail';
import type { Entry, FeedMethod, FeedType } from '@/types/models';

// `detailFor` reads only the units preference off the store, non-reactively.
// Mock that single read rather than standing up the whole store harness.
// Both `vi.hoisted` and `vi.mock` are lifted above the imports above.
const h = vi.hoisted(() => ({ unitSystem: 'metric' as 'metric' | 'imperial' }));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: { getState: () => ({ unitSystem: h.unitSystem }) },
}));

const NOW = 1_700_000_000_000;

const feed = (feedType: FeedType, method: FeedMethod, amount: number | null): Entry => ({
  id: 'f1',
  childId: 'c1',
  tags: [],
  type: 'feeding',
  start: NOW,
  end: NOW + 12 * 60000,
  feedType,
  method,
  amount,
});

describe('detailFor: feeding amount is dual-purpose', () => {
  it('converts and labels a bottle volume', () => {
    h.unitSystem = 'metric';
    expect(detailFor(feed('formula', 'bottle', 90))).toContain('90 ml');

    h.unitSystem = 'imperial';
    expect(detailFor(feed('formula', 'bottle', 90))).toContain('3 fl oz');
  });

  it('converts a breast feed given by bottle (expressed milk is still a volume)', () => {
    h.unitSystem = 'imperial';
    expect(detailFor(feed('breast', 'bottle', 90))).toContain('3 fl oz');
  });

  it('leaves a breast feed at the breast as a bare intake score', () => {
    // `amount` here is the subjective 1 to 10 intake scale, not millilitres.
    // Converting it would render an intake of 5 as "0.2 fl oz".
    for (const method of ['left', 'right', 'both'] as FeedMethod[]) {
      h.unitSystem = 'imperial';
      const imperial = detailFor(feed('breast', method, 5));
      expect(imperial).not.toContain('fl oz');
      expect(imperial).not.toContain('ml');
      expect(imperial).not.toContain('0.2');
      expect(imperial.split(' · ')).toContain('5');

      // and the same score, unchanged, on the metric lens
      h.unitSystem = 'metric';
      expect(detailFor(feed('breast', method, 5))).toBe(imperial);
    }
  });

  it('omits the amount entirely when there is none', () => {
    h.unitSystem = 'imperial';
    expect(detailFor(feed('breast', 'left', null))).toBe('Breast milk · left breast · 12 min');
  });
});
