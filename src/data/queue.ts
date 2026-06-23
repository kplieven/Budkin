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

export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
