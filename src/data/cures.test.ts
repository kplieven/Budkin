import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCures, loadCures, saveCures } from '@/data/cures';
import type { Cure } from '@/types/models';

// In-memory stand-in for AsyncStorage (node env has no native module).
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

const interval: Cure = {
  id: 'cure-1',
  childId: 'c1',
  name: 'Paracetamol',
  scheduleMode: 'everyHours',
  everyHours: 6,
  dosage: 2.5,
  dosageUnit: 'mL',
  fromDate: 1_700_000_000_000,
  toDate: 1_700_864_000_000,
  notes: 'after meals',
  condition: 'fever',
  active: true,
};

const timesOfDay: Cure = {
  id: 'cure-2',
  childId: 'c2',
  name: 'Vitamin D',
  scheduleMode: 'timesOfDay',
  timesOfDay: ['morning', 'evening'],
  fromDate: 1_700_000_000_000,
  active: false,
};

describe('cures persistence', () => {
  it('returns an empty array when nothing is stored', async () => {
    expect(await loadCures()).toEqual([]);
  });

  it('round-trips a list of cures (both schedule modes, open-ended and paused)', async () => {
    await saveCures([interval, timesOfDay]);
    expect(await loadCures()).toEqual([interval, timesOfDay]);
  });

  it('clearCures removes the stored list', async () => {
    await saveCures([interval]);
    await clearCures();
    expect(await loadCures()).toEqual([]);
  });
});
