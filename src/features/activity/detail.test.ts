import { describe, expect, it, vi } from 'vitest';

import { detailFor } from '@/features/activity/detail';
import type { Entry, FeedMethod, FeedType, Timer } from '@/types/models';

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

describe('detailFor: medication', () => {
  const med = (over: Partial<Extract<Entry, { type: 'medication' }>> = {}): Entry => ({
    id: 'md1',
    childId: 'c1',
    tags: [],
    type: 'medication',
    time: NOW,
    name: 'Paracetamol',
    ...over,
  });

  it('joins name, amount + free-text unit, and notes', () => {
    expect(detailFor(med({ dosage: 5, dosageUnit: 'mL', notes: 'for the fever' }))).toBe('Paracetamol · 5 mL · for the fever');
  });

  it('shows just the name when there is no amount', () => {
    expect(detailFor(med())).toBe('Paracetamol');
  });

  it('shows a bare amount when the unit is missing', () => {
    expect(detailFor(med({ dosage: 400 }))).toBe('Paracetamol · 400');
  });

  it('never routes the unit through the units converter (free text, verbatim)', () => {
    // A 5 mL dose must read "5 mL", never a converted "0.2 fl oz".
    h.unitSystem = 'imperial';
    expect(detailFor(med({ dosage: 5, dosageUnit: 'mL' }))).toBe('Paracetamol · 5 mL');
  });
});

const timer = (over: Partial<Timer> = {}): Timer => ({
  id: 't1',
  childId: 'c1',
  activity: 'sleep',
  saveAs: 'sleep',
  name: 'Sleep',
  start: NOW - 40 * 60000,
  ...over,
});

describe('detailFor: a running timer', () => {
  it('never quotes a duration, because the timer has no end yet', () => {
    h.unitSystem = 'metric';
    for (const saveAs of ['feeding', 'sleep', 'pumping', 'tummy'] as const) {
      expect(detailFor(timer({ saveAs }))).not.toContain('min');
    }
  });

  it('reads a sleep timer the way an ongoing sleep entry reads', () => {
    h.unitSystem = 'metric';
    expect(detailFor(timer({ saveAs: 'sleep', nap: true }))).toBe('Nap · ongoing');
    expect(detailFor(timer({ saveAs: 'sleep', nap: false }))).toBe('Night · ongoing');
  });

  it('does not guess Nap or Night before the user has said which', () => {
    // `nap` is only set once the running timer is edited, and calling an
    // unedited night feed "Nap" would be a fabrication.
    expect(detailFor(timer({ saveAs: 'sleep' }))).toBe('ongoing');
  });

  it('carries the feeding settings the timer was given', () => {
    h.unitSystem = 'metric';
    expect(detailFor(timer({ saveAs: 'feeding', feedType: 'formula', method: 'bottle', amount: 90 }))).toBe(
      'Formula · bottle · 90 ml',
    );
  });

  it('words a breast feed timer amount as an intake level, not a volume', () => {
    h.unitSystem = 'imperial';
    const d = detailFor(timer({ saveAs: 'feeding', feedType: 'breast', method: 'left', amount: 2 }));
    expect(d).not.toContain('fl oz');
    expect(d.split(' · ')).toContain('Some');
  });

  it('says nothing at all for a timer carrying no settings', () => {
    expect(detailFor(timer({ saveAs: 'feeding' }))).toBe('');
  });

  it('converts a pumping timer amount and shows a tummy milestone', () => {
    h.unitSystem = 'imperial';
    expect(detailFor(timer({ saveAs: 'pumping', amount: 90 }))).toBe('3 fl oz');
    expect(detailFor(timer({ saveAs: 'tummy', milestone: 'Rolled over' }))).toBe('Rolled over');
  });

  it('appends the note the user typed on the running timer', () => {
    expect(detailFor(timer({ saveAs: 'tummy', notes: 'on the mat' }))).toBe('on the mat');
    expect(detailFor(timer({ saveAs: 'sleep', nap: true, notes: 'pram' }))).toBe('Nap · ongoing · pram');
  });
});
