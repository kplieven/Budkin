import { describe, expect, it } from 'vitest';

import { timerQuickSets } from './timerQuickSets';
import type { Entry } from '@/types/models';

const NOW = new Date('2026-08-31T12:00:00').getTime();
const MIN = 60000;

const base = { childId: 'kid', tags: [] as string[] };

function feeding(id: string, startMinAgo: number, endMinAgo: number, childId = 'kid'): Entry {
  return {
    ...base,
    childId,
    id,
    type: 'feeding',
    start: NOW - startMinAgo * MIN,
    end: NOW - endMinAgo * MIN,
    feedType: 'breast',
    method: 'bottle',
    amount: null,
  };
}

function sleep(id: string, startMinAgo: number, endMinAgo: number, childId = 'kid'): Entry {
  return {
    ...base,
    childId,
    id,
    type: 'sleep',
    start: NOW - startMinAgo * MIN,
    end: NOW - endMinAgo * MIN,
    nap: true,
  };
}

function diaper(id: string, minAgo: number, childId = 'kid'): Entry {
  return { ...base, childId, id, type: 'diaper', time: NOW - minAgo * MIN, wet: true, solid: false, color: null };
}

describe('timerQuickSets', () => {
  it('leads with a Now chip targeting the current instant', () => {
    const [first] = timerQuickSets([], 'kid', NOW);
    expect(first).toEqual({ key: 'now', label: 'Now', at: NOW });
  });

  it('trails with fixed 30m, 1h and 2h chips spoken in full words', () => {
    const sets = timerQuickSets([], 'kid', NOW);
    expect(sets.slice(1)).toEqual([
      { key: 'ago30', label: '30m ago', at: NOW - 30 * MIN, spoken: 'Start 30 minutes ago' },
      { key: 'ago60', label: '1h ago', at: NOW - 60 * MIN, spoken: 'Start 1 hour ago' },
      { key: 'ago120', label: '2h ago', at: NOW - 120 * MIN, spoken: 'Start 2 hours ago' },
    ]);
  });

  it('puts the feed, wake and diaper anchors between Now and the fixed chips', () => {
    const sets = timerQuickSets(
      [feeding('f', 180, 120), sleep('s', 100, 45), diaper('d', 60)],
      'kid',
      NOW,
    );
    expect(sets.map((q) => q.key)).toEqual(['now', 'lastfeed', 'wake', 'diaper', 'ago30', 'ago60', 'ago120']);
    expect(sets.slice(1, 4)).toEqual([
      { key: 'lastfeed', label: 'Feed ended (2h)', at: NOW - 120 * MIN },
      { key: 'wake', label: 'Woke (45m)', at: NOW - 45 * MIN },
      { key: 'diaper', label: 'Diaper (1h)', at: NOW - 60 * MIN },
    ]);
  });

  it('drops the anchors the child has no entry for', () => {
    const sets = timerQuickSets([diaper('d', 60)], 'kid', NOW);
    expect(sets.map((q) => q.key)).toEqual(['now', 'diaper', 'ago30', 'ago60', 'ago120']);
  });

  it('ignores another child sibling entries', () => {
    const sets = timerQuickSets([feeding('f', 180, 120, 'sibling')], 'kid', NOW);
    expect(sets.map((q) => q.key)).toEqual(['now', 'ago30', 'ago60', 'ago120']);
  });

  it('offers no anchors for an unattributed timer', () => {
    const sets = timerQuickSets([feeding('f', 180, 120), diaper('d', 60)], undefined, NOW);
    expect(sets.map((q) => q.key)).toEqual(['now', 'ago30', 'ago60', 'ago120']);
  });
});
