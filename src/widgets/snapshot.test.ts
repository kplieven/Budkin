import { describe, expect, it } from 'vitest';

import type { Child, Entry, Timer } from '@/types/models';
import { buildWidgetSnapshot } from '@/widgets/snapshot';
import { widgetToday } from '@/widgets/today';

// Fixed local timestamps rather than `Date.now()` offsets: `now` is a parameter,
// so nothing here depends on what time the suite runs at (the old version placed
// its records on the previous calendar day when run between 00:00 and 02:00).
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const NOW = at(2026, 6, 5, 15); // 5 Jul 2026, 15:00; the noon window opened at 12:00

const child: Child = { id: 'c1', first: 'Ada', last: 'L', birth: 0, color: '#ffffff' };
const baseState = { children: [child], selectedChildId: 'c1', entries: [], timers: [], rhythmOriginHour: 12, now: NOW };

const sleep = (childId: string, start: number, end: number | null): Entry => ({
  id: `s-${start}`, childId, type: 'sleep', start, end, nap: true, tags: [],
});
const feed = (childId: string, start: number): Entry => ({
  id: `f-${start}`, childId, type: 'feeding', start, end: start + 900000, feedType: 'breast', method: 'left', amount: null, tags: [],
});
const diaper = (childId: string, time: number): Entry => ({
  id: `d-${time}`, childId, type: 'diaper', time, solid: false, wet: true, color: null, tags: [],
});

describe('buildWidgetSnapshot child + queue fields', () => {
  it('passes through selectedChildId', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { mode: 'server', serverUrl: 'http://x', token: 't' } });
    expect(s.selectedChildId).toBe('c1');
  });

  it('canQueueNap is true for a real connection', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { mode: 'server', serverUrl: 'http://x', token: 't' } });
    expect(s.canQueueNap).toBe(true);
  });

  it('canQueueNap is false in demo mode', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { mode: 'local' } });
    expect(s.canQueueNap).toBe(false);
  });

  it('canQueueNap is false with no connection', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: null });
    expect(s.canQueueNap).toBe(false);
  });

  it('carries the day boundary through, so the widget windows like Home', () => {
    const s = buildWidgetSnapshot({ ...baseState, rhythmOriginHour: 19, connection: null });
    expect(s.rhythmOriginHour).toBe(19);
  });
});

describe('buildWidgetSnapshot child scoping', () => {
  const sibling: Child = { id: 'c2', first: 'Theo', last: 'L', birth: 0, color: '#000000' };
  // Every record below belongs to the SIBLING, never to the selected child.
  const siblingEntries: Entry[] = [
    feed('c2', at(2026, 6, 5, 14)),
    diaper('c2', at(2026, 6, 5, 14, 30)),
    sleep('c2', at(2026, 6, 5, 13), at(2026, 6, 5, 14)),
  ];

  it("ignores a sibling child's records when that child is not selected", () => {
    const s = buildWidgetSnapshot({
      ...baseState,
      children: [child, sibling],
      selectedChildId: 'c1',
      entries: siblingEntries,
      connection: null,
    });
    expect(s.lastFeedStart).toBeNull();
    expect(s.lastDiaper).toBeNull();
    expect(s.lastDiaperSolid).toBe(false);
    // The records are gone from the snapshot entirely, so no render-time window
    // can resurrect them. (The old test asserted zero totals that were zero for
    // the wrong reason: they never reached the date filter at all.)
    expect(s.entries).toEqual([]);
    const t = widgetToday(s, NOW);
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([0, 0, 0]);
  });

  it("still reports the selected child's own records", () => {
    const s = buildWidgetSnapshot({
      ...baseState,
      children: [child, sibling],
      selectedChildId: 'c2',
      entries: siblingEntries,
      connection: null,
    });
    expect(s.childName).toBe('Theo');
    expect(s.lastFeedStart).toBe(at(2026, 6, 5, 14));
    expect(s.lastDiaper).toBe(at(2026, 6, 5, 14, 30));
    expect(s.lastDiaperSolid).toBe(false);
    const t = widgetToday(s, NOW);
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([60, 1, 1]);
  });

  it('shows nothing for an expecting child whose sibling owns all the records', () => {
    const expecting: Child = { id: 'c3', first: 'Bean', last: 'L', birth: NOW + 86400000, color: '#111111', expected: true };
    const s = buildWidgetSnapshot({
      ...baseState,
      children: [sibling, expecting],
      selectedChildId: 'c3',
      entries: siblingEntries,
      connection: null,
    });
    expect(s.expected).toBe(true);
    expect(s.lastFeedStart).toBeNull();
    expect(s.lastDiaper).toBeNull();
    expect(s.entries).toEqual([]);
    expect(widgetToday(s, NOW).feeds).toBe(0);
  });
});

describe('buildWidgetSnapshot running sleep timer', () => {
  const timer = (over: Partial<Timer> = {}): Timer => ({
    id: 't1', childId: 'c1', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: at(2026, 6, 5, 14), ...over,
  });

  it('picks up a running nap for the selected child', () => {
    const s = buildWidgetSnapshot({ ...baseState, timers: [timer()], connection: null });
    expect(s.sleepStart).toBe(at(2026, 6, 5, 14));
    expect(widgetToday(s, NOW).sleepMin).toBe(60);
  });

  it('counts a quick timer repointed to sleep (saveAs, never activity)', () => {
    // `setTimerSaveAs` rewrites `saveAs` and leaves `activity` at what the timer
    // was started as, so an activity-keyed lookup would miss this one.
    const s = buildWidgetSnapshot({ ...baseState, timers: [timer({ activity: 'feeding' })], connection: null });
    expect(s.sleepStart).toBe(at(2026, 6, 5, 14));
    expect(widgetToday(s, NOW).sleepMin).toBe(60);
  });

  it('ignores a timer that will be saved as something else', () => {
    const s = buildWidgetSnapshot({ ...baseState, timers: [timer({ activity: 'sleep', saveAs: 'feeding' })], connection: null });
    expect(s.sleepStart).toBeNull();
    expect(widgetToday(s, NOW).sleepMin).toBe(0);
  });

  it("ignores a sibling's running nap", () => {
    const s = buildWidgetSnapshot({ ...baseState, timers: [timer({ childId: 'c2' })], connection: null });
    expect(s.sleepStart).toBeNull();
    expect(widgetToday(s, NOW).sleepMin).toBe(0);
  });

  it('adopts an ownerless timer as the selected child\'s', () => {
    const s = buildWidgetSnapshot({ ...baseState, timers: [timer({ childId: undefined })], connection: null });
    expect(s.sleepStart).toBe(at(2026, 6, 5, 14));
  });

  it('has no running nap when no child is selected', () => {
    const s = buildWidgetSnapshot({ ...baseState, selectedChildId: '', timers: [timer({ childId: undefined })], connection: null });
    expect(s.sleepStart).toBeNull();
  });
});

describe('buildWidgetSnapshot raw records', () => {
  it('carries raw records instead of pre-baked totals, and prunes to the 48h lookback', () => {
    const keep = [
      sleep('c1', at(2026, 6, 5, 10), at(2026, 6, 5, 14)), // straddles the noon boundary
      feed('c1', at(2026, 6, 5, 13)),
      diaper('c1', at(2026, 6, 5, 13, 30)),
      sleep('c1', at(2026, 6, 4, 20), at(2026, 6, 5, 6)), // last night, previous window
    ];
    const drop = [
      sleep('c1', at(2026, 6, 2, 20), at(2026, 6, 3, 6)), // ended >48h before NOW
      feed('c1', at(2026, 6, 1, 9)),
    ];
    const s = buildWidgetSnapshot({ ...baseState, entries: [...keep, ...drop], connection: null });
    expect(s.entries).toEqual(keep);
    // The straddler contributes only its post-noon half, and last night nothing.
    const t = widgetToday(s, NOW);
    expect([t.sleepMin, t.feeds, t.diapers]).toEqual([120, 1, 1]);
  });

  it('keeps a sleep that began before the current window, so the cut is still available', () => {
    const overnight = sleep('c1', at(2026, 6, 5, 11), at(2026, 6, 5, 13));
    const s = buildWidgetSnapshot({ ...baseState, entries: [overnight], connection: null });
    expect(s.entries).toEqual([overnight]);
    expect(widgetToday(s, NOW).sleepMin).toBe(60);
  });

  it('the same snapshot yields the new window once the boundary passes', () => {
    // The property the whole design exists for: the widget bitmap is frozen and
    // may not be refreshed for 30+ minutes, so the numbers must come from `now`.
    const s = buildWidgetSnapshot({
      ...baseState,
      now: at(2026, 6, 5, 11),
      entries: [sleep('c1', at(2026, 6, 5, 9), at(2026, 6, 5, 10)), feed('c1', at(2026, 6, 5, 9)), diaper('c1', at(2026, 6, 5, 9))],
      connection: null,
    });
    const before = widgetToday(s, at(2026, 6, 5, 11, 30));
    expect([before.sleepMin, before.feeds, before.diapers]).toEqual([60, 1, 1]);
    const after = widgetToday(s, at(2026, 6, 5, 12, 30));
    expect([after.sleepMin, after.feeds, after.diapers]).toEqual([0, 0, 0]);
    expect(after.windowStartMs).toBe(at(2026, 6, 5, 12));
  });

  it('a non-default boundary changes which window the same records fall in', () => {
    const entries = [sleep('c1', at(2026, 6, 5, 13), at(2026, 6, 5, 14)), feed('c1', at(2026, 6, 5, 13)), diaper('c1', at(2026, 6, 5, 13))];
    const noon = buildWidgetSnapshot({ ...baseState, entries, connection: null });
    const evening = buildWidgetSnapshot({ ...baseState, entries, rhythmOriginHour: 19, connection: null });
    const now = at(2026, 6, 5, 20); // past a 19:00 boundary, still inside a noon one
    expect(widgetToday(noon, now).sleepMin).toBe(60);
    expect(widgetToday(evening, now).sleepMin).toBe(0);
    expect(widgetToday(evening, now).todayLine).toBe('since 19:00 · 0 feeds · 0 changes');
  });
});
