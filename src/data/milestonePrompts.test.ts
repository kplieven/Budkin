import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMilestonePrompts, saveMilestonePrompts } from '@/data/milestonePrompts';

// In-memory stand-in for AsyncStorage (node env has no native module).
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
  },
}));

beforeEach(() => {
  mem.store.clear();
});

describe('milestonePrompts persistence', () => {
  it('returns an empty map when nothing is stored', async () => {
    expect(await loadMilestonePrompts()).toEqual({});
  });

  it('round-trips the per-child answered map', async () => {
    await saveMilestonePrompts({ c1: ['waves-bye', 'first-word'], c2: ['crawls'] });
    expect(await loadMilestonePrompts()).toEqual({ c1: ['waves-bye', 'first-word'], c2: ['crawls'] });
  });
});
