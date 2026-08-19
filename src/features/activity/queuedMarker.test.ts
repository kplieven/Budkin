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
    // `enterLocal` does not clear `budkin.queue.v1`, so a device that used a server
    // before carries stale ids into local mode, where there is nowhere to upload to.
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
    // Timers live in their own array with their own id space and are never enqueued
    // (`flushQueue` only pushes entries), so a shared id is only ever a coincidence.
    expect(isItemQueued(timer('t1'), queuedIdSet(['t1'], true))).toBe(false);
  });

  it('marks a queued entry that already carries a serverId', () => {
    // `serverId` is not the test and must not become one: `undoDelete` re-queues
    // through `commitWrite` with the original entry, serverId and all, and that entry
    // really is waiting to upload again.
    expect(isItemQueued(diaper('e1', 42), queuedIdSet(['e1'], true))).toBe(true);
  });

  it('does NOT mark an already-flushed entry that still has serverId == null', () => {
    // The trap this whole helper exists for: `flushQueue` discards
    // `pushEntryToServer`'s return value, so an entry stays `serverId == null` in
    // memory until the next refresh()/hydrate() replaces `entries` wholesale. A
    // serverId-based badge would keep claiming "queued" forever.
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

  it("names the row's child, so the chip History draws is also announced", () => {
    expect(
      timelineRowLabel({ activity: 'Diaper', ongoing: false, timer: false, elapsed: '', queued: false, child: ', Mara' }),
    ).toBe('Edit Diaper, Mara');
  });

  it('puts the child with the activity, before the elapsed time', () => {
    // Whose row this is is part of WHAT the row is, not something still true of it, so
    // it goes in the first clause rather than trailing the sentence.
    expect(
      timelineRowLabel({ activity: 'Sleep', ongoing: true, timer: true, elapsed: '20m', queued: false, child: ', Tom' }),
    ).toBe('Edit running Sleep timer, Tom, 20m so far');
  });

  it('keeps the queued clause last even with a child named', () => {
    expect(
      timelineRowLabel({ activity: 'Sleep', ongoing: true, timer: false, elapsed: '20m', queued: true, child: ', Tom' }),
    ).toBe('Edit running Sleep, Tom, 20m so far, waiting to upload');
  });

  it('says nothing extra when the household view is off or the household has one child', () => {
    // `childAttribution` returns '' rather than null for the spoken form, and an absent
    // prop is the desktop rail, which never attributes at all. Both must land on the
    // byte-identical bare label.
    const bare = timelineRowLabel({ activity: 'Diaper', ongoing: false, timer: false, elapsed: '', queued: false });
    expect(
      timelineRowLabel({ activity: 'Diaper', ongoing: false, timer: false, elapsed: '', queued: false, child: '' }),
    ).toBe(bare);
    expect(bare).toBe('Edit Diaper');
  });
});
