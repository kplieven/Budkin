import { describe, expect, it } from 'vitest';

import { PREFIRE_WINDOW_MIN, SYNC_FLOOR_H, shouldBackgroundSync } from '@/notifications/backgroundGate';

const NOW = new Date(2026, 7, 26, 14, 0).getTime();
const MIN = 60_000;
const HOUR = 3_600_000;

/** A pending reminder identifier firing `minutes` from NOW. */
function pumpId(minutes: number): string {
  return `budkin:pump:global:${NOW + minutes * MIN}`;
}

/** Everything permissive, so each test varies exactly one thing. */
function gate(over: Partial<Parameters<typeof shouldBackgroundSync>[0]> = {}) {
  return {
    pendingIds: [] as readonly string[],
    now: NOW,
    // Recent enough that the floor never fires unless a test says so.
    lastSyncAt: NOW - 1 * HOUR,
    serverMode: true,
    hasPermission: true,
    ...over,
  };
}

describe('shouldBackgroundSync', () => {
  it('exposes the agreed constants', () => {
    expect(PREFIRE_WINDOW_MIN).toBe(30);
    expect(SYNC_FLOOR_H).toBe(4);
  });

  it('stays closed with nothing pending and the floor not elapsed', () => {
    expect(shouldBackgroundSync(gate())).toBe(false);
  });

  it('opens once the idle floor has elapsed', () => {
    expect(shouldBackgroundSync(gate({ lastSyncAt: NOW - 4 * HOUR }))).toBe(true);
  });

  it('opens when it has never synced', () => {
    expect(shouldBackgroundSync(gate({ lastSyncAt: null }))).toBe(true);
  });

  it('opens for a reminder inside the pre-fire window', () => {
    expect(shouldBackgroundSync(gate({ pendingIds: [pumpId(10)] }))).toBe(true);
  });

  it('stays closed for a reminder beyond the pre-fire window', () => {
    expect(shouldBackgroundSync(gate({ pendingIds: [pumpId(120)] }))).toBe(false);
  });

  it('opens for a reminder whose fire time has already passed', () => {
    expect(shouldBackgroundSync(gate({ pendingIds: [pumpId(-5)] }))).toBe(true);
  });

  it('lets the EARLIEST pending reminder decide', () => {
    const ids = [pumpId(300), pumpId(10), pumpId(600)];
    expect(shouldBackgroundSync(gate({ pendingIds: ids }))).toBe(true);
  });

  it('stays closed off server mode even with a reminder due imminently', () => {
    expect(shouldBackgroundSync(gate({ pendingIds: [pumpId(1)], serverMode: false }))).toBe(false);
  });

  it('stays closed without permission even with a reminder due imminently', () => {
    expect(shouldBackgroundSync(gate({ pendingIds: [pumpId(1)], hasPermission: false }))).toBe(false);
  });

  it('stays closed off server mode even past the idle floor', () => {
    expect(shouldBackgroundSync(gate({ lastSyncAt: null, serverMode: false }))).toBe(false);
  });

  it('ignores identifiers that are not ours', () => {
    // A running-timer notification is a bare uuid, not a `budkin:` id.
    const ids = ['3f2b1c7e-0000-4a11-9f00-abcdef123456'];
    expect(shouldBackgroundSync(gate({ pendingIds: ids }))).toBe(false);
  });

  it('ignores a malformed reminder id rather than throwing', () => {
    const ids = ['budkin:pump', 'budkin:', 'budkin:pump:global:not-a-number'];
    expect(() => shouldBackgroundSync(gate({ pendingIds: ids }))).not.toThrow();
    expect(shouldBackgroundSync(gate({ pendingIds: ids }))).toBe(false);
  });

  it('still finds a valid id sitting alongside junk', () => {
    const ids = ['budkin:pump:global:not-a-number', 'timer-uuid', pumpId(5)];
    expect(shouldBackgroundSync(gate({ pendingIds: ids }))).toBe(true);
  });

  it('parses a head containing colons', () => {
    // `head` may itself contain colons; fireAt is read off the END.
    const ids = [`budkin:treatment:child:1:vitamin:d:${NOW + 5 * MIN}`];
    expect(shouldBackgroundSync(gate({ pendingIds: ids }))).toBe(true);
  });

  // The gate uses `<=` on the pre-fire cutoff and `>=` on the floor. Pinned, because
  // an off-by-one either misses the window a late wake was meant to catch or spends
  // network a wake early.
  describe('boundaries', () => {
    it('opens for a reminder due at EXACTLY the pre-fire window', () => {
      expect(shouldBackgroundSync(gate({ pendingIds: [pumpId(PREFIRE_WINDOW_MIN)] }))).toBe(true);
    });

    it('stays closed a millisecond beyond the pre-fire window', () => {
      const id = `budkin:pump:global:${NOW + PREFIRE_WINDOW_MIN * MIN + 1}`;
      expect(shouldBackgroundSync(gate({ pendingIds: [id] }))).toBe(false);
    });

    it('opens at EXACTLY the idle floor', () => {
      expect(shouldBackgroundSync(gate({ lastSyncAt: NOW - SYNC_FLOOR_H * HOUR }))).toBe(true);
    });

    it('stays closed a millisecond short of the idle floor', () => {
      expect(shouldBackgroundSync(gate({ lastSyncAt: NOW - SYNC_FLOOR_H * HOUR + 1 }))).toBe(false);
    });
  });

  // ~15-minute wakes land about twice inside a 30-minute pre-fire window, and a
  // Doze-deferred alarm whose fireAt is already past matches on every wake forever.
  // Without this throttle the traffic budget the whole design exists for is blown.
  describe('pre-fire throttle', () => {
    it('stays closed for a due reminder when the last sync is inside the window', () => {
      const g = gate({ pendingIds: [pumpId(5)], lastSyncAt: NOW - 10 * MIN });
      expect(shouldBackgroundSync(g)).toBe(false);
    });

    it('stays closed for a Doze-deferred alarm whose fireAt is already past', () => {
      // The wake that motivated the throttle: a past fireAt matches the cutoff on
      // EVERY subsequent wake, so only the elapsed-window check can stop it.
      const g = gate({ pendingIds: [pumpId(-45)], lastSyncAt: NOW - 14 * MIN });
      expect(shouldBackgroundSync(g)).toBe(false);
    });

    it('reopens for that same deferred alarm once the window has elapsed', () => {
      const g = gate({ pendingIds: [pumpId(-45)], lastSyncAt: NOW - 31 * MIN });
      expect(shouldBackgroundSync(g)).toBe(true);
    });

    it('opens at EXACTLY one window since the last sync', () => {
      const g = gate({ pendingIds: [pumpId(5)], lastSyncAt: NOW - PREFIRE_WINDOW_MIN * MIN });
      expect(shouldBackgroundSync(g)).toBe(true);
    });

    it('stays closed a millisecond short of one window', () => {
      const g = gate({ pendingIds: [pumpId(5)], lastSyncAt: NOW - PREFIRE_WINDOW_MIN * MIN + 1 });
      expect(shouldBackgroundSync(g)).toBe(false);
    });

    it('does not throttle the idle floor: a throttled window cannot outlast it', () => {
      // The floor is checked first, so a long-quiet device still syncs even though
      // every wake in between was throttled out.
      const g = gate({ pendingIds: [pumpId(5)], lastSyncAt: NOW - SYNC_FLOOR_H * HOUR });
      expect(shouldBackgroundSync(g)).toBe(true);
    });

    it('never throttles a device that has never synced', () => {
      expect(shouldBackgroundSync(gate({ pendingIds: [pumpId(5)], lastSyncAt: null }))).toBe(true);
    });
  });
});
