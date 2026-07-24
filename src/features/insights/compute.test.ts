import { describe, expect, it } from 'vitest';
import { buildDiaperSeries, buildSleepHeatmap, buildTrend, noonWindowStart, windowStart } from './compute';
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

it('windowStart anchors the 24h window at the given origin hour', () => {
  // origin 19 (7pm): 3pm is before 7pm → previous day's 7pm
  const before = windowStart(at(2026, 6, 5, 15), 19);
  expect(new Date(before).getDate()).toBe(4);
  expect(new Date(before).getHours()).toBe(19);
  // 8pm is after 7pm → same day's 7pm
  const after = windowStart(at(2026, 6, 5, 20), 19);
  expect(new Date(after).getDate()).toBe(5);
  // origin 12 matches noonWindowStart
  expect(windowStart(at(2026, 6, 5, 3), 12)).toBe(noonWindowStart(at(2026, 6, 5, 3)));
});

const feeding = (start: number): Entry => ({
  id: `f-${start}`, childId: 'c1', type: 'feeding', start, end: start + 900000,
  feedType: 'breast', method: 'left', amount: null, tags: [],
});

describe('buildTrend', () => {
  const now = at(2026, 6, 5, 15);

  it('totalSleep sums a night\'s sleep into one noon-to-noon point (hours)', () => {
    const pts = buildTrend(
      [sleep(at(2026, 6, 4, 20), at(2026, 6, 4, 23), false), sleep(at(2026, 6, 5, 1), at(2026, 6, 5, 6), false)],
      'totalSleep', now, 30,
    );
    expect(pts).toHaveLength(1);
    expect(pts[0].value).toBeCloseTo(8, 1); // 3h + 5h in the same night window
  });

  it('longestStretch reports the single longest sleep of the night (hours)', () => {
    const pts = buildTrend(
      [sleep(at(2026, 6, 4, 20), at(2026, 6, 4, 22), false), sleep(at(2026, 6, 5, 0), at(2026, 6, 5, 6), false)],
      'longestStretch', now, 30,
    );
    expect(pts[0].value).toBeCloseTo(6, 1);
  });

  it('feedsPerDay counts feedings within a calendar day', () => {
    const day = at(2026, 6, 5, 8);
    const pts = buildTrend([feeding(day), feeding(day + 3600000), feeding(day + 7200000)], 'feedsPerDay', now, 30);
    expect(pts[0].value).toBe(3);
  });

  it('feedInterval averages gaps between consecutive feeds (hours)', () => {
    const day = at(2026, 6, 5, 8);
    const pts = buildTrend([feeding(day), feeding(day + 2 * 3600000), feeding(day + 4 * 3600000)], 'feedInterval', now, 30);
    expect(pts[0].value).toBeCloseTo(2, 2);
  });

  it('omits entries older than the range', () => {
    const pts = buildTrend([feeding(at(2026, 5, 1, 8))], 'feedsPerDay', now, 14);
    expect(pts).toHaveLength(0);
  });

  it('wakeWindow averages awake gaps between sleeps in a night window (minutes)', () => {
    const pts = buildTrend(
      [
        sleep(at(2026, 6, 4, 20), at(2026, 6, 4, 22), false),
        sleep(at(2026, 6, 4, 23), at(2026, 6, 5, 1), false),
        sleep(at(2026, 6, 5, 2, 30), at(2026, 6, 5, 6), false),
      ],
      'wakeWindow', now, 30,
    );
    expect(pts).toHaveLength(1);
    expect(pts[0].value).toBeCloseTo(75, 1); // gaps of 60m and 90m → avg 75m
  });

  it('wakeWindow ignores gaps ≥6h and omits windows with no valid gap', () => {
    // single sleep → no gaps → window omitted
    expect(buildTrend([sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false)], 'wakeWindow', now, 30)).toHaveLength(0);
    // two sleeps 8h apart → gap filtered as an outlier → window omitted
    expect(
      buildTrend(
        [sleep(at(2026, 6, 3, 13), at(2026, 6, 3, 14), true), sleep(at(2026, 6, 3, 22), at(2026, 6, 4, 6), false)],
        'wakeWindow', now, 30,
      ),
    ).toHaveLength(0);
  });
});

const diaper = (time: number, wet: boolean, solid: boolean): Entry => ({
  id: `d-${time}`, childId: 'c1', type: 'diaper', time, wet, solid, color: null, tags: [],
});

describe('buildDiaperSeries', () => {
  const now = at(2026, 6, 5, 15);
  const day = at(2026, 6, 5, 9);

  it('counts a both-wet-and-dirty change once in each series, never summed', () => {
    const s = buildDiaperSeries([diaper(day, true, true)], now, 14);
    expect(s[0].wet).toBe(1);
    expect(s[0].dirty).toBe(1);
  });

  it('tallies wet-only and dirty-only independently within a day', () => {
    const s = buildDiaperSeries(
      [diaper(day, true, false), diaper(day + 3600000, true, false), diaper(day + 7200000, false, true)],
      now, 14,
    );
    expect(s[0].wet).toBe(2);
    expect(s[0].dirty).toBe(1);
  });
});
