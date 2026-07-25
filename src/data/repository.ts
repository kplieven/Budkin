/**
 * Repository: the single source of "load data" / "push a write", abstracting
 * over a real Baby Buddy server vs the local demo. The store talks only to this.
 */

import { BabybuddyClient } from '@/api/client';
import { DEMO_TAGS } from '@/data/seed';
import { encodeTimerName, serverTimerToTimer } from '@/data/serverTimers';
import {
  entryTimestamp,
  type ActivityType,
  type Child,
  type ChildGender,
  type Cure,
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
  /** The selected child's treatment regimens, read from their `cure`-tagged
   *  notes. Empty in local mode and whenever the fetch fails. */
  cures: Cure[];
}

/** Validate the connection and load children + recent entries from the server.
 *
 *  `preferredChildServerId` is the SERVER id (`Child.serverId`) of the child the
 *  app currently has selected locally, so a multi-child account loads the
 *  child the user is actually looking at instead of always the server's first.
 *  Callers bridge from the local id space with `childServerIdFor`. It is honoured
 *  only when that child is still on the server: an id that was deleted
 *  server-side, or a locally-created child never pushed (an expecting child has
 *  no `serverId` at all, so callers pass nothing), falls back to `children[0]`
 *  exactly as before. */
export async function loadFromServer(
  conn: Connection,
  preferredChildServerId?: number | null,
): Promise<LoadResult> {
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
      cures: [],
    };
  }
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  // Validate auth by listing children — which we need anyway and which throws
  // ApiError(401/403) on a bad token. We deliberately do NOT use /api/profile/
  // as the gate: it can return 500 on some instances (e.g. a user without a
  // settings row), which would wrongly reject a valid token.
  const rawChildren = await client.listChildren();
  // Baby Buddy's Child model has no gender field, so it arrives as one extra
  // request over the `gender`-tagged notes for the WHOLE account (not per
  // child), keyed by server id. A failure degrades to "not recorded" rather
  // than failing the load.
  const genders = await client.listGenders().catch(() => new Map<number, ChildGender>());
  const children = rawChildren.map((c) =>
    c.serverId != null && genders.has(c.serverId) ? { ...c, gender: genders.get(c.serverId) } : c,
  );
  const preferred =
    preferredChildServerId != null
      ? children.find((c) => c.serverId === preferredChildServerId)?.id
      : undefined;
  const selectedChildId = preferred ?? children[0]?.id ?? '';

  let entries: Entry[] = [];
  let cures: Cure[] = [];
  if (selectedChildId) {
    const [f, s, d, p, tt, notesData, temp, med, cureList] = await Promise.all([
      client.listFeedings(selectedChildId).catch(() => []),
      client.listSleep(selectedChildId).catch(() => []),
      client.listChanges(selectedChildId).catch(() => []),
      client.listPumping(selectedChildId).catch(() => []),
      client.listTummy(selectedChildId).catch(() => []),
      // ONE /api/notes/ request, partitioned into milestones + baths + general notes.
      client.listChildNotes(selectedChildId).catch(() => ({ baths: [], milestones: [], notes: [] })),
      client.listTemperature(selectedChildId).catch(() => []),
      client.listMedication(selectedChildId).catch(() => []),
      // Cures come from a SECOND /api/notes/ request filtered by the `cure` tag,
      // not out of `listChildNotes`: a cure note is dated at the regimen's start,
      // so a long-running treatment would drop out of the recent-notes window.
      client.listChildCures(selectedChildId).catch(() => [] as Cure[]),
    ]);
    entries = [...f, ...s, ...d, ...p, ...tt, ...notesData.baths, ...notesData.milestones, ...notesData.notes, ...temp, ...med];
    cures = cureList;
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

  // Running timers mirrored on the server (same-account cross device). Map each
  // timer's child FK back to a local child id; skip timers for a child we don't
  // have loaded, and degrade to none if the endpoint is unavailable.
  let timers: Timer[] = [];
  try {
    const raw = await client.listTimers();
    const childByServerId = new Map<number, string>();
    for (const c of children) if (c.serverId != null) childByServerId.set(c.serverId, c.id);
    timers = raw.flatMap((t) => {
      if (t.child == null) return [];
      const childId = childByServerId.get(t.child);
      return childId ? [serverTimerToTimer(t, childId)] : [];
    });
  } catch {
    timers = [];
  }

  return { children, entries, timers, selectedChildId, lastFeed, measurements, cures };
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
  childServerId: number,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createMeasurement(m, childServerId);
}

export async function updateMeasurementOnServer(
  conn: Connection,
  m: Measurement,
  childServerId: number,
): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateMeasurement(m, childServerId);
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

/** Write a child's gender as a `gender`-tagged note (or delete the note when
 *  the gender is cleared). No-op in local mode. */
export async function setChildGenderOnServer(
  conn: Connection,
  childServerId: number,
  gender: ChildGender | undefined,
  atMs: number,
): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.setChildGender(childServerId, gender, atMs);
}

/** Push a newly created cure (a `cure`-tagged note); returns its new server id. */
export async function pushCureToServer(
  conn: Connection,
  cure: Cure,
  childServerId: number,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createCure(cure, childServerId);
}

export async function updateCureOnServer(conn: Connection, cure: Cure, childServerId: number): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateCure(cure, childServerId);
}

export async function deleteCureFromServer(conn: Connection, serverId: number): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteCure(serverId);
}

/** Push a newly created child (with an optional photo); returns the new server
 *  id, its slug and the stored picture URL. The slug is what the child
 *  endpoints are keyed by (see `BabybuddyClient.childKey`). */
export async function pushChildToServer(
  conn: Connection,
  child: Child,
  change: PhotoChange = { kind: 'none' },
): Promise<{ id?: number; slug?: string; picture?: string | null } | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createChild(child, change.kind === 'set' ? change.photo : undefined);
}

/** Update a child (name/birth and photo change); returns the stored picture URL
 *  and the child's current slug, which a rename moves. */
export async function updateChildOnServer(
  conn: Connection,
  child: Child,
  change: PhotoChange = { kind: 'none' },
): Promise<{ picture: string | null; slug?: string } | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.updateChild(child, change);
}

/** Delete a child on the server (no-op in local mode). Takes the whole child,
 *  not just an id: Baby Buddy keys the child endpoints by SLUG (see
 *  `BabybuddyClient.childKey`). Baby Buddy cascades the child's history
 *  server-side, so this single call is enough. */
export async function deleteChildFromServer(conn: Connection, child: Child): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteChild(child);
}

/** Push a created entry to the server; returns its new server id (or undefined). */
export async function pushEntryToServer(
  conn: Connection,
  entry: Entry,
  childServerId: number,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createEntry(entry, childServerId);
}

/** Update an existing entry on the server (no-op in demo mode). */
export async function updateEntryOnServer(
  conn: Connection,
  entry: Entry,
  childServerId: number,
): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateEntry(entry, childServerId);
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

/** Create a running timer on the server; returns its new server id. Requires the
 *  child's server id (skip when the child is not synced yet). */
export async function pushTimerToServer(
  conn: Connection,
  timer: Timer,
  childServerId: number,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createTimer(childServerId, timer.start, encodeTimerName(timer));
}

/** Update a running timer's encoded name + start on the server (needs serverId). */
export async function updateTimerOnServer(conn: Connection, timer: Timer): Promise<void> {
  if (conn.mode !== 'server' || timer.serverId == null) return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateTimer(timer.serverId, encodeTimerName(timer), timer.start);
}

/** Delete a running timer on the server (no-op in local mode). */
export async function deleteTimerFromServer(conn: Connection, serverId: number): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteTimer(serverId);
}

/** True if the server already has at least one child (i.e. it is NOT a fresh,
 *  empty instance). Used by the adopt flow to decide the empty vs guarded path. */
export async function serverHasData(conn: Connection): Promise<boolean> {
  if (conn.mode !== 'server') return false;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  const children = await client.listChildren();
  return children.length > 0;
}
