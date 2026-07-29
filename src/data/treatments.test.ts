import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTreatments, loadTreatments, saveTreatments } from '@/data/treatments';
import type { Treatment } from '@/types/models';

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

const interval: Treatment = {
  id: 'treatment-1',
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

const timesOfDay: Treatment = {
  id: 'treatment-2',
  childId: 'c2',
  name: 'Vitamin D',
  scheduleMode: 'timesOfDay',
  timesOfDay: ['morning', 'evening'],
  fromDate: 1_700_000_000_000,
  active: false,
};

describe('treatments persistence', () => {
  it('returns an empty array when nothing is stored', async () => {
    expect(await loadTreatments()).toEqual([]);
  });

  it('round-trips a list of treatments (both schedule modes, open-ended and paused)', async () => {
    await saveTreatments([interval, timesOfDay]);
    expect(await loadTreatments()).toEqual([interval, timesOfDay]);
  });

  it('clearTreatments removes the stored list', async () => {
    await saveTreatments([interval]);
    await clearTreatments();
    expect(await loadTreatments()).toEqual([]);
  });
});
