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

  it('names a breast feed at the breast by its intake level', () => {
    // `amount` here is the intake level, not millilitres. Formatting it as a
    // measurement would render a level 2 as "0.1 fl oz".
    for (const method of ['left', 'right', 'both'] as FeedMethod[]) {
      h.unitSystem = 'imperial';
      const imperial = detailFor(feed('breast', method, 2));
      expect(imperial).not.toContain('fl oz');
      expect(imperial).not.toContain('ml');
      expect(imperial.split(' · ')).toContain('Some');

      // and the same level, unchanged, on the metric lens
      h.unitSystem = 'metric';
      expect(detailFor(feed('breast', method, 2))).toBe(imperial);
    }
  });

  it('words all three intake levels', () => {
    h.unitSystem = 'metric';
    expect(detailFor(feed('breast', 'left', 1)).split(' · ')).toContain('A little');
    expect(detailFor(feed('breast', 'left', 2)).split(' · ')).toContain('Some');
    expect(detailFor(feed('breast', 'left', 3)).split(' · ')).toContain('A lot');
  });

  it('still words an entry left on the old 1 to 10 scale', () => {
    // Local-only history was never migrated, so a wider score can still show up
    // here. It must name a level rather than render a bare number or blank, and
    // a score above 3 (which can only be legacy) reads by thirds.
    h.unitSystem = 'metric';
    expect(detailFor(feed('breast', 'left', 5)).split(' · ')).toContain('Some');
    expect(detailFor(feed('breast', 'left', 7)).split(' · ')).toContain('Some');
    expect(detailFor(feed('breast', 'left', 10)).split(' · ')).toContain('A lot');
  });

  it('omits the amount entirely when there is none', () => {
    h.unitSystem = 'imperial';
    expect(detailFor(feed('breast', 'left', null))).toBe('Breast milk · left breast · 12 min');
  });
});
