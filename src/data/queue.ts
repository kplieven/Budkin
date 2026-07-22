/**
 * Offline write queue: entries created while offline are persisted here and
 * flushed to the server on reconnect. Backed by AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Entry } from '@/types/models';

const KEY = 'babybuddy.queue.v1';

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

export async function enqueueEntry(e: Entry): Promise<Entry[]> {
  const q = await loadQueue();
  q.push(e);
  await saveQueue(q);
  return q;
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

export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
