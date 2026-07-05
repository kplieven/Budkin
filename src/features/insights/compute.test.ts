import { describe, expect, it } from 'vitest';
import { buildSleepHeatmap, noonWindowStart } from './compute';
import type { Entry } from '@/types/models';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const sleep = (start: number, end: number, nap: boolean): Entry => ({
  id: `s-${start}`, childId: 'c1', type: 'sleep', start, end, nap, tags: [],
});

describe('buildSleepHeatmap', () => {
  const now = at(2026, 6, 5, 15); // 5 Jul 2026, 3pm

  it('places a night sleep as one contiguous segment in today\'s row', () => {
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false)], now);
    const today = rows[rows.length - 1];
    expect(today.offsetFromToday).toBe(0);
    expect(today.segments).toHaveLength(1);
    // 8pm = 8h after noon → 0.333; 6am next = 18h after noon → 0.75
    expect(today.segments[0].x0).toBeCloseTo(8 / 24, 3);
    expect(today.segments[0].x1).toBeCloseTo(18 / 24, 3);
    expect(today.segments[0].nap).toBe(false);
  });

  it('marks a daytime nap with nap=true at the right x', () => {
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 5, 13), at(2026, 6, 5, 14), true)], now);
    const seg = rows[rows.length - 1].segments[0];
    expect(seg.nap).toBe(true);
    expect(seg.x0).toBeCloseTo(1 / 24, 3); // 1pm = 1h after noon
  });

  it('splits a sleep that crosses noon across two rows', () => {
    // 11am–1pm on 4 Jul crosses the noon seam → yesterday-row tail + today-row head
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 4, 11), at(2026, 6, 4, 13), true)], now);
    const withSegs = rows.filter((r) => r.segments.length > 0);
    expect(withSegs).toHaveLength(2);
  });

  it('returns only rows up to the oldest data day (no phantom padding)', () => {
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 3, 20), at(2026, 6, 4, 6), false)], now);
    expect(rows.length).toBeLessThanOrEqual(2); // data only ~1–2 days back
  });
});

it('noonWindowStart bins a pre-noon time into the previous noon', () => {
  const w = noonWindowStart(at(2026, 6, 5, 3)); // 3am 5 Jul → noon 4 Jul
  expect(new Date(w).getDate()).toBe(4);
});
