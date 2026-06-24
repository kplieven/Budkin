import { describe, expect, it } from 'vitest';

import { groupByDay } from '@/features/activity/groupByDay';
import { dayGroupLabel } from '@/lib/format';
import type { Entry } from '@/types/models';

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
});
