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

const KEY_CHILDREN = 'babybuddy.children.v1';
const KEY_ENTRIES = 'babybuddy.entries.v1';
const KEY_MEASUREMENTS = 'babybuddy.measurements.v1';
const KEY_SELECTED_CHILD = 'babybuddy.selectedChild.v1';
const KEY_LAST_FEED = 'babybuddy.lastFeed.v1';

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
 * Returns null ONLY when nothing has ever been persisted (all keys absent);
 * otherwise returns a full object with any absent/corrupt collection defaulted.
 */
export async function loadEntities(): Promise<StoredEntities | null> {
  try {
    const [childrenRaw, entriesRaw, measurementsRaw, selectedChildIdRaw, lastFeedRaw] = await Promise.all([
      AsyncStorage.getItem(KEY_CHILDREN),
      AsyncStorage.getItem(KEY_ENTRIES),
      AsyncStorage.getItem(KEY_MEASUREMENTS),
      AsyncStorage.getItem(KEY_SELECTED_CHILD),
      AsyncStorage.getItem(KEY_LAST_FEED),
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
  } catch (e) {
    console.warn('[entityStore] loadEntities failed:', e);
    return null;
  }
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
