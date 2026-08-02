/**
 * Offline write queue: entries created while offline are persisted here and
 * flushed to the server on reconnect. Backed by AsyncStorage.
 *
 * THE RACE THIS FILE IS BUILT AROUND. Every mutation is a load-modify-save over
 * one AsyncStorage key, and AsyncStorage has no compare-and-swap. Two mutations
 * that overlap therefore both read the same pre-write queue, and the second save
 * clobbers the first: the losing entry is not merely left unsynced, it is gone
 * from the file. `applyServerLoad` rebuilds `entries` from exactly three sets
 * (the server's, this queue, and the held-back ones), so an entry in none of
 * them disappears from the UI on the next refresh, and `flushUnsynced` will not
 * rescue it either since it only pushes the held-back subset.
 *
 * Two defences, both needed, for two different shapes of the same problem:
 *
 * - `enqueueEntries` writes a whole BATCH in one cycle, for a caller that
 *   already holds every entry at once (a "log for both" save).
 * - `serialized` chains the four mutators, for callers that CANNOT batch because
 *   they are independent async continuations. That is the push-failure path: N
 *   clones POSTed from one synchronous loop fail together (conditional on either
 *   failing, both fail, since they are the same request to the same server), and
 *   each `.catch` enqueues on its own. A 401 or a 500 never sets `offline`, so
 *   that path is not hypothetical: it is what EVERY multi-child save takes while
 *   a self-hosted server is unhappy but the phone still has internet.
 *
 * KNOWN LIMIT: `src/widgets/napToggle.ts` enqueues from a headless task in
 * another process, which an in-process chain cannot order against this one. That
 * is pre-existing, and it writes one entry at a time, so it can only lose to (or
 * be lost to) a simultaneous foreground write, not to itself.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Entry } from '@/types/models';

const KEY = 'budkin.queue.v1';

/**
 * The tail of the write chain. Mutations queue behind it so no two ever have a
 * load-modify-save cycle in flight at once.
 *
 * `tail.then(work, work)` runs the next mutation whether the previous one
 * settled or threw: a rejected write must not wedge every later one behind a
 * promise nobody handles. `tail` is then re-armed from a fully-handled copy, so
 * the chain never carries an unhandled rejection forward either. Callers still
 * get the real promise, rejection and all.
 */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Run one queue mutation with exclusive access to the file.
 *
 * ONLY the four leaf mutators below are wrapped, never a function that calls
 * another of them. `enqueueEntry` delegates to `enqueueEntries`, so wrapping
 * both would have the inner call await a tail the outer already holds, and it
 * would hang forever. Reads (`loadQueue`) are deliberately unwrapped: they take
 * no lock, so a read can only ever see a state some mutation genuinely wrote.
 */
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

/**
 * Append a whole BATCH in one load/save cycle, returning the resulting queue.
 *
 * This is not an optimisation. See the race described at the top of this file:
 * N single enqueues issued without awaiting each other lose all but one, and
 * offline that made a "log for both" save drop a twin's entry.
 *
 * An empty batch writes nothing and just reports the queue, so a caller that
 * partitions its writes (see `commitWrites` in the store, where some entries
 * push and some queue) can hand over whatever is left without a length check.
 */
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
  return serialized(async () => {
    const q = await loadQueue();
    const removed = q.find((e) => e.id === id) ?? null;
    if (!removed) return { removed: null, queue: q };
    const queue = q.filter((e) => e.id !== id);
    await saveQueue(queue);
    return { removed, queue };
  });
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
 * rewrite still pushes the old copy. The chain does not close that one, because
 * the flush's read is a read, and it takes no lock by design. That window used
 * to be "until the next refresh" and is now milliseconds; closing it entirely
 * would need server-side idempotency Baby Buddy does not offer.
 */
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
