import { describe, expect, it } from 'vitest';

import { groupByDay, isTimer, timelineTimestamp } from '@/features/activity/groupByDay';
import { dayGroupLabel } from '@/lib/format';
import type { Entry, Timer } from '@/types/models';

const NOW = 1_700_000_000_000;
const M = 60000;
const DAY = 86400000;

const feed = (id: string, ts: number): Entry => ({
  id,
  childId: 'c1',
  type: 'feeding',
  start: ts,
  end: ts,
  feedType: 'breast',
  method: 'left',
  amount: null,
  tags: [],
});

describe('groupByDay', () => {
  it('returns no groups for no entries', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it('groups by day, newest day first', () => {
    const today = NOW - 10 * M;
    const olderToday = NOW - 30 * M;
    const daysAgo = NOW - 3 * DAY;
    const groups = groupByDay([feed('a', olderToday), feed('b', today), feed('c', daysAgo)], NOW);

    expect(groups.map((g) => g.label)).toEqual([dayGroupLabel(today, NOW), dayGroupLabel(daysAgo, NOW)]);
    expect(groups).toHaveLength(2);
  });

  it('sorts entries within a day newest-first', () => {
    const today = NOW - 10 * M;
    const olderToday = NOW - 30 * M;
    const groups = groupByDay([feed('a', olderToday), feed('b', today)], NOW);

    expect(groups[0].items.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('keeps every entry exactly once', () => {
    const entries = [feed('a', NOW - 10 * M), feed('b', NOW - 2 * DAY), feed('c', NOW - 30 * M)];
    const total = groupByDay(entries, NOW).reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(3);
  });

  it('labels every group, across more days than Today/Yesterday cover', () => {
    // Buckets are keyed by calendar day but LABELLED by dayGroupLabel, so a long
    // history has to keep the two in step.
    const days = [0, 1, 2, 3, 10, 40, 400];
    const groups = groupByDay(
      // Shuffled input: the grouping owns the ordering, not the caller.
      days.map((d, i) => feed(`d${d}`, NOW - d * DAY - i * M)).reverse(),
      NOW,
    );

    expect(groups).toHaveLength(days.length);
    expect(groups.map((g) => g.label)).toEqual(
      days.map((d, i) => dayGroupLabel(NOW - d * DAY - i * M, NOW)),
    );
    expect(groups.map((g) => g.items.map((e) => e.id))).toEqual(days.map((d) => [`d${d}`]));
  });

  it('puts a future-dated entry in its own group, ahead of today', () => {
    // Reachable from the UI: the time panels let an entry be logged ahead of the clock.
    // It is a calendar day of its own, and sorts newest-first like any other.
    const tomorrow = NOW + DAY;
    const groups = groupByDay([feed('today', NOW - 10 * M), feed('ahead', tomorrow)], NOW);

    expect(groups.map((g) => g.label)).toEqual([
      dayGroupLabel(tomorrow, NOW),
      dayGroupLabel(NOW - 10 * M, NOW),
    ]);
    expect(groups[0].items.map((e) => e.id)).toEqual(['ahead']);
  });
});

const timer = (id: string, start: number): Timer => ({
  id,
  childId: 'c1',
  activity: 'sleep',
  saveAs: 'sleep',
  name: id,
  start,
});

describe('running timers on the timeline', () => {
  it('tells a timer from an entry', () => {
    expect(isTimer(timer('t1', NOW))).toBe(true);
    expect(isTimer(feed('a', NOW))).toBe(false);
  });

  it('places a running timer at its start, not at now', () => {
    expect(timelineTimestamp(timer('t1', NOW - 90 * M))).toBe(NOW - 90 * M);
  });

  it('interleaves a running timer with entries by start time, not pinned to the top', () => {
    // The timer started an hour ago, so a feed logged ten minutes ago outranks it even
    // though the timer is the one still running.
    const groups = groupByDay(
      [feed('newer', NOW - 10 * M), timer('running', NOW - 60 * M), feed('older', NOW - 120 * M)],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(['newer', 'running', 'older']);
  });

  it('buckets a timer started on an earlier day into that day', () => {
    const started = NOW - 2 * DAY;
    const groups = groupByDay([feed('today', NOW - 10 * M), timer('long', started)], NOW);
    expect(groups.map((g) => g.label)).toEqual([dayGroupLabel(NOW - 10 * M, NOW), dayGroupLabel(started, NOW)]);
    expect(groups[1].items.map((i) => i.id)).toEqual(['long']);
  });

  it('keeps a caller that passes only entries typed as entries (the Notes tab)', () => {
    // groupByDay is generic, so widening it to accept timers must not force entry-only
    // callers to re-narrow their rows.
    const groups = groupByDay([feed('a', NOW)], NOW);
    const first: Entry = groups[0].items[0];
    expect(first.id).toBe('a');
  });
});
