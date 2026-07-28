/**
 * Durable on-device persistence for the app's core entities, backed by
 * AsyncStorage. This is the store that makes "local mode" real: children,
 * entries, measurements, the selected child, and the last-used feed defaults
 * all survive app restarts independent of any server connection.
 *
 * Mirrors the guarded try/catch AsyncStorage wrapper pattern used by
 * `src/data/timers.ts` / `src/data/prefs.ts`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Child, Entry, FeedMethod, FeedType, Measurement } from '@/types/models';

const KEY_CHILDREN = 'budkin.children.v1';
const KEY_ENTRIES = 'budkin.entries.v1';
const KEY_MEASUREMENTS = 'budkin.measurements.v1';
const KEY_SELECTED_CHILD = 'budkin.selectedChild.v1';
const KEY_LAST_FEED = 'budkin.lastFeed.v1';

const DEFAULT_LAST_FEED: { feedType: FeedType; method: FeedMethod } = {
  feedType: 'breast',
  method: 'left',
};

export interface StoredEntities {
  children: Child[];
  entries: Entry[];
  measurements: Measurement[];
  selectedChildId: string;
  lastFeed: { feedType: FeedType; method: FeedMethod };
}

/** Parses a persisted value, falling back to `fallback` when absent or corrupt. */
function parseOr<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn('[entityStore] failed to parse persisted value, using default:', e);
    return fallback;
  }
}

/**
 * Reads a single key, returning its raw string or `null` when the key is
 * absent OR the read itself rejects (a native I/O error). Guarding each read
 * individually means one key's infra failure can never take down the other
 * four — it's indistinguishable from that one key being absent.
 */
async function getItemOrNull(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (e) {
    console.warn(`[entityStore] failed to read "${key}", treating as absent:`, e);
    return null;
  }
}

/**
 * Returns null ONLY when all five keys come back absent-or-unreadable
 * (nothing has ever been persisted, or every read failed); otherwise returns
 * a full object with any absent/corrupt/unreadable field defaulted.
 *
 * Each key is read via `getItemOrNull`, which never rejects, so a native
 * I/O error on one key degrades only that key's field to its default — it
 * cannot mask real data successfully read from the other keys.
 */
export async function loadEntities(): Promise<StoredEntities | null> {
  const [childrenRaw, entriesRaw, measurementsRaw, selectedChildIdRaw, lastFeedRaw] = await Promise.all([
    getItemOrNull(KEY_CHILDREN),
    getItemOrNull(KEY_ENTRIES),
    getItemOrNull(KEY_MEASUREMENTS),
    getItemOrNull(KEY_SELECTED_CHILD),
    getItemOrNull(KEY_LAST_FEED),
  ]);

  if (
    childrenRaw == null &&
    entriesRaw == null &&
    measurementsRaw == null &&
    selectedChildIdRaw == null &&
    lastFeedRaw == null
  ) {
    return null;
  }

  return {
    children: parseOr<Child[]>(childrenRaw, []),
    entries: parseOr<Entry[]>(entriesRaw, []),
    measurements: parseOr<Measurement[]>(measurementsRaw, []),
    selectedChildId: parseOr<string>(selectedChildIdRaw, ''),
    lastFeed: parseOr<{ feedType: FeedType; method: FeedMethod }>(lastFeedRaw, DEFAULT_LAST_FEED),
  };
}

export async function saveChildren(v: Child[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_CHILDREN, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveChildren failed:', e);
  }
}

export async function saveEntries(v: Entry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_ENTRIES, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveEntries failed:', e);
  }
}

export async function saveMeasurements(v: Measurement[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_MEASUREMENTS, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveMeasurements failed:', e);
  }
}

export async function saveSelectedChildId(v: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_SELECTED_CHILD, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveSelectedChildId failed:', e);
  }
}

export async function saveLastFeed(v: { feedType: FeedType; method: FeedMethod }): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_LAST_FEED, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveLastFeed failed:', e);
  }
}

/** Remove all entity keys (used on disconnect). */
export async function clearEntities(): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.removeItem(KEY_CHILDREN),
      AsyncStorage.removeItem(KEY_ENTRIES),
      AsyncStorage.removeItem(KEY_MEASUREMENTS),
      AsyncStorage.removeItem(KEY_SELECTED_CHILD),
      AsyncStorage.removeItem(KEY_LAST_FEED),
    ]);
  } catch (e) {
    console.warn('[entityStore] clearEntities failed:', e);
  }
}
