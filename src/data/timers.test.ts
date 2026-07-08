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

  it('round-trips a staged end time', async () => {
    const timers: Timer[] = [{ ...t('a'), stagedEnd: 500 }];
    await saveTimers(timers);
    expect(await loadTimers()).toEqual(timers);
  });

  it('clears saved timers', async () => {
    await saveTimers([t('a')]);
    await clearTimers();
    expect(await loadTimers()).toEqual([]);
  });
});
