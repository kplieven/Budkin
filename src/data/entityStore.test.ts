import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearEntities,
  loadEntities,
  resetEntityStoreForTests,
  saveChildren,
  saveEntries,
  saveLastFeed,
  saveMeasurements,
  saveSelectedChildId,
} from '@/data/entityStore';
import type { Child, Entry, Measurement, SleepEntry } from '@/types/models';

// In-memory stand-in for the native AsyncStorage module.
const mem = vi.hoisted(() => ({
  store: new Map<string, string>(),
  rejectKeys: new Set<string>(),
  rejectGetAllKeys: false,
}));
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
    getAllKeys: vi.fn(async () => {
      if (mem.rejectGetAllKeys) throw new Error('simulated native I/O error listing keys');
      return [...mem.store.keys()];
    }),
    // Android reads a batch through one shared cursor, so a single unreadable
    // row fails the WHOLE multiGet, not just its own pair. Model that: any
    // requested key in rejectKeys rejects the entire call.
    multiGet: vi.fn(async (keys: readonly string[]) => {
      for (const k of keys) {
        if (mem.rejectKeys.has(k)) throw new Error(`simulated native I/O error batch-reading "${k}"`);
      }
      return keys.map((k) => [k, mem.store.get(k) ?? null] as const);
    }),
    multiSet: vi.fn(async (pairs: readonly (readonly [string, string])[]) => {
      for (const [k, v] of pairs) mem.store.set(k, v);
    }),
    multiRemove: vi.fn(async (keys: readonly string[]) => {
      for (const k of keys) mem.store.delete(k);
    }),
  },
}));

const KEY_ENTRIES_V1 = 'budkin.entries.v1';
const KEY_MIGRATED = 'budkin.entriesMigrated.v2';
const CHUNK_PREFIX = 'budkin.entries.v2.';

const chunkKey = (y: number, m: number) => `${CHUNK_PREFIX}${y}-${String(m).padStart(2, '0')}`;

const chunkKeysInStore = () => [...mem.store.keys()].filter((k) => k.startsWith(CHUNK_PREFIX)).sort();

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

// Chunking is keyed by LOCAL month of entryTimestamp, so build timestamps via
// the local-time Date constructor (noon, away from any DST boundary) to keep
// the expected month deterministic in whatever timezone the tests run.
const entryAt = (id: string, y: number, m: number, day = 10): SleepEntry => ({
  id,
  childId: 'c1',
  tags: [],
  type: 'sleep',
  start: new Date(y, m - 1, day, 12).getTime(),
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
  mem.rejectGetAllKeys = false;
  // The guard set and the per-month write cache are module session state; reset
  // them so each test starts as a fresh "app launch".
  resetEntityStoreForTests();
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

  it('round-trips entries spanning several months as one union', async () => {
    const entries = [entryAt('jun1', 2026, 6, 5), entryAt('jul1', 2026, 7, 5), entryAt('jun2', 2026, 6, 20)];
    await saveEntries(entries);
    const loaded = await loadEntities();
    expect(loaded?.entries).toHaveLength(3);
    expect(loaded?.entries).toEqual(expect.arrayContaining(entries));
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
    mem.store.set(KEY_ENTRIES_V1, '{not json');
    const loaded = await loadEntities();
    expect(loaded?.children).toEqual([child('a')]);
    expect(loaded?.entries).toEqual([]);
  });

  it('does not mask real persisted data as null when one key rejects (native I/O error)', async () => {
    await saveChildren([child('a')]);
    mem.rejectKeys.add(KEY_ENTRIES_V1);

    const loaded = await loadEntities();

    expect(loaded).toEqual({
      children: [child('a')],
      entries: [],
      measurements: [],
      selectedChildId: '',
      lastFeed: { feedType: 'breast', method: 'left' },
    });
  });

  it('clears all entity keys, including entry chunks, so a subsequent load returns null', async () => {
    await saveChildren([child('a')]);
    await saveEntries([entry('a'), entryAt('b', 2026, 6)]);
    await saveMeasurements([measurement('a')]);
    await saveSelectedChildId('c1');
    await saveLastFeed({ feedType: 'solid', method: 'self' });

    await clearEntities();

    expect(chunkKeysInStore()).toEqual([]);
    expect(await loadEntities()).toBeNull();
  });
});

describe('entityStore read-failure write guard', () => {
  it('blocks a save whose read failed, keeps healthy keys saving, and resumes after a clean re-load', async () => {
    await saveChildren([child('a')]);
    await saveMeasurements([measurement('m1')]);
    const childrenRawBefore = mem.store.get('budkin.children.v1');

    // New session whose children read fails at the native level.
    resetEntityStoreForTests();
    mem.rejectKeys.add('budkin.children.v1');
    const loaded = await loadEntities();
    expect(loaded?.children).toEqual([]);
    expect(loaded?.measurements).toEqual([measurement('m1')]);

    // The children key is write-blocked: the on-disk data was only unreadable,
    // not gone, and this session's state was built without it.
    await saveChildren([child('x')]);
    expect(mem.store.get('budkin.children.v1')).toBe(childrenRawBefore);

    // A healthy key keeps persisting.
    await saveMeasurements([measurement('m1'), measurement('m2')]);
    expect(mem.store.get('budkin.measurements.v1')).toBe(JSON.stringify([measurement('m1'), measurement('m2')]));

    // Next session: the read succeeds again, so writes resume.
    resetEntityStoreForTests();
    mem.rejectKeys.clear();
    const reloaded = await loadEntities();
    expect(reloaded?.children).toEqual([child('a')]);
    await saveChildren([child('a'), child('b')]);
    expect(mem.store.get('budkin.children.v1')).toBe(JSON.stringify([child('a'), child('b')]));
  });

  it('blocks every entry write while the legacy v1 blob is unreadable, then migrates once it reads again', async () => {
    const v1 = [entryAt('old', 2026, 5)];
    mem.store.set(KEY_ENTRIES_V1, JSON.stringify(v1));
    mem.rejectKeys.add(KEY_ENTRIES_V1);

    const loaded = await loadEntities();
    expect(loaded?.entries ?? []).toEqual([]);
    // The unreadable blob was left alone, not removed or defaulted over.
    expect(mem.store.get(KEY_ENTRIES_V1)).toBe(JSON.stringify(v1));

    // No chunk write may happen: a later successful migration overwrites the
    // month chunks from v1, so anything written now would be clobbered.
    await saveEntries([entryAt('new', 2026, 7)]);
    expect(chunkKeysInStore()).toEqual([]);
    expect(mem.store.get(KEY_ENTRIES_V1)).toBe(JSON.stringify(v1));

    // Next session reads v1 fine: it migrates and entry writes resume.
    resetEntityStoreForTests();
    mem.rejectKeys.clear();
    const reloaded = await loadEntities();
    expect(reloaded?.entries).toEqual(v1);
    await saveEntries([...v1, entryAt('new', 2026, 7)]);
    expect(mem.store.get(chunkKey(2026, 7))).toBe(JSON.stringify([entryAt('new', 2026, 7)]));
  });

  it('skips only the unreadable month chunk and keeps writing the others', async () => {
    const june = entryAt('jun', 2026, 6);
    const july = entryAt('jul', 2026, 7);
    await saveEntries([june, july]);
    const juneRawBefore = mem.store.get(chunkKey(2026, 6));

    // New session; June's chunk row fails to read (e.g. CursorWindow).
    resetEntityStoreForTests();
    mem.rejectKeys.add(chunkKey(2026, 6));
    const loaded = await loadEntities();
    // Partial history: July still loads even though the batched read failed.
    expect(loaded?.entries).toEqual([july]);

    // A save that touches both months writes July but leaves June's on-disk
    // chunk untouched (memory does not contain its entries).
    const julyNew = entryAt('jul2', 2026, 7, 20);
    const juneNew = entryAt('junNew', 2026, 6, 21);
    await saveEntries([july, julyNew, juneNew]);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(juneRawBefore);
    expect(mem.store.get(chunkKey(2026, 7))).toBe(JSON.stringify([july, julyNew]));
  });

  it('resumes writing a month chunk after a clean re-load', async () => {
    const june = entryAt('jun', 2026, 6);
    mem.store.set(chunkKey(2026, 6), JSON.stringify([june]));
    mem.rejectKeys.add(chunkKey(2026, 6));
    await loadEntities();
    await saveEntries([entryAt('junNew', 2026, 6, 21)]);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([june]));

    resetEntityStoreForTests();
    mem.rejectKeys.clear();
    const loaded = await loadEntities();
    expect(loaded?.entries).toEqual([june]);
    const juneNew = entryAt('junNew', 2026, 6, 21);
    await saveEntries([june, juneNew]);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([june, juneNew]));
  });

  it('blocks entry writes for the session when the chunk key listing fails', async () => {
    const june = entryAt('jun', 2026, 6);
    mem.store.set(chunkKey(2026, 6), JSON.stringify([june]));
    await saveChildren([child('a')]);

    resetEntityStoreForTests();
    mem.rejectGetAllKeys = true;
    const loaded = await loadEntities();
    expect(loaded?.entries).toEqual([]);

    // With the key listing unavailable there is no way to know which months
    // exist on disk, so every entry write is blocked, not just June's.
    await saveEntries([entryAt('jul', 2026, 7)]);
    expect(chunkKeysInStore()).toEqual([chunkKey(2026, 6)]);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([june]));

    // Keys outside the chunk namespace are unaffected.
    await saveChildren([child('a'), child('b')]);
    expect(mem.store.get('budkin.children.v1')).toBe(JSON.stringify([child('a'), child('b')]));
  });
});

describe('entityStore parse failures do not block writes', () => {
  it('overwrites a corrupt month chunk on the next save', async () => {
    mem.store.set(chunkKey(2026, 6), '{not json');
    const loaded = await loadEntities();
    // The chunk READ fine (so the key counts as present), only the parse failed.
    expect(loaded?.entries).toEqual([]);

    const june = entryAt('jun', 2026, 6);
    await saveEntries([june]);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([june]));
  });

  it('treats a chunk holding valid non-array JSON as empty and overwrites it', async () => {
    mem.store.set(chunkKey(2026, 6), '{"not":"an array"}');
    const loaded = await loadEntities();
    expect(loaded?.entries).toEqual([]);

    const june = entryAt('jun', 2026, 6);
    await saveEntries([june]);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([june]));
  });

  it('overwrites a corrupt children blob on the next save', async () => {
    mem.store.set('budkin.children.v1', '{not json');
    const loaded = await loadEntities();
    expect(loaded?.children).toEqual([]);

    await saveChildren([child('a')]);
    expect(mem.store.get('budkin.children.v1')).toBe(JSON.stringify([child('a')]));
  });
});

describe('entityStore per-month entry chunks', () => {
  it('distributes entries into per-month chunk keys by local time and never writes v1', async () => {
    const jun1 = entryAt('jun1', 2026, 6, 5);
    const jun2 = entryAt('jun2', 2026, 6, 20);
    const jul1 = entryAt('jul1', 2026, 7, 5);
    await saveEntries([jun1, jul1, jun2]);

    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([jun1, jun2]));
    expect(mem.store.get(chunkKey(2026, 7))).toBe(JSON.stringify([jul1]));
    expect(mem.store.has(KEY_ENTRIES_V1)).toBe(false);
  });

  it('rewrites only the month whose entries changed', async () => {
    const june = entryAt('jun', 2026, 6);
    const july = entryAt('jul', 2026, 7);
    await saveEntries([june, july]);

    const multiSet = vi.mocked(AsyncStorage.multiSet);
    const multiRemove = vi.mocked(AsyncStorage.multiRemove);
    multiSet.mockClear();
    multiRemove.mockClear();

    const julyEdited = { ...july, end: july.start + 60_000 };
    await saveEntries([june, julyEdited]);

    expect(multiSet).toHaveBeenCalledTimes(1);
    expect(multiSet.mock.calls[0][0]).toEqual([[chunkKey(2026, 7), JSON.stringify([julyEdited])]]);
    expect(multiRemove).not.toHaveBeenCalled();
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([june]));
  });

  it('writes nothing at all when the entries are unchanged', async () => {
    const june = entryAt('jun', 2026, 6);
    await saveEntries([june]);

    const multiSet = vi.mocked(AsyncStorage.multiSet);
    multiSet.mockClear();
    await saveEntries([june]);
    expect(multiSet).not.toHaveBeenCalled();
  });

  it('a cross-month move rewrites both months', async () => {
    const juneA = entryAt('a', 2026, 6, 5);
    const juneB = entryAt('b', 2026, 6, 20);
    const julyC = entryAt('c', 2026, 7, 5);
    await saveEntries([juneA, juneB, julyC]);

    // Move b from June into July (the user edited its date).
    const julyB = entryAt('b', 2026, 7, 2);
    await saveEntries([juneA, julyB, julyC]);

    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([juneA]));
    expect(mem.store.get(chunkKey(2026, 7))).toBe(JSON.stringify([julyB, julyC]));
  });

  it('removes a month chunk once its last entry moves out', async () => {
    const juneOnly = entryAt('a', 2026, 6);
    const julyC = entryAt('c', 2026, 7, 5);
    await saveEntries([juneOnly, julyC]);
    expect(mem.store.has(chunkKey(2026, 6))).toBe(true);

    const julyA = entryAt('a', 2026, 7, 2);
    await saveEntries([julyA, julyC]);

    expect(mem.store.has(chunkKey(2026, 6))).toBe(false);
    expect(mem.store.get(chunkKey(2026, 7))).toBe(JSON.stringify([julyA, julyC]));
  });

  it('removes a month chunk once its last entry is deleted', async () => {
    const june = entryAt('a', 2026, 6);
    const july = entryAt('c', 2026, 7, 5);
    await saveEntries([june, july]);

    await saveEntries([july]);

    expect(mem.store.has(chunkKey(2026, 6))).toBe(false);
    expect(mem.store.get(chunkKey(2026, 7))).toBe(JSON.stringify([july]));
  });

  it('keeps one copy when an interrupted cross-month move left the same id in two months (newest month wins)', async () => {
    const staleJune = entryAt('x', 2026, 6);
    const movedJuly = entryAt('x', 2026, 7, 2);
    mem.store.set(chunkKey(2026, 6), JSON.stringify([staleJune]));
    mem.store.set(chunkKey(2026, 7), JSON.stringify([movedJuly]));

    const loaded = await loadEntities();
    expect(loaded?.entries).toEqual([movedJuly]);
  });
});

describe('entityStore v1 to v2 migration', () => {
  it('migrates the v1 blob into month chunks and removes it', async () => {
    const june = entryAt('jun', 2026, 6);
    const july = entryAt('jul', 2026, 7);
    mem.store.set(KEY_ENTRIES_V1, JSON.stringify([june, july]));

    const loaded = await loadEntities();

    expect(loaded?.entries).toHaveLength(2);
    expect(loaded?.entries).toEqual(expect.arrayContaining([june, july]));
    expect(mem.store.has(KEY_ENTRIES_V1)).toBe(false);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([june]));
    expect(mem.store.get(chunkKey(2026, 7))).toBe(JSON.stringify([july]));
  });

  it('re-migrates idempotently when v1 survived an interrupted migration', async () => {
    const juneA = entryAt('a', 2026, 6);
    const julyB = entryAt('b', 2026, 7);
    const augD = entryAt('d', 2026, 8);
    mem.store.set(KEY_ENTRIES_V1, JSON.stringify([juneA, julyB]));
    // Leftovers of the interrupted run: a stale June chunk plus an August
    // chunk written by a session that ran on chunks before v1 removal landed.
    mem.store.set(chunkKey(2026, 6), JSON.stringify([entryAt('stale', 2026, 6, 3)]));
    mem.store.set(chunkKey(2026, 8), JSON.stringify([augD]));

    const loaded = await loadEntities();

    // v1 months are overwritten from v1; months v1 knows nothing about survive.
    expect(mem.store.has(KEY_ENTRIES_V1)).toBe(false);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([juneA]));
    expect(mem.store.get(chunkKey(2026, 7))).toBe(JSON.stringify([julyB]));
    expect(mem.store.get(chunkKey(2026, 8))).toBe(JSON.stringify([augD]));
    expect(loaded?.entries).toHaveLength(3);
    expect(loaded?.entries).toEqual(expect.arrayContaining([juneA, julyB, augD]));
  });

  it('loads chunks directly when v1 is absent, without recreating v1', async () => {
    const june = entryAt('jun', 2026, 6);
    mem.store.set(chunkKey(2026, 6), JSON.stringify([june]));

    const loaded = await loadEntities();

    expect(loaded?.entries).toEqual([june]);
    expect(mem.store.has(KEY_ENTRIES_V1)).toBe(false);
  });

  it('migrates a corrupt v1 blob to nothing and removes it', async () => {
    mem.store.set(KEY_ENTRIES_V1, '{not json');
    await saveChildren([child('a')]);

    const loaded = await loadEntities();

    // Corrupt JSON read fine, so it is unrecoverable either way: dropping the
    // key stops the migration from re-running on every launch.
    expect(loaded?.entries).toEqual([]);
    expect(mem.store.has(KEY_ENTRIES_V1)).toBe(false);
    expect(chunkKeysInStore()).toEqual([]);
    // No chunks were written, so there is nothing a marker would protect.
    expect(mem.store.has(KEY_MIGRATED)).toBe(false);
  });

  it('writes the completed-migration marker as the last pair of the chunk batch', async () => {
    const june = entryAt('jun', 2026, 6);
    const july = entryAt('jul', 2026, 7);
    mem.store.set(KEY_ENTRIES_V1, JSON.stringify([june, july]));
    const multiSet = vi.mocked(AsyncStorage.multiSet);
    multiSet.mockClear();

    await loadEntities();

    // The first (and only) multiSet is the migration batch: both month chunks
    // first, the marker last, so a present marker proves the chunks landed.
    expect(multiSet).toHaveBeenCalledTimes(1);
    const batch = multiSet.mock.calls[0][0];
    expect(batch).toHaveLength(3);
    expect(batch[batch.length - 1]).toEqual([KEY_MIGRATED, '1']);
    expect(mem.store.get(KEY_MIGRATED)).toBe('1');
  });

  it('drops a marker-covered v1 blob without reading it and never overwrites chunks from it', async () => {
    // The state a failed removeItem leaves behind: migration completed (marker
    // set), v1 lingering, and a chunk holding entries written SINCE, which a
    // re-migration would overwrite with the stale blob.
    const current = entryAt('cur', 2026, 6, 15);
    mem.store.set(KEY_ENTRIES_V1, JSON.stringify([entryAt('stale', 2026, 6, 3)]));
    mem.store.set(KEY_MIGRATED, '1');
    mem.store.set(chunkKey(2026, 6), JSON.stringify([current]));
    // Prove v1 is dropped UNREAD: if the marker path read it, this reject
    // would write-block entries for the session and leave the blob in place.
    mem.rejectKeys.add(KEY_ENTRIES_V1);

    const loaded = await loadEntities();

    expect(loaded?.entries).toEqual([current]);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([current]));
    expect(mem.store.has(KEY_ENTRIES_V1)).toBe(false);
    // The marker is kept forever (only clearEntities removes it).
    expect(mem.store.get(KEY_MIGRATED)).toBe('1');

    // Entry writes flow: the unread blob must not trip the read-failure guard.
    const junNew = entryAt('junNew', 2026, 6, 20);
    await saveEntries([current, junNew]);
    expect(mem.store.get(chunkKey(2026, 6))).toBe(JSON.stringify([current, junNew]));
  });

  it('clearEntities removes the completed-migration marker too', async () => {
    mem.store.set(KEY_MIGRATED, '1');
    await saveChildren([child('a')]);

    await clearEntities();

    expect(mem.store.has(KEY_MIGRATED)).toBe(false);
    expect(await loadEntities()).toBeNull();
  });
});
