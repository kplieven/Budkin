import { describe, expect, it } from 'vitest';

import { changeSince, seriesFor, xDomainFor, xTicksFor, yTicksFor } from './growthChart';
import { MONTH_MS } from './whoReference';
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

  it('widens the axis to include extra values', () => {
    const pts = [{ t: 1, value: 5 }, { t: 2, value: 6 }];
    const base = yTicksFor(pts);
    const wide = yTicksFor(pts, [0.5, 30]);
    expect(Math.max(...wide.ticks)).toBeGreaterThanOrEqual(30);
    expect(Math.min(...wide.ticks)).toBeLessThanOrEqual(0.5);
    // No extra values -> identical to the single-arg call.
    expect(yTicksFor(pts, []).ticks).toEqual(base.ticks);
  });
});

describe('xTicksFor', () => {
  it('returns an empty ticks array for no points', () => {
    const { ticks } = xTicksFor([], 5);
    expect(ticks).toEqual([]);
  });

  it('returns a single tick at that point for one point', () => {
    const t = base + 10 * DAY;
    const { ticks } = xTicksFor([{ t, value: 1 }], 5);
    expect(ticks).toEqual([t]);
  });

  it('produces strictly ascending ticks all within the domain for a multi-month span', () => {
    const points = [{ t: base, value: 1 }, { t: base + 150 * DAY, value: 2 }];
    const { ticks } = xTicksFor(points, 6);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(base);
      expect(tick).toBeLessThanOrEqual(base + 150 * DAY);
    }
  });

  it('respects the tick budget for a large span', () => {
    const points = [{ t: base, value: 1 }, { t: base + 900 * DAY, value: 2 }];
    const { ticks } = xTicksFor(points, 5);
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it('yields more ticks with a larger budget for the same span', () => {
    const points = [{ t: base, value: 1 }, { t: base + 150 * DAY, value: 2 }];
    const sparse = xTicksFor(points, 2).ticks;
    const dense = xTicksFor(points, 8).ticks;
    expect(dense.length).toBeGreaterThanOrEqual(sparse.length);
    expect(dense.length).toBeGreaterThanOrEqual(2);
  });

  it('formats a short span with a month + digit-day', () => {
    const points = [{ t: base, value: 1 }, { t: base + 10 * DAY, value: 2 }];
    const { fmtX } = xTicksFor(points, 5);
    const label = fmtX(base);
    expect(label).toMatch(/\d/);
    expect(label).toMatch(/[A-Za-z]/);
  });

  it('never repeats a label across the ticks of a 3-month span', () => {
    // 14-day ticks over 90 days used to be labelled by month alone: "Jun Jun Jul Jul Aug".
    const points = [{ t: base, value: 1 }, { t: base + 89 * DAY, value: 2 }];
    const { ticks, fmtX } = xTicksFor(points, 7);
    const labels = ticks.map(fmtX);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps month labels distinct when month-stepped ticks cross a year', () => {
    const points = [{ t: base, value: 1 }, { t: base + 900 * DAY, value: 2 }];
    const { ticks, fmtX } = xTicksFor(points, 6);
    const labels = ticks.map(fmtX);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('formats a long span (multi-year) as a 4-digit year', () => {
    const points = [{ t: base, value: 1 }, { t: base + 1100 * DAY, value: 2 }];
    const { fmtX } = xTicksFor(points, 5);
    expect(fmtX(base)).toMatch(/^\d{4}$/);
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

describe('xDomainFor', () => {
  const tMin = base;
  const tMax = base + 60 * DAY;

  it('stretches the domain to now when the last measurement is in the past', () => {
    const now = tMax + 20 * DAY;
    expect(xDomainFor({ tMin, tMax, now, reference: null })).toEqual({ xMax: now, refXMax: tMax });
  });

  it('ends at the last measurement when now is not past it', () => {
    const now = tMax - 5 * DAY;
    expect(xDomainFor({ tMin, tMax, now, reference: null })).toEqual({ xMax: tMax, refXMax: tMax });
  });

  it('leaves the reference span at the last measurement when the reference is off', () => {
    const r = xDomainFor({ tMin, tMax, now: tMax + 400 * DAY, reference: null });
    expect(r.refXMax).toBe(tMax);
  });

  it('extends the reference by its headroom when that reaches past now', () => {
    const now = tMax + DAY;
    const r = xDomainFor({ tMin, tMax, now, reference: { birth: base - 30 * DAY, headroom: 1 } });
    expect(r.refXMax).toBe(tMax + (tMax - tMin)); // headroom wins over now
    expect(r.xMax).toBe(r.refXMax);
  });

  it('stretches the reference to reach now when now is past the headroom', () => {
    const now = tMax + 300 * DAY;
    const r = xDomainFor({ tMin, tMax, now, reference: { birth: base - 30 * DAY, headroom: 1 } });
    expect(r.refXMax).toBe(now);
    expect(r.xMax).toBe(now);
  });

  it('caps the reference at 60 months of age but still plots out to now', () => {
    const birth = base - 30 * DAY;
    const cap = birth + 60 * MONTH_MS;
    const now = cap + 200 * DAY;
    const r = xDomainFor({ tMin, tMax, now, reference: { birth, headroom: 1 } });
    expect(r.refXMax).toBe(cap);
    expect(r.xMax).toBe(now);
  });

  it('never pulls the reference back before the last measurement', () => {
    const birth = base - 80 * MONTH_MS; // already past the 60-month cap
    const r = xDomainFor({ tMin, tMax, now: tMax, reference: { birth, headroom: 1 } });
    expect(r.refXMax).toBe(tMax);
    expect(r.xMax).toBe(tMax);
  });
});
