/**
 * Repository: the single source of "load data" / "push a write", abstracting
 * over a real Baby Buddy server vs the local demo. The store talks only to this.
 */

import { BabybuddyClient } from '@/api/client';
import { DEMO_TAGS } from '@/data/seed';
import {
  entryTimestamp,
  type ActivityType,
  type Child,
  type Entry,
  type FeedMethod,
  type FeedType,
  type Measurement,
  type MeasurementKind,
  type PhotoChange,
  type Profile,
  type Tag,
  type Timer,
} from '@/types/models';

export type Connection =
  | { mode: 'local' }
  | { mode: 'server'; serverUrl: string; token: string };

export interface LoadResult {
  children: Child[];
  entries: Entry[];
  timers: Timer[];
  selectedChildId: string;
  lastFeed: { feedType: FeedType; method: FeedMethod };
  measurements: Measurement[];
}

/** Validate the connection and load children + recent entries from the server. */
export async function loadFromServer(conn: Connection): Promise<LoadResult> {
  // Dead default: this is only ever called with a real server connection, but
  // the union needs a guard here to narrow `conn` for the `serverUrl`/`token`
  // access below.
  if (conn.mode !== 'server') {
    return {
      children: [],
      entries: [],
      timers: [],
      selectedChildId: '',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    };
  }
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  // Validate auth by listing children — which we need anyway and which throws
  // ApiError(401/403) on a bad token. We deliberately do NOT use /api/profile/
  // as the gate: it can return 500 on some instances (e.g. a user without a
  // settings row), which would wrongly reject a valid token.
  const children = await client.listChildren();
  const selectedChildId = children[0]?.id ?? '';

  let entries: Entry[] = [];
  if (selectedChildId) {
    const [f, s, d, p, tt, notesData, temp] = await Promise.all([
      client.listFeedings(selectedChildId).catch(() => []),
      client.listSleep(selectedChildId).catch(() => []),
      client.listChanges(selectedChildId).catch(() => []),
      client.listPumping(selectedChildId).catch(() => []),
      client.listTummy(selectedChildId).catch(() => []),
      // ONE /api/notes/ request, partitioned into baths + general notes.
      client.listChildNotes(selectedChildId).catch(() => ({ baths: [], notes: [] })),
      client.listTemperature(selectedChildId).catch(() => []),
    ]);
    entries = [...f, ...s, ...d, ...p, ...tt, ...notesData.baths, ...notesData.notes, ...temp];
  }

  const lastFeeding = entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding')
    .sort((a, b) => b.start - a.start)[0];
  const lastFeed = lastFeeding
    ? { feedType: lastFeeding.feedType, method: lastFeeding.method }
    : { feedType: 'breast' as FeedType, method: 'left' as FeedMethod };

  let measurements: Measurement[] = [];
  if (selectedChildId) {
    const kinds: MeasurementKind[] = ['weight', 'height', 'head', 'bmi'];
    const lists = await Promise.all(
      kinds.map((k) => client.listMeasurements(k, selectedChildId).catch(() => [] as Measurement[])),
    );
    measurements = lists.flat();
  }

  return { children, entries, timers: [], selectedChildId, lastFeed, measurements };
}

/**
 * Fetch the charted history (sleep + feedings + diapers) back to `sinceMs`
 * using LimitOffset pagination. Demo mode returns [] — the store supplies demo
 * history from the local seed. Per-type failures degrade to [].
 */
export async function loadInsightsHistory(
  conn: Connection,
  childId: string,
  sinceMs: number,
): Promise<Entry[]> {
  if (conn.mode !== 'server' || !childId) return [];
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  const LIMIT = 100;
  const MAX_PAGES = 20; // hard backstop: ≤2000 entries/type

  const pageAll = async (fetch: (limit: number, offset: number) => Promise<Entry[]>): Promise<Entry[]> => {
    const acc: Entry[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await fetch(LIMIT, page * LIMIT).catch(() => [] as Entry[]);
      acc.push(...batch);
      if (batch.length < LIMIT) break;
      if (entryTimestamp(batch[batch.length - 1]) < sinceMs) break;
    }
    return acc.filter((e) => entryTimestamp(e) >= sinceMs);
  };

  const [s, f, d] = await Promise.all([
    pageAll((l, o) => client.listSleep(childId, l, o)),
    pageAll((l, o) => client.listFeedings(childId, l, o)),
    pageAll((l, o) => client.listChanges(childId, l, o)),
  ]);
  return [...s, ...f, ...d];
}

/**
 * Fetch the connected user's Baby Buddy account + general settings
 * (read-only display in Settings). Demo → null (no server). Throws on
 * error — the store's `loadProfile` action catches it and sets
 * `profileError`; this must never be treated as fatal to the app.
 */
export async function loadProfileFromServer(conn: Connection): Promise<Profile | null> {
  if (conn.mode !== 'server') return null;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.getProfile();
}

/**
 * Fetch the server's tag list for the picker (lazy — called on first LogSheet
 * open, cached in the store, staleness tolerated). Demo → the local fallback
 * seed list so the picker isn't empty. Throws on error; the store's `loadTags`
 * action catches it and keeps whatever tags were already cached.
 */
export async function loadTagsFromServer(conn: Connection): Promise<Tag[]> {
  if (conn.mode !== 'server') return DEMO_TAGS;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.listTags();
}

/** Push a created measurement; returns its new server id (or undefined). */
export async function pushMeasurementToServer(
  conn: Connection,
  m: Measurement,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createMeasurement(m);
}

export async function updateMeasurementOnServer(conn: Connection, m: Measurement): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateMeasurement(m);
}

export async function deleteMeasurementFromServer(
  conn: Connection,
  kind: MeasurementKind,
  serverId: number,
): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteMeasurement(kind, serverId);
}

/** Push a newly created child (with an optional photo); returns the new server
 *  id and stored picture URL. */
export async function pushChildToServer(
  conn: Connection,
  child: Child,
  change: PhotoChange = { kind: 'none' },
): Promise<{ id?: number; picture?: string | null } | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createChild(child, change.kind === 'set' ? change.photo : undefined);
}

/** Update a child (name/birth and photo change); returns the stored picture URL. */
export async function updateChildOnServer(
  conn: Connection,
  child: Child,
  change: PhotoChange = { kind: 'none' },
): Promise<string | null | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.updateChild(child, change);
}

/** Delete a child on the server (no-op in local mode). Baby Buddy cascades the
 *  child's history server-side, so this single call is enough. */
export async function deleteChildFromServer(conn: Connection, id: number): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteChild(id);
}

/** Push a created entry to the server; returns its new server id (or undefined). */
export async function pushEntryToServer(
  conn: Connection,
  entry: Entry,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createEntry(entry);
}

/** Update an existing entry on the server (no-op in demo mode). */
export async function updateEntryOnServer(conn: Connection, entry: Entry): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateEntry(entry);
}

/** Delete an entry on the server (no-op in demo mode). */
export async function deleteEntryFromServer(
  conn: Connection,
  type: ActivityType,
  serverId: number,
): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteEntry(type, serverId);
}

/** True if the server already has at least one child (i.e. it is NOT a fresh,
 *  empty instance). Used by the adopt flow to decide the empty vs guarded path. */
export async function serverHasData(conn: Connection): Promise<boolean> {
  if (conn.mode !== 'server') return false;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  const children = await client.listChildren();
  return children.length > 0;
}
