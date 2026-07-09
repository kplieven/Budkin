import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearEntities,
  loadEntities,
  saveChildren,
  saveEntries,
  saveLastFeed,
  saveMeasurements,
  saveSelectedChildId,
} from '@/data/entityStore';
import type { Child, Entry, Measurement } from '@/types/models';

// In-memory stand-in for the native AsyncStorage module.
const mem = vi.hoisted(() => ({ store: new Map<string, string>(), rejectKeys: new Set<string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => {
      if (mem.rejectKeys.has(k)) throw new Error(`simulated native I/O error reading "${k}"`);
      return mem.store.get(k) ?? null;
    }),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      mem.store.delete(k);
    }),
  },
}));

const child = (id: string): Child => ({
  id,
  first: 'Ada',
  last: 'Lovelace',
  birth: 1000,
  color: '#abcdef',
});

const entry = (id: string): Entry => ({
  id,
  childId: 'c1',
  tags: [],
  type: 'sleep',
  start: 1,
  end: null,
  nap: false,
});

const measurement = (id: string): Measurement => ({
  id,
  childId: 'c1',
  kind: 'weight',
  value: 5.2,
  date: 1000,
});

beforeEach(() => {
  mem.store.clear();
  mem.rejectKeys.clear();
});

describe('entityStore persistence', () => {
  it('returns null when nothing has ever been persisted', async () => {
    expect(await loadEntities()).toBeNull();
  });

  it('round-trips saved children', async () => {
    const children = [child('a'), child('b')];
    await saveChildren(children);
    const loaded = await loadEntities();
    expect(loaded?.children).toEqual(children);
  });

  it('round-trips saved entries', async () => {
    const entries = [entry('a'), entry('b')];
    await saveEntries(entries);
    const loaded = await loadEntities();
    expect(loaded?.entries).toEqual(entries);
  });

  it('round-trips saved measurements', async () => {
    const measurements = [measurement('a'), measurement('b')];
    await saveMeasurements(measurements);
    const loaded = await loadEntities();
    expect(loaded?.measurements).toEqual(measurements);
  });

  it('round-trips the selected child id', async () => {
    await saveSelectedChildId('c1');
    const loaded = await loadEntities();
    expect(loaded?.selectedChildId).toEqual('c1');
  });

  it('round-trips the last-feed defaults', async () => {
    await saveLastFeed({ feedType: 'formula', method: 'bottle' });
    const loaded = await loadEntities();
    expect(loaded?.lastFeed).toEqual({ feedType: 'formula', method: 'bottle' });
  });

  it('defaults absent collections/fields when only some keys are present', async () => {
    await saveChildren([child('a')]);
    const loaded = await loadEntities();
    expect(loaded).toEqual({
      children: [child('a')],
      entries: [],
      measurements: [],
      selectedChildId: '',
      lastFeed: { feedType: 'breast', method: 'left' },
    });
  });

  it('falls back to the field default on corrupt JSON instead of throwing', async () => {
    await saveChildren([child('a')]);
    mem.store.set('babybuddy.entries.v1', '{not json');
    const loaded = await loadEntities();
    expect(loaded?.children).toEqual([child('a')]);
    expect(loaded?.entries).toEqual([]);
  });

  it('does not mask real persisted data as null when one key rejects (native I/O error)', async () => {
    await saveChildren([child('a')]);
    mem.rejectKeys.add('babybuddy.entries.v1');

    const loaded = await loadEntities();

    expect(loaded).toEqual({
      children: [child('a')],
      entries: [],
      measurements: [],
      selectedChildId: '',
      lastFeed: { feedType: 'breast', method: 'left' },
    });
  });

  it('clears all entity keys so a subsequent load returns null', async () => {
    await saveChildren([child('a')]);
    await saveEntries([entry('a')]);
    await saveMeasurements([measurement('a')]);
    await saveSelectedChildId('c1');
    await saveLastFeed({ feedType: 'solid', method: 'self' });

    await clearEntities();

    expect(await loadEntities()).toBeNull();
  });
});
