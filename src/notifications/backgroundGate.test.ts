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
});
