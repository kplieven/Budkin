import { describe, expect, it } from 'vitest';

import {
  attributionFor,
  entryCountLabel,
  offlineHint,
  queueSummaryHint,
  queueSummaryLine,
  queueTypeCounts,
  runQueueRetry,
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

  it('stays silent for a record with no owner at all', () => {
    // Only reachable through the timer cards: `Timer.childId` is optional where
    // an `Entry`'s is not. Silence, never the selected child.
    expect(attributionFor(undefined, kids)).toBeNull();
  });
});

describe('syncBlockedBy', () => {
  // Neither the connection nor the queue count is an argument any more, so
  // neither can grey the button out: being offline is the reason to press Retry
  // (it re-checks the connection before it flushes) and an empty queue still has
  // a connection worth re-checking. `offlineHint` says what is going on instead.
  const live = { loaded: true, serverMode: true };

  it('lets the button run with a read queue and a server connection', () => {
    expect(syncBlockedBy(live)).toBeNull();
  });

  it('blocks in local mode, where there is no server to reach', () => {
    expect(syncBlockedBy({ ...live, serverMode: false })).toBe('local');
  });

  it('reports the read ahead of everything else, so a result cannot land on a card still reading', () => {
    // An unread queue counts 0, and a result line under a card still headed
    // "Reading the queue" answers a question the screen has not asked yet.
    expect(syncBlockedBy({ ...live, loaded: false })).toBe('loading');
    expect(syncBlockedBy({ loaded: false, serverMode: false })).toBe('loading');
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

describe('offlineHint', () => {
  const unpressed = { block: null, answered: false } as const;

  it('says the connection is down while the button stays live', () => {
    // On mobile this route is a stack screen with no offline banner over it, so
    // without this line an offline user sees a live Retry and nothing at all
    // saying why entries are piling up.
    const hint = offlineHint({ ...unpressed, offline: true });
    expect(hint).toContain('No connection');
    // Informational, never a block: the press is exactly what re-checks.
    expect(syncBlockedBy({ loaded: true, serverMode: true })).toBeNull();
  });

  it('says nothing while the server is reachable', () => {
    expect(offlineHint({ ...unpressed, offline: false })).toBeNull();
    expect(offlineHint({ offline: false, block: 'loading', answered: false })).toBeNull();
  });

  it('stays quiet in local mode, where there is no server to be cut off from', () => {
    // `syncBlockedHint('local')` owns the slot there, and two sentences under
    // one button would have the screen blaming a connection that is not the
    // reason anything is blocked.
    expect(offlineHint({ offline: true, block: 'local', answered: false })).toBeNull();
  });

  it('speaks up while the queue is still being read', () => {
    // The connection is known independently of the AsyncStorage read, so
    // holding the line back would only make it appear a beat late.
    expect(offlineHint({ offline: true, block: 'loading', answered: false })).toContain('No connection');
  });

  it('gives way to the result of a press, rather than repeating it', () => {
    // Every offline `syncResultMessage` opens with "No connection to the
    // server", so leaving this up would stack two lines saying the same thing,
    // one of them answering a question the user has actually asked.
    expect(offlineHint({ offline: true, block: null, answered: true })).toBeNull();
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

  it('never claims an upload when nothing left the queue, connection down or not', () => {
    expect(syncResultMessage({ offline: true, before: 3, after: 3 })).not.toContain('Uploaded');
    expect(syncResultMessage({ offline: true, before: 0, after: 0 })).not.toContain('Uploaded');
  });

  it('still reports what went up when the connection dropped after the upload', () => {
    // The flush emptied the queue and the connection went down after it (the
    // NetInfo listener, a server that stopped answering the next call). Judging
    // by the flag alone hid three uploads behind "Nothing is waiting to
    // upload.", which reads as a retry that achieved nothing.
    expect(syncResultMessage({ offline: true, before: 3, after: 0 })).toBe(
      'Uploaded 3 entries. No connection to the server.',
    );
  });

  it('reports a part-finished upload that the connection cut short', () => {
    expect(syncResultMessage({ offline: true, before: 4, after: 1 })).toBe(
      'Uploaded 3 of 4. No connection to the server. 1 entry still waiting.',
    );
  });

  it('does not call an empty queue a success while the server is unreachable', () => {
    // Retry pressed offline with nothing queued: "Connected." would be a
    // straight lie, and "Nothing was waiting." would quietly imply it worked.
    expect(syncResultMessage({ offline: true, before: 0, after: 0 })).toBe(
      'No connection to the server. Nothing is waiting to upload.',
    );
  });
});

describe('runQueueRetry', () => {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('counts, re-checks the connection, flushes, counts again, and only then reads offline', async () => {
    const calls: string[] = [];
    await runQueueRetry({
      read: async () => {
        calls.push('read');
        return [];
      },
      refresh: async () => {
        calls.push('refresh');
      },
      flushQueue: async () => {
        calls.push('flush');
      },
      getOffline: () => {
        calls.push('offline');
        return false;
      },
    });
    expect(calls).toEqual(['read', 'refresh', 'flush', 'read', 'offline']);
  });

  it('does not start the flush until the refresh has settled', async () => {
    // Not merely "refresh was called first": the flush has to wait for the
    // re-check to finish, because `flushQueue` returns early while `offline` is
    // still set and a flush racing the refresh is the no-op this button exists
    // to stop being.
    let releaseRefresh = () => {};
    const refreshing = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let flushed = false;
    const done = runQueueRetry({
      read: async () => [],
      refresh: () => refreshing,
      flushQueue: async () => {
        flushed = true;
      },
      getOffline: () => false,
    });
    await tick();
    expect(flushed).toBe(false);
    releaseRefresh();
    await done;
    expect(flushed).toBe(true);
  });

  it('reports the connection the retry left behind, not the one it started from', async () => {
    // Pressed with no connection, and the re-check got through: reading the
    // flag captured at press time would report a successful upload as a dead
    // connection.
    let offline = true;
    let queue = ['a', 'b'];
    const msg = await runQueueRetry({
      read: async () => queue,
      refresh: async () => {
        offline = false;
      },
      flushQueue: async () => {
        queue = [];
      },
      getOffline: () => offline,
    });
    expect(msg).toBe('Uploaded 2 entries.');
  });

  it('reads offline after the flush, not just after the refresh', async () => {
    let offline = false;
    let queue = ['a', 'b'];
    const msg = await runQueueRetry({
      read: async () => queue,
      refresh: async () => {},
      flushQueue: async () => {
        queue = ['b'];
        offline = true;
      },
      getOffline: () => offline,
    });
    expect(msg).toBe('Uploaded 1 of 2. No connection to the server. 1 entry still waiting.');
  });

  it('counts the queue after the flush has finished, not while it runs', async () => {
    let queue = ['a', 'b', 'c'];
    let flushing = false;
    const msg = await runQueueRetry({
      read: async () => {
        // A read taken mid-flush would see the queue as it was and report
        // "Nothing uploaded." after a flush that emptied it.
        expect(flushing).toBe(false);
        return queue;
      },
      refresh: async () => {},
      flushQueue: async () => {
        flushing = true;
        await tick();
        queue = [];
        flushing = false;
      },
      getOffline: () => false,
    });
    expect(msg).toBe('Uploaded 3 entries.');
  });

  it('reports from the counts when the refresh throws instead of rejecting', async () => {
    let queue = ['a'];
    const msg = await runQueueRetry({
      read: async () => queue,
      refresh: async () => {
        throw new Error('unreachable');
      },
      flushQueue: async () => {
        queue = [];
      },
      getOffline: () => true,
    });
    // The flush never ran, so nothing moved and the flag is the whole story.
    expect(msg).toBe('No connection to the server. 1 entry still waiting.');
  });

  it('reports from the counts when the flush throws', async () => {
    const msg = await runQueueRetry({
      read: async () => ['a', 'b'],
      refresh: async () => {},
      flushQueue: async () => {
        throw new Error('boom');
      },
      getOffline: () => false,
    });
    expect(msg).toBe('Nothing uploaded. 2 entries still waiting.');
  });
});
