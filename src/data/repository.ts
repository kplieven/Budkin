/**
 * Repository: the single source of "load data" / "push a write", abstracting
 * over a real Baby Buddy server vs the local demo. The store talks only to this.
 */

import { ApiError, BabybuddyClient } from '@/api/client';
import { DEMO_TAGS } from '@/data/seed';
import { encodeTimerName, serverTimerToTimer } from '@/data/serverTimers';
import {
  entryTimestamp,
  type ActivityType,
  type Child,
  type ChildGender,
  type Treatment,
  type Entry,
  type LastFeed,
  type Measurement,
  type MeasurementKind,
  type PhotoChange,
  type Profile,
  type ServerChild,
  type Tag,
  type Timer,
} from '@/types/models';

export type Connection =
  | { mode: 'local' }
  | { mode: 'server'; serverUrl: string; token: string };

/** One per-type fetch's worth of a child's records: an entry `type`, a
 *  `MeasurementKind`, or `'treatment'` (its own request). The unit
 *  `LoadResult.incompleteSlices` is expressed in, so a load can say WHICH of a
 *  child's records are missing rather than only that some are. */
export type LoadSlice = ActivityType | MeasurementKind | 'treatment';

export interface LoadResult {
  /** No `color`: the avatar tint is local-only, and the store fills it in when
   *  it reconciles this list (see `reconcileChildren`). */
  children: ServerChild[];
  entries: Entry[];
  /** Running timers mirrored on the server, or null when the /api/timers/
   *  fetch itself failed. The distinction is load-bearing: an empty list is
   *  an ANSWER ("no timers running anywhere"), which consumers reconcile by
   *  dropping local serverId-carrying timers as stopped elsewhere; null is
   *  the ABSENCE of an answer, and consumers must keep their local timers
   *  and skip reconciliation, or one transient failure of that single
   *  endpoint during a refresh would kill a running mirrored timer on the
   *  very device that started it. */
  timers: Timer[] | null;
  selectedChildId: string;
  /** The feeding prefill implied by the server's history, keyed by child. Never
   *  more than one entry: a load only ever fetches ONE child's records, so this
   *  is what THAT child was last fed, and it says nothing about a sibling. The
   *  key is a SERVER child id, like every other `childId` here, and the caller
   *  translates it (see `mergeLastFeed`). */
  lastFeed: Record<string, LastFeed>;
  measurements: Measurement[];
  /** The selected child's treatment regimens, read from their `treatment`-tagged
   *  notes. Empty in local mode and whenever the fetch fails. */
  treatments: Treatment[];
  /** SERVER child id -> the record slices whose fetch DEGRADED to [] for that
   *  child (see the `.catch`es below). A listed slice is missing from
   *  `entries`/`measurements`/`treatments` with nothing else in the shape
   *  saying so, which makes it a FLOOR, not an answer: consumers must keep the
   *  rows they already hold for it instead of reading the gap as a delete, or
   *  one timed-out /api/notes/ takes every note, bath and milestone this device
   *  had. Exactly the `timers: null` distinction, per child and per slice.
   *
   *  Optional, and absent (like an empty map) means every slice of every
   *  fetched child came back whole: `loadFromServer` is the only construction
   *  site, and a caller that cannot degrade should not have to say so.
   *
   *  Per SLICE rather than per child, deliberately. An endpoint can fail
   *  STRUCTURALLY and keep failing, so a per-child signal would freeze a
   *  child's whole history for as long as one endpoint stayed broken, which is
   *  the "never" that carry-over exists to avoid. A 404 is not counted at all:
   *  it is a positive answer ("this server has no such feature", e.g. an
   *  instance older than Baby Buddy's medication release), not an absent one.
   *
   *  Names only children this load FETCHED and failed for. A sibling it never
   *  fetched is not an incomplete answer, it is no answer at all, and what
   *  happens to a sibling's records is a separate question from this one.
   *
   *  Accepted residual: a slice whose endpoint keeps failing with something
   *  other than a 404 stays at the rows the device already holds, so a record
   *  added or deleted elsewhere in THAT slice lands only once the endpoint
   *  answers again. Bounded to the broken slice, and consumers take the answer
   *  as-is for a slice they hold no rows for, so it cannot present as an empty
   *  app.
   *
   *  `listGenders` is deliberately not counted: gender is account-wide rather
   *  than part of any child's record slice, it is merged onto `children` rather
   *  than into a slice, and it re-reads on the next good refresh. */
  incompleteSlices?: Record<string, LoadSlice[]>;
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
      lastFeed: {},
      measurements: [],
      treatments: [],
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

  // Filled by `orEmpty` below, and reported as `incompleteSlices`: the slices
  // whose rows are missing from the concatenation with nothing in the shape
  // saying so.
  const degraded: LoadSlice[] = [];
  /** The degrade-to-empty catch every per-type call shares, recording WHICH
   *  slices it emptied rather than swallowing the failure silently. Takes the
   *  slices explicitly because one request can cover several (`listChildNotes`
   *  answers for baths, milestones and notes at once).
   *
   *  A 404 is deliberately NOT recorded. It says this server has no such
   *  endpoint (Baby Buddy instances older than the medication release 404 on
   *  /api/medication/), which is an answer: "no rows, and there never will be".
   *  Recording it would freeze those slices on every load for as long as the
   *  server stayed on that version, rather than for one refresh. */
  const orEmpty =
    <T>(empty: T, ...slices: LoadSlice[]) =>
    (e: unknown): T => {
      if (!(e instanceof ApiError && e.status === 404)) degraded.push(...slices);
      return empty;
    };

  let entries: Entry[] = [];
  let treatments: Treatment[] = [];
  if (selectedChildId) {
    const [f, s, d, p, tt, notesData, temp, med, treatmentList] = await Promise.all([
      client.listFeedings(selectedChildId).catch(orEmpty([], 'feeding')),
      client.listSleep(selectedChildId).catch(orEmpty([], 'sleep')),
      client.listChanges(selectedChildId).catch(orEmpty([], 'diaper')),
      client.listPumping(selectedChildId).catch(orEmpty([], 'pumping')),
      client.listTummy(selectedChildId).catch(orEmpty([], 'tummy')),
      // ONE /api/notes/ request, partitioned into milestones + baths + general notes,
      // so one failure empties all three of those slices at once.
      client.listChildNotes(selectedChildId).catch(orEmpty({ baths: [], milestones: [], notes: [] }, 'bath', 'milestone', 'note')),
      client.listTemperature(selectedChildId).catch(orEmpty([], 'temperature')),
      client.listMedication(selectedChildId).catch(orEmpty([], 'medication')),
      // Treatments come from a SECOND /api/notes/ request filtered by the `treatment` tag,
      // not out of `listChildNotes`: a treatment note is dated at the regimen's start,
      // so a long-running treatment would drop out of the recent-notes window.
      client.listChildTreatments(selectedChildId).catch(orEmpty([] as Treatment[], 'treatment')),
    ]);
    entries = [...f, ...s, ...d, ...p, ...tt, ...notesData.baths, ...notesData.milestones, ...notesData.notes, ...temp, ...med];
    treatments = treatmentList;
  }

  const lastFeeding = entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding')
    .sort((a, b) => b.start - a.start)[0];
  // Keyed by the child this load fetched, so the caller can file it against
  // that child alone. No feeds means no opinion, NOT a default: an empty map
  // leaves whatever the device already knew about this child standing.
  const lastFeed: Record<string, LastFeed> = lastFeeding
    ? { [lastFeeding.childId]: { feedType: lastFeeding.feedType, method: lastFeeding.method } }
    : {};

  let measurements: Measurement[] = [];
  if (selectedChildId) {
    const kinds: MeasurementKind[] = ['weight', 'height', 'head', 'bmi'];
    const lists = await Promise.all(
      // Each kind is its own request, so each is its own slice: a 500 on weight
      // says nothing about the height rows that came back.
      kinds.map((k) => client.listMeasurements(k, selectedChildId).catch(orEmpty([] as Measurement[], k))),
    );
    measurements = lists.flat();
  }

  // Running timers mirrored on the server (same-account cross device). Map each
  // timer's child FK back to a local child id; skip timers for a child we don't
  // have loaded, and degrade to null (unknown) if the endpoint is unavailable:
  // NOT [], which would be a positive "no timers running anywhere" answer that
  // consumers reconcile by dropping local synced timers as stopped elsewhere.
  // See `LoadResult.timers`.
  let timers: Timer[] | null = [];
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
    timers = null;
  }

  return {
    children,
    entries,
    timers,
    selectedChildId,
    lastFeed,
    measurements,
    treatments,
    // Keyed by the one child this load fetched, and only when something
    // actually degraded (see `LoadResult.incompleteSlices`). An account with no
    // children fetched nothing, so it names nothing.
    incompleteSlices: selectedChildId && degraded.length > 0 ? { [selectedChildId]: degraded } : {},
  };
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

/** Push a newly created treatment (a `treatment`-tagged note); returns its new server id. */
export async function pushTreatmentToServer(
  conn: Connection,
  treatment: Treatment,
  childServerId: number,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createTreatment(treatment, childServerId);
}

export async function updateTreatmentOnServer(conn: Connection, treatment: Treatment, childServerId: number): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateTreatment(treatment, childServerId);
}

export async function deleteTreatmentFromServer(conn: Connection, serverId: number): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteTreatment(serverId);
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
