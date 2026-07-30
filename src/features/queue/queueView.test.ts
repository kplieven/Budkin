import { describe, expect, it } from 'vitest';

import {
  attributionFor,
  entryCountLabel,
  groupQueuedByDay,
  queueSummaryLine,
  queueTypeCounts,
  syncBlockedBy,
  syncBlockedHint,
  syncResultMessage,
} from '@/features/queue/queueView';
import { dayGroupLabel } from '@/lib/format';
import type { Entry } from '@/types/models';

const NOW = 1_700_000_000_000;
const M = 60000;
const DAY = 86400000;

const feed = (id: string, ts: number, childId = 'c1'): Entry => ({
  id,
  childId,
  type: 'feeding',
  start: ts,
  end: ts,
  feedType: 'breast',
  method: 'left',
  amount: null,
  tags: [],
});

const diaper = (id: string, ts: number, childId = 'c1'): Entry => ({
  id,
  childId,
  type: 'diaper',
  time: ts,
  wet: true,
  solid: false,
  color: null,
  amount: null,
  tags: [],
});

const tummy = (id: string, ts: number): Entry => ({
  id,
  childId: 'c1',
  type: 'tummy',
  start: ts,
  end: ts,
  tags: [],
});

describe('entryCountLabel', () => {
  it('uses the singular for exactly one', () => {
    expect(entryCountLabel(1)).toBe('1 entry');
  });

  it('uses the plural for none and for many', () => {
    expect(entryCountLabel(0)).toBe('0 entries');
    expect(entryCountLabel(4)).toBe('4 entries');
  });
});

describe('queueSummaryLine', () => {
  it('says nothing is waiting on an empty queue', () => {
    expect(queueSummaryLine(0)).toBe('Nothing waiting to upload');
  });

  it('counts what is waiting, singular and plural', () => {
    expect(queueSummaryLine(1)).toBe('Waiting to upload: 1 entry');
    expect(queueSummaryLine(3)).toBe('Waiting to upload: 3 entries');
  });

  it('does not borrow the offline banner wording', () => {
    // selectPendingCount counts queued entries PLUS unsynced measurements, so
    // this screen must not phrase its own, smaller number as "pending".
    expect(queueSummaryLine(3).toLowerCase()).not.toContain('pending');
  });
});

describe('queueTypeCounts', () => {
  it('returns nothing for an empty queue', () => {
    expect(queueTypeCounts([])).toEqual([]);
  });

  it('counts per activity, biggest group first', () => {
    const counts = queueTypeCounts([
      diaper('d1', NOW),
      feed('f1', NOW),
      feed('f2', NOW),
      feed('f3', NOW),
      diaper('d2', NOW),
    ]);
    expect(counts.map((c) => [c.type, c.count])).toEqual([
      ['feeding', 3],
      ['diaper', 2],
    ]);
  });

  it('labels with the activity name verbatim, never pluralised', () => {
    expect(queueTypeCounts([tummy('t1', NOW), tummy('t2', NOW)])[0].label).toBe('2 Tummy time');
  });

  it('keeps queue order between equal counts', () => {
    // A stable sort must not reshuffle ties, otherwise the breakdown jumps
    // around between reloads of the same queue.
    const counts = queueTypeCounts([diaper('d1', NOW), feed('f1', NOW)]);
    expect(counts.map((c) => c.type)).toEqual(['diaper', 'feeding']);
  });
});

describe('groupQueuedByDay', () => {
  it('groups by the timestamp on the entry itself, newest day first', () => {
    const today = NOW - 10 * M;
    const older = NOW - 3 * DAY;
    const groups = groupQueuedByDay([feed('a', older), diaper('b', today)], NOW);
    expect(groups.map((g) => g.label)).toEqual([dayGroupLabel(today, NOW), dayGroupLabel(older, NOW)]);
  });

  it('keeps every queued entry exactly once', () => {
    const queue = [feed('a', NOW - 10 * M), feed('b', NOW - 2 * DAY), diaper('c', NOW - 30 * M)];
    expect(groupQueuedByDay(queue, NOW).reduce((n, g) => n + g.items.length, 0)).toBe(3);
  });

  it('has no groups for an empty queue', () => {
    expect(groupQueuedByDay([], NOW)).toEqual([]);
  });
});

describe('attributionFor', () => {
  const kids = [
    { id: 'c1', first: 'Mara' },
    { id: 'c2', first: 'Tom' },
  ];

  it('names the child when there is more than one', () => {
    expect(attributionFor('c2', kids)).toBe('Tom');
  });

  it('stays silent in a single-child household', () => {
    expect(attributionFor('c1', [{ id: 'c1', first: 'Mara' }])).toBeNull();
  });

  it('stays silent rather than showing an id for a child that is gone', () => {
    expect(attributionFor('gone', kids)).toBeNull();
  });
});

describe('syncBlockedBy', () => {
  it('lets the button run with a connected server, online, and something queued', () => {
    expect(syncBlockedBy({ serverMode: true, offline: false, count: 2 })).toBeNull();
  });

  it('blocks in local mode, where there is no server to upload to', () => {
    expect(syncBlockedBy({ serverMode: false, offline: false, count: 2 })).toBe('local');
  });

  it('blocks while offline, matching the flushQueue guard', () => {
    // flushQueue returns early on `offline`, so an enabled button would be a
    // no-op that looks like a working one.
    expect(syncBlockedBy({ serverMode: true, offline: true, count: 2 })).toBe('offline');
  });

  it('blocks on an empty queue', () => {
    expect(syncBlockedBy({ serverMode: true, offline: false, count: 0 })).toBe('empty');
  });

  it('reports local mode ahead of offline, since the missing server is the real reason', () => {
    expect(syncBlockedBy({ serverMode: false, offline: true, count: 0 })).toBe('local');
  });
});

describe('syncBlockedHint', () => {
  it('explains local mode and offline', () => {
    expect(syncBlockedHint('local')).toContain('Local mode');
    expect(syncBlockedHint('offline')).toContain('No connection');
  });

  it('says nothing when the queue is merely empty, or when the button is live', () => {
    // The empty state card already says everything is synced; a second sentence
    // under the button would only repeat it.
    expect(syncBlockedHint('empty')).toBeNull();
    expect(syncBlockedHint(null)).toBeNull();
  });
});

describe('syncResultMessage', () => {
  it('reports a clean flush', () => {
    expect(syncResultMessage(3, 0)).toBe('Uploaded 3 entries.');
    expect(syncResultMessage(1, 0)).toBe('Uploaded 1 entry.');
  });

  it('reports a partial flush honestly', () => {
    expect(syncResultMessage(4, 1)).toBe('Uploaded 3 of 4. 1 entry still waiting.');
  });

  it('never claims success when everything was re-queued', () => {
    // flushQueue swallows a throwing push and puts the entry straight back, so
    // "nothing moved" is the only thing the screen can honestly say.
    expect(syncResultMessage(2, 2)).toBe('Nothing uploaded. 2 entries still waiting.');
  });

  it('handles a queue that grew during the flush without calling it a failure', () => {
    expect(syncResultMessage(1, 2)).toBe('Nothing uploaded. 2 entries still waiting.');
  });

  it('reports an empty queue rather than an upload of nothing', () => {
    expect(syncResultMessage(0, 0)).toBe('Nothing was waiting.');
  });
});
