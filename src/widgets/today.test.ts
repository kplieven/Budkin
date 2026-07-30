import { describe, expect, it } from 'vitest';

import { liveSleepMsInWindow, windowStart } from '@/features/insights/compute';
import type { Entry, Timer } from '@/types/models';
import { pruneWidgetEntries, widgetToday, WIDGET_LOOKBACK_MS, type WidgetTodaySource } from '@/widgets/today';

// Fixed local timestamps, no fake timers (same style as insights/compute.test.ts).
// 5 Jul 2026 is well clear of any DST transition.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();

const sleep = (start: number, end: number | null, nap = true): Entry => ({
  id: `s-${start}`, childId: 'c1', type: 'sleep', start, end, nap, tags: [],
});
const feed = (start: number, end: number | null = null): Entry => ({
  id: `f-${start}`, childId: 'c1', type: 'feeding', start, end, feedType: 'breast', method: 'left', amount: null, tags: [],
});
const diaper = (time: number): Entry => ({
  id: `d-${time}`, childId: 'c1', type: 'diaper', time, wet: true, solid: false, color: null, tags: [],
});

const src = (over: Partial<WidgetTodaySource> = {}): WidgetTodaySource => ({
  entries: [],
  sleepStart: null,
  rhythmOriginHour: 12,
  ...over,
});

describe('widgetToday sleep total', () => {
  const now = at(2026, 6, 5, 15); // 5 Jul 2026, 15:00; noon window started 3h ago

  it('cuts a sleep straddling the boundary and counts only the in-window part', () => {
    // 10:00 to 14:00 with a noon boundary: 2h before, 2h after.
    const t = widgetToday(src({ entries: [sleep(at(2026, 6, 5, 10), at(2026, 6, 5, 14))] }), now);
    expect(t.sleepMin).toBe(120);
    expect(t.sleepValue).toBe('2h');
  });

  it('counts only the post-boundary part of a running nap that began before it', () => {
    const t = widgetToday(src({ sleepStart: at(2026, 6, 5, 11) }), at(2026, 6, 5, 13));
    expect(t.sleepMin).toBe(60);
  });

  it('counts the full elapsed time of a running nap that began inside the window', () => {
    const t = widgetToday(src({ sleepStart: at(2026, 6, 5, 13) }), at(2026, 6, 5, 14, 30));
    expect(t.sleepMin).toBe(90);
  });

  it('adds logged sleep and the live nap together, never showing the nap alone', () => {
    const t = widgetToday(
      src({ entries: [sleep(at(2026, 6, 5, 12, 30), at(2026, 6, 5, 13, 30))], sleepStart: at(2026, 6, 5, 14) }),
      now,
    );
    expect(t.sleepMin).toBe(60 + 60);
  });

  it('is the same number Home computes, via liveSleepMsInWindow itself', () => {
    // Home: liveSleepMsInWindow(childEntries, childTimers, windowStart(now, originHour), now).
    const entries = [
      sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false), // last night, previous window
      sleep(at(2026, 6, 5, 10), at(2026, 6, 5, 14)), // straddles noon
      sleep(at(2026, 6, 5, 14, 15), at(2026, 6, 5, 14, 45)),
    ];
    const sleepStart = at(2026, 6, 5, 14, 50);
    const timers: Timer[] = [{ id: 't1', childId: 'c1', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: sleepStart }];
    const home = liveSleepMsInWindow(entries, timers, windowStart(now, 12), now) / 60000;
    expect(widgetToday(src({ entries, sleepStart }), now).sleepMin).toBe(home);
    expect(home).toBeGreaterThan(0); // the comparison would be vacuous at zero
  });

  it('reports a real zero as "0 min", not as the empty placeholder', () => {
    const t = widgetToday(src({ entries: [sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false)] }), now);
    expect(t.sleepMin).toBe(0);
    expect(t.sleepValue).toBe('0 min');
  });

  it('ignores an in-progress logged sleep (end == null), like every other surface', () => {
    const t = widgetToday(src({ entries: [sleep(at(2026, 6, 5, 13), null)] }), now);
    expect(t.sleepMin).toBe(0);
  });
});

describe('widgetToday counts', () => {
  const now = at(2026, 6, 5, 15);

  it('buckets feeds by start, so one starting before the boundary counts to the previous window', () => {
    // 11:30 to 12:30 across a noon boundary: `start` is yesterday's, `end` is today's.
    const t = widgetToday(src({ entries: [feed(at(2026, 6, 5, 11, 30), at(2026, 6, 5, 12, 30))] }), now);
    expect(t.feeds).toBe(0);
  });

  it('counts a feed that starts inside the window', () => {
    const t = widgetToday(src({ entries: [feed(at(2026, 6, 5, 12, 30), at(2026, 6, 5, 13))] }), now);
    expect(t.feeds).toBe(1);
  });

  it('counts a still-running feed (no end) by its start', () => {
    const t = widgetToday(src({ entries: [feed(at(2026, 6, 5, 14, 45))] }), now);
    expect(t.feeds).toBe(1);
  });

  it('buckets diapers by time against the origin window', () => {
    const t = widgetToday(src({ entries: [diaper(at(2026, 6, 5, 11, 59)), diaper(at(2026, 6, 5, 12, 1)), diaper(at(2026, 6, 5, 14))] }), now);
    expect(t.diapers).toBe(2);
  });

  it('excludes records from the next window (a clock skewed ahead)', () => {
    const t = widgetToday(src({ entries: [feed(at(2026, 6, 6, 13)), diaper(at(2026, 6, 6, 13))] }), now);
    expect(t.feeds).toBe(0);
    expect(t.diapers).toBe(0);
  });
});

describe('widgetToday origin hour', () => {
  const now = at(2026, 6, 5, 20); // 20:00
  const entries = [sleep(at(2026, 6, 5, 13), at(2026, 6, 5, 14)), feed(at(2026, 6, 5, 13)), diaper(at(2026, 6, 5, 13))];

  it('noon (default): a 13:00 record is in the current window', () => {
    const t = widgetToday(src({ entries, rhythmOriginHour: 12 }), now);
    expect(t.windowStartMs).toBe(at(2026, 6, 5, 12));
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([60, 1, 1]);
  });

  it('midnight: the window is the calendar day, and the 13:00 record is still in it', () => {
    const t = widgetToday(src({ entries, rhythmOriginHour: 0 }), now);
    expect(t.windowStartMs).toBe(at(2026, 6, 5, 0));
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([60, 1, 1]);
  });

  it('19:00: the window opened an hour ago, so the same 13:00 record falls OUT of it', () => {
    const t = widgetToday(src({ entries, rhythmOriginHour: 19 }), now);
    expect(t.windowStartMs).toBe(at(2026, 6, 5, 19));
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([0, 0, 0]);
  });

  it('19:00 before the boundary: the window is yesterday evening, and the record is IN it', () => {
    const t = widgetToday(src({ entries, rhythmOriginHour: 19 }), at(2026, 6, 5, 18));
    expect(t.windowStartMs).toBe(at(2026, 6, 4, 19));
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([60, 1, 1]);
  });

  it('clamps a junk origin hour instead of producing a NaN window', () => {
    expect(widgetToday(src({ entries, rhythmOriginHour: NaN }), now).windowStartMs).toBe(at(2026, 6, 5, 12));
    // 25 clamps to 23, and 20:00 is before that boundary, so the window is yesterday's
    expect(widgetToday(src({ entries, rhythmOriginHour: 25 }), now).windowStartMs).toBe(at(2026, 6, 4, 23));
  });
});

describe('widgetToday labels', () => {
  const now = at(2026, 6, 5, 15);

  it('names the boundary rather than saying "today"', () => {
    const t = widgetToday(src({ entries: [feed(at(2026, 6, 5, 13)), diaper(at(2026, 6, 5, 13))] }), now);
    expect(t.todayLine).toBe('since noon · 1 feeds · 1 changes');
  });

  it('follows a non-default boundary into the label', () => {
    expect(widgetToday(src({ rhythmOriginHour: 0 }), now).todayLine).toBe('since midnight · 0 feeds · 0 changes');
    expect(widgetToday(src({ rhythmOriginHour: 7 }), now).todayLine).toBe('since 7:00 · 0 feeds · 0 changes');
  });

  it('keeps the graceful empty state when there is no snapshot at all', () => {
    const t = widgetToday(null, now);
    expect(t.sleepValue).toBe('—'); // not "0 min": with no snapshot there is no data, not a zero
    expect(t.todayLine).toBe('since noon · 0 feeds · 0 changes');
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([0, 0, 0]);
  });

  it('shows no figure for a child who is not born yet', () => {
    // An unborn child has no sleep to total, so this is the no-data case, not a
    // zero. "0 min" would read as a measurement of a baby who does not exist.
    expect(widgetToday(src({ expected: true }), now).sleepValue).toBe('—');
  });

  it('marks a running nap on the value, keeping the total as the number', () => {
    // The row's label stays the category ("Sleep"). Putting "Napping" there next
    // to a whole-window total would claim the number IS the nap's length.
    const t = widgetToday(src({ entries: [sleep(at(2026, 6, 5, 13), at(2026, 6, 5, 14))], sleepStart: at(2026, 6, 5, 14, 30) }), now);
    expect(t.sleepMin).toBe(90); // 1h logged + 30 min still running
    expect(t.sleepValue).toBe('1h 30m · napping');
  });
});

describe('widgetToday recomputes the window from the SAME snapshot', () => {
  // The core property of this design: the widget bitmap is frozen and Android's
  // refresh floor is 30 minutes, so a total baked in at write time would show
  // yesterday's figures after the boundary passed. Recomputing at render time
  // makes the rollover self-correcting.
  const snapshot = src({
    entries: [
      sleep(at(2026, 6, 5, 9), at(2026, 6, 5, 11)), // previous (Jul 4 noon) window
      sleep(at(2026, 6, 5, 13), at(2026, 6, 5, 14)), // current (Jul 5 noon) window
      feed(at(2026, 6, 5, 10)),
      feed(at(2026, 6, 5, 13)),
      diaper(at(2026, 6, 5, 10, 30)),
      diaper(at(2026, 6, 5, 13, 30)),
    ],
  });

  it('before the boundary it reports the previous window', () => {
    const t = widgetToday(snapshot, at(2026, 6, 5, 11, 30));
    expect(t.windowStartMs).toBe(at(2026, 6, 4, 12));
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([120, 1, 1]);
  });

  it('after the boundary the SAME snapshot reports the new window', () => {
    const t = widgetToday(snapshot, at(2026, 6, 5, 15));
    expect(t.windowStartMs).toBe(at(2026, 6, 5, 12));
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([60, 1, 1]);
  });

  it('a running nap rolls over the boundary within one minute, with no rebuild', () => {
    const napping = src({ sleepStart: at(2026, 6, 5, 11) });
    expect(widgetToday(napping, at(2026, 6, 5, 11, 59)).sleepMin).toBe(59);
    expect(widgetToday(napping, at(2026, 6, 5, 12, 1)).sleepMin).toBe(1);
  });
});

describe('pruneWidgetEntries', () => {
  const now = at(2026, 6, 5, 15);
  const cutoff = now - WIDGET_LOOKBACK_MS; // 3 Jul 15:00

  it('is a 48h lookback', () => {
    expect(WIDGET_LOOKBACK_MS).toBe(48 * 3600000);
    expect(cutoff).toBe(at(2026, 6, 3, 15));
  });

  it('keeps a sleep that started before the current window began', () => {
    const straddler = sleep(at(2026, 6, 5, 10), at(2026, 6, 5, 14));
    const kept = pruneWidgetEntries([straddler], now);
    expect(kept).toEqual([straddler]);
    // and the hard cut still works on the pruned list, so the prune loses nothing
    expect(widgetToday(src({ entries: kept }), now).sleepMin).toBe(120);
  });

  it('keeps a sleep whose start is older than the cutoff but whose end is inside it', () => {
    const long = sleep(at(2026, 6, 3, 12), at(2026, 6, 3, 16), false);
    expect(pruneWidgetEntries([long], now)).toEqual([long]);
  });

  it('drops records older than the lookback', () => {
    const old = [sleep(at(2026, 6, 3, 8), at(2026, 6, 3, 10)), feed(at(2026, 6, 3, 9), at(2026, 6, 3, 9, 30)), diaper(at(2026, 6, 3, 9))];
    expect(pruneWidgetEntries(old, now)).toEqual([]);
  });

  it('keeps only the three types the widget reads', () => {
    const others: Entry[] = [
      { id: 'p1', childId: 'c1', type: 'pumping', start: at(2026, 6, 5, 13), end: at(2026, 6, 5, 13, 20), amount: 90, tags: [] },
      { id: 'tu1', childId: 'c1', type: 'tummy', start: at(2026, 6, 5, 13), end: at(2026, 6, 5, 13, 10), tags: [] },
      { id: 'b1', childId: 'c1', type: 'bath', time: at(2026, 6, 5, 13), wash: 'small', tags: [] },
      { id: 'te1', childId: 'c1', type: 'temperature', time: at(2026, 6, 5, 13), value: 37, tags: [] },
      { id: 'm1', childId: 'c1', type: 'medication', time: at(2026, 6, 5, 13), name: 'x', tags: [] },
      { id: 'n1', childId: 'c1', type: 'note', time: at(2026, 6, 5, 13), text: 'x', tags: [] },
      { id: 'ms1', childId: 'c1', type: 'milestone', key: 'k', time: at(2026, 6, 5, 13), text: 'x', tags: [] },
    ];
    const wanted = [sleep(at(2026, 6, 5, 13), at(2026, 6, 5, 14)), feed(at(2026, 6, 5, 13)), diaper(at(2026, 6, 5, 13))];
    expect(pruneWidgetEntries([...others, ...wanted], now)).toEqual(wanted);
  });

  it('keeps an in-progress record by its start', () => {
    const running = feed(at(2026, 6, 5, 14, 30));
    const stale = feed(at(2026, 6, 3, 8));
    expect(pruneWidgetEntries([running, stale], now)).toEqual([running]);
  });
});
