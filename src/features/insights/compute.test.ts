import { describe, expect, it } from 'vitest';
import { buildDiaperSeries, buildSleepHeatmap, buildTrend, liveSleepMsInWindow, noonWindowStart, sleepMsInWindow, windowStart } from './compute';
import type { Entry, Timer } from '@/types/models';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const sleep = (start: number, end: number, nap: boolean): Entry => ({
  id: `s-${start}`, childId: 'c1', type: 'sleep', start, end, nap, tags: [],
});
/** A running sleep timer: a Timer has no `end`, it runs until stopped. */
const timer = (start: number): Timer => ({
  id: `t-${start}`, childId: 'c1', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start,
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
    expect(rows).toHaveLength(3); // offsets 2,1,0, nothing older than the data
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

  it('totalSleep still counts logged sleep only, never a running timer', () => {
    // Regression guard for liveSleepMsInWindow: the trend takes no timers and
    // must stay that way, or a history point would creep upward while a nap runs.
    const win = at(2026, 6, 5, 12);
    const entries = [sleep(at(2026, 6, 5, 13), at(2026, 6, 5, 14), true)];
    const pts = buildTrend(entries, 'totalSleep', now, 30);
    const today = pts.find((p) => p.t === win)!;
    expect(today.value).toBeCloseTo(1, 3);
    expect(today.value).toBeCloseTo(sleepMsInWindow(entries, win) / 3600000, 3);
    expect(liveSleepMsInWindow(entries, [timer(at(2026, 6, 5, 14))], win, now) / 3600000).toBeCloseTo(2, 3);
  });

  it('totalSleep splits a sleep crossing the window boundary between the two windows', () => {
    // 11am–1pm on 4 Jul straddles the noon origin → 1h to the Jul3-noon window,
    // 1h to the Jul4-noon window, instead of the full 2h landing in the start window.
    const pts = buildTrend([sleep(at(2026, 6, 4, 11), at(2026, 6, 4, 13), true)], 'totalSleep', now, 30);
    expect(pts).toHaveLength(2);
    expect(pts[0].value).toBeCloseTo(1, 2);
    expect(pts[1].value).toBeCloseTo(1, 2);
  });

  it('totalSleep apportions an overnight sleep across days at the chosen origin (midnight)', () => {
    // 10pm Jul4 – 6am Jul5 at origin 0 → 2h before midnight to Jul4, 6h after to Jul5.
    const pts = buildTrend([sleep(at(2026, 6, 4, 22), at(2026, 6, 5, 6), false)], 'totalSleep', now, 30, 0);
    expect(pts).toHaveLength(2);
    expect(pts[0].value).toBeCloseTo(2, 2);
    expect(pts[1].value).toBeCloseTo(6, 2);
  });

  it('longestStretch is not split at the window boundary (a stretch is one continuous thing)', () => {
    const pts = buildTrend([sleep(at(2026, 6, 4, 11), at(2026, 6, 4, 13), true)], 'longestStretch', now, 30);
    expect(pts).toHaveLength(1);
    expect(pts[0].value).toBeCloseTo(2, 2);
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

describe('buildSleepHeatmap markers', () => {
  const now = at(2026, 6, 5, 15);

  it('attaches feed segments and diaper marks to the sleep window rows', () => {
    const rows = buildSleepHeatmap([
      sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false), // night in the Jul4-noon window
      feeding(at(2026, 6, 4, 18)),                          // 6pm, 15min → segment
      diaper(at(2026, 6, 4, 22), true, false),              // 10pm → point
    ], now);
    const row = rows.find((r) => r.offsetFromToday === 1)!;
    expect(row.feeds).toHaveLength(1);
    expect(row.feeds[0].x0).toBeCloseTo(6 / 24, 2); // 6pm = 6h after the noon origin
    expect(row.feeds[0].x1).toBeGreaterThan(row.feeds[0].x0);
    expect(row.diapers).toHaveLength(1);
    expect(row.diapers[0]).toBeCloseTo(10 / 24, 2); // 10pm = 10h after the noon origin
  });

  it('leaves an in-progress feed out of the static feed segments', () => {
    const ongoing: Entry = {
      id: 'f-ongoing', childId: 'c1', type: 'feeding', start: at(2026, 6, 4, 18), end: null,
      feedType: 'breast', method: 'left', amount: null, tags: [],
    };
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false), ongoing], now);
    expect(rows.find((r) => r.offsetFromToday === 1)!.feeds).toHaveLength(0);
  });

  it('drops markers on days with no sleep row (stays sleep-anchored)', () => {
    expect(buildSleepHeatmap([feeding(at(2026, 6, 4, 18))], now)).toEqual([]);
  });
});

describe('sleepMsInWindow', () => {
  it('counts only the part of a boundary-crossing sleep that falls inside the window', () => {
    // 11am–1pm crosses the Jul4 noon origin; only the noon–1pm hour is inside that window
    const ms = sleepMsInWindow([sleep(at(2026, 6, 4, 11), at(2026, 6, 4, 13), true)], at(2026, 6, 4, 12));
    expect(ms / 3600000).toBeCloseTo(1, 3);
  });

  it('counts the after-boundary part of the previous night into the new window', () => {
    // 10pm Jul4 – 6am Jul5; the Jul5 midnight window gets the midnight–6am part
    const ms = sleepMsInWindow([sleep(at(2026, 6, 4, 22), at(2026, 6, 5, 6), false)], at(2026, 6, 5, 0));
    expect(ms / 3600000).toBeCloseTo(6, 3);
  });

  it('ignores in-progress sleeps and sums across multiple sleeps in the window', () => {
    const ongoing: Entry = { id: 's-live', childId: 'c1', type: 'sleep', start: at(2026, 6, 5, 14), end: null, nap: true, tags: [] };
    const ms = sleepMsInWindow(
      [sleep(at(2026, 6, 5, 13), at(2026, 6, 5, 14), true), sleep(at(2026, 6, 5, 15), at(2026, 6, 5, 16), true), ongoing],
      at(2026, 6, 5, 12),
    );
    expect(ms / 3600000).toBeCloseTo(2, 3);
  });
});

describe('liveSleepMsInWindow', () => {
  const win = at(2026, 6, 5, 12);  // noon Jul 5, the window under test
  const now = at(2026, 6, 5, 15);  // 3pm, three hours into it
  const napped = sleep(at(2026, 6, 5, 13), at(2026, 6, 5, 14), true); // logged 1h nap

  it('matches sleepMsInWindow when no timer is running', () => {
    const entries = [napped];
    expect(liveSleepMsInWindow(entries, [], win, now)).toBe(sleepMsInWindow(entries, win));
  });

  it('adds the full elapsed time of a nap that started inside the window', () => {
    const ms = liveSleepMsInWindow([], [timer(at(2026, 6, 5, 14))], win, now); // 2pm → 3pm
    expect(ms / 3600000).toBeCloseTo(1, 3);
  });

  it('counts only the in-window part of a nap that started before the window began', () => {
    // 11:30am under a noon window: the pre-noon half hour belongs to yesterday
    const ms = liveSleepMsInWindow([], [timer(at(2026, 6, 5, 11, 30))], win, now);
    expect(ms / 3600000).toBeCloseTo(3, 3);
  });

  it('stops counting a running nap at the window end', () => {
    // clock has run past next noon without the timer being stopped
    const ms = liveSleepMsInWindow([], [timer(at(2026, 6, 5, 22))], win, at(2026, 6, 6, 15));
    expect(ms / 3600000).toBeCloseTo(14, 3); // 10pm → next noon, not → 3pm
  });

  it('sums logged sleep and the running nap without double counting', () => {
    const ms = liveSleepMsInWindow([napped], [timer(at(2026, 6, 5, 14, 30))], win, now);
    expect(ms / 3600000).toBeCloseTo(1.5, 3); // 1h logged + 30min still running
  });

  it('ignores a running timer that will not be saved as sleep', () => {
    const feed: Timer = { ...timer(at(2026, 6, 5, 14)), activity: 'feeding', saveAs: 'feeding' };
    expect(liveSleepMsInWindow([napped], [feed], win, now)).toBe(sleepMsInWindow([napped], win));
  });

  it('counts a timer switched to sleep after starting as something else (saveAs, not activity)', () => {
    const switched: Timer = { ...timer(at(2026, 6, 5, 14)), activity: 'feeding', saveAs: 'sleep' };
    expect(liveSleepMsInWindow([], [switched], win, now) / 3600000).toBeCloseTo(1, 3);
  });

  it('never lets a nap starting after `now` subtract from the total', () => {
    const future = [timer(at(2026, 6, 5, 16))]; // 4pm start, now is 3pm (clock skew / bad data)
    expect(liveSleepMsInWindow([], future, win, now)).toBe(0);
    expect(liveSleepMsInWindow([napped], future, win, now)).toBe(sleepMsInWindow([napped], win));
  });

  it('caps at a full day when a timer straddles both window edges', () => {
    // started before noon Jul 5, still running past noon Jul 6: both clips bite at once
    const ms = liveSleepMsInWindow([], [timer(at(2026, 6, 5, 8))], win, at(2026, 6, 6, 18));
    expect(ms / 3600000).toBeCloseTo(24, 3);
  });

  it('double counts overlapping running timers, as documented', () => {
    // Reachable state (two quick timers both set to save as sleep). Pinned so the
    // behaviour the doc comment describes cannot change silently.
    const both = [timer(at(2026, 6, 5, 14)), { ...timer(at(2026, 6, 5, 14)), id: 't-dup' }];
    expect(liveSleepMsInWindow([], both, win, now) / 3600000).toBeCloseTo(2, 3);
  });
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
