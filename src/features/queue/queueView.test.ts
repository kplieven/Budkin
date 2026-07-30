import { describe, expect, it } from 'vitest';

import {
  attributionFor,
  entryCountLabel,
  queueSummaryHint,
  queueSummaryLine,
  queueTypeCounts,
  syncBlockedBy,
  syncBlockedHint,
  syncResultMessage,
} from '@/features/queue/queueView';
import type { Entry } from '@/types/models';

const NOW = 1_700_000_000_000;

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

describe('queueSummaryHint', () => {
  it('says the read is still running rather than claiming nothing is waiting', () => {
    // An unread queue counts 0, so the empty copy under a "Reading the queue"
    // headline would tell a user everything is synced before anything is known.
    expect(queueSummaryHint(false, 0)).toBe('Checking what is still waiting to upload.');
  });

  it('claims nothing is waiting only once the queue really has been read', () => {
    expect(queueSummaryHint(true, 0)).toContain('Nothing is waiting right now');
  });

  it('never sends the user to History, which two queued types never reach', () => {
    // commitWrite queues any Entry. A queued note shows only in the Notes tab
    // and a queued milestone only in the Growth checklist, so a blanket "they
    // already show in History" is false for both.
    expect(queueSummaryHint(true, 3)).not.toContain('History');
    expect(queueSummaryHint(true, 0)).not.toContain('History');
    expect(queueSummaryHint(false, 0)).not.toContain('History');
  });

  it('reassures without a false claim once entries are waiting', () => {
    expect(queueSummaryHint(true, 3)).toContain('saved on this device');
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
  const live = { loaded: true, serverMode: true, offline: false, count: 2 };

  it('lets the button run with a read queue, a connected server, online, and something queued', () => {
    expect(syncBlockedBy(live)).toBeNull();
  });

  it('blocks in local mode, where there is no server to upload to', () => {
    expect(syncBlockedBy({ ...live, serverMode: false })).toBe('local');
  });

  it('blocks while offline, matching the flushQueue guard', () => {
    // flushQueue returns early on `offline`, so an enabled button would be a
    // no-op that looks like a working one.
    expect(syncBlockedBy({ ...live, offline: true })).toBe('offline');
  });

  it('blocks on an empty queue', () => {
    expect(syncBlockedBy({ ...live, count: 0 })).toBe('empty');
  });

  it('reports the read ahead of everything else, so the button does not flicker', () => {
    // An unread queue counts 0, so without this every visit would grey the
    // button as "empty" for the length of an AsyncStorage round trip and then
    // enable it, for no reason the user can see.
    expect(syncBlockedBy({ ...live, loaded: false, count: 0 })).toBe('loading');
  });

  it('reports local mode ahead of offline, since the missing server is the real reason', () => {
    expect(syncBlockedBy({ ...live, serverMode: false, offline: true, count: 0 })).toBe('local');
  });
});

describe('syncBlockedHint', () => {
  it('explains local mode and offline', () => {
    expect(syncBlockedHint('local')).toContain('Local mode');
    expect(syncBlockedHint('offline')).toContain('No connection');
  });

  it('says nothing while reading, on a merely empty queue, or when the button is live', () => {
    // The card above already says everything is synced, and a read is over
    // before a sentence about it could be read.
    expect(syncBlockedHint('loading')).toBeNull();
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

  it('does not call a flush a failure just because the queue grew during it', () => {
    // 2 queued, both uploaded, the widget enqueues 3 while the flush runs. The
    // old `after >= before` branch told the user "Nothing uploaded" after a
    // flush that uploaded everything it had.
    const msg = syncResultMessage(2, 3);
    expect(msg).not.toContain('Nothing uploaded');
    expect(msg).toBe('3 entries waiting now. More were logged while the sync ran, so what went up cannot be told apart.');
  });

  it('reports an empty queue rather than an upload of nothing', () => {
    expect(syncResultMessage(0, 0)).toBe('Nothing was waiting.');
  });
});
