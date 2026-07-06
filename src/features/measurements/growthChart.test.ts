import { describe, expect, it } from 'vitest';

import { changeSince, seriesFor, yTicksFor } from './growthChart';
import type { Measurement } from '@/types/models';

const DAY = 86400000;
const base = new Date(2026, 0, 1).getTime();
const m = (kind: Measurement['kind'], value: number, dayOffset: number): Measurement => ({
  id: `${kind}-${dayOffset}`,
  childId: 'c1',
  kind,
  value,
  date: base + dayOffset * DAY,
});

describe('seriesFor', () => {
  it('filters by kind and sorts ascending by date', () => {
    const data = [m('weight', 7.0, 30), m('height', 60, 10), m('weight', 6.5, 15), m('weight', 5.0, 1)];
    const s = seriesFor(data, 'weight');
    expect(s.map((p) => p.value)).toEqual([5.0, 6.5, 7.0]);
    expect(s.map((p) => p.t)).toEqual([base + DAY, base + 15 * DAY, base + 30 * DAY]);
  });

  it('returns an empty array when no measurement matches the kind', () => {
    expect(seriesFor([m('weight', 5, 1)], 'bmi')).toEqual([]);
  });
});

describe('yTicksFor', () => {
  it('produces ascending ticks that span the data', () => {
    const { ticks } = yTicksFor([{ t: 1, value: 3.4 }, { t: 2, value: 7.2 }]);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBeLessThanOrEqual(3.4);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(7.2);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });

  it('does not divide by zero for a flat series', () => {
    const { ticks } = yTicksFor([{ t: 1, value: 5 }, { t: 2, value: 5 }]);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBeLessThan(5);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(5);
    expect(ticks.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('formats ticks from a coarse (integer-step) axis with no decimals', () => {
    const { fmtY } = yTicksFor([{ t: 1, value: 3 }, { t: 2, value: 8 }]);
    expect(fmtY(3)).toBe('3');
    expect(fmtY(8)).toBe('8');
  });

  it('formats ticks from a tight axis with distinct labels (regression: close readings)', () => {
    const { ticks, fmtY } = yTicksFor([{ t: 1, value: 5.2 }, { t: 2, value: 5.23 }]);
    expect(new Set(ticks.map(fmtY)).size).toBe(ticks.length);
    expect(fmtY(5.2)).not.toBe(fmtY(5.21));
  });

  it('returns finite, strictly ascending ticks bracketing a single point', () => {
    const { ticks } = yTicksFor([{ t: 1, value: 7 }]);
    expect(ticks[0]).toBeLessThan(7);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(7);
    expect(ticks.every((v) => Number.isFinite(v))).toBe(true);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });
});

describe('changeSince', () => {
  it('returns last minus previous with the previous date', () => {
    const r = changeSince([{ t: 10, value: 6.5 }, { t: 20, value: 7.0 }])!;
    expect(r.delta).toBeCloseTo(0.5, 6);
    expect(r.sinceT).toBe(10);
  });

  it('returns null for fewer than two points', () => {
    expect(changeSince([])).toBeNull();
    expect(changeSince([{ t: 1, value: 5 }])).toBeNull();
  });
});
