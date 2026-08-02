/**
 * Offline write queue: entries created while offline are persisted here and
 * flushed to the server on reconnect. Backed by AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Entry } from '@/types/models';

const KEY = 'budkin.queue.v1';

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

/**
 * Append a whole BATCH in one load/save cycle, returning the resulting queue.
 *
 * This is not an optimisation, it is the only safe way to queue more than one
 * entry at once. Every mutation here is an unguarded load-modify-save with no
 * locking, so N un-awaited `enqueueEntry` calls all read the same pre-push queue
 * and the last save clobbers the rest. Offline, a "log for both" save made that
 * one twin's entry silently vanish.
 *
 * An empty batch writes nothing and just reports the queue, so a caller that
 * partitions its writes (see `commitWrites` in the store, where some entries
 * push and some queue) can hand over whatever is left without a length check.
 */
export async function enqueueEntries(entries: Entry[]): Promise<Entry[]> {
  const q = await loadQueue();
  if (entries.length === 0) return q;
  q.push(...entries);
  await saveQueue(q);
  return q;
}

export async function enqueueEntry(e: Entry): Promise<Entry[]> {
  return enqueueEntries([e]);
}

/**
 * Drop an entry from the queue by its LOCAL id, returning what was removed (so
 * a caller can put it back) alongside the remaining queue.
 *
 * A record that is deleted, or replaced by a running timer, before the queue
 * ever flushed must not still be POSTed on reconnect: `flushQueue` pushes
 * whatever it finds without consulting `entries`, so leaving it queued
 * resurrects a deleted entry and, in the replace case, leaves a duplicate
 * sitting next to the timer that took its place.
 */
export async function removeQueuedEntry(id: string): Promise<{ removed: Entry | null; queue: Entry[] }> {
  const q = await loadQueue();
  const removed = q.find((e) => e.id === id) ?? null;
  if (!removed) return { removed: null, queue: q };
  const queue = q.filter((e) => e.id !== id);
  await saveQueue(queue);
  return { removed, queue };
}

/**
 * Replace a queued entry, found by its LOCAL id, with a newer copy IN PLACE
 * (same position), returning whether anything was replaced alongside the
 * resulting queue. An id that is not on the queue writes nothing.
 *
 * This is what keeps an EDIT of a still-queued entry from silently reverting:
 * `flushQueue` pushes whatever the FILE holds without consulting `entries`, so
 * an edit that only updated the in-memory copy would still POST the stale
 * pre-edit version on reconnect, and the next refresh() would replace the
 * local edit (serverId null, not held back) with the server's stale row.
 *
 * Position matters too: the reconnect flush uploads in queue order, so the
 * rewrite must not shuffle the edited entry to the back the way a
 * remove-then-enqueue would.
 *
 * Accepted residual race: a flush that read the file microseconds before this
 * rewrite still pushes the old copy. That window used to be "until the next
 * refresh" and is now milliseconds; closing it entirely would need
 * server-side idempotency Baby Buddy does not offer.
 */
export async function updateQueuedEntry(e: Entry): Promise<{ updated: boolean; queue: Entry[] }> {
  const q = await loadQueue();
  if (!q.some((x) => x.id === e.id)) return { updated: false, queue: q };
  const queue = q.map((x) => (x.id === e.id ? e : x));
  await saveQueue(queue);
  return { updated: true, queue };
}

export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
