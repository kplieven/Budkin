/**
 * Repository: the single source of "load data" / "push a write", abstracting
 * over a real Baby Buddy server vs the local demo. The store talks only to this.
 */

import { BabybuddyClient } from '@/api/client';
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
  type Timer,
} from '@/types/models';

export interface Connection {
  demo: boolean;
  serverUrl: string;
  token: string;
}

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
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  // Validate auth by listing children — which we need anyway and which throws
  // ApiError(401/403) on a bad token. We deliberately do NOT use /api/profile/
  // as the gate: it can return 500 on some instances (e.g. a user without a
  // settings row), which would wrongly reject a valid token.
  const children = await client.listChildren();
  const selectedChildId = children[0]?.id ?? '';

  let entries: Entry[] = [];
  if (selectedChildId) {
    const [f, s, d, p, tt, b] = await Promise.all([
      client.listFeedings(selectedChildId).catch(() => []),
      client.listSleep(selectedChildId).catch(() => []),
      client.listChanges(selectedChildId).catch(() => []),
      client.listPumping(selectedChildId).catch(() => []),
      client.listTummy(selectedChildId).catch(() => []),
      client.listNotes(selectedChildId).catch(() => []),
    ]);
    entries = [...f, ...s, ...d, ...p, ...tt, ...b];
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
  if (conn.demo || !childId) return [];
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
  if (conn.demo) return null;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.getProfile();
}

/** Push a created measurement; returns its new server id (or undefined). */
export async function pushMeasurementToServer(
  conn: Connection,
  m: Measurement,
): Promise<number | undefined> {
  if (conn.demo) return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createMeasurement(m);
}

export async function updateMeasurementOnServer(conn: Connection, m: Measurement): Promise<void> {
  if (conn.demo) return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateMeasurement(m);
}

export async function deleteMeasurementFromServer(
  conn: Connection,
  kind: MeasurementKind,
  serverId: number,
): Promise<void> {
  if (conn.demo) return;
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
  if (conn.demo) return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createChild(child, change.kind === 'set' ? change.photo : undefined);
}

/** Update a child (name/birth and photo change); returns the stored picture URL. */
export async function updateChildOnServer(
  conn: Connection,
  child: Child,
  change: PhotoChange = { kind: 'none' },
): Promise<string | null | undefined> {
  if (conn.demo) return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.updateChild(child, change);
}

/** Push a created entry to the server; returns its new server id (or undefined). */
export async function pushEntryToServer(
  conn: Connection,
  entry: Entry,
): Promise<number | undefined> {
  if (conn.demo) return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createEntry(entry);
}

/** Update an existing entry on the server (no-op in demo mode). */
export async function updateEntryOnServer(conn: Connection, entry: Entry): Promise<void> {
  if (conn.demo) return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateEntry(entry);
}

/** Delete an entry on the server (no-op in demo mode). */
export async function deleteEntryFromServer(
  conn: Connection,
  type: ActivityType,
  serverId: number,
): Promise<void> {
  if (conn.demo) return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteEntry(type, serverId);
}
