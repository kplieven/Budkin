import { describe, expect, it } from 'vitest';
import type { Entry } from '@/types/models';
import { detectSafetyFlags } from './safety';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const midnight = (d: number) => at(2026, 6, d, 0);
const now = at(2026, 6, 20, 15); // 20 Jul 2026, 3pm

const feeding = (t: number): Entry => ({
  id: `f-${t}`, childId: 'c1', type: 'feeding', start: t, end: t + 900000,
  feedType: 'breast', method: 'left', amount: null, tags: [],
});
const diaper = (t: number, wet: boolean): Entry => ({
  id: `d-${t}`, childId: 'c1', type: 'diaper', time: t, wet, solid: false, color: null, tags: [],
});

/** A well-logged day: `feeds` feeds and `wet` wet nappies spread through 6am–8pm. */
function makeDay(dayIdx: number, feeds: number, wet: number): Entry[] {
  const base = midnight(dayIdx) + 6 * 3600000;
  const es: Entry[] = [];
  for (let i = 0; i < feeds; i++) es.push(feeding(base + i * 45 * 60000));
  for (let i = 0; i < wet; i++) es.push(diaper(base + 1800000 + i * 55 * 60000, true));
  return es;
}

const born = (days: number) => now - days * 86400000; // birth ms for a baby `days` old

describe('detectSafetyFlags', () => {
  it('flags wet nappies below the floor for a current run of >= 2 days', () => {
    const entries = [
      ...makeDay(16, 9, 7), ...makeDay(17, 9, 7), ...makeDay(18, 9, 7),
      ...makeDay(19, 9, 4), ...makeDay(20, 9, 4), // last two days below 6 wet
    ];
    const flags = detectSafetyFlags(entries, born(30), now);
    expect(flags).toEqual([{ kind: 'wetLow', days: 2, floor: 6, latest: 4 }]);
  });

  it('flags too few feeds for a newborn (after the first week)', () => {
    const entries = [
      ...makeDay(16, 9, 7), ...makeDay(17, 9, 7),
      ...makeDay(18, 4, 7), ...makeDay(19, 4, 7), ...makeDay(20, 4, 7), // three low-feed days
    ];
    const flags = detectSafetyFlags(entries, born(30), now);
    expect(flags).toEqual([{ kind: 'feedsLow', days: 3, floor: 6, latest: 4 }]);
  });

  it('does not flag a single below-floor day', () => {
    const entries = [
      ...makeDay(16, 9, 7), ...makeDay(17, 9, 7), ...makeDay(18, 9, 7),
      ...makeDay(19, 9, 7), ...makeDay(20, 9, 4), // only the last day is low
    ];
    expect(detectSafetyFlags(entries, born(30), now)).toEqual([]);
  });

  it('does not nag about a dip that already recovered', () => {
    const entries = [
      ...makeDay(16, 9, 4), ...makeDay(17, 9, 4), // low, but earlier
      ...makeDay(18, 9, 7), ...makeDay(19, 9, 7), ...makeDay(20, 9, 7), // back to normal since
    ];
    expect(detectSafetyFlags(entries, born(30), now)).toEqual([]);
  });

  it('skips an under-logged day instead of reading it as a real low count', () => {
    const entries = [
      ...makeDay(16, 9, 7), ...makeDay(17, 9, 7), ...makeDay(18, 9, 7), ...makeDay(19, 9, 7),
      feeding(midnight(20) + 8 * 3600000), // Jul 20: a single entry, clearly under-logged
    ];
    // Without the guard, Jul 20 (0 wet) would look like a below-floor day; it must
    // be ignored, leaving the latest trustworthy day (Jul 19) normal → no flag.
    expect(detectSafetyFlags(entries, born(30), now)).toEqual([]);
  });

  it('returns nothing with too little reliably-logged history', () => {
    const entries = [...makeDay(19, 9, 4), ...makeDay(20, 9, 4)]; // only 2 days
    expect(detectSafetyFlags(entries, born(30), now)).toEqual([]);
  });

  it('suppresses the feed flag past the newborn window but still flags wet', () => {
    const entries = [
      ...makeDay(16, 9, 7), ...makeDay(17, 9, 7),
      ...makeDay(18, 4, 4), ...makeDay(19, 4, 4), ...makeDay(20, 4, 4), // low feeds AND low wet
    ];
    const flags = detectSafetyFlags(entries, born(200), now); // ~6.5 months → feed gate closed
    expect(flags).toEqual([{ kind: 'wetLow', days: 3, floor: 6, latest: 4 }]);
  });
});
