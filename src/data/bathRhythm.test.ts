import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBathRhythms, saveBathRhythms } from '@/data/bathRhythm';

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

const KEY = 'budkin.bathRhythm.v1';

beforeEach(() => {
  mem.store.clear();
});

describe('bathRhythm storage', () => {
  it('returns an empty map when nothing is stored', async () => {
    expect(await loadBathRhythms()).toEqual({});
  });

  it('round-trips a per-child map', async () => {
    const map = { c1: { fullEveryDays: 3, quickEveryDays: 1 }, c2: { fullEveryDays: 1, quickEveryDays: 0 } };
    await saveBathRhythms(map);
    expect(await loadBathRhythms()).toEqual(map);
  });

  it('treats unparseable storage as empty rather than throwing', async () => {
    mem.store.set(KEY, '{not json');
    expect(await loadBathRhythms()).toEqual({});
  });
});
