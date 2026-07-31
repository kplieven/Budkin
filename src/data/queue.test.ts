import { beforeEach, describe, expect, it, vi } from 'vitest';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { enqueueEntry, loadQueue, updateQueuedEntry } from '@/data/queue';
import type { Entry } from '@/types/models';

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

const note = (id: string, text: string): Entry => ({
  id,
  childId: 'c1',
  type: 'note',
  time: 1_700_000_000_000,
  text,
  tags: [],
});

beforeEach(() => {
  mem.store.clear();
  vi.mocked(AsyncStorage.setItem).mockClear();
});

describe('updateQueuedEntry', () => {
  it('replaces the queued copy in place, keeping its position, and persists it', async () => {
    await enqueueEntry(note('a', 'first'));
    await enqueueEntry(note('b', 'second wrods'));
    await enqueueEntry(note('c', 'third'));

    const { updated, queue } = await updateQueuedEntry(note('b', 'second words'));

    expect(updated).toBe(true);
    // Same position: the reconnect flush uploads in queue order, so an edit
    // must not shuffle the entry to the back.
    expect(queue.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(queue[1]).toMatchObject({ id: 'b', text: 'second words' });
    // Persisted, not just returned: the file is what flushQueue reads.
    expect(await loadQueue()).toEqual(queue);
  });

  it('returns updated: false and writes nothing when the id is not queued', async () => {
    await enqueueEntry(note('a', 'first'));
    vi.mocked(AsyncStorage.setItem).mockClear();

    const { updated, queue } = await updateQueuedEntry(note('missing', 'never queued'));

    expect(updated).toBe(false);
    expect(queue.map((e) => e.id)).toEqual(['a']);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect((await loadQueue()).map((e) => e.id)).toEqual(['a']);
  });

  it('is a cheap no-op on an empty queue', async () => {
    const { updated, queue } = await updateQueuedEntry(note('a', 'anything'));
    expect(updated).toBe(false);
    expect(queue).toEqual([]);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
