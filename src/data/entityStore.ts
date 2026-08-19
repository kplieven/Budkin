/** Durable on-device persistence for the app's core entities over AsyncStorage. A
 *  key whose last read THREW is write-blocked for the session (see `readFailed`),
 *  so a transient native error cannot persist an in-memory default over data that
 *  was merely unreadable. Entries live in per-month chunks because Android
 *  AsyncStorage stores each key as one SQLite row, and rows around 2MB stop being
 *  READABLE (CursorWindow) while writes keep succeeding. */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeWash } from '@/lib/wash';
import type { Child, Entry, LastFeed, Measurement } from '@/types/models';
import { entryTimestamp } from '@/types/models';

const KEY_CHILDREN = 'budkin.children.v1';
/** Legacy single-blob entries key, migrated into month chunks on first read. */
const KEY_ENTRIES_V1 = 'budkin.entries.v1';
/** Written LAST in the same `multiSet` batch as the migrated chunks, so its
 *  presence proves those writes completed. Kept outside `ENTRY_CHUNK_PREFIX`. */
const KEY_ENTRIES_MIGRATED = 'budkin.entriesMigrated.v2';
/** Chunk keys are `<prefix><YYYY-MM>`, the LOCAL (not UTC) month of
 *  `entryTimestamp`. The bare prefix stores nothing; it is also the `readFailed`
 *  sentinel for "the chunk key listing itself failed". */
const ENTRY_CHUNK_PREFIX = 'budkin.entries.v2.';
const KEY_MEASUREMENTS = 'budkin.measurements.v1';
const KEY_SELECTED_CHILD = 'budkin.selectedChild.v1';
const KEY_LAST_FEED = 'budkin.lastFeed.v1';
/** Which data set the stored entities belong to: a NORMALIZED server URL, or
 *  'local'. serverIds are per-server, so a reconnect may only reconcile stored
 *  entities against an incoming load when the origin matches. */
const KEY_ENTITY_ORIGIN = 'budkin.entityOrigin.v1';

export interface StoredEntities {
  children: Child[];
  entries: Entry[];
  measurements: Measurement[];
  selectedChildId: string;
  lastFeed: Record<string, LastFeed>;
  /** The account-wide value a pre-map build left on the same key. Read only. */
  legacyLastFeed: LastFeed | null;
}

/** Keys whose most recent read THREW (I/O, not a parse error). Every save skips a
 *  key in this set, because the in-memory value was built WITHOUT the on-disk
 *  data. Parse failures never enter it: that data is unrecoverable anyway. */
const readFailed = new Set<string>();

/** Last JSON read from or written to each chunk key this session, so `saveEntries`
 *  rewrites only changed months. null means the on-disk chunk set is unknown, in
 *  which case a save writes every month it has and removes nothing. */
let lastWrittenChunks: Map<string, string> | null = null;

export function resetEntityStoreForTests(): void {
  readFailed.clear();
  lastWrittenChunks = null;
}

function parseOr<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn('[entityStore] failed to parse persisted value, using default:', e);
    return fallback;
  }
}

/** Bath entries go through `normalizeWash` because older chunks hold
 *  `wash: 'small' | 'big'`. The queue and pending-ops log normalise separately. */
function parseEntryArray(raw: string | null): Entry[] {
  const parsed = parseOr<Entry[]>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((e) =>
    e?.type === 'bath' ? { ...e, wash: normalizeWash((e as { wash?: unknown }).wash) } : e,
  );
}

/** Splits the persisted value into the per-child map and the pre-map scalar the
 *  key may still hold. Both are plain objects, so the discriminator is the VALUE
 *  type: map values are objects, v1's are strings. They share one storage slot. */
function parseLastFeed(raw: string | null): { map: Record<string, LastFeed>; legacy: LastFeed | null } {
  const parsed = parseOr<unknown>(raw, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { map: {}, legacy: null };
  const v = parsed as Record<string, unknown>;
  if (typeof v.feedType === 'string') return { map: {}, legacy: v as unknown as LastFeed };
  const drafts = Object.entries(v).filter(([, d]) => !!d && typeof d === 'object' && !Array.isArray(d));
  return { map: Object.fromEntries(drafts) as Record<string, LastFeed>, legacy: null };
}

/** null when the key is absent OR the read rejects, so one key's I/O failure
 *  cannot take down the others. A rejection is remembered in `readFailed`. */
async function getItemOrNull(key: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    readFailed.delete(key);
    return raw;
  } catch (e) {
    console.warn(`[entityStore] failed to read "${key}", treating as absent:`, e);
    readFailed.add(key);
    return null;
  }
}

function blockedByFailedRead(key: string, fn: string): boolean {
  if (!readFailed.has(key)) return false;
  console.warn(
    `[entityStore] ${fn}: skipping write, the last read of "${key}" failed, so the on-disk value may hold data this session never saw`
  );
  return true;
}

function entryChunkKey(e: Entry): string {
  const d = new Date(entryTimestamp(e));
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${ENTRY_CHUNK_PREFIX}${d.getFullYear()}-${month}`;
}

function groupByChunkKey(entries: Entry[]): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = entryChunkKey(e);
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }
  return groups;
}

/** Migrates the legacy single-blob entries key into per-month chunks, retried on
 *  every load; returns whether entries were ever persisted. A present marker means
 *  only the v1 removal failed, so the blob is dropped UNREAD: re-reading past
 *  Android's CursorWindow cliff would write-block entries for the session. Chunks
 *  land BEFORE the v1 removal, so a crash between the two leaves both copies. */
async function migrateEntriesV1(): Promise<boolean> {
  const marker = await getItemOrNull(KEY_ENTRIES_MIGRATED);
  if (marker != null) {
    try {
      await AsyncStorage.removeItem(KEY_ENTRIES_V1);
    } catch (e) {
      console.warn('[entityStore] failed to drop the already-migrated v1 blob, will retry next load:', e);
    }
    return true;
  }
  const raw = await getItemOrNull(KEY_ENTRIES_V1);
  if (raw == null) return false;
  const entries = parseEntryArray(raw);
  const pairs: [string, string][] = [];
  for (const [key, monthEntries] of groupByChunkKey(entries)) {
    pairs.push([key, JSON.stringify(monthEntries)]);
  }
  try {
    if (pairs.length > 0) {
      // The marker rides the same batch, LAST: multiSet is a sequential loop on
      // the web backend, so a present marker proves every chunk pair landed.
      await AsyncStorage.multiSet([...pairs, [KEY_ENTRIES_MIGRATED, '1']]);
    }
    await AsyncStorage.removeItem(KEY_ENTRIES_V1);
  } catch (e) {
    console.warn('[entityStore] entries v1 to v2 migration failed, will retry next load:', e);
  }
  return true;
}

interface ChunkLoad {
  entries: Entry[];
  /** whether any chunk key exists on disk (even if unreadable or corrupt) */
  found: boolean;
}

/** Loads every chunk, month descending, seeding `lastWrittenChunks` so the first
 *  save can diff against disk. A failed key listing leaves the months unknown, so
 *  the whole namespace is marked unwritable for the session. Android serves
 *  `multiGet` through one shared cursor, so one over-large row fails every month
 *  at once: retry per key so the healthy months still load. */
async function loadEntryChunks(): Promise<ChunkLoad> {
  let chunkKeys: string[];
  try {
    const all = await AsyncStorage.getAllKeys();
    chunkKeys = all.filter((k) => k.startsWith(ENTRY_CHUNK_PREFIX));
    readFailed.delete(ENTRY_CHUNK_PREFIX);
  } catch (e) {
    console.warn('[entityStore] failed to list entry chunks, treating as absent:', e);
    readFailed.add(ENTRY_CHUNK_PREFIX);
    lastWrittenChunks = null;
    return { entries: [], found: false };
  }
  // Month desc: zero-padded keys sort lexicographically as chronologically.
  chunkKeys.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  if (chunkKeys.length === 0) {
    lastWrittenChunks = new Map();
    return { entries: [], found: false };
  }
  let pairs: readonly (readonly [string, string | null])[];
  try {
    pairs = await AsyncStorage.multiGet(chunkKeys);
    for (const k of chunkKeys) readFailed.delete(k);
  } catch {
    pairs = await Promise.all(chunkKeys.map(async (k) => [k, await getItemOrNull(k)] as const));
  }
  const cache = new Map<string, string>();
  const entries: Entry[] = [];
  // An entry edited across a month boundary moves chunks in one save, and a crash
  // between the two calls leaves a stale copy. First-seen in month-desc order wins.
  const seen = new Set<string>();
  for (const [key, raw] of pairs) {
    // The per-key retry failed: keep it out of the cache so saveEntries neither
    // rewrites nor removes it.
    if (raw == null) continue;
    cache.set(key, raw);
    for (const e of parseEntryArray(raw)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      entries.push(e);
    }
  }
  lastWrittenChunks = cache;
  return { entries, found: true };
}

/** null ONLY when every key is absent; otherwise an absent, corrupt, or
 *  unreadable field is defaulted. */
export async function loadEntities(): Promise<StoredEntities | null> {
  // Must finish before the chunk read: it writes the chunks that read enumerates.
  const hadEntries = await migrateEntriesV1();
  const [childrenRaw, measurementsRaw, selectedChildIdRaw, lastFeedRaw, chunks] = await Promise.all([
    getItemOrNull(KEY_CHILDREN),
    getItemOrNull(KEY_MEASUREMENTS),
    getItemOrNull(KEY_SELECTED_CHILD),
    getItemOrNull(KEY_LAST_FEED),
    loadEntryChunks(),
  ]);

  if (
    childrenRaw == null &&
    !hadEntries &&
    !chunks.found &&
    measurementsRaw == null &&
    selectedChildIdRaw == null &&
    lastFeedRaw == null
  ) {
    return null;
  }

  const lastFeed = parseLastFeed(lastFeedRaw);
  return {
    children: parseOr<Child[]>(childrenRaw, []),
    entries: chunks.entries,
    measurements: parseOr<Measurement[]>(measurementsRaw, []),
    selectedChildId: parseOr<string>(selectedChildIdRaw, ''),
    lastFeed: lastFeed.map,
    legacyLastFeed: lastFeed.legacy,
  };
}

export async function saveChildren(v: Child[]): Promise<void> {
  if (blockedByFailedRead(KEY_CHILDREN, 'saveChildren')) return;
  try {
    await AsyncStorage.setItem(KEY_CHILDREN, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveChildren failed:', e);
  }
}

export async function saveEntries(v: Entry[]): Promise<void> {
  // Whole-namespace blocks: an unreadable v1 blob means an unknown span of history
  // is missing from memory and the pending migration would overwrite new chunks.
  if (blockedByFailedRead(KEY_ENTRIES_V1, 'saveEntries')) return;
  if (blockedByFailedRead(ENTRY_CHUNK_PREFIX, 'saveEntries')) return;

  const next = new Map<string, string>();
  for (const [key, monthEntries] of groupByChunkKey(v)) {
    next.set(key, JSON.stringify(monthEntries));
  }

  const cache = lastWrittenChunks;
  const changed: [string, string][] = [];
  for (const [key, json] of next) {
    // This month never loaded, so the grouped array for it is incomplete.
    if (blockedByFailedRead(key, 'saveEntries')) continue;
    if (cache == null || cache.get(key) !== json) changed.push([key, json]);
  }
  // A month in `readFailed` cannot appear here: its failed read seeded no cache
  // entry, so an unreadable month is never mistaken for an emptied one.
  const removed = cache == null ? [] : [...cache.keys()].filter((k) => !next.has(k));

  // The cache updates only on success, so a failed month stays dirty and retries.
  try {
    if (changed.length > 0) {
      await AsyncStorage.multiSet(changed);
      const c = lastWrittenChunks ?? (lastWrittenChunks = new Map());
      for (const [key, json] of changed) c.set(key, json);
    }
  } catch (e) {
    console.warn('[entityStore] saveEntries failed:', e);
  }
  try {
    if (removed.length > 0) {
      await AsyncStorage.multiRemove(removed);
      for (const key of removed) lastWrittenChunks?.delete(key);
    }
  } catch (e) {
    console.warn('[entityStore] saveEntries failed to drop emptied months:', e);
  }
}

export async function saveMeasurements(v: Measurement[]): Promise<void> {
  if (blockedByFailedRead(KEY_MEASUREMENTS, 'saveMeasurements')) return;
  try {
    await AsyncStorage.setItem(KEY_MEASUREMENTS, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveMeasurements failed:', e);
  }
}

export async function saveSelectedChildId(v: string): Promise<void> {
  if (blockedByFailedRead(KEY_SELECTED_CHILD, 'saveSelectedChildId')) return;
  try {
    await AsyncStorage.setItem(KEY_SELECTED_CHILD, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveSelectedChildId failed:', e);
  }
}

/** An EMPTY map is never written: it shares its key with the pre-map scalar (see
 *  `parseLastFeed`), and within a session the map only ever GAINS keys. */
export async function saveLastFeed(v: Record<string, LastFeed>): Promise<void> {
  if (Object.keys(v).length === 0) return;
  if (blockedByFailedRead(KEY_LAST_FEED, 'saveLastFeed')) return;
  try {
    await AsyncStorage.setItem(KEY_LAST_FEED, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveLastFeed failed:', e);
  }
}

/** null when never stamped, unreadable, or corrupt: unknown only DISABLES the
 *  reconnect merge. */
export async function loadEntityOrigin(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_ENTITY_ORIGIN);
    if (raw == null) return null;
    const parsed = parseOr<unknown>(raw, null);
    return typeof parsed === 'string' ? parsed : null;
  } catch (e) {
    console.warn('[entityStore] failed to read the entity origin, treating as absent:', e);
    return null;
  }
}

/** Deliberately outside the read-failure write guard: every stamp is an
 *  authoritative re-label, and blocking it would leave A's label on B's data. */
export async function saveEntityOrigin(origin: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_ENTITY_ORIGIN, JSON.stringify(origin));
  } catch (e) {
    console.warn('[entityStore] saveEntityOrigin failed:', e);
  }
}

export async function clearEntities(): Promise<void> {
  // Disk state is unknown until the clear finishes, whichever way it ends.
  lastWrittenChunks = null;
  try {
    const all = await AsyncStorage.getAllKeys();
    const chunkKeys = all.filter((k) => k.startsWith(ENTRY_CHUNK_PREFIX));
    await Promise.all([
      AsyncStorage.removeItem(KEY_CHILDREN),
      AsyncStorage.removeItem(KEY_ENTRIES_V1),
      AsyncStorage.removeItem(KEY_ENTRIES_MIGRATED),
      AsyncStorage.removeItem(KEY_MEASUREMENTS),
      AsyncStorage.removeItem(KEY_SELECTED_CHILD),
      AsyncStorage.removeItem(KEY_LAST_FEED),
      AsyncStorage.removeItem(KEY_ENTITY_ORIGIN),
      ...(chunkKeys.length > 0 ? [AsyncStorage.multiRemove(chunkKeys)] : []),
    ]);
    // Every key the guard could be protecting was just destroyed on purpose.
    readFailed.clear();
    lastWrittenChunks = new Map();
  } catch (e) {
    console.warn('[entityStore] clearEntities failed:', e);
  }
}
