import { describe, expect, it } from 'vitest';

import { isItemQueued, queuedIdSet, timelineRowLabel } from '@/features/activity/queuedMarker';
import type { Entry, Timer } from '@/types/models';

const NOW = 1_700_000_000_000;

const diaper = (id: string, serverId?: number): Entry => ({
  id,
  serverId,
  childId: 'c1',
  tags: [],
  type: 'diaper',
  time: NOW,
  wet: true,
  solid: false,
  color: null,
});

const timer = (id: string): Timer => ({
  id,
  childId: 'c1',
  name: 'Sleep',
  activity: 'sleep',
  saveAs: 'sleep',
  start: NOW,
});

describe('queuedIdSet', () => {
  it('is the queued ids in server mode', () => {
    const set = queuedIdSet(['a', 'b'], true);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('is empty in local mode even when the queue file still holds ids', () => {
    // `enterLocal` does not clear `budkin.queue.v1`, so a device that used a
    // server before can carry stale ids into local mode. Nothing there is
    // waiting to upload: local mode has nowhere to upload to.
    expect(queuedIdSet(['a', 'b'], false).size).toBe(0);
  });

  it('is empty for an empty queue', () => {
    expect(queuedIdSet([], true).size).toBe(0);
  });
});

describe('isItemQueued', () => {
  it('marks an entry whose id is on the queue', () => {
    expect(isItemQueued(diaper('e1'), queuedIdSet(['e1'], true))).toBe(true);
  });

  it('leaves an entry that is not on the queue alone', () => {
    expect(isItemQueued(diaper('e2'), queuedIdSet(['e1'], true))).toBe(false);
  });

  it('never marks a running timer, even on an id collision', () => {
    // Timers live in their own array with their own id space and are never
    // enqueued (`flushQueue` only pushes entries), so a shared id could only
    // ever be a coincidence, and marking one would be a plain lie.
    expect(isItemQueued(timer('t1'), queuedIdSet(['t1'], true))).toBe(false);
  });

  it('marks a queued entry that already carries a serverId', () => {
    // `serverId` is not the test and must not become one. The reverse case
    // below is the one that actually bites, but `undoDelete` re-queues through
    // `commitWrite` with the original entry, serverId and all, and that entry
    // really is waiting to upload again.
    expect(isItemQueued(diaper('e1', 42), queuedIdSet(['e1'], true))).toBe(true);
  });

  it('does NOT mark an already-flushed entry that still has serverId == null', () => {
    // The trap this whole helper exists for: `flushQueue` discards
    // `pushEntryToServer`'s return value, so an entry stays `serverId == null`
    // in memory until the next refresh()/hydrate() replaces `entries`
    // wholesale. A serverId-based badge would keep claiming "queued" forever.
    expect(isItemQueued(diaper('e1'), queuedIdSet([], true))).toBe(false);
  });
});

describe('timelineRowLabel', () => {
  it('is a plain edit label for a finished, synced row', () => {
    expect(timelineRowLabel({ activity: 'Diaper', ongoing: false, timer: false, elapsed: '', queued: false })).toBe(
      'Edit Diaper',
    );
  });

  it('says the row is still waiting to upload', () => {
    expect(timelineRowLabel({ activity: 'Diaper', ongoing: false, timer: false, elapsed: '', queued: true })).toBe(
      'Edit Diaper, waiting to upload',
    );
  });

  it('keeps the elapsed time on an ongoing entry', () => {
    expect(timelineRowLabel({ activity: 'Sleep', ongoing: true, timer: false, elapsed: '1h 18m', queued: false })).toBe(
      'Edit running Sleep, 1h 18m so far',
    );
  });

  it('names a running timer as a timer', () => {
    expect(timelineRowLabel({ activity: 'Sleep', ongoing: true, timer: true, elapsed: '20m', queued: false })).toBe(
      'Edit running Sleep timer, 20m so far',
    );
  });

  it('appends the queued state after the elapsed time on an ongoing entry', () => {
    expect(timelineRowLabel({ activity: 'Sleep', ongoing: true, timer: false, elapsed: '20m', queued: true })).toBe(
      'Edit running Sleep, 20m so far, waiting to upload',
    );
  });
});
