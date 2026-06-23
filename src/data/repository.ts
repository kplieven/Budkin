/**
 * Repository: the single source of "load data" / "push a write", abstracting
 * over a real Baby Buddy server vs the local demo. The store talks only to this.
 */

import { BabybuddyClient } from '@/api/client';
import type {
  ActivityType,
  Child,
  Entry,
  FeedMethod,
  FeedType,
  Measurement,
  MeasurementKind,
  Timer,
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
    const [f, s, d, p, tt] = await Promise.all([
      client.listFeedings(selectedChildId).catch(() => []),
      client.listSleep(selectedChildId).catch(() => []),
      client.listChanges(selectedChildId).catch(() => []),
      client.listPumping(selectedChildId).catch(() => []),
      client.listTummy(selectedChildId).catch(() => []),
    ]);
    entries = [...f, ...s, ...d, ...p, ...tt];
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
