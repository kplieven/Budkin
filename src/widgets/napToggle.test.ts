import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadQueue } from '@/data/queue';
import { loadTimers, saveTimers } from '@/data/timers';
import { toggleNapFromWidget } from '@/widgets/napToggle';
import { writeWidgetSnapshot, type WidgetSnapshot } from '@/widgets/snapshot';

// In-memory stand-in for the native AsyncStorage module (same pattern as timers.test.ts).
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      mem.store.delete(k);
    }),
  },
}));

const snap = (over: Partial<WidgetSnapshot> = {}): WidgetSnapshot => ({
  childName: 'Ada',
  birth: null,
  lastFeedStart: null,
  nextSide: 'left',
  lastDiaper: null,
  lastDiaperSolid: false,
  sleepStart: null,
  sleepTodayMin: 0,
  feedsToday: 0,
  diapersToday: 0,
  selectedChildId: 'c1',
  canQueueNap: true,
  ...over,
});

beforeEach(() => {
  mem.store.clear();
});

describe('toggleNapFromWidget', () => {
  it('returns null when there is no snapshot yet', async () => {
    expect(await toggleNapFromWidget(1000)).toBeNull();
  });

  it('start: creates a sleep timer and sets sleepStart, queues nothing', async () => {
    await writeWidgetSnapshot(snap());
    const next = await toggleNapFromWidget(1000);
    expect(next?.sleepStart).toBe(1000);
    const timers = await loadTimers();
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({ activity: 'sleep', start: 1000 });
    expect(await loadQueue()).toHaveLength(0);
  });

  it('stop: queues the nap, clears the timer, clears sleepStart', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const next = await toggleNapFromWidget(5000);
    expect(next?.sleepStart).toBeNull();
    expect(await loadTimers()).toHaveLength(0);
    const q = await loadQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ type: 'sleep', start: 1000, end: 5000, childId: 'c1' });
  });

  it('stop in demo mode: clears the timer but queues nothing', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000, canQueueNap: false }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const next = await toggleNapFromWidget(5000);
    expect(next?.sleepStart).toBeNull();
    expect(await loadTimers()).toHaveLength(0);
    expect(await loadQueue()).toHaveLength(0);
  });
});
