import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAdoptTarget, loadAdoptTarget, saveAdoptTarget } from '@/data/adoptTarget';

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

beforeEach(() => {
  mem.store.clear();
});

describe('adoptTarget persistence', () => {
  it('returns null when nothing is saved', async () => {
    expect(await loadAdoptTarget()).toBeNull();
  });

  it('round-trips a saved target', async () => {
    await saveAdoptTarget('https://server-a.lan');
    expect(await loadAdoptTarget()).toBe('https://server-a.lan');
  });

  it('overwrites a previously saved target', async () => {
    await saveAdoptTarget('https://server-a.lan');
    await saveAdoptTarget('https://server-b.lan');
    expect(await loadAdoptTarget()).toBe('https://server-b.lan');
  });

  it('clears the saved target', async () => {
    await saveAdoptTarget('https://server-a.lan');
    await clearAdoptTarget();
    expect(await loadAdoptTarget()).toBeNull();
  });
});
