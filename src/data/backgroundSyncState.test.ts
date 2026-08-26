import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadLastBackgroundSyncAt, saveLastBackgroundSyncAt } from '@/data/backgroundSyncState';

// In-memory stand-in for AsyncStorage (node env has no native module).
const mem = vi.hoisted(() => ({ store: new Map<string, string>(), fail: false }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => {
      if (mem.fail) throw new Error('boom');
      return mem.store.get(k) ?? null;
    }),
    setItem: vi.fn(async (k: string, v: string) => {
      if (mem.fail) throw new Error('boom');
      mem.store.set(k, v);
    }),
  },
}));

beforeEach(() => {
  mem.store.clear();
  mem.fail = false;
});

describe('backgroundSyncState persistence', () => {
  it('returns null when nothing is stored', async () => {
    expect(await loadLastBackgroundSyncAt()).toBeNull();
  });

  it('round-trips a timestamp', async () => {
    await saveLastBackgroundSyncAt(1_700_000_000_000);
    expect(await loadLastBackgroundSyncAt()).toBe(1_700_000_000_000);
  });

  it('round-trips 0 rather than treating it as absent', async () => {
    await saveLastBackgroundSyncAt(0);
    expect(await loadLastBackgroundSyncAt()).toBe(0);
  });

  it('returns null for a non-numeric stored value', async () => {
    mem.store.set('budkin.bgsync.v1', 'garbage');
    expect(await loadLastBackgroundSyncAt()).toBeNull();
  });

  it('returns null instead of throwing when storage fails', async () => {
    mem.fail = true;
    await expect(loadLastBackgroundSyncAt()).resolves.toBeNull();
  });

  it('swallows a write failure', async () => {
    mem.fail = true;
    await expect(saveLastBackgroundSyncAt(1)).resolves.toBeUndefined();
  });
});
