import { describe, expect, it } from 'vitest';
import { buildSleepHeatmap, noonWindowStart } from './compute';
import type { Entry } from '@/types/models';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const sleep = (start: number, end: number, nap: boolean): Entry => ({
  id: `s-${start}`, childId: 'c1', type: 'sleep', start, end, nap, tags: [],
});

describe('buildSleepHeatmap', () => {
  const now = at(2026, 6, 5, 15); // 5 Jul 2026, 3pm

  it('places last night’s sleep in the current window when checked in the morning', () => {
    const morning = at(2026, 6, 5, 10); // before noon → the night’s window is still the current one
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false)], morning);
    const today = rows[rows.length - 1];
    expect(today.offsetFromToday).toBe(0);
    expect(today.segments).toHaveLength(1);
    // 8pm = 8h after noon → 0.333; 6am next = 18h after noon → 0.75
    expect(today.segments[0].x0).toBeCloseTo(8 / 24, 3);
    expect(today.segments[0].x1).toBeCloseTo(18 / 24, 3);
    expect(today.segments[0].nap).toBe(false);
  });

  it('after noon, last night moves up a row and Today is the fresh (empty) window', () => {
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false)], now); // 3pm
    expect(rows[rows.length - 1].offsetFromToday).toBe(0);
    expect(rows[rows.length - 1].segments).toHaveLength(0);
    expect(rows[rows.length - 2].offsetFromToday).toBe(1);
    expect(rows[rows.length - 2].segments).toHaveLength(1);
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

  it('spans oldest data → today inclusive, with no rows older than the data', () => {
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 3, 20), at(2026, 6, 4, 6), false)], now); // 3pm Jul 5
    expect(rows).toHaveLength(3); // offsets 2,1,0 — nothing older than the data
    expect(rows[0].segments).toHaveLength(1);
    expect(rows[2].segments).toHaveLength(0); // today-so-far, still empty
  });

  it('returns [] when no sleep falls inside the window', () => {
    expect(buildSleepHeatmap([], now)).toEqual([]);
  });
});

it('noonWindowStart bins a pre-noon time into the previous noon', () => {
  const w = noonWindowStart(at(2026, 6, 5, 3)); // 3am 5 Jul → noon 4 Jul
  expect(new Date(w).getDate()).toBe(4);
});
