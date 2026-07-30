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

  it('lets the button run with a read queue and a server connection', () => {
    expect(syncBlockedBy(live)).toBeNull();
  });

  it('blocks in local mode, where there is no server to reach', () => {
    expect(syncBlockedBy({ ...live, serverMode: false })).toBe('local');
  });

  it('stays available while offline, because trying the network again is the point', () => {
    // The old contract mirrored flushQueue's `offline` guard and greyed the
    // button out at exactly the moment the user came here to press it. The
    // handler re-checks the connection first now (`refresh()`, the only call
    // that can clear `offline`), so being offline is the reason to press this
    // button rather than a reason to disable it.
    expect(syncBlockedBy({ ...live, offline: true })).toBeNull();
  });

  it('stays available on an empty queue, where there is still a connection to re-check', () => {
    expect(syncBlockedBy({ ...live, count: 0 })).toBeNull();
    expect(syncBlockedBy({ ...live, offline: true, count: 0 })).toBeNull();
  });

  it('reports the read ahead of everything else, so a result cannot land on a card still reading', () => {
    // An unread queue counts 0, and a result line under a card still headed
    // "Reading the queue" answers a question the screen has not asked yet.
    expect(syncBlockedBy({ ...live, loaded: false, count: 0 })).toBe('loading');
  });

  it('reports local mode ahead of an offline connection, since the missing server is the real reason', () => {
    expect(syncBlockedBy({ ...live, serverMode: false, offline: true, count: 0 })).toBe('local');
  });
});

describe('syncBlockedHint', () => {
  it('explains local mode, the one state no retry can get out of', () => {
    expect(syncBlockedHint('local')).toContain('Local mode');
  });

  it('says nothing while reading or when the button is live', () => {
    // A read is over before a sentence about it could be read, and a live
    // button needs no excuse.
    expect(syncBlockedHint('loading')).toBeNull();
    expect(syncBlockedHint(null)).toBeNull();
  });
});

describe('syncResultMessage', () => {
  it('reports a clean flush', () => {
    expect(syncResultMessage({ offline: false, before: 3, after: 0 })).toBe('Uploaded 3 entries.');
    expect(syncResultMessage({ offline: false, before: 1, after: 0 })).toBe('Uploaded 1 entry.');
  });

  it('reports a partial flush honestly', () => {
    expect(syncResultMessage({ offline: false, before: 4, after: 1 })).toBe('Uploaded 3 of 4. 1 entry still waiting.');
  });

  it('never claims success when everything was re-queued', () => {
    // flushQueue swallows a throwing push and puts the entry straight back, so
    // "nothing moved" is the only thing the screen can honestly say.
    expect(syncResultMessage({ offline: false, before: 2, after: 2 })).toBe('Nothing uploaded. 2 entries still waiting.');
  });

  it('does not call a flush a failure just because the queue grew during it', () => {
    // 2 queued, both uploaded, the widget enqueues 3 while the flush runs. The
    // old `after >= before` branch told the user "Nothing uploaded" after a
    // flush that uploaded everything it had.
    const msg = syncResultMessage({ offline: false, before: 2, after: 3 });
    expect(msg).not.toContain('Nothing uploaded');
    expect(msg).toBe('3 entries waiting now. More were logged while the sync ran, so what went up cannot be told apart.');
  });

  it('says the connection is back when the queue was empty to begin with', () => {
    // Pressing Retry with nothing queued is a connection check, so the answer
    // has to be about the connection. "Nothing was waiting." alone would leave
    // the one thing the user pressed for unanswered.
    expect(syncResultMessage({ offline: false, before: 0, after: 0 })).toBe('Connected. Nothing was waiting to upload.');
  });

  it('blames the connection, not the queue, when the server still cannot be reached', () => {
    // flushQueue returns early on exactly this flag, so nothing can have gone
    // up: "Nothing uploaded" would read as a failed upload of entries that
    // were never even attempted.
    const msg = syncResultMessage({ offline: true, before: 2, after: 2 });
    expect(msg).toBe('No connection to the server. 2 entries still waiting.');
    expect(msg).not.toContain('Nothing uploaded');
  });

  it('never claims an upload while the connection is still down', () => {
    expect(syncResultMessage({ offline: true, before: 3, after: 3 })).not.toContain('Uploaded');
    expect(syncResultMessage({ offline: true, before: 0, after: 0 })).not.toContain('Uploaded');
  });

  it('does not call an empty queue a success while the server is unreachable', () => {
    // Retry pressed offline with nothing queued: "Connected." would be a
    // straight lie, and "Nothing was waiting." would quietly imply it worked.
    expect(syncResultMessage({ offline: true, before: 0, after: 0 })).toBe(
      'No connection to the server. Nothing is waiting to upload.',
    );
  });
});
