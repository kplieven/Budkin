/**
 * Offline write queue, flushed to the server on reconnect. Every mutation is a
 * load-modify-save over one AsyncStorage key, and AsyncStorage has no
 * compare-and-swap, so two overlapping mutations read the same pre-write queue and
 * the second save clobbers the first. A lost entry is gone from the UI too, since
 * `applyServerLoad` rebuilds `entries` from only the server's set, this queue, and
 * the held-back ones.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Entry } from '@/types/models';

const KEY = 'budkin.queue.v1';

/** The tail of the write chain. `tail.then(work, work)` runs the next mutation
 *  whether the previous one settled or threw, and `tail` is re-armed from a
 *  fully-handled copy so the chain never carries an unhandled rejection forward. */
let tail: Promise<unknown> = Promise.resolve();

/** Run one queue mutation with exclusive access to the file. ONLY the four leaf
 *  mutators are wrapped: `enqueueEntry` delegates to `enqueueEntries`, and wrapping
 *  both would deadlock. Reads take no lock, so they only see written states. */
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.then(
    () => {},
    () => {},
  );
  return next;
}

export async function loadQueue(): Promise<Entry[]> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Entry[]) : [];
  } catch {
    return [];
  }
}

export async function saveQueue(q: Entry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

/** Append a whole BATCH in one load/save cycle: N single enqueues issued without
 *  awaiting each other lose all but one. An empty batch writes nothing. */
export async function enqueueEntries(entries: Entry[]): Promise<Entry[]> {
  return serialized(async () => {
    const q = await loadQueue();
    if (entries.length === 0) return q;
    q.push(...entries);
    await saveQueue(q);
    return q;
  });
}

export async function enqueueEntry(e: Entry): Promise<Entry[]> {
  return enqueueEntries([e]);
}

/** Drop an entry by its LOCAL id, returning what was removed so a caller can put it
 *  back. `flushQueue` pushes what it finds without consulting `entries`, so a record
 *  deleted or replaced before the flush would be resurrected on reconnect. */
export async function removeQueuedEntry(id: string): Promise<{ removed: Entry | null; queue: Entry[] }> {
  return serialized(async () => {
    const q = await loadQueue();
    const removed = q.find((e) => e.id === id) ?? null;
    if (!removed) return { removed: null, queue: q };
    const queue = q.filter((e) => e.id !== id);
    await saveQueue(queue);
    return { removed, queue };
  });
}

/** Replace a queued entry, found by its LOCAL id, IN PLACE. `flushQueue` pushes what
 *  the FILE holds, so an edit that only touched the in-memory copy would POST the
 *  stale version on reconnect. In place, not remove-then-enqueue, because the flush
 *  uploads in queue order. A flush that read the file just before still loses. */
export async function updateQueuedEntry(e: Entry): Promise<{ updated: boolean; queue: Entry[] }> {
  return serialized(async () => {
    const q = await loadQueue();
    if (!q.some((x) => x.id === e.id)) return { updated: false, queue: q };
    const queue = q.map((x) => (x.id === e.id ? e : x));
    await saveQueue(queue);
    return { updated: true, queue };
  });
}

export async function clearQueue(): Promise<void> {
  return serialized(async () => {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  });
}
