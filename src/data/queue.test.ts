import { beforeEach, describe, expect, it, vi } from 'vitest';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearQueue, enqueueEntries, enqueueEntry, loadQueue, removeQueuedEntry, updateQueuedEntry } from '@/data/queue';
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

describe('queue writes are serialized', () => {
  it('keeps both of two concurrent enqueues', async () => {
    // The push-failure path fires one enqueue per entry from N correlated
    // `.catch` handlers, so this is the shape a two-child save takes whenever
    // Baby Buddy answers 401 or 500 (which never sets `offline`, so the batched
    // path is not reached). Unchained, both handlers read the same pre-push
    // queue and the second save clobbers the first.
    await Promise.all([enqueueEntry(note('a', 'twin one')), enqueueEntry(note('b', 'twin two'))]);
    expect((await loadQueue()).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('keeps a concurrent enqueue and batch from clobbering each other', async () => {
    await Promise.all([enqueueEntries([note('a', 'one'), note('b', 'two')]), enqueueEntry(note('c', 'three'))]);
    expect((await loadQueue()).map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not resurrect an entry removed concurrently with an enqueue', async () => {
    await enqueueEntry(note('a', 'first'));
    await Promise.all([removeQueuedEntry('a'), enqueueEntry(note('b', 'second'))]);
    expect((await loadQueue()).map((e) => e.id)).toEqual(['b']);
  });

  it('orders a clear against a concurrent enqueue instead of interleaving them', async () => {
    await enqueueEntry(note('a', 'first'));
    await Promise.all([clearQueue(), enqueueEntry(note('b', 'second'))]);
    expect((await loadQueue()).map((e) => e.id)).toEqual(['b']);
  });

  it('survives a throwing write without wedging the chain', async () => {
    // `loadQueue` CASTS whatever the file parsed to and never validates it, so a
    // corrupted queue makes the mutator itself throw (here: `.find` on a string).
    // A chain that only followed the success path would leave every later write
    // waiting on a promise nobody ever resolves.
    mem.store.set('budkin.queue.v1', JSON.stringify('not an array'));
    await expect(removeQueuedEntry('a')).rejects.toThrow();

    mem.store.clear();
    await enqueueEntry(note('b', 'second'));
    expect((await loadQueue()).map((e) => e.id)).toEqual(['b']);
  });
});

describe('enqueueEntries', () => {
  it('appends the whole batch in ONE load/save cycle', async () => {
    await enqueueEntry(note('a', 'first'));
    vi.mocked(AsyncStorage.setItem).mockClear();

    const queue = await enqueueEntries([note('b', 'twin one'), note('c', 'twin two')]);

    expect(queue.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    // One write for the batch, which is the whole point: `enqueueEntry` is an
    // unguarded load-modify-save, so N un-awaited calls read the same pre-push
    // queue and the last save clobbers the rest.
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(await loadQueue()).toEqual(queue);
  });

  it('keeps every entry of a batch written in one pass', async () => {
    // The offline twin save: one entry per child, all handed over together.
    // Written one at a time without awaiting, one of them silently vanishes.
    await enqueueEntries([note('a', 'twin one'), note('b', 'twin two')]);
    expect((await loadQueue()).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('writes nothing for an empty batch, and still reports the queue', async () => {
    await enqueueEntry(note('a', 'first'));
    vi.mocked(AsyncStorage.setItem).mockClear();

    const queue = await enqueueEntries([]);

    expect(queue.map((e) => e.id)).toEqual(['a']);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
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
