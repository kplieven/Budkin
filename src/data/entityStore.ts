/**
 * Durable on-device persistence for the app's core entities, backed by
 * AsyncStorage. This is the store that makes "local mode" real: children,
 * entries, measurements, the selected child, and the last-used feed defaults
 * all survive app restarts independent of any server connection.
 *
 * Mirrors the guarded try/catch AsyncStorage wrapper pattern used by
 * `src/data/timers.ts` / `src/data/prefs.ts`, with two protections on top:
 *
 * 1. Read-failure write guard: a key whose last read THREW is write-blocked
 *    for the rest of the session (see `readFailed`). Without this, a transient
 *    native read error would default the key in memory and the store
 *    subscription would then persist that default over on-disk data that was
 *    merely unreadable for one launch, turning a glitch into a permanent wipe.
 *
 * 2. Per-month entry chunks: entries are persisted as one key per local month
 *    (`budkin.entries.v2.<YYYY-MM>`) instead of a single ever-growing blob.
 *    Android AsyncStorage stores each key as one SQLite row, and rows around
 *    2MB stop being READABLE (CursorWindow) while writes keep succeeding; a
 *    year of dense logging in one key would cross that cliff and the app
 *    would come up empty for good. Chunks keep every row small forever, and
 *    a read failure in one month costs that month, not the whole history.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeWash } from '@/lib/wash';
import type { Child, Entry, LastFeed, Measurement } from '@/types/models';
import { entryTimestamp } from '@/types/models';

const KEY_CHILDREN = 'budkin.children.v1';
/**
 * Legacy single-blob entries key. Nothing writes it anymore; `loadEntities`
 * migrates it into month chunks on first read and removes it. It stays in
 * `clearEntities` (a pre-migration disconnect must still destroy it) and in
 * the write guard (see `saveEntries`).
 */
const KEY_ENTRIES_V1 = 'budkin.entries.v1';
/**
 * Set (to '1') in the same `multiSet` batch that lands the migrated chunks,
 * as the LAST pair, and kept forever afterwards (only `clearEntities` removes
 * it). Its presence proves a migration completed its chunk writes, so a v1
 * blob still on disk is dead data whose final `removeItem` did not land; see
 * `migrateEntriesV1` for why it must then be dropped UNREAD. Deliberately
 * outside the `ENTRY_CHUNK_PREFIX` namespace so the chunk listing can never
 * misparse it as a month.
 */
const KEY_ENTRIES_MIGRATED = 'budkin.entriesMigrated.v2';
/**
 * Prefix of the per-month entry chunk keys, `budkin.entries.v2.<YYYY-MM>`
 * (local time of `entryTimestamp`, zero-padded month). The bare prefix never
 * names a stored value; it doubles as the `readFailed` sentinel meaning "the
 * chunk key listing itself failed, block every entry write".
 */
const ENTRY_CHUNK_PREFIX = 'budkin.entries.v2.';
const KEY_MEASUREMENTS = 'budkin.measurements.v1';
const KEY_SELECTED_CHILD = 'budkin.selectedChild.v1';
const KEY_LAST_FEED = 'budkin.lastFeed.v1';
/**
 * Which data set the stored entities belong to: a NORMALIZED server URL
 * (`normalizeServerUrl`) for server mode, or the literal 'local' for local
 * mode. Stamped by connect()/adopt()/enterLocal() alongside their
 * saveConnection, and read back by connect() to decide whether a reconnect
 * may reconcile the stored entities with the incoming server load: serverIds
 * are per-server numeric ids, so matching by them across two different
 * servers would graft one account's records onto another's children.
 *
 * Its lifecycle is paired with the DATA it labels, not with the connection:
 * a session expiry clears the connection but keeps the entities, and the
 * origin must survive right alongside them, so only `clearEntities` removes
 * it. Not a secret, just a label naming where the data came from; it never
 * holds a token.
 */
const KEY_ENTITY_ORIGIN = 'budkin.entityOrigin.v1';

export interface StoredEntities {
  children: Child[];
  entries: Entry[];
  measurements: Measurement[];
  selectedChildId: string;
  /** Per-child feeding prefill, keyed by child id. Absent for a child who has
   *  never been fed through this app; the reader falls back (see
   *  `lastFeedForChild`), which is also how `legacyLastFeed` gets used. */
  lastFeed: Record<string, LastFeed>;
  /** The single account-wide value a pre-map build left on the same key, or
   *  null. Read-only: nothing ever writes this shape again, and it disappears
   *  the first time `saveLastFeed` overwrites the key with a map. */
  legacyLastFeed: LastFeed | null;
}

/**
 * Keys whose most recent read THREW (a native I/O error, not a parse error).
 * Every save skips a key in this set: the in-memory value for it was built
 * WITHOUT the on-disk data, so writing it back would overwrite real data that
 * was merely unreadable for one launch. A read that succeeds (including one
 * that finds the key absent) unblocks the key; there is no mid-session
 * unblock without a re-read, because by then state was already built without
 * the unread data and any write would still clobber it.
 *
 * Parse failures (corrupt JSON that READ fine) never enter this set: that
 * data is unrecoverable anyway, and overwriting corruption with good data is
 * desirable.
 *
 * Accepted tradeoff: during a session whose read failed, that key's changes
 * do not persist locally; in server mode the queue/pendingOps paths still
 * capture writes. This trades "silently destroy history" for "one session's
 * local persistence pauses", which is the right trade.
 */
const readFailed = new Set<string>();

/**
 * Last JSON written to (or read from) each chunk key this session, so
 * `saveEntries` can rewrite only the months that actually changed. Seeded by
 * `loadEntryChunks`; null means the on-disk chunk set is unknown (no load ran
 * yet, e.g. the first save after a fresh server connect), in which case a
 * save writes every month it has and removes nothing.
 */
let lastWrittenChunks: Map<string, string> | null = null;

/**
 * Test-only: forget the read-failure guard and the per-month write cache,
 * modelling an app restart. Both are module state, so without this one test's
 * simulated I/O failure would block writes in every test after it (matches
 * the `resetTimerRetryForTests` pattern in useAppStore).
 */
export function resetEntityStoreForTests(): void {
  readFailed.clear();
  lastWrittenChunks = null;
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
 * Parses a persisted entry-array value; anything but an array counts as corrupt.
 *
 * Bath entries are additionally run through `normalizeWash`. Chunks written
 * before the 2026-08 rename hold `wash: 'small' | 'big'` verbatim, so this
 * normalises them on the way out of AsyncStorage. It is NOT the single funnel
 * every stored entry passes through: the offline queue (`src/data/queue.ts`)
 * and the pending-ops log (`src/data/pendingOps.ts`) hold entries too, and
 * neither loads through this function. Those two are covered instead by
 * normalising at their comparison sites (`bathToNoteBody` in
 * `src/api/client.ts`, `washDueState` in `src/store/selectors.ts`), so a
 * legacy value reaching any of the three is defused wherever it is compared.
 */
function parseEntryArray(raw: string | null): Entry[] {
  const parsed = parseOr<Entry[]>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((e) =>
    e?.type === 'bath' ? { ...e, wash: normalizeWash((e as { wash?: unknown }).wash) } : e,
  );
}

/**
 * Splits the persisted `budkin.lastFeed.v1` value into the per-child map and
 * the pre-map scalar the key may still be holding.
 *
 * Both shapes are plain objects, so "is it an object" decides nothing: the v1
 * value `{feedType, method}` would pass straight through as a map of two
 * children called `feedType` and `method`, and `parseOr` casts without looking.
 * The discriminator is the VALUE type. A map's values are always drafts
 * (objects); v1's are strings, so a string `feedType` can only be the old
 * shape. Anything that is neither is dropped rather than seeding a child with
 * junk.
 *
 * The key is deliberately NOT bumped, so the map and the value it replaces
 * SHARE one slot and a write can destroy the fallback. Nothing is migrated: the
 * legacy value is consulted on read as one child's fallback
 * (`lastFeedForChild`) and is overwritten only when a real per-child map is
 * saved over it, which `saveLastFeed`'s empty guard is what makes true.
 */
function parseLastFeed(raw: string | null): { map: Record<string, LastFeed>; legacy: LastFeed | null } {
  const parsed = parseOr<unknown>(raw, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { map: {}, legacy: null };
  const v = parsed as Record<string, unknown>;
  if (typeof v.feedType === 'string') return { map: {}, legacy: v as unknown as LastFeed };
  const drafts = Object.entries(v).filter(([, d]) => !!d && typeof d === 'object' && !Array.isArray(d));
  return { map: Object.fromEntries(drafts) as Record<string, LastFeed>, legacy: null };
}

/**
 * Reads a single key, returning its raw string or `null` when the key is
 * absent OR the read itself rejects (a native I/O error). Guarding each read
 * individually means one key's infra failure can never take down the others:
 * it's indistinguishable from that one key being absent. The failure is
 * remembered in `readFailed` so saves stop touching the key; a later
 * successful read clears it.
 */
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

/**
 * True when `key` is write-blocked because its last read failed; logs why.
 * See `readFailed` for the invariant this protects.
 */
function blockedByFailedRead(key: string, fn: string): boolean {
  if (!readFailed.has(key)) return false;
  console.warn(
    `[entityStore] ${fn}: skipping write, the last read of "${key}" failed, so the on-disk value may hold data this session never saw`
  );
  return true;
}

/** The chunk key an entry persists under: its `entryTimestamp` local month. */
function entryChunkKey(e: Entry): string {
  const d = new Date(entryTimestamp(e));
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${ENTRY_CHUNK_PREFIX}${d.getFullYear()}-${month}`;
}

/** Buckets entries by chunk key, preserving their order within each month. */
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

/**
 * One-time migration of the legacy single-blob entries key into per-month
 * chunks, run on every load until it completes (mirrors the `stagedEnd`-strip
 * migration-on-load style in `src/data/timers.ts`). Returns whether entries
 * were ever persisted (a v1 value now, or the completed-migration marker from
 * an earlier one), so `loadEntities` can keep its "was anything ever
 * persisted" contract across the migration.
 *
 * Interrupted migrations self-heal, and the marker decides HOW:
 * - marker present: the chunk writes of a previous migration all landed, only
 *   the final v1 removal did not. The chunks may hold entries written SINCE,
 *   so re-migrating would overwrite them with the stale blob, silently
 *   dropping those entries; and re-READING a dead blob that has crossed
 *   Android's CursorWindow cliff would fail and needlessly write-block
 *   entries for the whole session. So the blob is dropped UNREAD, best
 *   effort, and the chunks are left alone.
 * - no marker: the chunk batch itself never finished, so migrate again as an
 *   idempotent overwrite (every chunk being overwritten came from this same
 *   blob; nothing newer can exist under a month it covers). The chunk write
 *   comes BEFORE the v1 removal so a crash between the two can only leave
 *   both copies, never neither. If the v1 READ fails, the blob is left alone
 *   (`readFailed` blocks entry writes for the session) and whatever chunks
 *   exist are loaded instead: the blob may still become readable next launch.
 */
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
  // A corrupt v1 blob READ fine, so it is unrecoverable either way; migrating
  // it to "no entries" and dropping the key stops an eternal re-migration.
  const entries = parseEntryArray(raw);
  const pairs: [string, string][] = [];
  for (const [key, monthEntries] of groupByChunkKey(entries)) {
    pairs.push([key, JSON.stringify(monthEntries)]);
  }
  try {
    if (pairs.length > 0) {
      // The marker rides the same batch, LAST: the web localStorage backend
      // executes multiSet as a sequential loop, so a present marker proves
      // every chunk pair before it landed (on Android the batch is one
      // transaction and the order is moot). An empty or corrupt v1 writes no
      // marker on purpose: re-migrating nothing overwrites nothing.
      await AsyncStorage.multiSet([...pairs, [KEY_ENTRIES_MIGRATED, '1']]);
    }
    await AsyncStorage.removeItem(KEY_ENTRIES_V1);
  } catch (e) {
    // v1 survives (the removeItem only runs after the chunks landed), so the
    // next load simply migrates again.
    console.warn('[entityStore] entries v1 to v2 migration failed, will retry next load:', e);
  }
  return true;
}

interface ChunkLoad {
  entries: Entry[];
  /** whether any chunk key exists on disk (even if unreadable or corrupt) */
  found: boolean;
}

/**
 * Loads every `budkin.entries.v2.*` chunk and concatenates them, month
 * descending (deterministic; display sorts anyway). Seeds `lastWrittenChunks`
 * with each chunk's raw JSON so the first save can diff against disk.
 *
 * Failure handling, from coarse to fine:
 * - the key listing fails: no way to know which months exist, so mark the
 *   whole chunk namespace unwritable for the session (prefix sentinel).
 * - the batched read fails: Android serves `multiGet` through one shared
 *   cursor, so a single over-large row fails every month at once; retry per
 *   key so the healthy months still load and only the failing chunk is
 *   quarantined (via `getItemOrNull`). Partial history beats no history.
 */
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
  // Month desc. Zero-padded keys sort lexicographically as chronologically.
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
  // An entry edited across a month boundary is written to its new chunk and
  // dropped from its old one in the same save, but a crash between the two
  // storage calls can leave a stale copy behind. Dedupe by id, first-seen in
  // month-desc order, so the newest month's copy wins.
  const seen = new Set<string>();
  for (const [key, raw] of pairs) {
    // null here means the per-key retry failed for this chunk (getItemOrNull
    // already put it in readFailed): leave it out of the cache so saveEntries
    // can neither rewrite nor remove it.
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

/**
 * Returns null ONLY when every key comes back absent (nothing has ever been
 * persisted); otherwise returns a full object with any absent, corrupt, or
 * unreadable field defaulted.
 *
 * Each single key is read via `getItemOrNull` and entries via
 * `loadEntryChunks`, none of which reject, so a native I/O error on one key
 * degrades only that key's field to its default; it cannot mask real data
 * successfully read from the other keys. A failed read additionally
 * write-blocks its key for the session (see `readFailed`), so the default
 * that replaced it in memory can never be persisted over the real data.
 */
export async function loadEntities(): Promise<StoredEntities | null> {
  // The migration must finish before the chunk read: it writes the chunks the
  // read then enumerates (including, after an interrupted run, months that
  // exist only in chunks and months that exist only in v1).
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

/**
 * Persists the full entries array (the store subscription passes whole-state
 * arrays) into per-month chunks, writing only the months whose JSON differs
 * from the last written value and removing months that no longer have any
 * entries. In steady state that is one small chunk per save (the current
 * month), which is what keeps every row far below Android's read cliff.
 */
export async function saveEntries(v: Entry[]): Promise<void> {
  // Whole-namespace blocks, coarser than the per-month guard below: an
  // unreadable v1 blob means an unknown span of history is missing from
  // memory AND the pending migration would overwrite any chunk written now;
  // an unreadable key listing means the set of on-disk months is unknown, so
  // no chunk can be proven safe to touch.
  if (blockedByFailedRead(KEY_ENTRIES_V1, 'saveEntries')) return;
  if (blockedByFailedRead(ENTRY_CHUNK_PREFIX, 'saveEntries')) return;

  const next = new Map<string, string>();
  for (const [key, monthEntries] of groupByChunkKey(v)) {
    next.set(key, JSON.stringify(monthEntries));
  }

  const cache = lastWrittenChunks;
  const changed: [string, string][] = [];
  for (const [key, json] of next) {
    // Per-month guard: this month's entries are absent from memory, so its
    // grouped array here is incomplete; skip it and keep writing the others.
    if (blockedByFailedRead(key, 'saveEntries')) continue;
    if (cache == null || cache.get(key) !== json) changed.push([key, json]);
  }
  // Months that had entries at the last write and have none now. A month in
  // `readFailed` can never appear here: its failed read seeded no cache entry.
  const removed = cache == null ? [] : [...cache.keys()].filter((k) => !next.has(k));

  // The cache is updated only after a storage call succeeds; on failure the
  // stale cache value keeps the month marked dirty, so the next save retries.
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

/**
 * An EMPTY map is never written. The map shares its key with the pre-map scalar
 * (see `parseLastFeed`), and a launch that falls back to that scalar holds an
 * empty map all session, handed to the store as a FRESH `{}` reference; the
 * persistence subscription's reference check fires on it, so without this the
 * legacy value was destroyed by the first hydrate rather than by the first real
 * save, and the prefill reverted after a single restart.
 *
 * Nothing is lost by skipping it: within a session the map only ever GAINS keys
 * (`save()` and `mergeLastFeed` both spread the previous one), so an empty map
 * is always a just-loaded one, never a deletion. The one visible consequence is
 * that connecting to a DIFFERENT server leaves the previous account's map on
 * disk until the next feed is saved; those keys name children this install no
 * longer has, so nothing reads them, and `clearEntities` removes the key
 * outright on disconnect.
 */
export async function saveLastFeed(v: Record<string, LastFeed>): Promise<void> {
  if (Object.keys(v).length === 0) return;
  if (blockedByFailedRead(KEY_LAST_FEED, 'saveLastFeed')) return;
  try {
    await AsyncStorage.setItem(KEY_LAST_FEED, JSON.stringify(v));
  } catch (e) {
    console.warn('[entityStore] saveLastFeed failed:', e);
  }
}

/**
 * The stored entities' origin label (see `KEY_ENTITY_ORIGIN`), or null when
 * never stamped, unreadable, or corrupt. All three degrade the same safe way:
 * an unknown origin only ever DISABLES the reconnect merge, and the caller's
 * own stamp then self-heals the label for the next time.
 */
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

/**
 * Deliberately NOT wired into the read-failure write guard: every stamp is an
 * authoritative re-label tied to the data replacement happening in the same
 * connect/adopt/enterLocal flow, never an in-memory default being written
 * back over unread data, and blocking it could only let the label drift from
 * the data it names (e.g. a connect to server B that failed to re-stamp would
 * leave server A's label on B's entities, wrongly licensing a later merge).
 */
export async function saveEntityOrigin(origin: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_ENTITY_ORIGIN, JSON.stringify(origin));
  } catch (e) {
    console.warn('[entityStore] saveEntityOrigin failed:', e);
  }
}

/** Remove all entity keys, including every entry chunk (used on disconnect). */
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
      // The origin goes with the data it labels (see KEY_ENTITY_ORIGIN).
      AsyncStorage.removeItem(KEY_ENTITY_ORIGIN),
      ...(chunkKeys.length > 0 ? [AsyncStorage.multiRemove(chunkKeys)] : []),
    ]);
    // Every key the guard could be protecting was just destroyed on purpose,
    // so the read-failure blocks have nothing left to protect.
    readFailed.clear();
    lastWrittenChunks = new Map();
  } catch (e) {
    console.warn('[entityStore] clearEntities failed:', e);
  }
}
