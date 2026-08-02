import { describe, expect, it } from 'vitest';

import { ALL_ACTIVITIES, DIAPER_LEVELS, INTAKE_LEVELS, allowsMultipleChildren, feedAmountIsVolume, intakeLevelLabel, type LevelSet } from '@/lib/activities';
import type { ActivityType } from '@/types/models';

describe('feedAmountIsVolume partitions the dual-purpose amount', () => {
  it('is a volume for anything but a feed taken at the breast', () => {
    expect(feedAmountIsVolume('formula', 'bottle')).toBe(true);
    expect(feedAmountIsVolume('fortified', 'bottle')).toBe(true);
    expect(feedAmountIsVolume('solid', 'parent')).toBe(true);
    expect(feedAmountIsVolume('breast', 'bottle')).toBe(true); // expressed milk
  });

  it('is a level at the breast', () => {
    for (const m of ['left', 'right', 'both'] as const) expect(feedAmountIsVolume('breast', m)).toBe(false);
  });
});

describe('allowsMultipleChildren gates the "log for both" affordance', () => {
  it('allows the routines siblings genuinely share', () => {
    for (const type of ['feeding', 'sleep', 'diaper', 'bath', 'tummy'] as const) {
      expect(allowsMultipleChildren(type)).toBe(true);
    }
  });

  it('refuses pumping, so duplicating a session cannot double-count the milk', () => {
    // Pumping is parent-side: one session produces one volume, and copying it
    // onto each child inflates every aggregate built on it.
    expect(allowsMultipleChildren('pumping')).toBe(false);
  });

  it('refuses measurements and one-off records', () => {
    // One thermometer reading cannot belong to two children, and a dose, a note
    // or a milestone is about one of them by construction.
    for (const type of ['temperature', 'medication', 'note', 'milestone'] as const) {
      expect(allowsMultipleChildren(type)).toBe(false);
    }
  });

  it('is an allow-list, so a newly added activity is never silently included', () => {
    const known: ActivityType[] = [...ALL_ACTIVITIES, 'note', 'milestone'];
    expect(known.filter(allowsMultipleChildren)).toEqual(['feeding', 'sleep', 'diaper', 'tummy', 'bath']);
  });
});

describe('three-level scales', () => {
  const sets: [string, LevelSet][] = [
    ['diaper', DIAPER_LEVELS],
    ['intake', INTAKE_LEVELS],
  ];

  for (const [name, set] of sets) {
    it(`${name} has three labels`, () => {
      expect(set.labels).toHaveLength(3);
    });

    // The invariant every bucket has to hold: what the scale writes, it reads
    // back. Without it a level saved today would light up a different button
    // tomorrow, and the label shown for it would be wrong.
    it(`${name} buckets its own levels to themselves`, () => {
      expect([1, 2, 3].map(set.bucket)).toEqual([1, 2, 3]);
    });

    it(`${name} lands any finite number on a real level`, () => {
      for (const v of [-99, 0, 0.5, 1.5, 2.5, 4, 7, 10, 1e6]) expect([1, 2, 3]).toContain(set.bucket(v));
    });
  }

  it('diaper keeps its original wording and bucketing', () => {
    expect(DIAPER_LEVELS.labels).toEqual(['Small', 'Medium', 'Large']);
    expect([0, 1].map(DIAPER_LEVELS.bucket)).toEqual([1, 1]);
    expect(DIAPER_LEVELS.bucket(2)).toBe(2);
    expect([3, 4, 10].map(DIAPER_LEVELS.bucket)).toEqual([3, 3, 3]);
  });

  it('intake words the levels', () => {
    expect(INTAKE_LEVELS.labels).toEqual(['A little', 'Some', 'A lot']);
    expect([1, 2, 3].map(intakeLevelLabel)).toEqual(['A little', 'Some', 'A lot']);
  });

  it('intake reads a legacy score above 3 by thirds, since it cannot be a level', () => {
    // Nothing writes above 3 any more, so 4 and up can only be an old 1-to-10
    // score and gets the same reading the wire format gives one.
    for (const score of [4, 5, 6, 7]) expect(intakeLevelLabel(score)).toBe('Some');
    for (const score of [8, 9, 10]) expect(intakeLevelLabel(score)).toBe('A lot');
  });

  it('intake is deliberately non-monotonic across the 3/4 boundary', () => {
    // The seam between the two ranges, pinned so it cannot be "tidied" into a
    // monotonic bucket: that would either mangle today's levels or misread
    // every old score. 3 is the top LEVEL, 4 is a mid old SCORE.
    expect(intakeLevelLabel(3)).toBe('A lot');
    expect(intakeLevelLabel(4)).toBe('Some');
    expect(INTAKE_LEVELS.bucket(3)).toBe(3);
    expect(INTAKE_LEVELS.bucket(4)).toBe(2);
  });

  it('intake keeps the residual ambiguity to old scores of 2 and 3', () => {
    // A stored 2 or 3 is both a valid level and a valid old score, so it reads
    // as today's level. Every other old score reads the same either way, which
    // is what keeps the two directions of sync agreeing.
    const byThirds = (v: number) => (v <= 3 ? 1 : v <= 7 ? 2 : 3);
    const disagrees = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((v) => INTAKE_LEVELS.bucket(v) !== byThirds(v));
    expect(disagrees).toEqual([2, 3]);
  });
});
