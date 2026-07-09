import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTimers, loadTimers, saveTimers } from '@/data/timers';
import type { Timer } from '@/types/models';

// In-memory stand-in for the native AsyncStorage module.
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

const t = (id: string): Timer => ({ id, activity: 'sleep', name: 'Sleep', start: 1, saveAs: 'sleep' });

beforeEach(() => {
  mem.store.clear();
});

describe('timers persistence', () => {
  it('returns [] when nothing is saved', async () => {
    expect(await loadTimers()).toEqual([]);
  });

  it('round-trips saved timers', async () => {
    const timers = [t('a'), t('b')];
    await saveTimers(timers);
    expect(await loadTimers()).toEqual(timers);
  });

  it('strips a legacy stagedEnd field from older persisted timers instead of crashing', async () => {
    // Simulate a timer persisted by a pre-WI-4 build, before `stagedEnd` was
    // removed from the Timer model.
    const legacy = { ...t('a'), stagedEnd: 500 };
    mem.store.set('babybuddy.timers.v1', JSON.stringify([legacy]));
    expect(await loadTimers()).toEqual([t('a')]);
  });

  it('clears saved timers', async () => {
    await saveTimers([t('a')]);
    await clearTimers();
    expect(await loadTimers()).toEqual([]);
  });
});
