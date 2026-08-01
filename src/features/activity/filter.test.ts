import { describe, expect, it } from 'vitest';

import {
  activityOptions,
  dayKey,
  dayKeyLabel,
  dayOptions,
  filterItems,
  itemActivity,
} from '@/features/activity/filter';
import type { Entry, Timer } from '@/types/models';

const NOW = new Date(2026, 5, 22, 12, 0, 0).getTime(); // local noon
const M = 60000;
const H = 3600000;

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

const diaper = (id: string, ts: number): Entry => ({
  id,
  childId: 'c1',
  type: 'diaper',
  time: ts,
  wet: true,
  solid: false,
  color: null,
  tags: [],
});

const timer = (id: string, start: number, saveAs: 'sleep' | 'feeding' = 'sleep'): Timer => ({
  id,
  childId: 'c1',
  activity: saveAs,
  saveAs,
  name: id,
  start,
});

describe('itemActivity', () => {
  it('reads an entry by its type and a running timer by what it will be saved as', () => {
    expect(itemActivity(feed('a', NOW))).toBe('feeding');
    expect(itemActivity(timer('t', NOW, 'sleep'))).toBe('sleep');
  });

  it('follows a timer repointed at another activity', () => {
    // saveAs, not activity: the same rule Home and the reminder scheduler use.
    const repointed = { ...timer('t', NOW, 'sleep'), saveAs: 'feeding' as const };
    expect(itemActivity(repointed)).toBe('feeding');
  });
});

describe('dayKey', () => {
  it('is the same for two times on one local day and differs across midnight', () => {
    const morning = new Date(2026, 5, 22, 0, 30, 0).getTime();
    const evening = new Date(2026, 5, 22, 23, 30, 0).getTime();
    const nextDay = new Date(2026, 5, 23, 0, 30, 0).getTime();

    expect(dayKey(morning)).toBe(dayKey(evening));
    expect(dayKey(nextDay)).not.toBe(dayKey(morning));
  });

  it('pads month and day so keys sort chronologically as strings', () => {
    expect(dayKey(new Date(2026, 0, 5, 12, 0, 0).getTime())).toBe('2026-01-05');
  });
});

describe('dayKeyLabel', () => {
  it('labels a key the way the timeline heads that day', () => {
    expect(dayKeyLabel(dayKey(NOW), NOW)).toBe('Today');
    expect(dayKeyLabel(dayKey(NOW - 26 * H), NOW)).toBe('Yesterday');
    expect(dayKeyLabel('2026-06-20', NOW)).toBe('20/06/2026');
  });

  it('re-reads the same key against a later now, so a selection ages by itself', () => {
    // The key is fixed; only `now` moves. A day picked as "Today" must read
    // "Yesterday" once the clock passes midnight, not stay stuck on its label.
    const tomorrowNoon = new Date(2026, 5, 23, 12, 0, 0).getTime();
    expect(dayKeyLabel(dayKey(NOW), tomorrowNoon)).toBe('Yesterday');
  });
});

describe('activityOptions', () => {
  it('lists only the activities present, in the app-wide order, once each', () => {
    const items = [diaper('d1', NOW), feed('f1', NOW - H), diaper('d2', NOW - 2 * H)];
    expect(activityOptions(items)).toEqual(['feeding', 'diaper']);
  });

  it('counts a running timer as its save-as activity', () => {
    expect(activityOptions([timer('t', NOW, 'sleep')])).toEqual(['sleep']);
  });

  it('has nothing to offer for an empty timeline', () => {
    expect(activityOptions([])).toEqual([]);
  });
});

describe('dayOptions', () => {
  it('lists each day once, newest first, labelled and counted', () => {
    const today = NOW - 10 * M;
    const alsoToday = NOW - 3 * H;
    const yesterday = NOW - 26 * H;

    expect(dayOptions([feed('a', alsoToday), feed('b', today), feed('c', yesterday)], NOW)).toEqual([
      { key: dayKey(today), label: 'Today', count: 2 },
      { key: dayKey(yesterday), label: 'Yesterday', count: 1 },
    ]);
  });

  it('places a running timer on the day it started', () => {
    const started = new Date(2026, 5, 21, 22, 0, 0).getTime();
    expect(dayOptions([timer('t', started)], NOW)).toEqual([
      { key: dayKey(started), label: 'Yesterday', count: 1 },
    ]);
  });

  it('has nothing to offer for an empty timeline', () => {
    expect(dayOptions([], NOW)).toEqual([]);
  });
});

describe('filterItems', () => {
  const today = NOW - 10 * M;
  const yesterday = NOW - 26 * H;
  const items = [feed('f-today', today), diaper('d-today', today), feed('f-yest', yesterday)];

  it('keeps everything when no day and no type is selected', () => {
    expect(filterItems(items, { day: null, types: [] })).toEqual(items);
  });

  it('keeps only the chosen day', () => {
    expect(filterItems(items, { day: dayKey(yesterday), types: [] }).map((i) => i.id)).toEqual(['f-yest']);
  });

  it('keeps only the chosen types', () => {
    expect(filterItems(items, { day: null, types: ['diaper'] }).map((i) => i.id)).toEqual(['d-today']);
  });

  it('keeps any of several chosen types', () => {
    expect(filterItems(items, { day: null, types: ['diaper', 'feeding'] }).map((i) => i.id)).toEqual([
      'f-today',
      'd-today',
      'f-yest',
    ]);
  });

  it('applies day and type together', () => {
    expect(filterItems(items, { day: dayKey(today), types: ['feeding'] }).map((i) => i.id)).toEqual(['f-today']);
  });

  it('can match nothing', () => {
    expect(filterItems(items, { day: dayKey(yesterday), types: ['diaper'] })).toEqual([]);
  });

  it('filters a running timer by its save-as activity and its start day', () => {
    const running = timer('t', yesterday, 'sleep');
    expect(filterItems([running], { day: dayKey(yesterday), types: ['sleep'] }).map((i) => i.id)).toEqual(['t']);
    expect(filterItems([running], { day: null, types: ['feeding'] })).toEqual([]);
    expect(filterItems([running], { day: dayKey(today), types: [] })).toEqual([]);
  });

  it('preserves the incoming order, so the timeline still sorts it', () => {
    const out = filterItems(items, { day: null, types: [] });
    expect(out.map((i) => i.id)).toEqual(['f-today', 'd-today', 'f-yest']);
  });
});
