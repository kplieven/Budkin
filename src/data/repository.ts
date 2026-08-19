/** The single source of "load data" and "push a write", abstracting over a real
 *  Baby Buddy server vs local mode. The store talks only to this. */

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

/** One per-type fetch: an entry `type`, a `MeasurementKind`, or `'treatment'`. */
export type LoadSlice = ActivityType | MeasurementKind | 'treatment';

export interface LoadResult {
  children: ServerChild[];
  entries: Entry[];
  /** null when the /api/timers/ fetch FAILED, which is distinct from []. Empty is
   *  an ANSWER ("nothing running anywhere") and consumers reconcile by dropping
   *  local serverId-carrying timers; null means keep them and skip that step. */
  timers: Timer[] | null;
  selectedChildId: string;
  /** Keyed by SERVER child id. A child with no feedings is ABSENT rather than
   *  keyed to a default, leaving whatever the device already knew standing. */
  lastFeed: Record<string, LastFeed>;
  measurements: Measurement[];
  /** Read from each child's `treatment`-tagged notes. Empty in local mode. */
  treatments: Treatment[];
  /** SERVER child id -> the record slices whose fetch DEGRADED to [] for that
   *  child. Nothing else in the shape says so, which makes a listed slice a FLOOR
   *  and not an answer: consumers must keep the rows they already hold instead of
   *  reading the gap as a delete, or one timed-out /api/notes/ takes every note,
   *  bath and milestone this device had. Per SLICE, so one structurally broken
   *  endpoint cannot freeze a child's whole history. FAILS CLOSED: any new
   *  per-type fetch MUST route its catch through `orEmpty`. */
  incompleteSlices?: Record<string, LoadSlice[]>;
}

/** Fixed concatenation order for `LoadResult.entries`, independent of timing. */
const ENTRY_SLICES = [
  'feeding',
  'sleep',
  'diaper',
  'pumping',
  'tummy',
  'bath',
  'milestone',
  'note',
  'temperature',
  'medication',
] as const satisfies readonly ActivityType[];

const MEASUREMENT_KINDS = ['weight', 'height', 'head', 'bmi'] as const satisfies readonly MeasurementKind[];

/** Cap on requests in flight across the WHOLE load, siblings included. A load
 *  costs 3 account-wide requests plus 13 per child, so a per-child `Promise.all`
 *  would peak at 13N, and peak concurrency is what kills a self-hosted instance:
 *  gunicorn defaults to `2*cores+1` workers, so a Pi serves 9 at a time. */
const FETCH_CONCURRENCY = 8;

/** Results come back in INPUT order regardless of completion order. A rejection
 *  leaves the remaining workers running, so every caller attaches its own catch. */
async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Kept per SLICE so concatenation order comes from `ENTRY_SLICES`, not timing. */
interface ChildLoad {
  entries: Partial<Record<ActivityType, Entry[]>>;
  measurements: Partial<Record<MeasurementKind, Measurement[]>>;
  treatments: Treatment[];
  degraded: LoadSlice[];
}

/** Validate the connection and load EVERY child's recent records, not just the
 *  selected one's: `applyServerLoad` replaces `entries` wholesale, so fetching
 *  only the selection deleted the previous child's month chunks from disk on each
 *  switch. `preferredChildServerId` only nominates `selectedChildId`, falling back
 *  to `children[0]` when that child is not on the server. */
export async function loadFromServer(
  conn: Connection,
  preferredChildServerId?: number | null,
): Promise<LoadResult> {
  // Only ever called with a server connection; the guard just narrows the union.
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
  // Validate auth by listing children, which we need anyway and which throws
  // ApiError(401/403) on a bad token. NOT /api/profile/ as the gate: it can 500 on
  // some instances (a user without a settings row), rejecting a valid token.
  const rawChildren = await client.listChildren();
  // Baby Buddy's Child model has no gender field: it lives in `gender`-tagged notes.
  const genders = await client.listGenders().catch(() => new Map<number, ChildGender>());
  const children = rawChildren.map((c) =>
    c.serverId != null && genders.has(c.serverId) ? { ...c, gender: genders.get(c.serverId) } : c,
  );
  const preferred =
    preferredChildServerId != null
      ? children.find((c) => c.serverId === preferredChildServerId)?.id
      : undefined;
  const selectedChildId = preferred ?? children[0]?.id ?? '';

  const loads = new Map<string, ChildLoad>();
  for (const c of children) loads.set(c.id, { entries: {}, measurements: {}, treatments: [], degraded: [] });

  /** The degrade-to-empty catch every per-type call shares. Takes the slices and
   *  the child explicitly, because one request can cover several slices and
   *  siblings' requests interleave. A 404 is NOT recorded: it says this server has
   *  no such endpoint (older instances 404 on /api/medication/), which is an
   *  answer, and recording it would freeze those slices on every load. */
  const orEmpty =
    <T>(load: ChildLoad, empty: T, ...slices: LoadSlice[]) =>
    (e: unknown): T => {
      if (!(e instanceof ApiError && e.status === 404)) load.degraded.push(...slices);
      return empty;
    };

  // ONE flat list across every child rather than a per-child `Promise.all`: flat
  // is what lets `FETCH_CONCURRENCY` cap the whole load instead of each child.
  const tasks = children.flatMap((c) => {
    const load = loads.get(c.id)!;
    const id = c.id;
    return [
      async () => void (load.entries.feeding = await client.listFeedings(id).catch(orEmpty(load, [], 'feeding'))),
      async () => void (load.entries.sleep = await client.listSleep(id).catch(orEmpty(load, [], 'sleep'))),
      async () => void (load.entries.diaper = await client.listChanges(id).catch(orEmpty(load, [], 'diaper'))),
      async () => void (load.entries.pumping = await client.listPumping(id).catch(orEmpty(load, [], 'pumping'))),
      async () => void (load.entries.tummy = await client.listTummy(id).catch(orEmpty(load, [], 'tummy'))),
      // ONE /api/notes/ request: a failure empties bath, milestone and note at once.
      async () => {
        const notesData = await client
          .listChildNotes(id)
          .catch(orEmpty(load, { baths: [], milestones: [], notes: [] }, 'bath', 'milestone', 'note'));
        load.entries.bath = notesData.baths;
        load.entries.milestone = notesData.milestones;
        load.entries.note = notesData.notes;
      },
      async () => void (load.entries.temperature = await client.listTemperature(id).catch(orEmpty(load, [], 'temperature'))),
      async () => void (load.entries.medication = await client.listMedication(id).catch(orEmpty(load, [], 'medication'))),
      // A SECOND /api/notes/ request filtered by the `treatment` tag: those notes
      // are dated at the regimen's start, outside the recent-notes window above.
      async () => void (load.treatments = await client.listChildTreatments(id).catch(orEmpty(load, [] as Treatment[], 'treatment'))),
      ...MEASUREMENT_KINDS.map(
        (k) => async () =>
          void (load.measurements[k] = await client.listMeasurements(k, id).catch(orEmpty(load, [] as Measurement[], k))),
      ),
    ];
  });
  await mapWithLimit(tasks, FETCH_CONCURRENCY, (t) => t());

  const entries: Entry[] = [];
  const measurements: Measurement[] = [];
  const treatments: Treatment[] = [];
  const incompleteSlices: Record<string, LoadSlice[]> = {};
  // No feeds means no opinion, NOT a default.
  const lastFeed: Record<string, LastFeed> = {};
  for (const c of children) {
    const load = loads.get(c.id)!;
    for (const slice of ENTRY_SLICES) entries.push(...(load.entries[slice] ?? []));
    for (const kind of MEASUREMENT_KINDS) measurements.push(...(load.measurements[kind] ?? []));
    treatments.push(...load.treatments);
    if (load.degraded.length > 0) incompleteSlices[c.id] = load.degraded;
    // Sort rather than trust the server's `-start` ordering. A degraded feeding
    // slice leaves the list empty, so the child's existing prefill survives.
    const lastFeeding = [...(load.entries.feeding ?? [])]
      .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding')
      .sort((a, b) => b.start - a.start)[0];
    if (lastFeeding) lastFeed[c.id] = { feedType: lastFeeding.feedType, method: lastFeeding.method };
  }

  // Map each timer's child FK back to a local child id, and degrade to null
  // (unknown) rather than [] when the endpoint is unavailable.
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
    incompleteSlices,
  };
}

/** Fetch the charted history (sleep + feedings + diapers) back to `sinceMs` by
 *  LimitOffset pagination. Local mode returns []; the store uses the seed. */
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

/** Throws on error; the store catches it into `profileError`, never fatal. */
export async function loadProfileFromServer(conn: Connection): Promise<Profile | null> {
  if (conn.mode !== 'server') return null;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.getProfile();
}

/** Lazy and cached; throws, and the store keeps the tags it already had. */
export async function loadTagsFromServer(conn: Connection): Promise<Tag[]> {
  if (conn.mode !== 'server') return DEMO_TAGS;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.listTags();
}

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

/** Gender is a `gender`-tagged note, not a Child field. */
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

/** A treatment is stored as a `treatment`-tagged note. */
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

/** Child endpoints are keyed by SLUG, not the numeric id, so callers store it. */
export async function pushChildToServer(
  conn: Connection,
  child: Child,
  change: PhotoChange = { kind: 'none' },
): Promise<{ id?: number; slug?: string; picture?: string | null } | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createChild(child, change.kind === 'set' ? change.photo : undefined);
}

/** Returns the child's current slug, which a rename MOVES: re-stamp it. */
export async function updateChildOnServer(
  conn: Connection,
  child: Child,
  change: PhotoChange = { kind: 'none' },
): Promise<{ picture: string | null; slug?: string } | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.updateChild(child, change);
}

/** Takes the whole child because of the slug; the server cascades the history. */
export async function deleteChildFromServer(conn: Connection, child: Child): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteChild(child);
}

export async function pushEntryToServer(
  conn: Connection,
  entry: Entry,
  childServerId: number,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createEntry(entry, childServerId);
}

export async function updateEntryOnServer(
  conn: Connection,
  entry: Entry,
  childServerId: number,
): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateEntry(entry, childServerId);
}

export async function deleteEntryFromServer(
  conn: Connection,
  type: ActivityType,
  serverId: number,
): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteEntry(type, serverId);
}

export async function pushTimerToServer(
  conn: Connection,
  timer: Timer,
  childServerId: number,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createTimer(childServerId, timer.start, encodeTimerName(timer));
}

export async function updateTimerOnServer(conn: Connection, timer: Timer): Promise<void> {
  if (conn.mode !== 'server' || timer.serverId == null) return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateTimer(timer.serverId, encodeTimerName(timer), timer.start);
}

export async function deleteTimerFromServer(conn: Connection, serverId: number): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteTimer(serverId);
}

/** True if the server is NOT a fresh instance; the adopt flow branches on it. */
export async function serverHasData(conn: Connection): Promise<boolean> {
  if (conn.mode !== 'server') return false;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  const children = await client.listChildren();
  return children.length > 0;
}
