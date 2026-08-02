import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mergeHeldBackEntries,
  mergeQueuedEntries,
  mergeUnsynced,
  reconcileChildren,
  remapChildIds,
  resetQueueRetryForTests,
  resetTimerRetryForTests,
  useAppStore,
  visibleTags,
} from '@/store/useAppStore';
import { BATH_RHYTHM_DEFAULT, entriesForChild, isActive, LAST_FEED_DEFAULT, selectPendingCount, teDurationMin, teEnd, teStart } from '@/store/selectors';
import { toDisplay } from '@/lib/units';
import { CHILD_COLORS } from '@/lib/color';
import { ApiError } from '@/api/client';
import { DEMO_TAGS } from '@/data/seed';
import { loadConnection, saveConnection } from '@/data/storage';
import {
  deleteEntryFromServer,
  loadFromServer,
  loadInsightsHistory,
  loadProfileFromServer,
  loadTagsFromServer,
  pushEntryToServer,
  serverHasData,
  updateChildOnServer,
  updateEntryOnServer,
} from '@/data/repository';
import { matchServerChild, uploadUnsynced } from '@/data/sync';
import { savePrefs } from '@/data/prefs';
import { saveTimers } from '@/data/timers';
import {
  clearEntities,
  loadEntities,
  saveChildren,
  saveEntries,
} from '@/data/entityStore';
import { enqueueEntries, enqueueEntry } from '@/data/queue';
import { addPendingOp, clearPendingOps } from '@/data/pendingOps';
import type { PendingOp } from '@/data/pendingOps';
import { clearAdoptTarget, loadAdoptTarget, saveAdoptTarget } from '@/data/adoptTarget';
import type { Child, Treatment, Entry, Measurement, MilestoneEntry, Profile, Tag, Timer } from '@/types/models';

// Shared mock state (hoisted so the vi.mock factories can close over it).
const h = vi.hoisted(() => ({
  q: [] as unknown[],
  timers: [] as unknown[],
  servers: [] as unknown[],
  pushed: [] as unknown[],
  /** The `childServerId` argument each `pushEntryToServer` call went out with.
   *  Separate from `pushed` (which several tests match wholesale) and the thing
   *  that actually decides which child the server row lands under. */
  pushedChildServerIds: [] as unknown[],
  updated: [] as unknown[],
  deleted: [] as unknown[],
  measPushed: [] as unknown[],
  measUpdated: [] as unknown[],
  measDeleted: [] as unknown[],
  treatmentPushed: [] as unknown[],
  treatmentUpdated: [] as unknown[],
  treatmentDeleted: [] as unknown[],
  treatmentPushFails: false,
  genderWritten: [] as unknown[],
  genderWriteFails: false,
  childPushed: [] as unknown[],
  childUpdated: [] as unknown[],
  childDeleted: [] as unknown[],
  childPushChange: [] as unknown[],
  childUpdateChange: [] as unknown[],
  timerPushed: [] as unknown[],
  timerUpdated: [] as unknown[],
  timerDeleted: [] as unknown[],
  /** How many `pushTimerToServer` calls should throw before one succeeds. Models
   *  a server that rejects or drops the create, which is the case that used to
   *  leave a timer unsynced with nothing scheduled to try again. */
  timerPushFails: 0,
  /** How many `pushEntryToServer` calls should throw before one succeeds. The
   *  entry twin of `timerPushFails`: models a server that refuses the write the
   *  moment it is made but accepts the identical payload a few seconds later
   *  (clock skew on the `end == now` timestamp, a locked SQLite file behind a
   *  concurrent timer DELETE), which is the case that left the entry sitting on
   *  the write queue until the user pulled to refresh. */
  entryPushFails: 0,
  pendingOps: [] as unknown[],
  adoptTarget: null as string | null,
  pushFails: false,
  childDeleteFails: false,
  /** serverId -> the slug the fake server currently holds for that child. Seed
   *  it to opt a test into slug-accurate PATCH behaviour (see
   *  `updateChildOnServer` below); empty means the old permissive mock. */
  childSlugOnServer: {} as Record<string, string>,
  profile: { username: 'alex', timezone: 'UTC', language: 'en', dashboardRefreshRate: undefined } as unknown,
  profileFails: false,
  tags: [{ name: 'Fussy', color: '#f80' }, { name: 'Sleepy' }] as unknown,
  tagsFails: false,
  prefs: {} as Record<string, unknown>,
  milestonePrompts: {} as Record<string, string[]>,
  treatments: [] as unknown[],
  bathRhythms: {} as Record<string, unknown>,
  /** Mirrors the stored entity-origin label (see `loadEntityOrigin`): which
   *  server (or 'local') the persisted entities belong to. Null models an
   *  install that predates the key. */
  entityOrigin: null as string | null,
}));

// Hoisted so the repository mock factory (also hoisted) can reference it.
const SERVER_PIC = vi.hoisted(() => 'https://srv.example/media/child/xyz.jpg');
const SERVER_SLUG = vi.hoisted(() => 'nova-o');

vi.mock('@/data/storage', () => ({
  saveConnection: vi.fn(async () => {}),
  loadConnection: vi.fn(async () => null),
  clearConnection: vi.fn(async () => {}),
}));

vi.mock('@/data/servers', () => ({
  loadServers: vi.fn(async () => h.servers),
  persistServers: vi.fn(async (list: unknown[]) => {
    h.servers = list;
  }),
  // simple URL-equality stand-ins (the store tests use identical URLs)
  upsertServer: (list: any[], server: any) => {
    const rest = list.filter((s) => s.serverUrl !== server.serverUrl);
    return [server, ...rest].slice(0, 6);
  },
  removeServer: (list: any[], url: string) => list.filter((s) => s.serverUrl !== url),
}));

vi.mock('@/data/queue', () => ({
  loadQueue: vi.fn(async () => h.q),
  saveQueue: vi.fn(async (x: unknown[]) => {
    h.q = x;
  }),
  enqueueEntry: vi.fn(async (e: unknown) => {
    h.q = [...h.q, e];
    return h.q;
  }),
  enqueueEntries: vi.fn(async (es: unknown[]) => {
    if (es.length > 0) h.q = [...h.q, ...es];
    return h.q;
  }),
  removeQueuedEntry: vi.fn(async (id: string) => {
    const removed = (h.q as { id: string }[]).find((e) => e.id === id) ?? null;
    h.q = (h.q as { id: string }[]).filter((e) => e.id !== id);
    return { removed, queue: h.q };
  }),
  updateQueuedEntry: vi.fn(async (e: { id: string }) => {
    const updated = (h.q as { id: string }[]).some((x) => x.id === e.id);
    if (updated) h.q = (h.q as { id: string }[]).map((x) => (x.id === e.id ? e : x));
    return { updated, queue: h.q };
  }),
  clearQueue: vi.fn(async () => {
    h.q = [];
  }),
}));

vi.mock('@/data/timers', () => ({
  loadTimers: vi.fn(async () => h.timers),
  saveTimers: vi.fn(async (t: unknown[]) => {
    h.timers = t;
  }),
  clearTimers: vi.fn(async () => {
    h.timers = [];
  }),
}));

// The durable entity store (children/entries/measurements/selectedChild/lastFeed).
// Defaults to "nothing persisted yet" (null); individual tests override via
// mockResolvedValueOnce to simulate a restart with saved data.
vi.mock('@/data/entityStore', () => ({
  loadEntities: vi.fn(async () => null),
  loadEntityOrigin: vi.fn(async () => h.entityOrigin),
  saveChildren: vi.fn(async () => {}),
  saveEntityOrigin: vi.fn(async (origin: string) => {
    h.entityOrigin = origin;
  }),
  saveEntries: vi.fn(async () => {}),
  saveMeasurements: vi.fn(async () => {}),
  saveSelectedChildId: vi.fn(async () => {}),
  saveLastFeed: vi.fn(async () => {}),
  // Faithful to the real module: the origin's lifecycle is paired with the
  // data it labels, so clearing the entities clears the label too.
  clearEntities: vi.fn(async () => {
    h.entityOrigin = null;
  }),
}));

// REQUIRED: `prefs.ts` imports AsyncStorage; without mocking it here the node
// test env pulls in the native AsyncStorage module and the suite breaks —
// mirrors why `@/data/timers` above is fully mocked too.
vi.mock('@/data/prefs', () => ({
  loadPrefs: vi.fn(async () => h.prefs),
  savePrefs: vi.fn(async () => {}),
}));

vi.mock('@/data/milestonePrompts', () => ({
  loadMilestonePrompts: vi.fn(async () => h.milestonePrompts),
  saveMilestonePrompts: vi.fn(async (m: Record<string, string[]>) => {
    h.milestonePrompts = m;
  }),
}));

// Treatments are AsyncStorage-backed (the local-mode store, and the offline cache
// in front of the server when connected), so this is mocked for the same reason the
// timers module is: keep the native module out of the node test env. `h.treatments`
// mirrors the stored list so the persistence subscribe can be observed.
vi.mock('@/data/treatments', () => ({
  loadTreatments: vi.fn(async () => h.treatments),
  saveTreatments: vi.fn(async (c: unknown[]) => {
    h.treatments = c;
  }),
  clearTreatments: vi.fn(async () => {
    h.treatments = [];
  }),
}));

// Per-child bath rhythm, AsyncStorage-backed like the modules above, so it is
// mocked for the same reason: keep the native module out of the node test env.
vi.mock('@/data/bathRhythm', () => ({
  loadBathRhythms: vi.fn(async () => h.bathRhythms),
  saveBathRhythms: vi.fn(async (m: Record<string, unknown>) => {
    h.bathRhythms = m;
  }),
}));

vi.mock('@/data/repository', () => ({
  loadFromServer: vi.fn(async () => ({
    children: [],
    entries: [],
    timers: [],
    selectedChildId: '',
    lastFeed: {},
    measurements: [],
    treatments: [],
  })),
  pushEntryToServer: vi.fn(async (_conn: unknown, e: unknown, childServerId: unknown) => {
    if (h.pushFails) throw new Error('net');
    if (h.entryPushFails > 0) {
      h.entryPushFails -= 1;
      throw new Error('net');
    }
    h.pushed.push(e);
    h.pushedChildServerIds.push(childServerId);
    return 999;
  }),
  updateEntryOnServer: vi.fn(async (_c: unknown, e: unknown) => {
    h.updated.push(e);
  }),
  deleteEntryFromServer: vi.fn(async (_c: unknown, type: unknown, id: unknown) => {
    h.deleted.push({ type, id });
  }),
  pushMeasurementToServer: vi.fn(async (_c: unknown, m: unknown) => {
    h.measPushed.push(m);
    return 888;
  }),
  updateMeasurementOnServer: vi.fn(async (_c: unknown, m: unknown) => {
    h.measUpdated.push(m);
  }),
  deleteMeasurementFromServer: vi.fn(async (_c: unknown, kind: unknown, id: unknown) => {
    h.measDeleted.push({ kind, id });
  }),
  setChildGenderOnServer: vi.fn(async (_c: unknown, childServerId: unknown, gender: unknown) => {
    if (h.genderWriteFails) throw new Error('net');
    h.genderWritten.push({ childServerId, gender });
  }),
  pushTreatmentToServer: vi.fn(async (_c: unknown, treatment: unknown) => {
    if (h.treatmentPushFails) throw new Error('net');
    h.treatmentPushed.push(treatment);
    return 555;
  }),
  updateTreatmentOnServer: vi.fn(async (_c: unknown, treatment: unknown) => {
    h.treatmentUpdated.push(treatment);
  }),
  deleteTreatmentFromServer: vi.fn(async (_c: unknown, serverId: unknown) => {
    h.treatmentDeleted.push(serverId);
  }),
  pushChildToServer: vi.fn(async (_c: unknown, child: unknown, change: any) => {
    h.childPushed.push(child);
    h.childPushChange.push(change);
    return { id: 777, slug: SERVER_SLUG, picture: change?.kind === 'set' ? SERVER_PIC : null };
  }),
  updateChildOnServer: vi.fn(async (_c: unknown, child: any, change: any) => {
    h.childUpdated.push(child);
    h.childUpdateChange.push(change);
    const nextSlug = String(child?.first ?? '').toLowerCase() + '-slug';
    // Opt-in faithful slug behaviour, keyed by serverId. Inert unless a test
    // seeds `childSlugOnServer`, so it changes nothing for the rest of the file.
    // Baby Buddy addresses children BY slug, so a PATCH carrying a stale one
    // 404s rather than falling back to matching on id, and a rename MOVES the
    // slug, which is what makes the next stale request fail.
    const key = String(child?.serverId);
    const currentSlug = h.childSlugOnServer[key];
    if (currentSlug !== undefined) {
      if (child?.slug && child.slug !== currentSlug) throw new Error('404');
      h.childSlugOnServer[key] = nextSlug;
    }
    // The real PATCH response carries the CURRENT slug.
    return { picture: change?.kind === 'set' ? SERVER_PIC : null, slug: nextSlug };
  }),
  // Takes the whole child now, not a numeric id: the server DELETE is keyed by
  // slug (see BabybuddyClient.childKey), which only the child carries.
  deleteChildFromServer: vi.fn(async (_c: unknown, child: unknown) => {
    if (h.childDeleteFails) throw new Error('net');
    h.childDeleted.push(child);
  }),
  pushTimerToServer: vi.fn(async (_c: unknown, timer: unknown, childServerId: unknown) => {
    if (h.timerPushFails > 0) {
      h.timerPushFails -= 1;
      throw new Error('net');
    }
    h.timerPushed.push({ timer, childServerId });
    return 555;
  }),
  updateTimerOnServer: vi.fn(async (_c: unknown, timer: unknown) => {
    h.timerUpdated.push(timer);
  }),
  deleteTimerFromServer: vi.fn(async (_c: unknown, serverId: unknown) => {
    h.timerDeleted.push(serverId);
  }),
  loadInsightsHistory: vi.fn(async () => []),
  loadProfileFromServer: vi.fn(async () => {
    if (h.profileFails) throw new Error('500');
    return h.profile;
  }),
  loadTagsFromServer: vi.fn(async () => {
    if (h.tagsFails) throw new Error('500');
    return h.tags;
  }),
  serverHasData: vi.fn(async () => false),
}));

// `@/data/sync`'s real uploader/matcher (Unit J's primitives, from an earlier
// unit on this branch). Default `uploadUnsynced` is a pure passthrough (no
// stamping) so it's a no-op for every OTHER test in this file that
// incidentally triggers `flushUnsynced` via connect/hydrate/refresh/etc (the
// default seeded child has no serverId, so `flushUnsynced`'s `hasUnsynced`
// check is true almost everywhere) — only the `adopt`/`flushUnsynced`
// describe blocks below override this to actually stamp serverIds.
vi.mock('@/data/sync', () => ({
  uploadUnsynced: vi.fn(async (state: { children: unknown[]; entries: unknown[]; measurements: unknown[] }) => ({
    children: state.children,
    entries: state.entries,
    measurements: state.measurements,
  })),
  matchServerChild: vi.fn(() => null),
}));

// The offline op-log (Unit D). Tests assert against `h.pendingOps` directly
// (mirroring how `h.pushed`/`h.updated`/etc. track the repository mocks above)
// rather than asserting on the mock functions themselves.
vi.mock('@/data/pendingOps', () => ({
  addPendingOp: vi.fn(async (op: unknown) => {
    h.pendingOps.push(op);
    return h.pendingOps;
  }),
  // Returns a COPY, like the real module (every load is a fresh JSON.parse of
  // the file). Handing out `h.pendingOps` itself would alias the flush run's
  // snapshot to the live log, so an op appended mid-run would leak INTO the
  // running batch, which the real storage-backed module can never do.
  loadPendingOps: vi.fn(async () => [...h.pendingOps]),
  savePendingOps: vi.fn(async (ops: unknown[]) => {
    h.pendingOps = ops;
  }),
  // Same first-stringify-match semantics as the real removePendingOp: drop ONE
  // occurrence by value, keep the rest (including anything appended since the
  // caller last loaded).
  removePendingOp: vi.fn(async (op: unknown) => {
    const key = JSON.stringify(op);
    const idx = h.pendingOps.findIndex((o) => JSON.stringify(o) === key);
    if (idx !== -1) h.pendingOps = h.pendingOps.filter((_, i) => i !== idx);
    return h.pendingOps;
  }),
  clearPendingOps: vi.fn(async () => {
    h.pendingOps = [];
  }),
}));

// The persisted adopt target (Finding 2): backs the server-switch reset in
// `adopt` so it survives an app kill between an abandoned `partial` adoption
// and a later retry/switch — mirrors the AsyncStorage-backed mocks above.
vi.mock('@/data/adoptTarget', () => ({
  loadAdoptTarget: vi.fn(async () => h.adoptTarget),
  saveAdoptTarget: vi.fn(async (url: string) => {
    h.adoptTarget = url;
  }),
  clearAdoptTarget: vi.fn(async () => {
    h.adoptTarget = null;
  }),
}));

const NOW = 1_700_000_000_000;
const M = 60000;
const flush = () => new Promise((r) => setTimeout(r, 0));

// The shared `beforeEach` below seeds child 'c1' with NO serverId on purpose:
// most of this file exercises the offline-first / not-yet-synced paths (the
// `@/data/sync` mock comment above explains why), and some tests (e.g.
// `deleteChild`'s "local-only child" case) assert specifically on that
// unsynced default. A real server-mode child is always either loaded from the
// server or pushed to it, so it always carries a serverId; tests whose
// subject is ordinary synced-child push/update behaviour opt into this
// constant rather than mutating the shared default.
const SYNCED_C1: Child = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' };

beforeEach(() => {
  h.q = [];
  h.timers = [];
  h.servers = [];
  h.pushed = [];
  h.pushedChildServerIds = [];
  h.updated = [];
  h.deleted = [];
  h.measPushed = [];
  h.measUpdated = [];
  h.treatmentPushed = [];
  h.treatmentUpdated = [];
  h.treatmentDeleted = [];
  h.treatmentPushFails = false;
  h.genderWritten = [];
  h.genderWriteFails = false;
  h.measDeleted = [];
  h.childPushed = [];
  h.childUpdated = [];
  h.childDeleted = [];
  h.childPushChange = [];
  h.childUpdateChange = [];
  h.timerPushed = [];
  h.timerUpdated = [];
  h.timerDeleted = [];
  h.timerPushFails = 0;
  h.entryPushFails = 0;
  // Module state in the store, not store state: a retry armed by one test would
  // otherwise fire in the middle of a later one.
  resetTimerRetryForTests();
  resetQueueRetryForTests();
  h.pendingOps = [];
  h.adoptTarget = null;
  h.pushFails = false;
  h.childDeleteFails = false;
  h.childSlugOnServer = {};
  h.profile = { username: 'alex', timezone: 'UTC', language: 'en', dashboardRefreshRate: undefined };
  h.profileFails = false;
  h.tags = [{ name: 'Fussy', color: '#f80' }, { name: 'Sleepy' }];
  h.tagsFails = false;
  h.prefs = {};
  h.milestonePrompts = {};
  h.treatments = [];
  h.bathRhythms = {};
  h.entityOrigin = null;
  vi.mocked(enqueueEntry).mockClear();
  vi.mocked(enqueueEntries).mockClear();
  vi.mocked(loadProfileFromServer).mockClear();
  vi.mocked(loadTagsFromServer).mockClear();
  vi.mocked(savePrefs).mockClear();
  vi.mocked(loadEntities).mockClear();
  vi.mocked(loadEntities).mockResolvedValue(null);
  vi.mocked(saveChildren).mockClear();
  vi.mocked(clearEntities).mockClear();
  vi.mocked(clearPendingOps).mockClear();
  vi.mocked(loadAdoptTarget).mockClear();
  vi.mocked(saveAdoptTarget).mockClear();
  vi.mocked(clearAdoptTarget).mockClear();
  useAppStore.setState({
    connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
    connected: true,
    offline: false,
    networkOnline: true,
    simulateOffline: false,
    now: NOW,
    selectedChildId: 'c1',
    children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
    entries: [],
    timers: [],
    measurements: [],
    treatments: [],
    lastFeed: {},
    legacyLastFeed: LAST_FEED_DEFAULT,
    sheet: null,
    sheetChildIds: [],
    editingId: null,
    fromTimerId: null,
    measurementSheet: null,
    editingMeasurementId: null,
    milestoneSheet: null,
    treatmentPicker: null,
    treatmentEditor: null,
    answeredMilestonePrompts: {},
    showChildSwitcher: false,
    childSheet: false,
    editingChildId: null,
    adoptSheet: false,
    te: { shape: 'interval', tags: [] },
    queueCount: 0,
    queuedIds: [],
    profile: null,
    profileLoading: false,
    profileError: false,
    profileLoaded: false,
    tags: [],
    tagsLoaded: false,
    tagsLoading: false,
    toast: null,
    savedServers: [],
    bathRhythms: {},
    legacyRhythm: BATH_RHYTHM_DEFAULT,
    napWindowStartMin: 420,
    napWindowEndMin: 1140,
  });
});

const s = () => useAppStore.getState();

/** Branch-level invariant: whenever a state-producing path (hydrate/refresh/
 *  adopt) leaves `children` non-empty, `selectedChildId` must name one of
 *  them. Regression coverage for a server-space id (`loadFromServer`'s
 *  `selectedChildId`, see repository.ts) being used as a local-space
 *  fallback instead of being resolved through `resolveSelectedChildId`. */
function expectSelectionNamesARealChild(): void {
  const { children, selectedChildId } = useAppStore.getState();
  if (children.length > 0) {
    expect(children.some((c) => c.id === selectedChildId)).toBe(true);
  }
}

describe('openSheet defaults', () => {
  it('feeding: interval, alternates breast side, 18m default', () => {
    s().openSheet('feeding');
    const te = s().te;
    expect(te.shape).toBe('interval');
    expect(te.durationMin).toBe(18);
    expect(te.endAgoMin).toBe(0);
    expect(te.ongoing).toBe(false);
    expect(te.feedType).toBe('breast');
    expect(te.method).toBe('right'); // opposite of lastFeed.method = 'left'
  });
  it('diaper: point shape, wet default', () => {
    s().openSheet('diaper');
    const te = s().te;
    expect(te.shape).toBe('point');
    expect(te.agoMin).toBe(0);
    expect(te.wet).toBe(true);
    expect(te.solid).toBe(false);
    expect(te.color).toBe('yellow');
  });
  it('pumping: amount 90, both, 15m', () => {
    s().openSheet('pumping');
    expect(s().te.amount).toBe(90);
    expect(s().te.method).toBe('both');
    expect(s().te.durationMin).toBe(15);
  });
});

// The feeding draft's three seeds are about ONE child: what their last feed was
// like, and which breast comes next. Both used to be read unscoped, so with
// twins the sheet opened on the other one's history and disagreed with the Home
// tile that sent you there (the tile computes its hint from child-scoped entries).
describe('the feeding prefill is scoped to the sheet\'s child', () => {
  const mira: Child = { id: 'c1', first: 'Mira', last: 'O', birth: NOW - 200 * 86400000, color: '#fff' };
  const ivo: Child = { id: 'c2', first: 'Ivo', last: 'O', birth: NOW - 200 * 86400000, color: '#eee' };
  const feedOnTheLeft = (id: string, childId: string): Entry => ({
    id, childId, type: 'feeding', start: NOW - 60 * M, end: NOW - 40 * M, feedType: 'breast', method: 'left', amount: null, tags: [],
  });

  beforeEach(() => {
    useAppStore.setState({ children: [mira, ivo], selectedChildId: 'c1' });
  });

  it('suggests the start side from THIS child\'s feeds, not a sibling\'s', () => {
    // Only Ivo has fed, on the left, so HIS next side is the right. Mira has
    // never fed: hers is the opening default, and his feed must not move it.
    useAppStore.setState({ entries: [feedOnTheLeft('f2', 'c2')] });
    s().openSheet('feeding');
    expect(s().te.startSide).toBe('left');
  });

  it('takes the type and method from THIS child\'s last feed, not a sibling\'s', () => {
    useAppStore.setState({ lastFeed: { c2: { feedType: 'solid', method: 'self' } } });
    s().openSheet('feeding');
    expect(s().te.feedType).toBe('breast');
    expect(s().te.method).toBe('right'); // the default 'left', alternated
  });

  it('inherits the pre-map value for a child with nothing of their own', () => {
    // Derive-on-read migration: until a child gets a real save, the single
    // account-wide value a pre-map build left behind is still their prefill.
    useAppStore.setState({ lastFeed: {}, legacyLastFeed: { feedType: 'formula', method: 'bottle' } });
    s().openSheet('feeding');
    expect(s().te.feedType).toBe('formula');
    expect(s().te.method).toBe('bottle');
  });

  it('openTimerEdit seeds from the TIMER\'s child, not the selection', () => {
    // Mira is selected and has fed on the left, so HER next side is the right.
    // The running feeding timer is Ivo's and he has never fed.
    useAppStore.setState({
      entries: [feedOnTheLeft('f1', 'c1')],
      lastFeed: { c1: { feedType: 'solid', method: 'self' } },
      timers: [{ id: 't9', childId: 'c2', activity: 'feeding', name: 'Feed', start: NOW - 5 * M, saveAs: 'feeding' }],
    });
    s().openTimerEdit('t9');
    expect(s().te.startSide).toBe('left');
    expect(s().te.feedType).toBe('breast');
  });

  it('openTimerEdit borrows nobody\'s history for a timer with no owner', () => {
    // Ownerless timers are no longer adopted by the selection, so there is no
    // scoped history to read and the suggestion falls back to the default.
    useAppStore.setState({
      entries: [feedOnTheLeft('f1', 'c1')],
      timers: [{ id: 't9', activity: 'feeding', name: 'Feed', start: NOW - 5 * M, saveAs: 'feeding' }],
    });
    s().openTimerEdit('t9');
    expect(s().te.startSide).toBe('left');
  });
});

describe('adjustAmount (stepper presses land in the display unit system)', () => {
  // The units preference is not part of the shared beforeEach reset, so put it
  // back or an imperial case would leak into every test after it.
  afterEach(() => useAppStore.setState({ unitSystem: 'metric' }));

  it('metric: a press moves the stored amount by 10 ml', () => {
    useAppStore.setState({ unitSystem: 'metric' });
    s().openSheet('pumping');
    expect(s().te.amount).toBe(90); // the 90 ml seed already sits on the 10 ml grid
    s().adjustAmount(1);
    expect(s().te.amount).toBe(100);
    s().adjustAmount(-1);
    expect(s().te.amount).toBe(90);
  });

  it('imperial: a press moves by half a fl oz, and stores canonical ml', () => {
    useAppStore.setState({ unitSystem: 'imperial' });
    s().openSheet('pumping');
    // The 90 ml seed is 3.0433 fl oz, which is off the half-ounce grid and would
    // render as "3.0", the same string the first minus press produces. Opening
    // the sheet snaps the draft to exactly 3.0 fl oz so no press looks dead.
    expect(s().te.amount).toBe(88.7205);
    expect(toDisplay('volume', s().te.amount ?? 0, 'imperial')).toBeCloseTo(3, 9);

    s().adjustAmount(1);
    expect(toDisplay('volume', s().te.amount ?? 0, 'imperial')).toBeCloseTo(3.5, 9);
    s().adjustAmount(1);
    expect(toDisplay('volume', s().te.amount ?? 0, 'imperial')).toBeCloseTo(4, 9);
    // What is persisted and synced is millilitres, never the fl oz number.
    expect(s().te.amount).toBeCloseTo(118.294, 3);
  });

  it('clamps at zero rather than going negative', () => {
    useAppStore.setState({ unitSystem: 'imperial' });
    s().openSheet('pumping');
    for (let i = 0; i < 10; i++) s().adjustAmount(-1);
    expect(s().te.amount).toBe(0);
  });
});

describe('draft amounts snap to the step grid, so no stepper press looks dead', () => {
  afterEach(() => useAppStore.setState({ unitSystem: 'metric' }));

  // What the Stepper actually paints for a canonical-ml draft amount.
  const render = (ml: number | undefined, system: 'metric' | 'imperial') => {
    const shown = toDisplay('volume', ml ?? 0, system);
    return system === 'imperial' ? shown.toFixed(1) : String(Math.round(shown * 10) / 10);
  };

  const pumpingEntry = (amount: number): Entry => ({
    id: 'p1',
    childId: 'c1',
    type: 'pumping',
    start: NOW - 20 * M,
    end: NOW - 5 * M,
    amount,
    method: 'both',
    tags: [],
  });

  // Values verified to render identically before and after a minus press when
  // the draft is left off-grid: each sits just above a half-ounce mark.
  const DEAD_ON_MINUS = [15, 30, 45, 60, 75, 90];
  // ...and these sit just below one, so a plus press was the swallowed one.
  const DEAD_ON_PLUS = [250, 265, 280, 295];

  it.each(DEAD_ON_MINUS)('imperial: minus visibly moves a %i ml draft', (ml) => {
    useAppStore.setState({ unitSystem: 'imperial', entries: [pumpingEntry(ml)] });
    s().openEdit('p1');
    const before = render(s().te.amount, 'imperial');
    s().adjustAmount(-1);
    expect(render(s().te.amount, 'imperial')).not.toBe(before);
  });

  it.each(DEAD_ON_PLUS)('imperial: plus visibly moves a %i ml draft', (ml) => {
    useAppStore.setState({ unitSystem: 'imperial', entries: [pumpingEntry(ml)] });
    s().openEdit('p1');
    const before = render(s().te.amount, 'imperial');
    s().adjustAmount(1);
    expect(render(s().te.amount, 'imperial')).not.toBe(before);
  });

  it('metric: the same amounts step visibly too', () => {
    for (const ml of [...DEAD_ON_MINUS, ...DEAD_ON_PLUS]) {
      useAppStore.setState({ unitSystem: 'metric', entries: [pumpingEntry(ml)] });
      s().openEdit('p1');
      const before = render(s().te.amount, 'metric');
      s().adjustAmount(1);
      expect(render(s().te.amount, 'metric')).not.toBe(before);
    }
  });

  it('openSheet snaps the pumping seed onto the active grid', () => {
    useAppStore.setState({ unitSystem: 'imperial' });
    s().openSheet('pumping');
    expect(s().te.amount).toBe(88.7205); // exactly 3.0 fl oz

    useAppStore.setState({ unitSystem: 'metric' });
    s().openSheet('pumping');
    expect(s().te.amount).toBe(90); // already on the 10 ml grid
  });

  it('openEdit snaps the draft of an existing entry without rewriting the stored entry', () => {
    useAppStore.setState({ unitSystem: 'imperial', entries: [pumpingEntry(90)] });
    s().openEdit('p1');
    expect(s().te.amount).toBe(88.7205);
    // The persisted entry keeps its canonical millilitres until a save.
    const stored = s().entries[0];
    expect(stored.type === 'pumping' && stored.amount).toBe(90);
  });

  it('openTimerEdit snaps the draft amount of a running timer', () => {
    useAppStore.setState({
      unitSystem: 'imperial',
      timers: [
        {
          id: 't1',
          childId: 'c1',
          activity: 'pumping',
          name: 'Pumping',
          saveAs: 'pumping',
          start: NOW - 10 * M,
          amount: 90,
          method: 'both',
        },
      ],
    });
    s().openTimerEdit('t1');
    expect(s().te.amount).toBe(88.7205);
  });

  it('toggling the unit system re-snaps the draft of an open sheet', () => {
    useAppStore.setState({ unitSystem: 'metric' });
    s().openSheet('pumping');
    expect(s().te.amount).toBe(90);

    s().toggleUnitSystem();
    expect(s().unitSystem).toBe('imperial');
    expect(s().te.amount).toBe(88.7205); // now on the half-ounce grid

    s().toggleUnitSystem();
    expect(s().unitSystem).toBe('metric');
    expect(s().te.amount).toBe(90); // 3.0 fl oz is 88.72 ml, nearest 10 ml is 90
  });

  it('setUnitSystem leaves the draft alone when no sheet is open', () => {
    useAppStore.setState({ unitSystem: 'metric', sheet: null, te: { shape: 'interval', tags: [], amount: 90 } });
    s().setUnitSystem('imperial');
    expect(s().te.amount).toBe(90);
  });

  it('never snaps the intake level of a breast feed, which is dimensionless', () => {
    useAppStore.setState({
      unitSystem: 'imperial',
      entries: [
        {
          id: 'f1',
          childId: 'c1',
          type: 'feeding',
          start: NOW - 30 * M,
          end: NOW - 10 * M,
          feedType: 'breast',
          method: 'left',
          amount: 3, // an intake level ("A lot"), NOT millilitres
          tags: [],
        },
      ],
    });
    s().openEdit('f1');
    expect(s().te.amount).toBe(3);

    // A unit toggle must not touch it either.
    s().toggleUnitSystem();
    expect(s().te.amount).toBe(3);
  });

  it('never snaps a level picked in an open sheet, on either unit system', () => {
    // The grid snap rounds to whole ml (metric) or 0.1 fl oz (imperial), so a
    // level that leaked into the volume branch would come back as 10 ml.
    for (const system of ['metric', 'imperial'] as const) {
      useAppStore.setState({ unitSystem: system });
      s().openSheet('feeding');
      s().setTE({ feedType: 'breast', method: 'left' });
      for (const level of [1, 2, 3]) {
        s().setTE({ amount: level });
        s().toggleUnitSystem();
        expect(s().te.amount).toBe(level);
        s().toggleUnitSystem();
        expect(s().te.amount).toBe(level);
      }
    }
  });

  it('a level cannot survive a switch to a volume feed and be snapped as one', () => {
    // The reported hole: pick an intake at the breast, switch the open sheet to
    // a bottle, toggle units, and the level snapped as if it were millilitres.
    useAppStore.setState({ unitSystem: 'metric' });
    s().openSheet('feeding');
    s().setTE({ feedType: 'breast', method: 'left', amount: 3 });
    s().setTE({ feedType: 'formula' }); // crosses into the volume branch
    expect(s().te.amount).toBeUndefined();

    s().toggleUnitSystem();
    expect(s().te.amount).toBeUndefined();
  });

  it('does snap a bottle feed, whose amount IS a volume', () => {
    useAppStore.setState({
      unitSystem: 'imperial',
      entries: [
        {
          id: 'f2',
          childId: 'c1',
          type: 'feeding',
          start: NOW - 30 * M,
          end: NOW - 10 * M,
          feedType: 'formula',
          method: 'bottle',
          amount: 90,
          tags: [],
        },
      ],
    });
    s().openEdit('f2');
    expect(s().te.amount).toBe(88.7205);
  });

  it('leaves the solid amount of a diaper alone (no stepper, no unit)', () => {
    useAppStore.setState({
      unitSystem: 'imperial',
      entries: [
        { id: 'd1', childId: 'c1', type: 'diaper', time: NOW - M, wet: false, solid: true, color: 'yellow', amount: 3, tags: [] },
      ],
    });
    s().openEdit('d1');
    expect(s().te.amount).toBe(3);
  });
});

describe('bath tracking', () => {
  it('setWash selects the wash size', () => {
    s().openSheet('bath');
    s().setWash('full');
    expect(s().te.wash).toBe('full');
    s().setWash('quick');
    expect(s().te.wash).toBe('quick');
  });
  it('save builds a point bath entry and pushes it (to the notes endpoint)', async () => {
    useAppStore.setState({ children: [SYNCED_C1] }); // ordinary server-mode push needs a synced child
    s().openSheet('bath');
    s().setWash('full');
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'bath' }>;
    expect(e.type).toBe('bath');
    expect(e.time).toBe(NOW);
    expect(e.wash).toBe('full');
    expect(e.childId).toBe('c1');
    expect(s().sheet).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1);
    expect((h.pushed[0] as Extract<Entry, { type: 'bath' }>).type).toBe('bath');
  });
});

describe('temperature tracking', () => {
  it('openSheet: point shape, seeds a default reading', () => {
    s().openSheet('temperature');
    const te = s().te;
    expect(te.shape).toBe('point');
    expect(te.agoMin).toBe(0);
    expect(te.temperature).toBe(37.0);
  });

  it('save builds a point temperature entry (value + trimmed notes) and pushes it', async () => {
    useAppStore.setState({ children: [SYNCED_C1] }); // ordinary server-mode push needs a synced child
    s().openSheet('temperature');
    s().setTE({ temperature: 38.2, notes: '  slight fever  ' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'temperature' }>;
    expect(e.type).toBe('temperature');
    expect(e.time).toBe(NOW);
    expect(e.value).toBe(38.2);
    expect(e.notes).toBe('slight fever');
    expect(e.childId).toBe('c1');
    expect(s().sheet).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1);
    expect((h.pushed[0] as Extract<Entry, { type: 'temperature' }>).type).toBe('temperature');
  });

  it('save falls back to the default reading when none was entered', () => {
    s().openSheet('temperature');
    s().setTE({ temperature: undefined });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'temperature' }>;
    expect(e.value).toBe(37.0);
  });

  it('openEdit prefills value + notes and treats it as a point event', () => {
    useAppStore.setState({
      entries: [
        { id: 'temperature-1', serverId: 5, childId: 'c1', type: 'temperature', time: NOW - 20 * M, value: 37.8, notes: 'after nap', tags: [] },
      ],
    });
    s().openEdit('temperature-1');
    expect(s().te.shape).toBe('point');
    expect(s().te.temperature).toBe(37.8);
    expect(s().te.notes).toBe('after nap');
    expect(s().te.agoMin).toBe(20);
  });
});

describe('medication tracking', () => {
  it('openSheet: point shape, blank name', () => {
    s().openSheet('medication');
    const te = s().te;
    expect(te.shape).toBe('point');
    expect(te.agoMin).toBe(0);
    expect(te.medName).toBe('');
  });

  it('save builds a point medication entry (name + amount + unit + trimmed notes) and pushes it', async () => {
    useAppStore.setState({ children: [SYNCED_C1] }); // ordinary server-mode push needs a synced child
    s().openSheet('medication');
    s().setTE({ medName: '  Paracetamol  ', medDosage: 2.5, medUnit: 'mL', notes: '  for the fever  ' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'medication' }>;
    expect(e.type).toBe('medication');
    expect(e.time).toBe(NOW);
    expect(e.name).toBe('Paracetamol');
    expect(e.dosage).toBe(2.5);
    expect(e.dosageUnit).toBe('mL');
    expect(e.notes).toBe('for the fever');
    expect(e.childId).toBe('c1');
    expect(s().sheet).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1);
    expect((h.pushed[0] as Extract<Entry, { type: 'medication' }>).type).toBe('medication');
  });

  it('save is a no-op when the name is blank, even with an amount entered', () => {
    s().openSheet('medication');
    s().setTE({ medName: '   ', medDosage: 5, medUnit: 'mL' });
    s().save();
    expect(s().entries).toHaveLength(0);
    expect(s().sheet).not.toBeNull(); // sheet stays open like a blank note
  });

  it('openEdit prefills name/amount/unit/notes and treats it as a point event', () => {
    useAppStore.setState({
      entries: [
        { id: 'medication-1', serverId: 5, childId: 'c1', type: 'medication', time: NOW - 20 * M, name: 'Ibuprofen', dosage: 5, dosageUnit: 'mL', notes: 'evening', tags: [] },
      ],
    });
    s().openEdit('medication-1');
    expect(s().te.shape).toBe('point');
    expect(s().te.medName).toBe('Ibuprofen');
    expect(s().te.medDosage).toBe(5);
    expect(s().te.medUnit).toBe('mL');
    expect(s().te.notes).toBe('evening');
    expect(s().te.agoMin).toBe(20);
  });
});

describe('treatments (medication regimens)', () => {
  const DAY = 86400000;
  const treatment = (over: Partial<Treatment> = {}): Treatment => ({
    id: 'treatment-1',
    childId: 'c1',
    name: 'Paracetamol',
    scheduleMode: 'everyHours',
    everyHours: 6,
    dosage: 2.5,
    dosageUnit: 'mL',
    fromDate: NOW - 5 * DAY,
    toDate: undefined,
    active: true,
    ...over,
  });

  it('addTreatment prepends, updateTreatment replaces by id, deleteTreatment removes', () => {
    s().addTreatment(treatment());
    s().addTreatment(treatment({ id: 'treatment-2', name: 'Vitamin D' }));
    expect(s().treatments.map((c) => c.id)).toEqual(['treatment-2', 'treatment-1']);

    s().updateTreatment(treatment({ id: 'treatment-1', name: 'Ibuprofen' }));
    expect(s().treatments.find((c) => c.id === 'treatment-1')?.name).toBe('Ibuprofen');

    s().deleteTreatment('treatment-2');
    expect(s().treatments.map((c) => c.id)).toEqual(['treatment-1']);
  });

  it('mutating treatments persists them via the subscribe', async () => {
    s().addTreatment(treatment());
    await flush();
    expect((h.treatments as { id: string }[]).map((c) => c.id)).toEqual(['treatment-1']);
  });

  it('makes no server call in local mode', async () => {
    useAppStore.setState({ connection: { mode: 'local' }, children: [SYNCED_C1] });
    s().addTreatment(treatment());
    s().updateTreatment(treatment({ name: 'Ibuprofen' }));
    s().deleteTreatment('treatment-1');
    await flush();
    expect(h.treatmentPushed).toHaveLength(0);
    expect(h.treatmentUpdated).toHaveLength(0);
    expect(h.treatmentDeleted).toHaveLength(0);
  });

  describe('server mirror', () => {
    beforeEach(() => {
      useAppStore.setState({
        connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
        children: [SYNCED_C1],
        offline: false,
      });
    });

    it('addTreatment pushes the treatment and stamps the returned serverId', async () => {
      s().addTreatment(treatment());
      await flush();
      expect((h.treatmentPushed[0] as Treatment).id).toBe('treatment-1');
      expect(s().treatments[0].serverId).toBe(555);
    });

    it('addTreatment leaves the treatment unstamped when the push fails, for flushUnsynced to retry', async () => {
      h.treatmentPushFails = true;
      s().addTreatment(treatment());
      await flush();
      expect(s().treatments[0].serverId).toBeUndefined();
      // The local write still stands: offline-first never rolls back on a
      // failed mirror.
      expect(s().treatments).toHaveLength(1);
    });

    it('addTreatment does not push when the child has no server id yet', async () => {
      useAppStore.setState({ children: [{ ...SYNCED_C1, serverId: undefined }] });
      s().addTreatment(treatment());
      await flush();
      expect(h.treatmentPushed).toHaveLength(0);
      expect(s().treatments[0].serverId).toBeUndefined();
    });

    it('updateTreatment PATCHes an already-synced treatment', async () => {
      useAppStore.setState({ treatments: [treatment({ serverId: 88 })] });
      s().updateTreatment(treatment({ serverId: 88, name: 'Ibuprofen' }));
      await flush();
      expect((h.treatmentUpdated[0] as Treatment).name).toBe('Ibuprofen');
    });

    it('updateTreatment makes no call for a treatment that never reached the server', async () => {
      useAppStore.setState({ treatments: [treatment()] });
      s().updateTreatment(treatment({ name: 'Ibuprofen' }));
      await flush();
      expect(h.treatmentUpdated).toHaveLength(0);
    });

    it('deleteTreatment DELETEs the backing note', async () => {
      useAppStore.setState({ treatments: [treatment({ serverId: 88 })] });
      s().deleteTreatment('treatment-1');
      await flush();
      expect(h.treatmentDeleted).toEqual([88]);
    });

    it('deleteTreatment makes no call for a treatment that never reached the server', async () => {
      useAppStore.setState({ treatments: [treatment()] });
      s().deleteTreatment('treatment-1');
      await flush();
      expect(h.treatmentDeleted).toHaveLength(0);
    });

    it('queues an offline edit / delete of a synced treatment as a pending op', async () => {
      useAppStore.setState({ treatments: [treatment({ serverId: 88 })], offline: true });
      s().updateTreatment(treatment({ serverId: 88, name: 'Ibuprofen' }));
      await flush();
      expect(h.pendingOps).toContainEqual({ op: 'update', entity: 'treatment', payload: expect.objectContaining({ name: 'Ibuprofen' }) });
      expect(h.treatmentUpdated).toHaveLength(0);

      s().deleteTreatment('treatment-1');
      await flush();
      expect(h.pendingOps).toContainEqual({ op: 'delete', entity: 'treatment', serverId: 88 });
      expect(h.treatmentDeleted).toHaveLength(0);
    });

    it('records NO pending op for a treatment created offline (its create is still pending)', async () => {
      useAppStore.setState({ offline: true });
      s().addTreatment(treatment());
      await flush();
      expect(h.pendingOps).toHaveLength(0);
      expect(h.treatmentPushed).toHaveLength(0);
    });
  });

  it('deleteTreatment closes the editor when it is open on that treatment', () => {
    useAppStore.setState({ treatments: [treatment()], treatmentEditor: { editingId: 'treatment-1', openedAt: 0 } });
    s().deleteTreatment('treatment-1');
    expect(s().treatmentEditor).toBeNull();
  });

  it('openMedicationLog opens the manual form directly when there are no active treatments today', () => {
    useAppStore.setState({ treatments: [] });
    s().openMedicationLog();
    expect(s().treatmentPicker).toBeNull();
    expect(s().sheet).toEqual({ type: 'medication' });
  });

  it('openMedicationLog opens the picker when the child has an active treatment covering today', () => {
    useAppStore.setState({ treatments: [treatment()] });
    s().openMedicationLog();
    expect(s().treatmentPicker).toEqual({ open: true });
    expect(s().sheet).toBeNull();
  });

  it('openMedicationLog ignores a paused treatment and a sibling\'s treatment (per-child, active-only)', () => {
    useAppStore.setState({
      treatments: [treatment({ id: 'paused', active: false }), treatment({ id: 'sibling', childId: 'c2' })],
    });
    s().openMedicationLog();
    expect(s().treatmentPicker).toBeNull();
    expect(s().sheet).toEqual({ type: 'medication' });
  });

  it('openMedicationLog ignores a treatment whose range ended before today', () => {
    useAppStore.setState({ treatments: [treatment({ toDate: NOW - 2 * DAY })] });
    s().openMedicationLog();
    expect(s().treatmentPicker).toBeNull();
    expect(s().sheet).toEqual({ type: 'medication' });
  });

  it('logMedicationFromTreatment from an interval treatment seeds the draft and opens the confirm sheet (nothing committed yet)', () => {
    useAppStore.setState({ treatments: [treatment()], treatmentPicker: { open: true } });
    s().logMedicationFromTreatment('treatment-1');
    // Opens the medication sheet in confirm mode and closes the picker.
    expect(s().sheet).toEqual({ type: 'medication', confirm: true });
    expect(s().treatmentPicker).toBeNull();
    // A point (time-only) draft, seeded from the treatment. Nothing is written until save().
    expect(s().te.shape).toBe('point');
    expect(s().te.medName).toBe('Paracetamol');
    expect(s().te.medDosage).toBe(2.5);
    expect(s().te.medUnit).toBe('mL');
    expect(s().te.medNextDoseIntervalSec).toBe(6 * 3600); // everyHours * 3600
    expect(s().entries).toEqual([]);
  });

  it('logMedicationFromTreatment from a times-of-day treatment seeds no next-dose interval', () => {
    useAppStore.setState({
      treatments: [treatment({ scheduleMode: 'timesOfDay', timesOfDay: ['morning', 'evening'], everyHours: undefined })],
    });
    s().logMedicationFromTreatment('treatment-1');
    expect(s().te.medName).toBe('Paracetamol');
    expect(s().te.medNextDoseIntervalSec).toBeUndefined();
  });

  it('saving from the confirm sheet writes a dose carrying nextDoseIntervalSec', () => {
    useAppStore.setState({ treatments: [treatment({ everyHours: 8 })] });
    s().logMedicationFromTreatment('treatment-1');
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'medication' }>;
    expect(e.type).toBe('medication');
    expect(e.childId).toBe('c1');
    expect(e.time).toBe(NOW); // point draft, agoMin 0
    expect(e.name).toBe('Paracetamol');
    expect(e.dosage).toBe(2.5);
    expect(e.dosageUnit).toBe('mL');
    expect(e.nextDoseIntervalSec).toBe(8 * 3600);
  });

  it('expandMedicationLog drops the confirm flag but keeps the seeded draft', () => {
    useAppStore.setState({ treatments: [treatment()], treatmentPicker: { open: true } });
    s().logMedicationFromTreatment('treatment-1');
    const seeded = s().te;
    s().expandMedicationLog();
    expect(s().sheet).toEqual({ type: 'medication' });
    expect(s().te).toBe(seeded); // same draft reference, untouched
  });

  it('survive disconnect (user data, unlike the synced entity store)', () => {
    useAppStore.setState({ treatments: [treatment()] });
    s().disconnect();
    expect(s().treatments.map((c) => c.id)).toEqual(['treatment-1']);
  });
});

describe('general notes', () => {
  it('openSheet: point shape, empty note body', () => {
    s().openSheet('note');
    const te = s().te;
    expect(te.shape).toBe('point');
    expect(te.agoMin).toBe(0);
    expect(te.noteText).toBe('');
  });

  it('save builds a point note entry (trimmed body) and pushes it', async () => {
    useAppStore.setState({ children: [SYNCED_C1] }); // ordinary server-mode push needs a synced child
    s().openSheet('note');
    s().setTE({ noteText: '  remember the follow-up  ' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'note' }>;
    expect(e.type).toBe('note');
    expect(e.time).toBe(NOW);
    expect(e.text).toBe('remember the follow-up');
    expect(e.childId).toBe('c1');
    expect(s().sheet).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1);
    expect((h.pushed[0] as Extract<Entry, { type: 'note' }>).type).toBe('note');
  });

  it('refuses to save a blank note (whitespace only): no entry, sheet stays open', async () => {
    s().openSheet('note');
    s().setTE({ noteText: '   ' });
    s().save();
    expect(s().entries).toHaveLength(0);
    expect(s().sheet).not.toBeNull(); // still open — nothing created
    await flush();
    expect(h.pushed).toHaveLength(0);
  });

  it('openEdit prefills the note body + tags and treats it as a point event', () => {
    useAppStore.setState({
      entries: [
        { id: 'note-1', serverId: 5, childId: 'c1', type: 'note', time: NOW - 20 * M, text: 'first giggle', tags: ['Milestone'] },
      ],
    });
    s().openEdit('note-1');
    expect(s().te.shape).toBe('point');
    expect(s().te.noteText).toBe('first giggle');
    expect(s().te.tags).toEqual(['Milestone']);
    expect(s().te.agoMin).toBe(20);
    // a note has no secondary per-entry `notes` annotation
    expect(s().te.notes).toBeUndefined();
  });

  it('a note lives in the shared entries array, so delete/undo work like any entry', () => {
    useAppStore.setState({
      entries: [{ id: 'note-2', serverId: 7, childId: 'c1', type: 'note', time: NOW, text: 'x', tags: [] }],
    });
    s().deleteEntry('note-2');
    expect(s().entries).toHaveLength(0);
    s().undoDelete();
    expect(s().entries[0].id).toBe('note-2');
  });

  it('notes are excluded from the activity timeline while activities are kept', () => {
    // The History/rail views group `entries.filter(e => e.type !== 'note')`.
    useAppStore.setState({
      entries: [
        { id: 'note-3', childId: 'c1', type: 'note', time: NOW, text: 'note body', tags: [] },
        { id: 'diaper-1', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] },
      ],
    });
    const activityEntries = s().entries.filter((e) => e.type !== 'note');
    expect(activityEntries.map((e) => e.type)).toEqual(['diaper']);
    const noteEntries = s().entries.filter((e) => e.type === 'note');
    expect(noteEntries.map((e) => e.id)).toEqual(['note-3']);
  });
});

describe('save', () => {
  it('feeding builds a correct entry and pushes online', async () => {
    useAppStore.setState({ children: [SYNCED_C1] }); // ordinary server-mode push needs a synced child
    s().openSheet('feeding');
    s().setLasted(20);
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.type).toBe('feeding');
    expect(e.end).toBe(NOW);
    expect(e.start).toBe(NOW - 20 * M);
    expect(e.feedType).toBe('breast');
    expect(e.method).toBe('right');
    expect(e.amount).toBeNull(); // breast + not bottle => null
    expect(s().lastFeed).toEqual({ c1: { feedType: 'breast', method: 'right' } });
    expect(s().sheet).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1);
  });

  it('diaper builds a point entry', () => {
    s().openSheet('diaper');
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'diaper' }>;
    expect(e.type).toBe('diaper');
    expect(e.time).toBe(NOW);
    expect(e.wet).toBe(true);
    expect(e.solid).toBe(false);
    expect(e.color).toBeNull();
  });

  it('live interval creates a timer, not an entry', () => {
    s().openSheet('sleep');
    s().setOngoing();
    s().save();
    expect(s().timers).toHaveLength(1);
    expect(s().entries).toHaveLength(0);
    expect(s().timers[0].saveAs).toBe('sleep');
  });

  it('a live interval carries the draft\'s details onto the timer', () => {
    // Everything typed into the sheet before "Still feeding" must survive; the
    // timer used to be created bare, silently dropping a just-typed note.
    s().openSheet('feeding');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'right', amount: 3, notes: '  dozy  ' });
    s().toggleTag('Fussy');
    s().setOngoing();
    s().save();
    const tm = s().timers[0];
    expect(tm.feedType).toBe('breast');
    expect(tm.method).toBe('both');
    expect(tm.startSide).toBe('right');
    expect(tm.amount).toBe(3);
    expect(tm.notes).toBe('dozy'); // trimmed, like an entry's notes
    expect(tm.tags).toEqual(['Fussy']);
    expect(tm.childId).toBe('c1');
  });

  it('a live sleep interval carries the nap flag', () => {
    s().openSheet('sleep');
    s().setTE({ nap: false });
    s().setOngoing();
    s().save();
    expect(s().timers[0].nap).toBe(false);
  });

  it('offline save enqueues instead of pushing', async () => {
    useAppStore.setState({ offline: true });
    s().openSheet('feeding');
    s().save();
    await flush();
    expect(h.q).toHaveLength(1);
    expect(s().queueCount).toBe(1);
    // The ids mirror too, so History can mark the row as waiting to upload.
    expect(s().queuedIds).toEqual([(h.q[0] as Entry).id]);
    expect(h.pushed).toHaveLength(0);
  });

  it('an entry whose child has no serverId is queued, not pushed', async () => {
    useAppStore.setState({
      children: [{ id: 'localA', first: 'Ada', last: '', birth: NOW - 30 * 86400000, color: '#E8A87C' }],
      entries: [],
      selectedChildId: 'localA',
      offline: false,
    });

    // Log an entry through the same action the other `save` tests above use.
    s().openSheet('note');
    s().setTE({ noteText: 'hi' });
    s().save();
    await flush();

    // The child was never pushed (no serverId), so there is nothing sensible
    // to push the entry to yet: it goes to the reconnect queue instead, the
    // same way an offline save does.
    expect(h.pushed).toHaveLength(0);
    expect(h.q).toHaveLength(1);
    expect(s().queueCount).toBe(1);
  });
});

describe('flushQueue', () => {
  it('pushes queued entries and clears on success', async () => {
    useAppStore.setState({ children: [SYNCED_C1] }); // ordinary server-mode push needs a synced child
    h.q = [{ id: 'x', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }];
    useAppStore.setState({ queueCount: 1, queuedIds: ['x'] });
    await s().flushQueue();
    expect(h.pushed).toHaveLength(1);
    expect(h.q).toHaveLength(0);
    expect(s().queueCount).toBe(0);
    // The History marker has to clear here and nowhere else. It reads
    // `queuedIds` and must keep doing so: `serverId` is not a marker test, since
    // an entry can hold one for reasons that have nothing to do with the queue.
    expect(s().queuedIds).toEqual([]);
  });

  // The reported bug: an entry that reached the server through the QUEUE (a
  // retried save, a reconnect flush) kept `serverId == null` locally, because
  // this was the one push path that discarded what the server returned. It was
  // off the queue by then too, so deleting it took `detachEntry`'s "never
  // synced" branch: local-only removal, no server DELETE, no pending op. The
  // server kept its copy and the row came back on the next refresh.
  it('stamps the serverId it gets back, so a later delete reaches the server', async () => {
    const entry: Entry = { id: 'x', childId: 'c1', type: 'sleep', start: NOW - 30 * M, end: NOW, nap: true, tags: [] };
    useAppStore.setState({ children: [SYNCED_C1], entries: [entry], queueCount: 1, queuedIds: ['x'] });
    h.q = [entry];

    await s().flushQueue();
    expect(h.pushed).toHaveLength(1);
    expect(s().entries[0].serverId).toBe(999);

    s().deleteEntry('x');
    await flush();
    expect(h.deleted).toContainEqual({ type: 'sleep', id: 999 });
  });

  it('stamps onto the CURRENT entry list, not the pre-push snapshot', async () => {
    // A save landing mid-flush must not be dropped by the stamp, the same rule
    // `flushUnsynced`'s merge follows.
    const queued: Entry = { id: 'x', childId: 'c1', type: 'sleep', start: NOW - 30 * M, end: NOW, nap: true, tags: [] };
    const later: Entry = { id: 'y', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] };
    useAppStore.setState({ children: [SYNCED_C1], entries: [queued], queueCount: 1, queuedIds: ['x'] });
    h.q = [queued];

    const run = s().flushQueue();
    useAppStore.setState({ entries: [later, queued] });
    await run;

    expect(s().entries.map((e) => e.id)).toEqual(['y', 'x']);
    expect(s().entries.find((e) => e.id === 'x')?.serverId).toBe(999);
  });

  it('keeps entries that fail to push', async () => {
    h.pushFails = true;
    h.q = [{ id: 'x', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }];
    await s().flushQueue();
    expect(h.q).toHaveLength(1);
    expect(s().queueCount).toBe(1);
    expect(s().queuedIds).toEqual(['x']);
  });

  it('pushes an entry once when two flushes overlap', async () => {
    // `refresh()` fires a flush of its own on every successful re-check and does
    // NOT await it, so a caller that awaits `flushQueue()` straight after
    // awaiting `refresh()` (the queue screen's Retry button does exactly that,
    // because it has to count the queue once the upload is finished) starts a
    // second flush on top of one already in flight. Both read the same stored
    // queue, neither has saved yet, and every entry gets POSTed twice: a
    // duplicate feed on the server that the parent has to go and delete.
    useAppStore.setState({ children: [SYNCED_C1] });
    h.q = [{ id: 'x', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }];
    useAppStore.setState({ queueCount: 1, queuedIds: ['x'] });

    await Promise.all([s().flushQueue(), s().flushQueue()]);

    expect(h.pushed).toHaveLength(1);
    expect(h.q).toHaveLength(0);
    expect(s().queueCount).toBe(0);
  });

  it('makes a second caller wait for the flush already running, not return early', async () => {
    // The awaited call has to resolve AFTER the upload, otherwise the queue
    // screen counts the queue mid-flush and reports a successful sync as
    // "Nothing uploaded. 1 entry still waiting."
    useAppStore.setState({ children: [SYNCED_C1] });
    h.q = [{ id: 'x', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }];
    useAppStore.setState({ queueCount: 1, queuedIds: ['x'] });

    void s().flushQueue();
    await s().flushQueue();

    expect(h.q).toHaveLength(0);
    expect(h.pushed).toHaveLength(1);
  });

  it('drops each entry from the stored queue as soon as its own push succeeds', async () => {
    // The queue file is what "not on the server yet" means: refresh() merges
    // it back into `entries` so a still-queued row stays visible. Saving only
    // once at the end of the run breaks that meaning for the length of the
    // run, because an entry already accepted by the server sits in the file
    // until the last push finishes. A refresh landing in that window shows
    // the server's copy AND the queued copy: the same feed twice in History.
    useAppStore.setState({ children: [SYNCED_C1] });
    const first = { id: 'x1', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] };
    const second = { id: 'x2', childId: 'c1', type: 'diaper', time: NOW, wet: false, solid: true, color: null, tags: [] };
    h.q = [first, second];
    useAppStore.setState({ queueCount: 2, queuedIds: ['x1', 'x2'] });

    // Snapshot the stored queue as the SECOND push starts: by then the first
    // entry is on the server and must already be out of the file.
    let queueDuringSecondPush: unknown[] = [];
    vi.mocked(pushEntryToServer)
      .mockImplementationOnce(async (_c: unknown, e: unknown) => {
        h.pushed.push(e);
        return 999;
      })
      .mockImplementationOnce(async (_c: unknown, e: unknown) => {
        queueDuringSecondPush = [...h.q];
        h.pushed.push(e);
        return 999;
      });

    await s().flushQueue();

    expect((queueDuringSecondPush as { id: string }[]).map((e) => e.id)).toEqual(['x2']);
    expect(h.q).toHaveLength(0);
    expect(s().queuedIds).toEqual([]);
  });
});

describe('flushPendingOps', () => {
  const child: Child = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW, color: '#fff' };
  const measurement: Measurement = { id: 'weight-1', serverId: 1, childId: 'c1', kind: 'weight', value: 6, date: NOW };
  const entry: Entry = {
    id: 'feeding-1',
    serverId: 1,
    childId: 'c1',
    type: 'feeding',
    start: NOW - 30 * M,
    end: NOW - 10 * M,
    feedType: 'breast',
    method: 'left',
    amount: null,
    tags: [],
  };

  // Ordinary server-mode replay behaviour: the measurement/entry payloads
  // reference childId 'c1', so replaying their update ops needs 'c1' synced
  // (the shared `beforeEach` default is deliberately unsynced elsewhere in
  // this file). `child` above already carries the serverId this block needs.
  beforeEach(() => {
    useAppStore.setState({ children: [child] });
  });

  it('replays an update/child op to updateChildOnServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'update', entity: 'child', payload: child }];
    await s().flushPendingOps();
    expect(h.childUpdated).toEqual([child]);
    expect(h.pendingOps).toHaveLength(0);
  });

  // Op payloads are SNAPSHOTS taken at enqueue time and addPendingOp appends
  // without dedup, so two offline renames of the same child queue two ops that
  // BOTH carry the original slug. Replaying op1 moves the slug server-side,
  // which makes op2's snapshot stale before it is ever sent. Trusting the
  // payload there loses the second rename permanently: it 404s, goes back on
  // the queue, and 404s again on every later flush, so the op log never drains.
  it('replays a second queued rename against the LIVE slug, not its stale snapshot', async () => {
    h.childSlugOnServer = { '501': 'mira-o' };
    const staleSnapshot = { ...child, slug: 'mira-o' };
    h.pendingOps = [
      { op: 'update', entity: 'child', payload: { ...staleSnapshot, first: 'Mirabel' } },
      { op: 'update', entity: 'child', payload: { ...staleSnapshot, first: 'Mirage' } },
    ];
    useAppStore.setState({ children: [{ ...child, slug: 'mira-o' }] });

    await s().flushPendingOps();

    // Both renames landed, so the queue drains and the last one is the winner.
    expect(h.pendingOps).toHaveLength(0);
    expect(h.childUpdated).toHaveLength(2);
    expect((h.childUpdated[1] as Child).slug).toBe('mirabel-slug');
    expect(s().children[0].slug).toBe('mirage-slug');
  });

  it('re-stamps the slug a replayed rename moved, so a later delete is not keyed by a stale one', async () => {
    // An offline rename replays here on reconnect. Baby Buddy derives the slug
    // from the name, so the replay MOVES it server-side; keeping the old one
    // locally would 404 the next delete, which is how a deleted child came back.
    // Same re-stamp saveChild's online edit does.
    h.pendingOps = [{ op: 'update', entity: 'child', payload: { ...child, first: 'Mirabel' } }];
    await s().flushPendingOps();
    expect(s().children[0].slug).toBe('mirabel-slug');
  });

  it('replays an update/measurement op to updateMeasurementOnServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'update', entity: 'measurement', payload: measurement }];
    await s().flushPendingOps();
    expect(h.measUpdated).toEqual([measurement]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('replays an update/entry op to updateEntryOnServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'update', entity: 'entry', payload: entry }];
    await s().flushPendingOps();
    expect(h.updated).toEqual([entry]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('replays a delete/measurement op to deleteMeasurementFromServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'delete', entity: 'measurement', kind: 'weight', serverId: 1 }];
    await s().flushPendingOps();
    expect(h.measDeleted).toEqual([{ kind: 'weight', id: 1 }]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('replays a delete/entry op to deleteEntryFromServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 }];
    await s().flushPendingOps();
    expect(h.deleted).toEqual([{ type: 'feeding', id: 1 }]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('retains an op that fails to replay, leaving successful ones cleared', async () => {
    vi.mocked(updateChildOnServer).mockRejectedValueOnce(new Error('net'));
    h.pendingOps = [
      { op: 'update', entity: 'child', payload: child },
      { op: 'update', entity: 'measurement', payload: measurement },
    ];
    await s().flushPendingOps();
    expect(h.measUpdated).toEqual([measurement]); // the other op still replayed
    expect(h.pendingOps).toEqual([{ op: 'update', entity: 'child', payload: child }]); // failed op retained
  });

  it('replays each op exactly once when two flushes overlap', async () => {
    // Foregrounding fires the AppState refresh() (whose success schedules a
    // flush) and the network-state effect (setNetworkOnline, a second one)
    // within milliseconds, so two concurrent runs are the ordinary case, not
    // a corner. Unguarded, both read the same stored log before either
    // removes anything and every op is replayed twice; the loser of a
    // replayed delete 404s and used to push the op back for a third try.
    h.pendingOps = [{ op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 }];
    await Promise.all([s().flushPendingOps(), s().flushPendingOps()]);
    expect(h.deleted).toEqual([{ type: 'feeding', id: 1 }]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('makes a second caller wait for the flush already running, not return early', async () => {
    // Same joiner contract as flushQueue: the awaited call resolves once the
    // running flush has drained, so a caller can trust the log afterwards.
    h.pendingOps = [{ op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 }];
    void s().flushPendingOps();
    await s().flushPendingOps();
    expect(h.deleted).toEqual([{ type: 'feeding', id: 1 }]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('keeps an op recorded while a flush is mid-run', async () => {
    // The old end-of-run savePendingOps(remaining) was last-write-wins: an op
    // appended by addPendingOp after the run loaded the log was overwritten
    // by the run's stale survivors list, silently losing an offline edit or
    // delete. Per-op removal leaves anything it wasn't asked to remove alone.
    const appended: PendingOp = { op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 9 };
    h.pendingOps = [{ op: 'update', entity: 'entry', payload: entry }];
    vi.mocked(updateEntryOnServer).mockImplementationOnce(async (_c: unknown, e: unknown) => {
      // An offline delete lands while the replay is on the wire.
      await addPendingOp(appended);
      h.updated.push(e);
    });
    await s().flushPendingOps();
    expect(h.updated).toEqual([entry]);
    expect(h.pendingOps).toEqual([appended]);
  });

  it('drops an op whose target is already gone (404) instead of retrying it forever', async () => {
    // A 404 means the record was deleted elsewhere (or the replayed delete
    // already won a race). The old code could not tell that from a transient
    // failure, so the op went back on the log and 404ed again on every later
    // flush, immortal. Terminal for updates and deletes alike.
    vi.mocked(deleteEntryFromServer).mockRejectedValueOnce(new ApiError(404, 'Not found.'));
    h.pendingOps = [{ op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 }];
    await s().flushPendingOps();
    expect(h.deleted).toHaveLength(0);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('keeps an op whose failure is network-level (ApiError 0) for the next flush', async () => {
    vi.mocked(deleteEntryFromServer).mockRejectedValueOnce(new ApiError(0, "Couldn't reach server."));
    const op: PendingOp = { op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 };
    h.pendingOps = [op];
    await s().flushPendingOps();
    expect(h.pendingOps).toEqual([op]);
  });

  it('stops the run on 401, keeping every remaining op and making no further calls', async () => {
    // A dead token fails every op identically; hammering the server with the
    // rest of the log helps nobody. The ops stay on file for after reconnect,
    // and refresh()'s session-expiry handling owns telling the user.
    vi.mocked(updateChildOnServer).mockRejectedValueOnce(new ApiError(401, 'Invalid token for this server.'));
    h.pendingOps = [
      { op: 'update', entity: 'child', payload: child },
      { op: 'update', entity: 'measurement', payload: measurement },
      { op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 },
    ];
    await s().flushPendingOps();
    expect(h.measUpdated).toHaveLength(0);
    expect(h.deleted).toHaveLength(0);
    expect(h.pendingOps).toHaveLength(3);
  });

  it('is a no-op while offline', async () => {
    useAppStore.setState({ offline: true });
    h.pendingOps = [{ op: 'delete', entity: 'measurement', kind: 'weight', serverId: 1 }];
    await s().flushPendingOps();
    expect(h.measDeleted).toHaveLength(0);
    expect(h.pendingOps).toHaveLength(1);
  });

  it('is a no-op in demo mode', async () => {
    useAppStore.setState({ connection: { mode: 'local' } });
    h.pendingOps = [{ op: 'delete', entity: 'measurement', kind: 'weight', serverId: 1 }];
    await s().flushPendingOps();
    expect(h.measDeleted).toHaveLength(0);
    expect(h.pendingOps).toHaveLength(1);
  });
});

describe('stopTimer', () => {
  it('converts a timer into an entry', async () => {
    useAppStore.setState({
      children: [SYNCED_C1], // ordinary server-mode push needs a synced child
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep' }],
    });
    s().stopTimer('t1');
    expect(s().timers).toHaveLength(0);
    expect(s().entries[0].type).toBe('sleep');
    await flush();
    expect(h.pushed).toHaveLength(1);
  });

  // The reported bug: stopping a timer while genuinely online ("Saved as sleep",
  // not "queued offline") left the entry on the write queue, with the History
  // row marked "waiting to upload", until the user pulled to refresh.
  // `commitWrite` made the rejected push DURABLE (`enqueueEntry`) but nothing
  // DRAINED the queue — `flushQueue` only runs from hydrate, refresh, and the
  // offline/network transitions. Same gap `scheduleUnsyncedTimerFlush` already
  // closes for timer creates.
  it('retries a rejected entry push with no manual refresh', async () => {
    vi.useFakeTimers();
    try {
      h.entryPushFails = 1;
      useAppStore.setState({
        connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
        offline: false,
        children: [SYNCED_C1],
        selectedChildId: 'c1',
        timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep', childId: 'c1' }],
        entries: [],
      });

      s().stopTimer('t1');
      await vi.advanceTimersByTimeAsync(0);
      // The push threw, so the entry is queued and the row reads as waiting.
      expect(h.pushed).toHaveLength(0);
      expect(h.q).toHaveLength(1);
      expect(s().queuedIds).toHaveLength(1);

      // No refresh, no foreground, no network event: the retry alone lands it.
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.pushed).toHaveLength(1);
      expect(h.q).toHaveLength(0);
      expect(s().queuedIds).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying once the attempt budget is spent, leaving the entry queued', async () => {
    vi.useFakeTimers();
    try {
      h.pushFails = true; // server stays broken for the whole chain
      useAppStore.setState({
        connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
        offline: false,
        children: [SYNCED_C1],
        selectedChildId: 'c1',
        timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep', childId: 'c1' }],
        entries: [],
      });

      s().stopTimer('t1');
      await vi.advanceTimersByTimeAsync(120000);
      // Still durable and still marked, but the chain is not spinning forever:
      // refresh/foreground/reconnect take it from here.
      expect(h.q).toHaveLength(1);
      expect(s().queuedIds).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('timer childId attribution', () => {
  it('stamps childId on a quick-started timer and commits the stop to that child', () => {
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [
        { id: 'c1', first: 'A', last: '', birth: 0, color: '#fff' },
        { id: 'c2', first: 'B', last: '', birth: 0, color: '#fff' },
      ],
      selectedChildId: 'c1',
      timers: [],
      entries: [],
    });
    s().startQuickTimer();
    const timer = s().timers[0];
    expect(timer.childId).toBe('c1');

    // switch child, then stop: the entry must go to the timer's child
    useAppStore.setState({ selectedChildId: 'c2' });
    s().stopTimer(timer.id);
    expect(s().entries[0].childId).toBe('c1');
  });

  it('a timer with no childId (e.g. a pre-fix widget-started nap) is never attributed to an expecting child when stopped', () => {
    // Exactly the case `stampTimerOwners` declines to migrate, so this fallback
    // chain is what is left to resolve it: still stoppable, still never logged
    // against a child who has not been born.
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [
        { id: 'c1', first: 'A', last: '', birth: NOW - 90 * 86400000, color: '#fff' },
        { id: 'c2', first: 'B', last: '', birth: NOW + 30 * 86400000, color: '#fff', expected: true },
      ],
      selectedChildId: 'c2', // the expecting child is the one currently selected
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep' }], // no childId
      entries: [],
    });

    s().stopTimer('t1');

    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].childId).not.toBe('c2'); // never the unborn baby
    expect(s().entries[0].childId).toBe('c1'); // falls back to the born child on file
  });
});

describe('timer server sync', () => {
  const server = { mode: 'server', serverUrl: 'http://x', token: 't' } as const;
  const syncedChild = { id: 'c1', serverId: 2, first: 'A', last: '', birth: 0, color: '#fff' };
  const localChild = { id: 'c1', first: 'A', last: '', birth: 0, color: '#fff' };
  const syncedTimer = (over: Partial<Timer> = {}): Timer => ({
    id: 't1', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: NOW - 10 * M, serverId: 77, childId: 'c1', ...over,
  });

  it('POSTs a new timer and stamps its serverId when online', async () => {
    useAppStore.setState({ connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', timers: [] });
    s().startQuickTimer();
    const id = s().timers[0].id;
    await flush();
    expect(h.timerPushed).toHaveLength(1);
    expect(s().timers.find((t) => t.id === id)?.serverId).toBe(555);
  });

  // A create that doesn't land is the case that sent the user to pull-to-refresh:
  // `mirrorTimerCreate` swallowed the failure and nothing retried it, so the
  // timer sat unsynced until a refresh/foreground/reconnect happened to run
  // `flushUnsynced`. These two cover the failure being the server's, and the
  // failure being a child that wasn't on the server yet.
  it('retries a create the server rejected, with no manual refresh', async () => {
    vi.useFakeTimers();
    try {
      h.timerPushFails = 1;
      useAppStore.setState({ connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', timers: [] });
      s().startQuickTimer();
      const id = s().timers[0].id;
      await vi.advanceTimersByTimeAsync(0);
      // first POST threw, so nothing is stamped yet
      expect(s().timers.find((t) => t.id === id)?.serverId).toBeUndefined();

      await vi.advanceTimersByTimeAsync(5000);
      expect(h.timerPushed).toHaveLength(1);
      expect(s().timers.find((t) => t.id === id)?.serverId).toBe(555);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pushes a timer started against an unsynced child once that child lands', async () => {
    vi.useFakeTimers();
    try {
      useAppStore.setState({ connection: server, offline: false, children: [localChild], selectedChildId: 'c1', timers: [] });
      s().startQuickTimer();
      const id = s().timers[0].id;
      await vi.advanceTimersByTimeAsync(0);
      expect(h.timerPushed).toHaveLength(0); // no child serverId to POST against

      // the child reaches the server (as its own push would do)
      useAppStore.setState({ children: [syncedChild] });
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.timerPushed).toHaveLength(1);
      expect(s().timers.find((t) => t.id === id)?.serverId).toBe(555);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not POST a timer while the child is unsynced', async () => {
    useAppStore.setState({ connection: server, offline: false, children: [localChild], selectedChildId: 'c1', timers: [] });
    s().startQuickTimer();
    await flush();
    expect(h.timerPushed).toHaveLength(0);
    expect(s().timers[0].serverId).toBeUndefined();
  });

  it('deletes the orphan when a timer is stopped before its create resolves', async () => {
    useAppStore.setState({ connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', timers: [], entries: [] });
    s().startQuickTimer();
    const id = s().timers[0].id;
    s().stopTimer(id); // stop before the POST resolves — serverId not stamped yet
    await flush();
    expect(h.timerDeleted).toContain(555);
  });

  it('PATCHes a synced timer when edited online', async () => {
    useAppStore.setState({ connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', timers: [syncedTimer()] });
    s().adjustTimerStart('t1', -5);
    await flush();
    expect(h.timerUpdated).toHaveLength(1);
    expect((h.timerUpdated[0] as Timer).serverId).toBe(77);
  });

  it('queues a timer update op when edited offline', async () => {
    useAppStore.setState({ connection: server, offline: true, children: [syncedChild], selectedChildId: 'c1', timers: [syncedTimer()] });
    s().adjustTimerStart('t1', -5);
    await flush();
    expect(h.pendingOps).toContainEqual(expect.objectContaining({ op: 'update', entity: 'timer' }));
    expect(h.timerUpdated).toHaveLength(0);
  });

  it('DELETEs the server timer when a synced timer is stopped online', async () => {
    useAppStore.setState({ connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', timers: [syncedTimer()], entries: [] });
    s().stopTimer('t1');
    await flush();
    expect(h.timerDeleted).toContain(77);
  });

  it('queues a timer delete op when a synced timer is stopped offline', async () => {
    useAppStore.setState({ connection: server, offline: true, children: [syncedChild], selectedChildId: 'c1', timers: [syncedTimer()], entries: [] });
    s().stopTimer('t1');
    await flush();
    expect(h.pendingOps).toContainEqual(expect.objectContaining({ op: 'delete', entity: 'timer', serverId: 77 }));
    expect(h.timerDeleted).toHaveLength(0);
  });

  it('DELETEs the server timer on discard', async () => {
    useAppStore.setState({ connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', timers: [syncedTimer()] });
    s().discardTimer('t1');
    await flush();
    expect(h.timerDeleted).toContain(77);
  });

  it('reconciles server timers on refresh: adds new, drops locally-synced-but-gone, keeps unsynced', async () => {
    useAppStore.setState({
      connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1',
      timers: [syncedTimer({ id: 't5', serverId: 5 }), { id: 't-local', activity: 'feeding', saveAs: 'feeding', name: 'Feeding', start: NOW, childId: 'c1' }],
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [syncedChild], entries: [], measurements: [], selectedChildId: 'c1',
      lastFeed: {},
      timers: [{ id: 'tsrv6', serverId: 6, childId: 'c1', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: NOW }],
    });
    await s().refresh();
    expect(s().timers.some((t) => t.serverId === 5)).toBe(false);
    expect(s().timers.some((t) => t.serverId === 6)).toBe(true);
    expect(s().timers.some((t) => t.id === 't-local')).toBe(true);
  });

  // `loadFromServer` reports a failed /api/timers/ fetch as `timers: null`
  // ("unknown"), distinct from `[]` ("known none"). Reconciling null as [] is
  // what used to kill a running mirrored timer on the device that started it,
  // over one transient failure of that single endpoint.
  it('refresh keeps a running synced timer when the timers fetch failed (timers: null)', async () => {
    useAppStore.setState({
      connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1',
      timers: [syncedTimer({ id: 't5', serverId: 5 })],
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [syncedChild], entries: [], measurements: [], selectedChildId: 'c1',
      lastFeed: {},
      timers: null,
    });
    await s().refresh();
    // The refresh itself succeeded (a timers-only failure is not "offline")...
    expect(s().offline).toBe(false);
    // ...and the running timer survived: null skips reconciliation entirely.
    expect(s().timers.some((t) => t.serverId === 5)).toBe(true);
  });

  it('refresh still drops a synced timer on an EMPTY timers list (a real "none running" answer)', async () => {
    useAppStore.setState({
      connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1',
      timers: [syncedTimer({ id: 't5', serverId: 5 })],
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [syncedChild], entries: [], measurements: [], selectedChildId: 'c1',
      lastFeed: {},
      timers: [],
    });
    await s().refresh();
    expect(s().timers.some((t) => t.serverId === 5)).toBe(false); // stopped elsewhere
  });

  it('connect keeps in-memory timers when the timers fetch failed, instead of writing null into state', async () => {
    const localRunning: Timer = { id: 't-local', activity: 'feeding', saveAs: 'feeding', name: 'Feeding', start: NOW, childId: 'c1' };
    useAppStore.setState({ connection: null, connected: false, timers: [localRunning] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [syncedChild], entries: [], measurements: [], selectedChildId: 'c1',
      lastFeed: {},
      timers: null,
    });
    await s().connect('http://x', 't');
    expect(s().connected).toBe(true);
    // `connect` spreads `...data` into state, so a null must be caught before
    // it lands. Assert on id only: the post-connect flushUnsynced may already
    // have stamped a serverId on the kept timer.
    expect(s().timers).toHaveLength(1);
    expect(s().timers[0]).toMatchObject({ id: 't-local' });
  });

  it('refresh remaps a server-loaded timer\'s childId from the server id to the local child id', async () => {
    useAppStore.setState({ connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', timers: [] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [syncedChild], entries: [], measurements: [], selectedChildId: 'c1',
      lastFeed: {},
      // `loadFromServer` has no local state to translate with, so the timer's
      // child FK arrives as the SERVER id (mirrors repository.ts's
      // `childByServerId` construction), not the local id 'c1'.
      timers: [{ id: 'tsrv9', serverId: 9, childId: String(syncedChild.serverId), activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: NOW }],
    });

    await s().refresh();

    const timer = s().timers.find((t) => t.serverId === 9);
    expect(timer?.childId).toBe('c1'); // remapped from the server id to the local id
  });

  it('stopping a server-loaded timer writes an entry under the LOCAL child id, not the server id', async () => {
    useAppStore.setState({ connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', timers: [], entries: [] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [syncedChild], entries: [], measurements: [], selectedChildId: 'c1',
      lastFeed: {},
      timers: [{ id: 'tsrv10', serverId: 10, childId: String(syncedChild.serverId), activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: NOW - 10 * M }],
    });
    await s().refresh();
    const timer = s().timers.find((t) => t.serverId === 10);

    s().stopTimer(timer!.id);

    // If the childId had been left as the server id, this entry would
    // reference a child that does not exist locally: the exact orphaning
    // this branch's remapping exists to prevent, arriving via a timer.
    expect(s().entries[0].childId).toBe('c1');
  });

  it('replays queued timer ops on reconnect (flushPendingOps)', async () => {
    useAppStore.setState({ connection: server, offline: false });
    h.pendingOps = [
      { op: 'update', entity: 'timer', payload: syncedTimer({ serverId: 5 }) },
      { op: 'delete', entity: 'timer', serverId: 9 },
    ];
    await s().flushPendingOps();
    expect(h.timerUpdated).toHaveLength(1);
    expect(h.timerDeleted).toContain(9);
  });

  it('flushUnsynced leaves an ownerless timer unpushed rather than filing it under the selection', async () => {
    // The last read site that used to adopt. A timer hydrate could not
    // attribute (nothing selected at the time, or an expecting child selected)
    // must not be created server-side under whoever is selected now: the server
    // row would be the misattribution, and deleting it needs another round trip.
    useAppStore.setState({
      connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', measurements: [],
      timers: [{ id: 't-legacy', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: NOW }],
    });
    await s().flushUnsynced();
    expect(h.timerPushed).toHaveLength(0);
    expect(s().timers[0].serverId).toBeUndefined();
  });

  it('flushUnsynced POSTs an offline-created timer once its child is synced', async () => {
    useAppStore.setState({
      connection: server, offline: false, children: [syncedChild], selectedChildId: 'c1', measurements: [],
      timers: [{ id: 't-local', activity: 'feeding', saveAs: 'feeding', name: 'Feeding', start: NOW, childId: 'c1' }],
    });
    await s().flushUnsynced();
    expect(h.timerPushed).toHaveLength(1);
    expect(s().timers[0].serverId).toBe(555);
  });
});

describe('timer persistence across restarts', () => {
  const savedTimer = (id: string): Timer => ({ id, activity: 'sleep', name: 'Sleep', start: NOW - 5 * M, saveAs: 'sleep' });

  it('restores persisted timers on hydrate (real connection)', async () => {
    const saved = [savedTimer('t9')];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    await s().hydrate();
    expect(s().timers).toEqual(saved);
  });

  it('restores persisted timers when the server is unreachable at launch', async () => {
    const saved = [savedTimer('t8')];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await s().hydrate();
    await flush(); // the unreachable verdict now comes from the background refresh
    expect(s().offline).toBe(true);
    expect(s().timers).toEqual(saved);
  });

  it('hydrate keeps a persisted synced timer when only the timers fetch failed (timers: null)', async () => {
    const saved = [{ ...savedTimer('t7'), serverId: 7, childId: 'c1' }];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [], entries: [], measurements: [], selectedChildId: '',
      lastFeed: {},
      timers: null,
    });
    await s().hydrate();
    await flush(); // the null-guard now lives in the background refresh; let it run
    // The load as a whole succeeded (a timers-only failure is not "offline"),
    // and null skipped reconciliation: the running timer was not treated as
    // "stopped elsewhere" over one transient /api/timers/ failure.
    expect(s().offline).toBe(false);
    expect(s().timers).toEqual(saved);
  });

  it('prefers persisted timers over the demo seed', async () => {
    const saved = [savedTimer('tD')];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    await s().hydrate();
    expect(s().timers).toEqual(saved);
  });

  it('persists timers when a quick timer is started', async () => {
    h.timers = [];
    vi.mocked(saveTimers).mockClear();
    s().startQuickTimer();
    expect(saveTimers).toHaveBeenCalled();
    expect(h.timers).toHaveLength(1);
  });

  it('persists the now-empty list on disconnect', () => {
    useAppStore.setState({ timers: [savedTimer('t1')] });
    vi.mocked(saveTimers).mockClear();
    s().disconnect();
    expect(saveTimers).toHaveBeenLastCalledWith([]);
    expect(h.timers).toEqual([]);
  });
});

// The retired adoption rule used to let every read site treat a timer with no
// `childId` as the selected child's. Every timer source stamps one now, so the
// only ownerless timers left are ones persisted by an older build; hydrate gives
// them an owner once, on load, and the persistence subscription writes the
// stamped list back.
describe('hydrate migrates ownerless timers', () => {
  const ownerless = (id = 't1'): Timer => ({ id, activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep' });
  const born = (id: string): Child => ({ id, first: id, last: '', birth: NOW - 90 * 86400000, color: '#fff' });
  const entityStore = (children: Child[], selectedChildId: string) =>
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children,
      entries: [],
      measurements: [],
      selectedChildId,
      lastFeed: {},
      legacyLastFeed: null,
    });

  it('stamps the selected child onto a timer persisted before stamping existed', async () => {
    h.timers = [ownerless()];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    entityStore([born('c1'), born('c2')], 'c2');

    await s().hydrate();

    expect(s().timers).toEqual([{ ...ownerless(), childId: 'c2' }]);
    // Durable, so the next launch has nothing left to migrate.
    expect(h.timers).toEqual([{ ...ownerless(), childId: 'c2' }]);
  });

  it('stamps on a server-mode cold start too, from the entity store selection', async () => {
    h.timers = [ownerless()];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    entityStore([born('c1')], 'c1');

    await s().hydrate();

    expect(s().timers).toEqual([{ ...ownerless(), childId: 'c1' }]);
  });

  it('leaves an owned timer exactly as it was, including a non-selected child\'s', () => {
    // Idempotent, and never a re-point: a sibling's running nap belongs to the
    // sibling however long the app sat closed.
    const mine: Timer = { ...ownerless('t1'), childId: 'c1' };
    const sibling: Timer = { ...ownerless('t2'), childId: 'c2' };
    h.timers = [mine, sibling];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    entityStore([born('c1'), born('c2')], 'c1');

    return s().hydrate().then(() => {
      expect(s().timers).toEqual([mine, sibling]);
    });
  });

  it('refuses to hand a timer to an expecting child, and never drops it', async () => {
    // Same refusal `stopTimer` makes: an expecting child's `birth` is a due
    // date, so nothing can be logged against them. Leaving the timer unstamped
    // keeps the migration lossless; `stopTimer`'s own fallback chain still
    // resolves it if the user stops it before the selection moves.
    const expecting: Child = { id: 'due', first: 'Bean', last: '', birth: NOW + 30 * 86400000, color: '#fff', expected: true };
    h.timers = [ownerless()];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    entityStore([born('c1'), expecting], 'due');

    await s().hydrate();

    expect(s().timers).toEqual([ownerless()]);
  });

  it('leaves a timer unstamped when nothing is selected to stamp it with', async () => {
    h.timers = [ownerless()];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    entityStore([born('c1')], '');

    await s().hydrate();

    expect(s().timers).toEqual([ownerless()]);
  });

  it('has no roster to stamp against with no connection, and leaves timers alone', async () => {
    // The no-connection branch reads no entity store at all, so there is no
    // child list and no selection to attribute a timer to.
    h.timers = [ownerless()];
    vi.mocked(loadConnection).mockResolvedValueOnce(null);

    await s().hydrate();

    expect(s().timers).toEqual([ownerless()]);
  });
});

describe('mergeQueuedEntries', () => {
  const mk = (id: string, serverId?: number): Entry => ({
    id,
    serverId,
    childId: 'c1',
    type: 'diaper',
    time: NOW,
    wet: true,
    solid: false,
    color: null,
    tags: [],
  });

  it('prepends queued entries (newest first) onto the server entries', () => {
    const merged = mergeQueuedEntries([mk('s1', 1)], [mk('q1')]);
    expect(merged.map((e) => e.id)).toEqual(['q1', 's1']);
  });

  it('returns just the server entries when nothing is queued', () => {
    expect(mergeQueuedEntries([mk('s1', 1)], [])).toEqual([mk('s1', 1)]);
  });
});

describe('mergeUnsynced', () => {
  const mkChild = (id: string, serverId?: number): Child => ({
    id,
    serverId,
    first: 'A',
    last: '',
    birth: NOW,
    color: '#fff',
  });

  it('prepends a serverId==null local not present in the server list', () => {
    const merged = mergeUnsynced([mkChild('s1', 1)], [mkChild('local1')]);
    expect(merged.map((c) => c.id)).toEqual(['local1', 's1']);
  });

  it('excludes a local that has a serverId', () => {
    const merged = mergeUnsynced([mkChild('s1', 1)], [mkChild('local1', 2)]);
    expect(merged.map((c) => c.id)).toEqual(['s1']);
  });

  it('excludes a local whose id is already in the server list (belt-and-suspenders)', () => {
    const merged = mergeUnsynced([mkChild('dup', 1)], [mkChild('dup')]);
    expect(merged.map((c) => c.id)).toEqual(['dup']);
  });

  it('returns just the server list when nothing is unsynced', () => {
    expect(mergeUnsynced([mkChild('s1', 1)], [])).toEqual([mkChild('s1', 1)]);
  });
});

describe('mergeHeldBackEntries', () => {
  // `heldBack` defaults to false: mirrors an ordinary entry, which never
  // carries the flag. Tests that need a withheld entry pass `true` explicitly.
  // This is now a STORED fact (see `commitWrite`), never inferred from the
  // owning child's `expected` state or a timestamp comparison.
  const mkEntry = (id: string, childId: string, heldBack = false): Entry => ({
    id,
    childId,
    type: 'note',
    time: NOW,
    text: 'note',
    tags: [],
    heldBack,
  });
  const expecting: Child = { id: 'due1', first: 'Sky', last: '', birth: NOW + 30 * 86400000, color: '#eee', expected: true };
  const born: Child = { id: 'c1', first: 'Mira', last: '', birth: NOW, color: '#fff' };

  it('prepends a local entry flagged heldBack', () => {
    const merged = mergeHeldBackEntries([mkEntry('s1', 'c1')], [mkEntry('note1', 'due1', true)], [born, expecting]);
    expect(merged.map((e) => e.id)).toEqual(['note1', 's1']);
  });

  it('excludes a local entry NOT flagged heldBack, even against an expecting child (the ordinary queued-entry case stays mergeQueuedEntries\' job)', () => {
    const merged = mergeHeldBackEntries([mkEntry('s1', 'c1')], [mkEntry('note1', 'due1')], [born, expecting]);
    expect(merged.map((e) => e.id)).toEqual(['s1']);
  });

  it('excludes a local held-back entry already present (by id) in the base list, so it is never duplicated', () => {
    const merged = mergeHeldBackEntries([mkEntry('note1', 'due1', true)], [mkEntry('note1', 'due1', true)], [born, expecting]);
    expect(merged.map((e) => e.id)).toEqual(['note1']);
  });

  it('excludes a held-back entry whose owning child is no longer in the given children list (referential-integrity guard against a deleted child)', () => {
    const merged = mergeHeldBackEntries([mkEntry('s1', 'c1')], [mkEntry('note1', 'due1', true)], [born]);
    expect(merged.map((e) => e.id)).toEqual(['s1']);
  });

  it('returns the base list unchanged when nothing is held back', () => {
    expect(mergeHeldBackEntries([mkEntry('s1', 'c1')], [mkEntry('note1', 'c1')], [born])).toEqual([mkEntry('s1', 'c1')]);
  });
});

describe('queued entries survive killing the app', () => {
  const queuedEntry = (id: string): Entry => ({
    id,
    childId: 'c1',
    type: 'diaper',
    time: NOW,
    wet: true,
    solid: false,
    color: null,
    tags: [],
  });
  // A child returned by `loadFromServer` was, by definition, loaded from the
  // server, so it always carries a serverId (a serverId-less child here would
  // be a fixture bug, not a real state the app can be in).
  const mira = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' };

  it('restores a queued entry into `entries` on hydrate when the server is reachable', async () => {
    h.q = [queuedEntry('e1')];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [mira],
      entries: [
        { id: 'srv-1', serverId: 5, childId: 'c1', type: 'feeding', start: NOW - 60 * M, end: NOW - 40 * M, feedType: 'breast', method: 'left', amount: null, tags: [] },
      ],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().hydrate();
    // Cache-first: the queued entry is already visible straight off hydrate,
    // still counted as queued (nothing has flushed yet).
    expect(s().entries.map((e) => e.id)).toEqual(['e1']);
    expect(s().queueCount).toBe(1);
    // The background refresh then merges the server entries in around it.
    await flush();
    expect(s().entries.map((e) => e.id)).toEqual(['e1', 'srv-1']);
  });

  it('restores a queued entry into `entries` when the server is unreachable at launch', async () => {
    h.q = [queuedEntry('e2')];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await s().hydrate();
    await flush(); // the unreachable verdict now comes from the background refresh
    expect(s().offline).toBe(true);
    expect(s().entries).toEqual([queuedEntry('e2')]);
    expect(s().queueCount).toBe(1);
  });

  it('restores an entity-store-only entry (never queued) when the server is unreachable at launch, without wiping the durable store', async () => {
    // Regression: the network-unreachable catch branch used to build `entries`
    // from the write queue alone and never read the entity store at all. Before
    // expecting children, every local entry in server mode also lived on the
    // queue, so that was harmless; an expecting child's entries (or any entry
    // whose owner has since been confirmed born, see isHeldBackEntry) are the
    // first whose only home is the entity store. Setting `entries` to a
    // queue-only list gives `entries` a new reference, and the persistence
    // subscription then writes that (queue-only) list straight over the
    // durable store, permanently losing anything the queue didn't have.
    const storedOnly: Entry = { id: 'storedOnly', childId: 'c1', tags: [], type: 'note', time: NOW, text: 'entity-store only' };
    h.q = []; // nothing on the retry queue: this is NOT the queued-entry case above
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
      entries: [storedOnly],
      measurements: [],
      selectedChildId: 'c1',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));

    await s().hydrate();
    await flush(); // the unreachable verdict now comes from the background refresh

    expect(s().offline).toBe(true);
    expect(s().entries.find((e) => e.id === 'storedOnly')).toBeDefined();
    // Still durable: the persistence subscription's write reflects it too,
    // rather than overwriting the entity store with a copy that dropped it.
    expect(vi.mocked(saveEntries).mock.calls.at(-1)?.[0]).toContainEqual(storedOnly);
  });

  it('Finding 3: children and measurements also survive hydrate when the server is unreachable at cold start (not just entries)', async () => {
    // Regression: the network-unreachable catch branch restored `entries`
    // from the entity store (fixed above) but restored neither `children`
    // nor `measurements`, leaving them at whatever they were before hydrate()
    // ran, empty on a real cold start. Home then renders the no-child card,
    // and if the parent re-adds the baby, `saveChild` sets `children:
    // [newChild]`, which the persistence subscription writes straight over
    // the durable store, erasing the expecting child (and orphaning its
    // notes) that was sitting right there in `loadEntities()`.
    const expectingChild: Child = { id: 'localDue', first: 'Sky', last: '', birth: NOW + 30 * 86400000, color: '#eee', expected: true };
    const note: Entry = { id: 'noteDue', childId: 'localDue', tags: [], type: 'note', time: NOW, text: 'Scan: 20 weeks, all clear', heldBack: true };
    const meas: Measurement = { id: 'measDue', childId: 'localDue', kind: 'weight', value: 3.2, date: NOW };
    h.q = [];
    // Simulate a genuine fresh cold start: nothing yet in memory (the shared
    // beforeEach seeds a non-empty `children` for other tests' convenience).
    useAppStore.setState({ children: [], entries: [], measurements: [] });
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [expectingChild],
      entries: [note],
      measurements: [meas],
      selectedChildId: 'localDue',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));

    await s().hydrate();
    await flush(); // the unreachable verdict now comes from the background refresh

    expect(s().offline).toBe(true);
    expect(s().children.find((c) => c.id === 'localDue')).toBeDefined();
    expect(s().measurements.find((m) => m.id === 'measDue')).toBeDefined();
    // Durable too: the persistence subscription's write must reflect the
    // restored child, not overwrite the entity store with an empty array.
    expect(vi.mocked(saveChildren).mock.calls.at(-1)?.[0]).toContainEqual(expectingChild);
  });

  it('Fix 2: selectedChildId and lastFeed also survive hydrate when the server is unreachable at cold start', async () => {
    // Regression: the previous fix (Finding 3, above) restored `children`,
    // `entries` and `measurements` in this branch but not `selectedChildId`
    // or `lastFeed`. With `children` now non-empty but `selectedChildId`
    // stuck at '', `DashboardContent`'s `hasChild` reads true while
    // `selectedChild` is undefined, so `selectedChild?.expected` is false and
    // it falls through to the activity tiles for an unborn baby, which is the
    // exact junk-data path hiding the tiles is meant to prevent.
    const expectingChild: Child = { id: 'localDue', first: 'Sky', last: '', birth: NOW + 30 * 86400000, color: '#eee', expected: true };
    const note: Entry = { id: 'noteDue', childId: 'localDue', tags: [], type: 'note', time: NOW, text: 'Scan: 20 weeks, all clear', heldBack: true };
    h.q = [];
    useAppStore.setState({ children: [], entries: [], measurements: [], selectedChildId: '' });
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [expectingChild],
      entries: [note],
      measurements: [],
      selectedChildId: 'localDue',
      lastFeed: { localDue: { feedType: 'formula', method: 'bottle' } },
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));

    await s().hydrate();
    await flush(); // the unreachable verdict now comes from the background refresh

    expect(s().offline).toBe(true);
    expect(s().selectedChildId).toBe('localDue');
    // What DashboardContent actually branches on: with selection restored,
    // the selected child resolves and is seen as expecting, not undefined
    // falling through to the activity tiles.
    const selectedChild = s().children.find((c) => c.id === s().selectedChildId);
    expect(selectedChild).toBeDefined();
    expect(selectedChild?.expected).toBe(true);
    expect(s().lastFeed).toEqual({ localDue: { feedType: 'formula', method: 'bottle' } });
  });

  it('does not duplicate the entry after it flushes and a later refresh returns the server copy', async () => {
    h.q = [queuedEntry('e3')];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().hydrate();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].id).toBe('e3');

    // hydrate's fire-and-forget flushQueue() pushes it and clears the persisted
    // queue, but does NOT touch `entries` (matches existing flushQueue behavior).
    await flush();
    expect(h.q).toHaveLength(0);
    expect(s().entries).toHaveLength(1);

    // the next refresh sees the entry server-side (in server shape/id) — the
    // full `...data` replace in refresh() swaps the local copy for it.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [mira],
      entries: [{ id: 'diaper-9', serverId: 9, childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().refresh();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].id).toBe('diaper-9');
  });

  it('keeps a still-queued entry visible across a successful refresh', async () => {
    // hydrate() merges the write queue back into `entries` so an offline
    // create stays on screen; refresh() did not, so the first successful
    // re-check replaced `entries` with server data alone and the row
    // disappeared. The entry is not lost (it is still in the queue file, and
    // the queue screen still lists it), but History stops showing it until
    // some later load returns it from the server. The case that matters most
    // is the entry that cannot flush at all, which is the one this test uses:
    // it stays queued forever, so without the merge it is invisible forever,
    // and it is exactly the row the "waiting to upload" clock exists for.
    h.pushFails = true;
    h.q = [queuedEntry('e3')];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().hydrate();
    await flush();
    expect(s().entries.map((e) => e.id)).toEqual(['e3']);

    // The re-check succeeds and the server still knows nothing about it.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().refresh();
    await flush();

    expect(h.q).toHaveLength(1);
    expect(s().entries.map((e) => e.id)).toEqual(['e3']);
    expect(s().queuedIds).toEqual(['e3']);
  });
});

describe('offline-created children/measurements survive a cold hydrate (server mode)', () => {
  const mira = { id: 'c1', first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' };

  it('recovers a persisted serverId==null child from loadEntities when the server reload omits it', async () => {
    const localChild: Child = { id: 'localY', first: 'Persisted', last: 'Local', birth: NOW, color: '#abc' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [localChild],
      entries: [],
      measurements: [],
      selectedChildId: 'localY',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().hydrate();
    await flush(); // let the background refresh finish its merge
    expect(s().children.map((c) => c.id)).toEqual(['localY', 'c1']);
  });

  it('keeps selectedChildId pointing at a local-only child when the server reload omits it', async () => {
    // Regression: hydrate used to take `data.selectedChildId` unconditionally,
    // so a cold start right after selecting an offline-only child would
    // silently deselect it back to whatever the server preferred.
    const localChild: Child = { id: 'localY', first: 'Persisted', last: 'Local', birth: NOW, color: '#abc' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [localChild],
      entries: [],
      measurements: [],
      selectedChildId: 'localY',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().hydrate();
    await flush(); // let the background refresh finish its merge
    expect(s().children.map((c) => c.id)).toEqual(['localY', 'c1']);
    expect(s().selectedChildId).toBe('localY');
    expect(s().children.some((c) => c.id === s().selectedChildId)).toBe(true);
  });

  it('recovers a persisted serverId==null measurement from loadEntities when the server reload omits it', async () => {
    const localMeasurement: Measurement = { id: 'localN', childId: 'c1', kind: 'height', value: 60, date: NOW };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [mira],
      entries: [],
      measurements: [localMeasurement],
      selectedChildId: 'c1',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().hydrate();
    expect(s().measurements.map((m) => m.id)).toEqual(['localN']);
  });

  // Scope guard: entries must keep using the queue-only merge
  // (mergeQueuedEntries), NOT mergeUnsynced — a serverId==null entry that was
  // persisted but never queued (e.g. it already flushed) must NOT reappear via
  // loadEntities, or a flushed entry would show up twice (brief's scope note).
  it('does NOT merge a persisted serverId==null entry that is not in the queue', async () => {
    const persistedEntry: Entry = {
      id: 'persisted-e',
      childId: 'c1',
      type: 'diaper',
      time: NOW,
      wet: true,
      solid: false,
      color: null,
      tags: [],
    };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [],
      entries: [persistedEntry],
      measurements: [],
      selectedChildId: '',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().hydrate();
    await flush(); // let the background refresh finish its merge
    expect(s().entries.map((e) => e.id)).not.toContain('persisted-e');
  });
});

// F6: cold start used to block the splash on the complete server load (and
// `request()` had no timeout underneath it), so away from the home LAN, where
// the server address black-holes rather than refusing, every cold start sat
// on the splash until the platform socket gave up. Cache-first instead:
// hydrate populates state from the durable entity store and finishes
// immediately, then hands the fetch-reconcile-merge to a background
// `refresh()`, which already owns the 401 and unreachable outcomes.
describe('cache-first hydrate (server mode)', () => {
  const storedChild: Child = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' };
  const storedEntry: Entry = { id: 'stored-1', childId: 'c1', type: 'note', time: NOW - 60 * M, text: 'from the entity store', tags: [] };

  it('finishes hydrating on cached data BEFORE the server load settles, then merges the refresh result', async () => {
    let resolveLoad!: (data: unknown) => void;
    useAppStore.setState({ hydrating: true, connection: null, connected: false, children: [], entries: [], selectedChildId: '' });
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [storedChild],
      entries: [storedEntry],
      measurements: [],
      selectedChildId: 'c1',
      lastFeed: { c1: { feedType: 'formula', method: 'bottle' } },
      legacyLastFeed: null,
    });
    // A black-holed server: the load neither resolves nor rejects until told to.
    vi.mocked(loadFromServer).mockImplementationOnce(() => new Promise((res) => (resolveLoad = res)) as never);

    await s().hydrate();

    // hydrate resolved while the server load is still hanging: the UI can render.
    expect(s().hydrating).toBe(false);
    expect(s().connected).toBe(true);
    expect(s().offline).toBe(false); // nothing failed yet: refresh decides offline, not hydrate
    expect(s().children.map((c) => c.id)).toEqual(['c1']);
    expect(s().entries.map((e) => e.id)).toEqual(['stored-1']);
    expect(s().selectedChildId).toBe('c1');
    expect(s().lastFeed).toEqual({ c1: { feedType: 'formula', method: 'bottle' } });

    // The background refresh was fired and asked the server for the persisted
    // selection: children were populated from the entity store BEFORE the
    // refresh read them, so the preferred-child fetch survives cache-first.
    await flush();
    expect(vi.mocked(loadFromServer).mock.calls.at(-1)?.[1]).toBe(501);

    // Let the hanging load settle (refreshInFlight is module state: a test
    // that leaves it pending would wedge every later refresh in this file)
    // and check the refresh pipeline merged the server answer over the cache.
    resolveLoad({
      treatments: [],
      children: [{ id: '501', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
      entries: [{ id: 'srv-1', serverId: 5, childId: '501', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }],
      timers: [],
      selectedChildId: '501',
      lastFeed: {},
      measurements: [],
    });
    await flush();
    expect(s().entries.map((e) => e.id)).toEqual(['srv-1']);
    expect(s().children.map((c) => c.id)).toEqual(['c1']); // local id preserved by reconcile
    expect(s().selectedChildId).toBe('c1');
  });

  it('a 401 at cold start opens on cached data, then the background refresh clears the session', async () => {
    useAppStore.setState({ hydrating: true, connection: null, connected: false, connectError: null, children: [], entries: [] });
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [storedChild],
      entries: [],
      measurements: [],
      selectedChildId: 'c1',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new ApiError(401, 'Invalid token for this server.'));

    await s().hydrate();

    // hydrate itself never sees the 401: it resolved on the cached view.
    expect(s().hydrating).toBe(false);
    expect(s().connected).toBe(true);

    // The refresh it fired lands the 401 a moment later: connection cleared,
    // reconnect flow takes over (the same UX a warm-session 401 already has).
    await flush();
    expect(s().connection).toBeNull();
    expect(s().connected).toBe(false);
    expect(s().connectError).toBe('Session expired — please reconnect.');
  });

  it('a fresh-connect cold start with an empty entity store still opens immediately', async () => {
    // The accepted trade: nothing cached yet means a briefly empty dashboard
    // while the first refresh runs, never a splash held hostage by the fetch.
    let rejectLoad!: (e: unknown) => void;
    useAppStore.setState({ hydrating: true, connection: null, connected: false });
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockImplementationOnce(() => new Promise((_res, rej) => (rejectLoad = rej)) as never);

    await s().hydrate();

    expect(s().hydrating).toBe(false);
    expect(s().connected).toBe(true);
    expect(s().children).toEqual([]);
    expect(s().entries).toEqual([]);

    // Settle the hanging load (refreshInFlight is module state, see above);
    // an unreachable answer keeps this test's subject the empty cold open.
    rejectLoad(new Error('network'));
    await flush();
    expect(s().offline).toBe(true);
  });
});

describe('new timers are added to the bottom of the list', () => {
  const existing = (id: string): Timer => ({ id, activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep' });

  it('startQuickTimer appends the new timer after existing ones', () => {
    useAppStore.setState({ timers: [existing('t-old')] });
    s().startQuickTimer();
    expect(s().timers).toHaveLength(2);
    expect(s().timers[0].id).toBe('t-old'); // existing timer stays on top
    expect(s().timers[1].id).not.toBe('t-old'); // new timer is last
  });

  it('a live-interval save appends the running timer after existing ones', () => {
    useAppStore.setState({ timers: [existing('t-old')] });
    s().openSheet('feeding');
    s().setOngoing();
    s().save();
    expect(s().timers).toHaveLength(2);
    expect(s().timers[0].id).toBe('t-old');
    expect(s().timers[1].saveAs).toBe('feeding'); // newest at the bottom
  });
});

describe('edit / delete entry', () => {
  const seedFeeding = () =>
    useAppStore.setState({
      entries: [
        { id: 'feeding-1', serverId: 1, childId: 'c1', type: 'feeding', start: NOW - 30 * M, end: NOW - 10 * M, feedType: 'breast', method: 'left', amount: null, tags: [] },
      ],
    });

  // Ordinary server-mode edit/delete behaviour needs 'c1' synced: updating an
  // entry (and re-creating one via undoDelete) is gated on the owning
  // child's serverId, unlike deleting/offline-editing which key off the
  // entry's own serverId and so don't care.
  beforeEach(() => {
    useAppStore.setState({ children: [SYNCED_C1] });
  });

  it('openEdit anchors absolute time; save updates in place + pushes update', async () => {
    seedFeeding();
    s().openEdit('feeding-1');
    expect(s().editingId).toBe('feeding-1');
    expect(s().te.endAbs).toBe(NOW - 10 * M);
    expect(s().te.durationMin).toBe(20);
    s().setTE({ method: 'right' });
    s().save();
    expect(s().entries).toHaveLength(1);
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.id).toBe('feeding-1');
    expect(e.method).toBe('right');
    expect(e.start).toBe(NOW - 30 * M);
    expect(e.end).toBe(NOW - 10 * M); // absolute time preserved (no drift)
    expect(s().editingId).toBeNull();
    await flush();
    expect(h.updated).toHaveLength(1);
  });

  it('tapping an Ended chip switches end off the edit anchor', () => {
    seedFeeding();
    s().openEdit('feeding-1');
    expect(s().te.endAbs).toBe(NOW - 10 * M);
    s().setEnded(0);
    expect(s().te.endAbs).toBeUndefined();
    expect(s().te.endAgoMin).toBe(0);
  });

  it('deleteEntry removes locally and deletes on server', async () => {
    seedFeeding();
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0);
    await flush();
    expect(h.deleted).toHaveLength(1);
  });

  it('offline edit of a synced entry records an update pending op instead of pushing', async () => {
    seedFeeding();
    useAppStore.setState({ offline: true });
    s().openEdit('feeding-1');
    s().setTE({ method: 'right' });
    s().save();
    await flush();
    expect(h.updated).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toHaveLength(1);
    expect(h.pendingOps[0]).toMatchObject({ op: 'update', entity: 'entry' });
    expect((h.pendingOps[0] as { payload: Entry }).payload.id).toBe('feeding-1');
  });

  it('online edit of a synced entry does NOT record a pending op', async () => {
    seedFeeding();
    s().openEdit('feeding-1');
    s().setTE({ method: 'right' });
    s().save();
    await flush();
    expect(h.updated).toHaveLength(1);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('offline delete of a synced entry records a delete pending op and still removes locally', async () => {
    seedFeeding();
    useAppStore.setState({ offline: true });
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0); // still removed locally
    await flush();
    expect(h.deleted).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toEqual([{ op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 }]);
  });

  it('deleteEntry shows an Undo toast and undoDelete restores + re-creates the entry', async () => {
    seedFeeding();
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0);
    expect(s().toast).toBe('Deleted');
    expect(s().toastAction?.label).toBe('Undo');
    await flush();
    expect(h.deleted).toHaveLength(1); // the delete reached the server

    s().undoDelete();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].id).toBe('feeding-1');
    expect(s().toast).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1); // re-created server-side
  });

  it('undoDelete restores locally without a server round-trip for an offline delete', async () => {
    seedFeeding();
    useAppStore.setState({ offline: true });
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0);
    await flush();
    expect(h.deleted).toHaveLength(0); // offline: the server was never touched

    s().undoDelete();
    expect(s().entries).toHaveLength(1);
    await flush();
    expect(h.pushed).toHaveLength(0); // nothing to re-create
  });

  it('undoDelete cancels the queued offline pending-delete op so it does not replay on reconnect', async () => {
    seedFeeding();
    useAppStore.setState({ offline: true });
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0);
    await flush();
    expect(h.pendingOps).toEqual([{ op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 }]);

    s().undoDelete();
    expect(s().entries).toHaveLength(1);
    await flush();
    // The queued delete op must be removed, or a later flushPendingOps would
    // delete the just-restored entry from the server anyway.
    expect(h.pendingOps).toHaveLength(0);
  });
});

describe('editing a record keeps it with the child it belongs to', () => {
  // A record belongs to whoever it was about, not to whoever happens to be
  // selected while it is edited. Editing stamped the SELECTED child onto it,
  // and since the edit path also PATCHes `child:`, that moved the server row
  // to the sibling too.
  const mira: Child = { id: 'localMira', serverId: 1, first: 'Mira', last: '', birth: NOW - 200 * 86400000, color: '#fff' };
  const theo: Child = { id: 'localTheo', serverId: 2, first: 'Theo', last: '', birth: NOW - 90 * 86400000, color: '#eee' };
  const miraFeed: Entry = { id: 'f1', serverId: 11, childId: 'localMira', tags: [], type: 'feeding', start: NOW - 30 * M, end: NOW - 10 * M, feedType: 'breast', method: 'left', amount: null };

  beforeEach(() => {
    useAppStore.setState({ children: [mira, theo], selectedChildId: 'localTheo' });
  });

  it("an entry edit made while a sibling is selected stays with the entry's own child", async () => {
    useAppStore.setState({ entries: [miraFeed] });
    s().openEdit('f1');
    s().setTE({ method: 'right' });
    s().save();

    expect(s().entries[0].childId).toBe('localMira');
    await flush();
    expect((h.updated[0] as Entry).childId).toBe('localMira');
    // ...and the PATCH is addressed to Mira's server row, not Theo's.
    expect(vi.mocked(updateEntryOnServer).mock.calls.at(-1)?.[2]).toBe(1);
  });

  it("a measurement edit made while a sibling is selected stays with the measurement's own child", async () => {
    useAppStore.setState({
      measurements: [{ id: 'weight-1', serverId: 7, childId: 'localMira', kind: 'weight', value: 5.0, date: NOW }],
    });
    s().openEditMeasurement('weight-1');
    s().saveMeasurement(6.0, NOW);

    expect(s().measurements[0].childId).toBe('localMira');
    await flush();
    expect((h.measUpdated[0] as Measurement).childId).toBe('localMira');
  });

  it('converting an entry back into a live timer keeps it with the entry\'s own child', async () => {
    useAppStore.setState({ entries: [miraFeed] });
    s().openEdit('f1');
    s().setOngoing(); // "Still ongoing": the entry is replaced by a timer
    s().save();

    expect(s().entries).toHaveLength(0);
    expect(s().timers).toHaveLength(1);
    expect(s().timers[0].childId).toBe('localMira');
    await flush();
    // The server mirror is created under Mira, not under the selected child.
    expect(h.timerPushed[0]).toMatchObject({ childServerId: 1 });
  });
});

describe('the log sheet owns the child it is logging for', () => {
  // The draft used to read the GLOBAL selection at save time, so anything that
  // moved the selection under an open sheet re-aimed the draft. Once the sheet
  // carries its own target, the selection moving underneath is irrelevant.
  const mira: Child = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 200 * 86400000, color: '#fff' };
  const ivo: Child = { id: 'c2', serverId: 502, first: 'Ivo', last: 'O', birth: NOW - 200 * 86400000, color: '#eee' };

  beforeEach(() => {
    useAppStore.setState({ children: [mira, ivo], selectedChildId: 'c1' });
  });

  it('openSheet pins the selection as the sheet target', () => {
    s().openSheet('diaper');
    expect(s().sheetChildIds).toEqual(['c1']);
  });

  it('a fresh draft files against the sheet target, not a selection that moved under it', () => {
    // A warm notification tap for a sibling moves the selection with no action
    // on the switcher, and the sheet is a root overlay that survives the
    // navigation, so the draft really does stay open over the new selection.
    s().openSheet('diaper');
    useAppStore.setState({ selectedChildId: 'c2' });
    s().save();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].childId).toBe('c1');
  });

  it('setSheetChildren re-aims the draft without moving the global selection', () => {
    s().openSheet('diaper');
    s().setSheetChildren(['c2']);
    s().save();
    expect(s().entries[0].childId).toBe('c2');
    expect(s().selectedChildId).toBe('c1');
  });

  it('setSheetChildren ignores an empty list, so a draft can never lose its owner', () => {
    s().openSheet('diaper');
    s().setSheetChildren([]);
    expect(s().sheetChildIds).toEqual(['c1']);
  });

  it('openEdit pins the entry\'s own child, not the selection', () => {
    useAppStore.setState({
      entries: [{ id: 'f1', serverId: 11, childId: 'c2', tags: [], type: 'feeding', start: NOW - 30 * M, end: NOW - 10 * M, feedType: 'breast', method: 'left', amount: null }],
    });
    s().openEdit('f1');
    expect(s().sheetChildIds).toEqual(['c2']);
  });

  it('re-aiming an edit moves the record, server row and all', async () => {
    useAppStore.setState({
      entries: [{ id: 'f1', serverId: 11, childId: 'c1', tags: [], type: 'feeding', start: NOW - 30 * M, end: NOW - 10 * M, feedType: 'breast', method: 'left', amount: null }],
    });
    s().openEdit('f1');
    s().setSheetChildren(['c2']);
    s().save();

    expect(s().entries[0].childId).toBe('c2');
    await flush();
    // The PATCH is addressed to Ivo's server row: the entry really moves.
    expect(vi.mocked(updateEntryOnServer).mock.calls.at(-1)?.[2]).toBe(502);
  });

  it('openTimerEdit pins the timer\'s owner', () => {
    useAppStore.setState({
      timers: [{ id: 't1', childId: 'c2', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    expect(s().sheetChildIds).toEqual(['c2']);
  });

  it('closeSheet clears the target alongside the sheet itself', () => {
    s().openSheet('diaper');
    s().closeSheet();
    expect(s().sheetChildIds).toEqual([]);
  });

  it('expandMedicationLog keeps the target, since it replaces `sheet` wholesale', () => {
    // `sheet` is never spread, so a target living on it would silently reset
    // here. This is why the target is its own top-level field.
    s().openSheet('medication');
    s().setSheetChildren(['c2']);
    s().expandMedicationLog();
    expect(s().sheetChildIds).toEqual(['c2']);
  });

  it('a sheet opened without a seeded target still falls back to the selection', () => {
    // Nothing in the app opens a sheet this way, but `sheetChildIds` is state
    // and an empty list has to keep meaning "whoever the old rule picked".
    useAppStore.setState({ sheet: { type: 'diaper' }, sheetChildIds: [], te: { shape: 'point', tags: [], agoMin: 0 } });
    s().save();
    expect(s().entries[0].childId).toBe('c1');
  });
});

describe('re-aiming a bath sheet re-seeds the suggested wash', () => {
  // `wash` is the one child-scoped SEED the sheet computes at open (from that
  // child's own rhythm and bath history), so re-aiming has to move it: leaving
  // it behind offers Mira's suggestion as Ivo's, and the sheet saves it.
  const mira: Child = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 200 * 86400000, color: '#fff' };
  const ivo: Child = { id: 'c2', serverId: 502, first: 'Ivo', last: 'O', birth: NOW - 200 * 86400000, color: '#eee' };
  // Bathed fully an hour ago, so the full-bath clock is reset and only a quick
  // wash is on the cards. Ivo has never been bathed, so a full bath is due.
  const miraBath: Entry = { id: 'b1', childId: 'c1', type: 'bath', time: NOW - 3600000, wash: 'full', tags: [] };

  beforeEach(() => {
    useAppStore.setState({ children: [mira, ivo], selectedChildId: 'c1', entries: [miraBath] });
  });

  it('follows a single-target re-aim', () => {
    s().openSheet('bath');
    expect(s().te.wash).toBe('quick');
    s().setSheetChildren(['c2']);
    expect(s().te.wash).toBe('full');
  });

  it('follows a collapse back to one child', () => {
    s().openSheet('bath');
    s().toggleSheetChild('c2');
    // Two targets have no single rhythm to read, so the shared value stands.
    expect(s().te.wash).toBe('quick');
    s().toggleSheetChild('c1');
    expect(s().te.wash).toBe('full');
  });

  it('never overwrites a wash the parent already chose', () => {
    // A suggestion must not overrule a decision. Both children suggest `full`
    // here, so only the guard can keep the chosen `quick`.
    useAppStore.setState({ entries: [] });
    s().openSheet('bath');
    expect(s().te.wash).toBe('full');
    s().setWash('quick');
    s().setSheetChildren(['c2']);
    expect(s().te.wash).toBe('quick');
  });

  it('never re-seeds an EDIT, whose wash is the record\'s own', () => {
    // Re-aiming an edit moves the record; it must not also rewrite what the
    // record says happened.
    useAppStore.setState({ entries: [{ ...miraBath, wash: 'quick' }] });
    s().openEdit('b1');
    expect(s().te.wash).toBe('quick');
    s().setSheetChildren(['c2']);
    expect(s().te.wash).toBe('quick');
  });

  it('leaves other activities\' drafts alone', () => {
    s().openSheet('diaper');
    const before = s().te;
    s().setSheetChildren(['c2']);
    expect(s().te).toBe(before);
  });
});

describe('logging for more than one child at once', () => {
  // "Log for both": one INDEPENDENT entry per target child, each separately
  // editable and deletable afterwards. No link field, no group id.
  const mira: Child = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 200 * 86400000, color: '#fff' };
  const ivo: Child = { id: 'c2', serverId: 502, first: 'Ivo', last: 'O', birth: NOW - 200 * 86400000, color: '#eee' };

  beforeEach(() => {
    useAppStore.setState({ children: [mira, ivo], selectedChildId: 'c1' });
  });

  const bothDiapers = () => {
    s().openSheet('diaper');
    s().toggleSheetChild('c2');
    s().save();
  };

  it('toggleSheetChild adds a second target and takes it away again', () => {
    s().openSheet('diaper');
    s().toggleSheetChild('c2');
    expect(s().sheetChildIds).toEqual(['c1', 'c2']);
    s().toggleSheetChild('c2');
    expect(s().sheetChildIds).toEqual(['c1']);
  });

  it('toggleSheetChild refuses to untoggle the last target', () => {
    s().openSheet('diaper');
    s().toggleSheetChild('c1');
    expect(s().sheetChildIds).toEqual(['c1']);
  });

  it('toggleSheetChild refuses a child the picker could never have offered', () => {
    // An expecting child added as a target would fan out invisibly: no chip
    // would show it, so nothing could take it back off again.
    useAppStore.setState({ children: [mira, { ...ivo, serverId: undefined, expected: true }] });
    s().openSheet('diaper');
    s().toggleSheetChild('c2');
    expect(s().sheetChildIds).toEqual(['c1']);
  });

  it('toggleSheetChild refuses an id that names nobody', () => {
    s().openSheet('diaper');
    s().toggleSheetChild('ghost');
    expect(s().sheetChildIds).toEqual(['c1']);
  });

  it('writes one entry per target child', () => {
    bothDiapers();
    expect(s().entries).toHaveLength(2);
    expect(s().entries.map((e) => e.childId).sort()).toEqual(['c1', 'c2']);
  });

  it('gives each entry its OWN id', () => {
    // Both entries used to land with the SAME id, and everything id-keyed then
    // hit both. See where `built` is assembled in `save()`.
    bothDiapers();
    const ids = s().entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('leaves the entries independent: deleting one keeps the other', () => {
    bothDiapers();
    s().deleteEntry(s().entries[0].id);
    expect(s().entries).toHaveLength(1);
  });

  it('pushes each entry to its own child\'s server row', async () => {
    bothDiapers();
    await flush();
    expect(h.pushed).toHaveLength(2);
    expect([...(h.pushedChildServerIds as number[])].sort()).toEqual([501, 502]);
  });

  it('queues the whole batch in ONE write while offline', async () => {
    useAppStore.setState({ offline: true });
    bothDiapers();
    await flush();
    // One batched call, not one per child. See `enqueueEntries` for the
    // load-modify-save race that turns the difference into a lost entry.
    expect(vi.mocked(enqueueEntries)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueueEntry)).not.toHaveBeenCalled();
    expect(h.q).toHaveLength(2);
    expect(s().queueCount).toBe(2);
    expect(s().queuedIds).toHaveLength(2);
  });

  it('writes ONE lastFeed draft, filed under every child it was logged for', () => {
    // One draft, one write. It lands under both targets because "what was this
    // child's last feed like" is now true of each of them, and leaving the
    // sibling's entry stale is the leak the map exists to close.
    s().openSheet('feeding');
    s().toggleSheetChild('c2');
    s().setTE({ feedType: 'formula', method: 'bottle' });
    s().save();
    expect(s().entries).toHaveLength(2);
    expect(s().lastFeed).toEqual({
      c1: { feedType: 'formula', method: 'bottle' },
      c2: { feedType: 'formula', method: 'bottle' },
    });
  });

  it('leaves an untargeted sibling\'s prefill alone', () => {
    useAppStore.setState({ lastFeed: { c2: { feedType: 'solid', method: 'self' } } });
    s().openSheet('feeding');
    s().setTE({ feedType: 'formula', method: 'bottle' });
    s().save();
    expect(s().lastFeed).toEqual({
      c1: { feedType: 'formula', method: 'bottle' },
      c2: { feedType: 'solid', method: 'self' },
    });
  });

  it('starts one live timer per target child', () => {
    s().openSheet('sleep');
    s().toggleSheetChild('c2');
    s().setOngoing();
    s().save();
    expect(s().entries).toHaveLength(0);
    expect(s().timers).toHaveLength(2);
    expect(s().timers.map((tm) => tm.childId).sort()).toEqual(['c1', 'c2']);
    expect(new Set(s().timers.map((tm) => tm.id)).size).toBe(2);
  });

  it('never fans out an EDIT, even with several targets sitting in state', () => {
    // Multi-select is create-only: an edit moves ONE record, and letting it add
    // a child would silently mint a sibling copy of an existing entry.
    useAppStore.setState({
      entries: [{ id: 'f1', serverId: 11, childId: 'c1', tags: [], type: 'feeding', start: NOW - 30 * M, end: NOW - 10 * M, feedType: 'breast', method: 'left', amount: null }],
    });
    s().openEdit('f1');
    useAppStore.setState({ sheetChildIds: ['c1', 'c2'] });
    s().save();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].childId).toBe('c1');
  });

  it('never fans out a timer stop', () => {
    // A timer stop belongs to whoever started the timer, and there is one of it.
    useAppStore.setState({
      timers: [{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    useAppStore.setState({ sheetChildIds: ['c1', 'c2'] });
    s().setTimerLasted(40);
    s().save();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].childId).toBe('c1');
  });

  it('refuses to fan out an activity off the allow-list', () => {
    // Belt and braces behind the UI gate: duplicating a pumping session would
    // double-count the milk in every aggregate built on it.
    s().openSheet('pumping');
    useAppStore.setState({ sheetChildIds: ['c1', 'c2'] });
    s().save();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].childId).toBe('c1');
  });

  it('routes a mixed batch per child: a withheld sibling stays local', async () => {
    // `commitWrites` routes each entry on its OWN child, so a batch genuinely
    // takes several paths at once. The target is set directly rather than
    // through the picker, which refuses an expecting child: the subject here is
    // what the write path does with such a batch, however one arose.
    useAppStore.setState({ children: [mira, { ...ivo, serverId: undefined, expected: true }] });
    s().openSheet('diaper');
    useAppStore.setState({ sheetChildIds: ['c1', 'c2'] });
    s().save();
    await flush();
    expect(s().entries).toHaveLength(2);
    expect(s().entries.find((e) => e.childId === 'c2')?.heldBack).toBe(true);
    expect(h.pushed).toHaveLength(1);
    expect(h.pushedChildServerIds).toEqual([501]);
  });
});

describe('editing a still-queued entry rewrites its queued copy', () => {
  // The offline write queue file is what `flushQueue` pushes, and it never
  // consults `entries`. An edit that only updated the in-memory copy left the
  // stale pre-edit version sitting on the file: the reconnect flush POSTed
  // that stale copy, and the next refresh() then dropped the local edit
  // (serverId null, not held back) in favor of the server's row, silently
  // reverting the user's correction.

  it('save() rewrites the queued copy in place, same position, and re-mirrors the queue', async () => {
    useAppStore.setState({ offline: true });
    s().openSheet('note');
    s().setTE({ noteText: 'first wrods' });
    s().save();
    await flush();
    expect(h.q).toHaveLength(1);
    const id = (h.q[0] as Entry).id;
    // A second write queued behind it, so "in place" is observable as
    // position: a remove-and-append rewrite would move the edit to the back
    // and reorder the reconnect upload.
    const later: Entry = { id: 'q-later', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] };
    h.q = [...h.q, later];

    s().openEdit(id);
    s().setTE({ noteText: 'first words' });
    s().save();
    await flush();

    expect(h.q).toHaveLength(2);
    expect(h.q[0]).toMatchObject({ id, type: 'note', text: 'first words' });
    expect((h.q[1] as Entry).id).toBe('q-later');
    // The mirror is refreshed from the rewritten file, so History's queued
    // markers and the banner count stay truthful.
    expect(s().queuedIds).toEqual([id, 'q-later']);
    expect(s().queueCount).toBe(2);
  });

  it('a reconnect flush pushes the edited payload, not the stale pre-edit copy', async () => {
    useAppStore.setState({ offline: true, children: [SYNCED_C1] });
    s().openSheet('note');
    s().setTE({ noteText: 'fed at teh wrong time' });
    s().save();
    await flush();
    const id = (h.q[0] as Entry).id;

    s().openEdit(id);
    s().setTE({ noteText: 'fed at the right time' });
    s().save();
    await flush();

    useAppStore.setState({ offline: false });
    await s().flushQueue();

    expect(h.pushed).toHaveLength(1);
    expect(h.pushed[0]).toMatchObject({ id, text: 'fed at the right time' });
    expect(h.q).toHaveLength(0);
  });

  it('editing an entry that is NOT queued leaves the queue file untouched', async () => {
    useAppStore.setState({
      children: [SYNCED_C1],
      entries: [
        { id: 'feeding-1', serverId: 1, childId: 'c1', type: 'feeding', start: NOW - 30 * M, end: NOW - 10 * M, feedType: 'breast', method: 'left', amount: null, tags: [] },
      ],
    });
    const other: Entry = { id: 'q-other', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] };
    h.q = [other];
    useAppStore.setState({ queueCount: 1, queuedIds: ['q-other'] });

    s().openEdit('feeding-1');
    s().setTE({ method: 'right' });
    s().save();
    await flush();

    expect(h.q).toEqual([other]);
    expect(s().queuedIds).toEqual(['q-other']);
    expect(s().queueCount).toBe(1);
    expect(h.updated).toHaveLength(1); // the ordinary online update still went out
  });

  it('editMilestone on a queued milestone rewrites the queued copy too', async () => {
    useAppStore.setState({ offline: true });
    s().logMilestone('first-steps', NOW - 10 * M, 'wobbly');
    await flush();
    expect(h.q).toHaveLength(1);
    const id = (h.q[0] as Entry).id;

    s().editMilestone(id, NOW - 5 * M, 'three steady steps');
    await flush();

    expect(h.q).toHaveLength(1);
    expect(h.q[0]).toMatchObject({ id, type: 'milestone', time: NOW - 5 * M, note: 'three steady steps' });
  });
});

describe('"Still ongoing" on a logged entry converts it into a live timer', () => {
  // A finished entry the user marks as still running is not an entry any more.
  // It used to be patched to `end: null`, which is not a timer at all and which
  // the API client pushes as a ZERO-LENGTH record (`end: entry.end ?? start`),
  // so the next refresh overwrote the local copy with a nonsense one. The entry
  // must be removed and replaced by a running timer instead.
  const sleepEntry = (over: Partial<Extract<Entry, { type: 'sleep' }>> = {}): Entry => ({
    id: 'sleep-1',
    serverId: 7,
    childId: 'c1',
    type: 'sleep',
    start: NOW - 90 * M,
    end: NOW - 30 * M,
    nap: true,
    tags: [],
    ...over,
  });

  beforeEach(() => {
    useAppStore.setState({ children: [SYNCED_C1] });
  });

  const convert = (id: string) => {
    s().openEdit(id);
    s().setOngoing();
    s().save();
  };

  it('removes the entry and starts a timer instead of writing a fake-ongoing entry', () => {
    useAppStore.setState({ entries: [sleepEntry()] });
    convert('sleep-1');
    expect(s().entries).toHaveLength(0); // no `end: null` entry left behind
    expect(s().timers).toHaveLength(1);
    expect(s().timers[0].saveAs).toBe('sleep');
    expect(s().timers[0].start).toBe(NOW - 90 * M); // the original start, exactly
    expect(s().sheet).toBeNull();
    expect(s().editingId).toBeNull();
  });

  it('carries the entry\'s settings onto the timer, not just its start', () => {
    useAppStore.setState({
      entries: [
        {
          id: 'feed-1',
          serverId: 8,
          childId: 'c1',
          type: 'feeding',
          start: NOW - 20 * M,
          end: NOW - 5 * M,
          feedType: 'breast',
          method: 'both',
          amount: 2,
          notes: 'sleepy latch',
          tags: ['right', 'Fussy'],
        },
      ],
    });
    convert('feed-1');
    const tm = s().timers[0];
    expect(tm.feedType).toBe('breast');
    expect(tm.method).toBe('both');
    expect(tm.startSide).toBe('right');
    expect(tm.amount).toBe(2);
    expect(tm.notes).toBe('sleepy latch');
    expect(tm.tags).toEqual(['right', 'Fussy']);
  });

  it('keeps a sleep nap flag and a tummy milestone', () => {
    useAppStore.setState({ entries: [sleepEntry({ nap: false })] });
    convert('sleep-1');
    expect(s().timers[0].nap).toBe(false);

    useAppStore.setState({
      entries: [{ id: 'tt-1', childId: 'c1', type: 'tummy', start: NOW - 8 * M, end: NOW - 2 * M, milestone: 'rolled over', tags: [] }],
      timers: [],
    });
    convert('tt-1');
    expect(s().timers[0].milestone).toBe('rolled over');
  });

  it('deletes the entry on the server and creates the timer there', async () => {
    useAppStore.setState({ entries: [sleepEntry()] });
    convert('sleep-1');
    await flush();
    expect(h.deleted).toEqual([{ type: 'sleep', id: 7 }]);
    expect(h.timerPushed).toHaveLength(1);
    expect(h.updated).toHaveLength(0); // never patched into a fake-ongoing entry
  });

  it('undo restores the entry AND discards the new timer (never both)', async () => {
    useAppStore.setState({ entries: [sleepEntry(), { id: 'other', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }] });
    convert('sleep-1');
    await flush();
    expect(s().toastAction?.label).toBe('Undo');

    s().toastAction?.run();
    expect(s().timers).toHaveLength(0); // the timer is gone
    expect(s().entries.map((e) => e.id)).toEqual(['sleep-1', 'other']); // restored in place
    await flush();
    expect(h.pushed).toHaveLength(1); // the server copy is re-created
    expect(h.timerDeleted).toEqual([555]); // and the server timer is discarded
  });

  it('keeps the entry\'s original start when only the END was nudged in the same sheet session', () => {
    // `openEdit` leaves the start DERIVED (end − lasted), so nudging the end
    // silently slides it. The recorded start is the only exact answer.
    useAppStore.setState({ entries: [sleepEntry()] });
    s().openEdit('sleep-1');
    s().setEndedAbs(NOW - 5 * M); // user fiddles with the end first
    s().setOngoing();
    expect(s().te.startAbs).toBe(NOW - 90 * M); // the sheet shows the true start too
    s().save();
    expect(s().timers[0].start).toBe(NOW - 90 * M);
  });

  it('keeps the original start when the DURATION was nudged', () => {
    useAppStore.setState({ entries: [sleepEntry()] });
    s().openEdit('sleep-1');
    s().setLasted(15);
    s().setOngoing();
    s().save();
    expect(s().timers[0].start).toBe(NOW - 90 * M);
  });

  it('honours a start the user edited themselves', () => {
    useAppStore.setState({ entries: [sleepEntry()] });
    s().openEdit('sleep-1');
    s().setStartedAt(NOW - 200 * M);
    s().setOngoing();
    s().save();
    expect(s().timers[0].start).toBe(NOW - 200 * M);
  });

  it('preserves a days-old start', () => {
    useAppStore.setState({ entries: [sleepEntry({ start: NOW - 3 * 24 * 60 * M, end: NOW - 3 * 24 * 60 * M + 30 * M })] });
    convert('sleep-1');
    expect(s().timers[0].start).toBe(NOW - 3 * 24 * 60 * M);
  });

  it('clamps a start in the future to now', () => {
    useAppStore.setState({ entries: [sleepEntry()] });
    s().openEdit('sleep-1');
    s().setStartedAt(NOW + 10 * M);
    s().setOngoing();
    s().save();
    expect(s().timers[0].start).toBe(NOW);
  });

  it('the timer belongs to the entry\'s child, not the selected one', () => {
    useAppStore.setState({
      children: [SYNCED_C1, { id: 'c2', serverId: 502, first: 'Ivo', last: 'O', birth: NOW - 400 * 86400000, color: '#abc' }],
      entries: [sleepEntry({ childId: 'c2' })],
      selectedChildId: 'c1',
    });
    convert('sleep-1');
    expect(s().timers[0].childId).toBe('c2');
  });

  it('never converts a point entry', () => {
    useAppStore.setState({
      entries: [{ id: 'd1', serverId: 9, childId: 'c1', type: 'diaper', time: NOW - 20 * M, wet: true, solid: false, color: null, tags: [] }],
    });
    s().openEdit('d1');
    s().setOngoing(); // the flag exists on the shared draft; a point must ignore it
    s().save();
    expect(s().timers).toHaveLength(0);
    expect(s().entries).toHaveLength(1);
  });

  it('scrubs the offline write queue so the entry does not resurrect on reconnect', async () => {
    useAppStore.setState({ offline: true });
    s().openSheet('sleep');
    s().setLasted(30);
    s().save(); // created offline: queued, no serverId
    await flush();
    expect(h.q).toHaveLength(1);
    const id = s().entries[0].id;

    convert(id);
    await flush();
    expect(h.q).toHaveLength(0); // pulled off the queue
    expect(s().queueCount).toBe(0);

    // ...and a reconnect flush must not re-create it alongside the timer.
    useAppStore.setState({ offline: false });
    await s().flushQueue();
    expect(h.pushed).toHaveLength(0);
    expect(s().entries).toHaveLength(0);
    expect(s().timers).toHaveLength(1);
  });

  it('undo puts a scrubbed queued entry back on the queue', async () => {
    useAppStore.setState({ offline: true });
    s().openSheet('sleep');
    s().setLasted(30);
    s().save();
    await flush();
    const id = s().entries[0].id;

    convert(id);
    await flush();
    expect(h.q).toHaveLength(0);

    s().toastAction?.run();
    await flush();
    expect(s().entries).toHaveLength(1);
    expect(h.q).toHaveLength(1); // still unsent, exactly as it was
  });

  it('cleans up the orphan when the entry\'s create POST lands after the conversion', async () => {
    // commitWrite's push is fire-and-forget: converting before it resolves
    // leaves serverId null, so no delete goes out at conversion time.
    s().openSheet('sleep');
    s().setLasted(30);
    s().save(); // POST in flight, serverId not stamped yet
    const id = s().entries[0].id;
    expect(s().entries[0].serverId).toBeUndefined();

    convert(id);
    await flush();
    expect(h.deleted).toEqual([{ type: 'sleep', id: 999 }]); // orphan removed
    expect(s().entries).toHaveLength(0);
  });

  it('records a pending delete op when converting offline', async () => {
    useAppStore.setState({ entries: [sleepEntry()], offline: true });
    convert('sleep-1');
    await flush();
    expect(h.deleted).toHaveLength(0);
    expect(h.pendingOps).toEqual([{ op: 'delete', entity: 'entry', entryType: 'sleep', serverId: 7 }]);
  });
});

describe('measurements', () => {
  // Ordinary server-mode measurement create/update needs 'c1' synced; the
  // offline tests below key off the measurement's own serverId instead, so
  // they don't care either way.
  beforeEach(() => {
    useAppStore.setState({ children: [SYNCED_C1] });
  });

  it('saveMeasurement creates and pushes', async () => {
    s().openMeasurement('weight');
    s().saveMeasurement(5.5, NOW);
    expect(s().measurements).toHaveLength(1);
    expect(s().measurements[0].kind).toBe('weight');
    expect(s().measurements[0].value).toBe(5.5);
    await flush();
    expect(h.measPushed).toHaveLength(1);
  });

  it('edit + delete a measurement', async () => {
    useAppStore.setState({
      measurements: [{ id: 'weight-1', serverId: 1, childId: 'c1', kind: 'weight', value: 5.0, date: NOW }],
    });
    s().openEditMeasurement('weight-1');
    s().saveMeasurement(6.0, NOW);
    expect(s().measurements[0].value).toBe(6.0);
    await flush();
    expect(h.measUpdated).toHaveLength(1);

    s().deleteMeasurement('weight-1');
    expect(s().measurements).toHaveLength(0);
    await flush();
    expect(h.measDeleted).toHaveLength(1);
  });

  it('offline edit of a synced measurement records an update pending op instead of pushing', async () => {
    useAppStore.setState({
      offline: true,
      measurements: [{ id: 'weight-1', serverId: 1, childId: 'c1', kind: 'weight', value: 5.0, date: NOW }],
    });
    s().openEditMeasurement('weight-1');
    s().saveMeasurement(6.0, NOW);
    await flush();
    expect(h.measUpdated).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toHaveLength(1);
    expect(h.pendingOps[0]).toMatchObject({ op: 'update', entity: 'measurement' });
    expect((h.pendingOps[0] as { payload: Measurement }).payload.id).toBe('weight-1');
  });

  it('offline delete of a synced measurement records a delete pending op and still removes locally', async () => {
    useAppStore.setState({
      offline: true,
      measurements: [{ id: 'weight-1', serverId: 1, childId: 'c1', kind: 'weight', value: 5.0, date: NOW }],
    });
    s().deleteMeasurement('weight-1');
    expect(s().measurements).toHaveLength(0); // still removed locally
    await flush();
    expect(h.measDeleted).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toEqual([{ op: 'delete', entity: 'measurement', kind: 'weight', serverId: 1 }]);
  });
});

describe('milestone sheet', () => {
  it('openMilestone opens the sheet in log mode for a catalog key', () => {
    s().openMilestone('lifts-head');
    expect(s().milestoneSheet).toEqual({ mode: 'log', key: 'lifts-head' });
  });

  it('openEditMilestone opens the sheet in edit mode for a logged milestone entry', () => {
    useAppStore.setState({
      entries: [{ id: 'm1', childId: 'c1', type: 'milestone', key: 'lifts-head', time: NOW, text: 'Lifts head', tags: [] }],
    });
    s().openEditMilestone('m1');
    expect(s().milestoneSheet).toEqual({ mode: 'edit', id: 'm1' });
  });

  it('openEditMilestone ignores a missing or non-milestone entry', () => {
    s().openEditMilestone('nope');
    expect(s().milestoneSheet).toBeNull();
  });

  it('closeMilestoneSheet clears the sheet', () => {
    s().openMilestone('lifts-head');
    s().closeMilestoneSheet();
    expect(s().milestoneSheet).toBeNull();
  });
});

describe('children', () => {
  it('saveChild creates, auto-selects, and pushes; keeps the local id and stamps serverId instead of rewriting it', async () => {
    s().openAddChild();
    expect(s().childSheet).toBe(true);
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW - 30 * 86400000 });

    expect(s().children).toHaveLength(2);
    const created = s().children[1];
    expect(created.first).toBe('Nova');
    expect(created.last).toBe('O');
    expect(created.birth).toBe(NOW - 30 * 86400000);
    expect(created.id).toMatch(/^child\d+$/);
    expect(s().selectedChildId).toBe(created.id);
    expect(s().childSheet).toBe(false);
    expect(s().editingChildId).toBeNull();
    expect(s().showChildSwitcher).toBe(false);

    const localId = created.id;
    await flush();
    expect(h.childPushed).toHaveLength(1);
    // the local id is NOT rewritten to the server id, and selection keeps
    // following it: entries/measurements reference this id, and rewriting it
    // would orphan them (the bug this whole design exists to prevent).
    expect(s().children[1].id).toBe(localId);
    expect(s().selectedChildId).toBe(localId);
    // serverId is stamped instead (like entries/measurements) so server-child
    // ops (update / delete / sync) recognise it before the next refresh.
    expect(s().children[1].serverId).toBe(777);
    // The slug is stamped from the same create response. Baby Buddy keys the
    // child endpoints by slug, so without this a child created this session
    // could not be renamed or deleted until the next refresh filled it in.
    expect(s().children[1].slug).toBe(SERVER_SLUG);
  });

  it('a child created online can immediately be deleted on the server (no resurrection)', async () => {
    // Regression: saveChild must stamp serverId AND slug on create, else
    // deleteChild would only remove the child locally (serverId gate) or address
    // it by an id Baby Buddy 404s on (slug lookup), and either way it would
    // reappear on the next refresh.
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW });
    await flush();
    const created = s().children[1];
    expect(created.serverId).toBe(777);

    h.childDeleted = [];
    void s().deleteChild(created.id);
    // The whole child goes to the server delete, carrying the slug it is keyed by.
    expect(h.childDeleted).toEqual([expect.objectContaining({ serverId: 777, slug: SERVER_SLUG })]);
    expect(s().children.find((c) => c.id === created.id)).toBeUndefined();
  });

  it('renaming a child re-stamps the slug, which Baby Buddy moves with the name', async () => {
    // The slug is derived from the name server-side, so a rename changes it
    // (confirmed against a live server). Holding the OLD slug would 404 the
    // next rename or delete, resurrecting the child: the reported bug, one
    // rename removed.
    useAppStore.setState({
      children: [{ id: 'c1', serverId: 5, first: 'Mira', last: 'D', birth: NOW, color: '#fff', slug: 'mira-d' }],
      selectedChildId: 'c1',
    });
    s().openEditChild('c1');
    s().saveChild({ first: 'Mirabel', last: 'D', birth: NOW });
    await flush();

    expect(s().children[0].slug).toBe('mirabel-slug');
  });

  it('saveChild picks a tint no sibling wears, not one keyed to the list length', async () => {
    // The shape deleting the middle of three children leaves behind. Picking by
    // `children.length` here would hand out CHILD_COLORS[2] a second time.
    useAppStore.setState({
      children: [
        { id: 'c1', first: 'Mira', last: 'O', birth: NOW, color: CHILD_COLORS[0] },
        { id: 'c3', first: 'Theo', last: 'O', birth: NOW, color: CHILD_COLORS[2] },
      ],
    });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW });
    await flush();

    expect(s().children.at(-1)?.color).toBe(CHILD_COLORS[1]);
  });

  it('saveChild creating a new child resets the insights cache (auto-select mirrors selectChild)', () => {
    useAppStore.setState({ insightsLoaded: true, insightsEntries: [{ id: 'x' } as any], insightsError: true });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW - 30 * 86400000 });

    const created = s().children[1];
    expect(s().selectedChildId).toBe(created.id);
    expect(s().insightsLoaded).toBe(false);
    expect(s().insightsEntries).toEqual([]);
    expect(s().insightsError).toBe(false);
  });

  it('saveChild while editing updates the existing child in place and calls updateChild', async () => {
    s().openEditChild('c1');
    expect(s().editingChildId).toBe('c1');
    s().saveChild({ first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });

    expect(s().children).toHaveLength(1);
    expect(s().children[0]).toMatchObject({ id: 'c1', first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });
    expect(s().childSheet).toBe(false);
    expect(s().editingChildId).toBeNull();

    await flush();
    expect(h.childUpdated).toHaveLength(1);
    expect(h.childPushed).toHaveLength(0);
  });

  describe('gender (a `gender`-tagged note, since Baby Buddy Child has no such field)', () => {
    it('stores the gender on the child and writes the note when it changes', async () => {
      useAppStore.setState({ children: [SYNCED_C1] });
      s().openEditChild('c1');
      s().saveChild({ first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, gender: 'girl' });
      expect(s().children[0].gender).toBe('girl');
      await flush();
      expect(h.genderWritten).toEqual([{ childServerId: 501, gender: 'girl' }]);
    });

    it('writes nothing when the gender is unchanged by an edit', async () => {
      useAppStore.setState({ children: [{ ...SYNCED_C1, gender: 'girl' }] });
      s().openEditChild('c1');
      s().saveChild({ first: 'Mira', last: 'Renamed', birth: NOW - 90 * 86400000, gender: 'girl' });
      await flush();
      expect(h.genderWritten).toHaveLength(0);
      // The rename itself still goes out.
      expect(h.childUpdated).toHaveLength(1);
    });

    it('clears the gender, which deletes the note server-side', async () => {
      useAppStore.setState({ children: [{ ...SYNCED_C1, gender: 'girl' }] });
      s().openEditChild('c1');
      s().saveChild({ first: 'Mira', last: 'O', birth: NOW - 90 * 86400000 });
      expect(s().children[0].gender).toBeUndefined();
      await flush();
      expect(h.genderWritten).toEqual([{ childServerId: 501, gender: undefined }]);
    });

    it('writes a new child\'s gender only once the POST has produced a server id', async () => {
      s().saveChild({ first: 'Nova', last: 'O', birth: NOW - 30 * 86400000, gender: 'boy' });
      const created = s().children[s().children.length - 1];
      expect(created.gender).toBe('boy');
      // The note references the child by SERVER id, so nothing is written until
      // pushChildToServer resolves with one (777 in the repository mock).
      await flush();
      expect(h.genderWritten).toEqual([{ childServerId: 777, gender: 'boy' }]);
    });

    it('does not write a gender note for a child created with no gender', async () => {
      s().saveChild({ first: 'Nova', last: 'O', birth: NOW - 30 * 86400000 });
      await flush();
      expect(h.genderWritten).toHaveLength(0);
    });

    it('a failed gender write leaves the local value in place (offline-first)', async () => {
      h.genderWriteFails = true;
      useAppStore.setState({ children: [SYNCED_C1] });
      s().openEditChild('c1');
      s().saveChild({ first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, gender: 'girl' });
      await flush();
      expect(s().children[0].gender).toBe('girl');
    });

    it('replays a queued offline gender change through the child update op', async () => {
      useAppStore.setState({
        offline: true,
        children: [{ ...SYNCED_C1, gender: undefined }],
      });
      s().openEditChild('c1');
      s().saveChild({ first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, gender: 'boy' });
      await flush();
      // Offline: one child-update op carrying the gender, no direct write.
      expect(h.genderWritten).toHaveLength(0);
      expect(h.pendingOps).toContainEqual({
        op: 'update',
        entity: 'child',
        payload: expect.objectContaining({ gender: 'boy' }),
      });

      useAppStore.setState({ offline: false });
      await s().flushPendingOps();
      expect(h.genderWritten).toEqual([{ childServerId: 501, gender: 'boy' }]);
    });

    it('re-queues the child op when the gender write fails, so the change is retried', async () => {
      h.pendingOps = [
        { op: 'update', entity: 'child', payload: { ...SYNCED_C1, gender: 'girl' } },
      ];
      h.genderWriteFails = true;
      await s().flushPendingOps();
      // A retryable failure leaves the op on the log: nothing removes it.
      expect(h.pendingOps).toHaveLength(1);
    });
  });

  it('offline edit of a synced child records an update pending op instead of pushing', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
    });
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });

    expect(s().children[0].last).toBe('Updated'); // still applied locally
    await flush();
    expect(h.childUpdated).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toHaveLength(1);
    expect(h.pendingOps[0]).toMatchObject({ op: 'update', entity: 'child' });
    expect((h.pendingOps[0] as { payload: Child }).payload.id).toBe('c1');
  });

  it('online edit of a synced child does NOT record a pending op', async () => {
    useAppStore.setState({
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
    });
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });
    await flush();
    expect(h.childUpdated).toHaveLength(1);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('offline edit of a NOT-yet-synced child (no serverId) records no pending op (its create is still pending)', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'localOnly', first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
    });
    s().openEditChild('localOnly');
    s().saveChild({ first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });
    await flush();
    expect(h.pendingOps).toHaveLength(0);
  });

  it('saveChild create with a photo sets picture optimistically, then swaps in the server URL', async () => {
    const photo = { uri: 'file:///tmp/pick.jpg', name: 'pick.jpg', type: 'image/jpeg' };
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, photo: { kind: 'set', photo } });

    expect(s().children[1].picture).toBe('file:///tmp/pick.jpg'); // optimistic local URI
    await flush();
    expect(h.childPushChange[0]).toEqual({ kind: 'set', photo });
    expect(s().children[1].picture).toBe(SERVER_PIC); // swapped to durable URL
  });

  it('saveChild edit with a photo swaps the local URI for the server URL', async () => {
    const photo = { uri: 'file:///tmp/e.jpg', name: 'e.jpg', type: 'image/jpeg' };
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: '', birth: NOW, photo: { kind: 'set', photo } });

    expect(s().children[0].picture).toBe('file:///tmp/e.jpg');
    await flush();
    expect(h.childUpdateChange[0]).toEqual({ kind: 'set', photo });
    expect(s().children[0].picture).toBe(SERVER_PIC);
  });

  it('saveChild edit with remove clears the picture and passes a remove change', async () => {
    useAppStore.setState((st) => ({ children: st.children.map((c) => ({ ...c, picture: 'file:///old.jpg' })) }));
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: '', birth: NOW, photo: { kind: 'remove' } });

    expect(s().children[0].picture).toBeNull();
    await flush();
    expect(h.childUpdateChange[0]).toEqual({ kind: 'remove' });
  });

  it('saveChild edit with no photo change leaves the existing picture untouched', async () => {
    useAppStore.setState((st) => ({ children: st.children.map((c) => ({ ...c, picture: 'file:///keep.jpg' })) }));
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: '', birth: NOW });

    expect(s().children[0].picture).toBe('file:///keep.jpg');
    await flush();
    expect(h.childUpdateChange[0]).toEqual({ kind: 'none' });
  });

  it('demo mode: create stays local, no server push', async () => {
    useAppStore.setState({ connection: { mode: 'local' } });
    s().openAddChild();
    s().saveChild({ first: 'Demo', last: '', birth: NOW });
    expect(s().children).toHaveLength(2);
    await flush();
    expect(h.childPushed).toHaveLength(0);
  });

  it('offline: create stays local, no server push', async () => {
    useAppStore.setState({ offline: true });
    s().openAddChild();
    s().saveChild({ first: 'Offline', last: '', birth: NOW });
    expect(s().children).toHaveLength(2);
    await flush();
    expect(h.childPushed).toHaveLength(0);
  });

  it('closeChildSheet clears both childSheet and editingChildId', () => {
    s().openEditChild('c1');
    s().closeChildSheet();
    expect(s().childSheet).toBe(false);
    expect(s().editingChildId).toBeNull();
  });
});

describe('deleteChild', () => {
  // A server-backed child in the new model carries a numeric `serverId` (the
  // stable local `id` is server-independent). Mirror that: `serverId = Number(id)`.
  const serverChild = (id: string, first: string) => ({
    id,
    serverId: Number(id),
    first,
    last: '',
    birth: NOW,
    color: '#fff',
    slug: first.toLowerCase(),
  });
  const feeding = (id: string, childId: string): Entry => ({
    id,
    serverId: 1,
    childId,
    type: 'feeding',
    start: NOW - 20 * M,
    end: NOW,
    feedType: 'breast',
    method: 'left',
    amount: null,
    tags: [],
  });
  const timer = (id: string, childId: string): Timer => ({ id, childId, activity: 'sleep', name: 'Sleep', start: NOW, saveAs: 'sleep' });

  it('local-only child: deletes in memory only, no server call', async () => {
    // the seeded child 'c1' has no serverId => local-only
    s().openEditChild('c1');
    s().deleteChild('c1');
    expect(s().children).toHaveLength(0);
    expect(s().selectedChildId).toBe('');
    expect(s().childSheet).toBe(false);
    expect(s().editingChildId).toBeNull();
    expect(s().toast).toBe('Mira deleted');
    await flush();
    expect(h.childDeleted).toHaveLength(0);
  });

  /** Point the shared `loadFromServer` mock at a server view that still holds
   *  `survivors`. The default mock reports an EMPTY server, which
   *  `reconcileChildren` correctly reads as "every child was deleted
   *  server-side" and drops, which is not the situation these tests are about. Needed
   *  now that a successful delete refetches (see the re-point tests below). */
  const serverViewOf = (...survivors: ReturnType<typeof serverChild>[]) =>
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: survivors.map((c) => ({ ...c, id: String(c.serverId) })),
      entries: [],
      timers: [],
      selectedChildId: String(survivors[0]?.serverId ?? ''),
      lastFeed: {},
      measurements: [],
    } as any);

  it('server-backed selected child while online: server delete + purge + re-point', async () => {
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
      entries: [feeding('feeding-1', '5')],
      measurements: [{ id: 'weight-1', serverId: 2, childId: '5', kind: 'weight', value: 5, date: NOW }],
      timers: [timer('t1', '5')],
      insightsLoaded: true,
      insightsEntries: [{ id: 'x' } as any],
      insightsError: true,
    });
    serverViewOf(serverChild('6', 'Nova'));
    void s().deleteChild('5');
    expect(s().children.map((c) => c.id)).toEqual(['6']);
    expect(s().selectedChildId).toBe('6'); // re-pointed to the surviving child
    expect(s().entries).toHaveLength(0); // deleted child's entries purged
    expect(s().measurements).toHaveLength(0); // measurements purged
    expect(s().timers).toHaveLength(0); // running timers cleared
    expect(s().insightsLoaded).toBe(false);
    expect(s().insightsEntries).toEqual([]);
    expect(s().insightsError).toBe(false);
    expect(s().childSheet).toBe(false);
    expect(s().showChildSwitcher).toBe(false);
    await flush();
    // The whole child is handed to the server delete: it is keyed by slug, and
    // only the child carries that.
    expect(h.childDeleted).toEqual([expect.objectContaining({ serverId: 5, slug: 'mira' })]);
    expect(s().toast).toBe('Mira deleted');
  });

  it('deleting the last remaining child leaves selectedChildId empty', async () => {
    useAppStore.setState({ children: [serverChild('5', 'Mira')], selectedChildId: '5' });
    void s().deleteChild('5');
    expect(s().children).toHaveLength(0);
    expect(s().selectedChildId).toBe('');
    await flush();
    expect(h.childDeleted).toEqual([expect.objectContaining({ serverId: 5 })]);
  });

  it('deleting a non-selected child leaves selection + loaded data intact', async () => {
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
      entries: [feeding('feeding-1', '5')],
      timers: [timer('t1', '5')],
    });
    void s().deleteChild('6');
    expect(s().children.map((c) => c.id)).toEqual(['5']);
    expect(s().selectedChildId).toBe('5'); // unchanged
    expect(s().entries).toHaveLength(1); // selected child's data untouched
    expect(s().timers).toHaveLength(1); // and their running timer keeps running
    await flush();
    expect(h.childDeleted).toEqual([expect.objectContaining({ serverId: 6 })]);
  });

  it("deleting the selected child leaves a sibling's timer running", async () => {
    // The wipe used to be unconditional inside the re-point branch, so deleting
    // one child stopped every child's timers. A timer belongs to whoever started
    // it, and the sibling is still here.
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
      timers: [timer('t1', '5'), timer('t2', '6')],
    });
    serverViewOf(serverChild('6', 'Nova'));

    void s().deleteChild('5');

    expect(s().timers.map((t) => t.id)).toEqual(['t2']);
    await flush();
  });

  it("deleting a NON-selected child stops that child's orphaned timers", async () => {
    // The second bug this filter fixes: the purge used to run only when the
    // deleted child was the selected one, so a non-selected child's timers ran
    // on forever with no owner and no surface to stop them from.
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
      timers: [timer('t1', '5'), timer('t2', '6')],
    });

    void s().deleteChild('6');

    expect(s().timers.map((t) => t.id)).toEqual(['t1']);
    await flush();
  });

  it('keeps a still-unstamped timer, which belongs to no deleted child', () => {
    // `t.childId !== id` is true for `undefined`, deliberately: a timer hydrate
    // could not attribute is not evidence that it was the deleted child's, and
    // `stopTimer` can still resolve it.
    const legacy: Timer = { id: 't-legacy', activity: 'sleep', name: 'Sleep', start: NOW, saveAs: 'sleep' };
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
      timers: [legacy, timer('t1', '5')],
    });

    void s().deleteChild('5');

    expect(s().timers).toEqual([legacy]);
  });

  it('local mode: deletes in memory only, no server call', async () => {
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [serverChild('5', 'Mira')],
      selectedChildId: '5',
    });
    void s().deleteChild('5');
    expect(s().children).toHaveLength(0);
    await flush();
    expect(h.childDeleted).toHaveLength(0);
  });

  it('server-backed child while offline: in-memory only, never an undurable server delete', async () => {
    useAppStore.setState({
      offline: true,
      children: [serverChild('5', 'Mira')],
      selectedChildId: '5',
    });
    void s().deleteChild('5');
    expect(s().children).toHaveLength(0);
    await flush();
    expect(h.childDeleted).toHaveLength(0);
  });

  // refresh() only bails on the simulateOffline override, not the real offline
  // flag, so an ungated refetch here would fire a doomed fetch while offline.
  // Today's server-backed offline delete is UI-blocked, but a local-only child
  // deleted offline reaches this line, and relaxing that UI block is a named
  // follow-up: without the gate, a delete that merely MIGHT be resurrected
  // later becomes one that is resurrected immediately.
  it('deleting while offline never fires the post-delete refetch', async () => {
    vi.mocked(loadFromServer).mockClear();
    useAppStore.setState({
      offline: true,
      children: [
        { id: 'local1', first: 'Mira', last: '', birth: NOW, color: '#fff' }, // never pushed
        serverChild('6', 'Nova'),
      ],
      selectedChildId: 'local1',
    });

    void s().deleteChild('local1');
    await flush();

    expect(s().selectedChildId).toBe('6'); // still re-points
    expect(loadFromServer).not.toHaveBeenCalled();
  });

  // The reported symptom: the child vanished, a success toast appeared, and the
  // child came back on the next refresh. The DELETE had 404'd all along and the
  // error was swallowed by a fire-and-forget `.catch(() => {})`.
  it('a failed server delete restores the child instead of claiming success', async () => {
    h.childDeleteFails = true;
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
      entries: [feeding('feeding-1', '5')],
      measurements: [{ id: 'weight-1', serverId: 2, childId: '5', kind: 'weight', value: 5, date: NOW }],
    });

    await s().deleteChild('5');

    expect(s().children.map((c) => c.id)).toEqual(['5', '6']); // back, in its old slot
    expect(s().selectedChildId).toBe('5'); // selection restored too
    expect(s().entries.map((e) => e.id)).toEqual(['feeding-1']);
    expect(s().measurements).toHaveLength(1);
    expect(s().toast).not.toBe('Mira deleted'); // never claims a delete that did not happen
    expect(s().toast).toBe('Could not delete Mira');
  });

  it('a failed server delete keeps entries written during the round trip', async () => {
    // The restore merges rather than snapping state back wholesale, so a write
    // that landed while the DELETE was in flight is not lost.
    h.childDeleteFails = true;
    useAppStore.setState({
      children: [serverChild('5', 'Mira')],
      selectedChildId: '5',
      entries: [feeding('feeding-1', '5')],
    });

    const pending = s().deleteChild('5');
    useAppStore.setState({ entries: [...s().entries, feeding('feeding-mid', '6')] });
    await pending;

    expect(s().entries.map((e) => e.id).sort()).toEqual(['feeding-1', 'feeding-mid']);
  });

  // Item 1 scoped every history surface to the selected child and put the
  // refetch inside selectChild. deleteChild re-points the selection WITHOUT
  // going through selectChild, so without this the surviving child's History,
  // Growth and dashboard strip would sit empty until something else refreshed.
  it('re-pointing after a delete loads the surviving child, and only after the DELETE lands', async () => {
    vi.mocked(loadFromServer).mockClear();
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
    });
    serverViewOf(serverChild('6', 'Nova'));

    void s().deleteChild('5');
    // Ordering: nothing may be fetched while the DELETE is in flight, or
    // reconcileChildren would re-add the child being deleted.
    expect(loadFromServer).not.toHaveBeenCalled();

    await flush();
    expect(loadFromServer).toHaveBeenCalledTimes(1);
    // Fetched for the SURVIVING child's server id, not the deleted one's.
    expect(vi.mocked(loadFromServer).mock.calls[0][1]).toBe(6);
    expect(s().children.map((c) => c.id)).toEqual(['6']);
  });

  it('deleting a non-selected child does not refetch: the selection did not move', async () => {
    vi.mocked(loadFromServer).mockClear();
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
    });

    void s().deleteChild('6');
    await flush();

    expect(loadFromServer).not.toHaveBeenCalled();
  });

  // reconcileChildren re-adds a child it cannot match locally under the
  // SERVER-derived id (String(serverId)), not the local one. So a refresh that
  // completes while the DELETE is in flight puts the child back as '5', and a
  // rollback guard that only looks for the local id 'c1' would splice a SECOND
  // copy in beside it: same serverId, two ids, and every later rename or delete
  // acts on whichever one the UI happens to hand over.
  it('a failed server delete does not duplicate a child a mid-flight refresh already restored', async () => {
    h.childDeleteFails = true;
    useAppStore.setState({
      children: [{ ...serverChild('5', 'Mira'), id: 'c1' }, serverChild('6', 'Nova')],
      selectedChildId: 'c1',
    });

    const pending = s().deleteChild('c1');
    // A refresh lands mid-flight and reconciles the still-present server child
    // back in under its server-derived id.
    useAppStore.setState({ children: [serverChild('5', 'Mira'), ...s().children] });
    await pending;

    expect(s().children.filter((c) => c.serverId === 5)).toHaveLength(1);
    expect(s().children.map((c) => c.serverId).sort()).toEqual([5, 6]);
  });

  // deleteChild wipes the running timers when the deleted child was selected,
  // and the persistence subscription writes that empty array straight to the
  // device. A server-backed timer would come back on the next refresh, but one
  // started offline (serverId == null) exists nowhere else and is gone for good.
  it('a failed server delete restores the running timers it cleared', async () => {
    h.childDeleteFails = true;
    const localTimer = timer('t-local', '5');
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
      timers: [localTimer],
    });

    await s().deleteChild('5');

    expect(s().timers).toEqual([localTimer]);
  });

  it('a failed server delete does not refetch, so the restore is not clobbered', async () => {
    h.childDeleteFails = true;
    vi.mocked(loadFromServer).mockClear();
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
    });

    await s().deleteChild('5');
    await flush();

    expect(loadFromServer).not.toHaveBeenCalled();
    expect(s().children.map((c) => c.id)).toEqual(['5', '6']);
  });
});

describe('adopt sheet open/close (mirrors openAddChild/closeChildSheet)', () => {
  it('openAdopt opens the sheet', () => {
    expect(s().adoptSheet).toBe(false);
    s().openAdopt();
    expect(s().adoptSheet).toBe(true);
  });

  it('closeAdopt closes the sheet', () => {
    s().openAdopt();
    expect(s().adoptSheet).toBe(true);
    s().closeAdopt();
    expect(s().adoptSheet).toBe(false);
  });
});

describe('local mode: durable entityStore (empty start, no fake seed)', () => {
  it('enterLocal sets connection to local mode, connects, and persists it — without seeding fake children', async () => {
    useAppStore.setState({ connection: null, connected: false, children: [], entries: [] });
    vi.mocked(loadEntities).mockResolvedValueOnce(null);
    await s().enterLocal();
    expect(s().connection).toEqual({ mode: 'local' });
    expect(s().connected).toBe(true);
    expect(s().children).toEqual([]); // no demo seed
    expect(s().entries).toEqual([]);
    expect(saveConnection).toHaveBeenCalledWith({ mode: 'local' });
  });

  it('enterLocal loads persisted entities when a prior local session left some', async () => {
    const savedChild = { id: 'p1', first: 'Persisted', last: '', birth: NOW, color: '#000' };
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [savedChild],
      entries: [],
      measurements: [],
      selectedChildId: 'p1',
      lastFeed: { p1: { feedType: 'formula', method: 'bottle' } },
      legacyLastFeed: null,
    });
    await s().enterLocal();
    expect(s().children).toEqual([savedChild]); // restored, not the demo seed
    expect(s().selectedChildId).toBe('p1');
    expect(s().lastFeed).toEqual({ p1: { feedType: 'formula', method: 'bottle' } });
  });

  it('local hydrate loads persisted entities instead of seeding fake ones', async () => {
    const savedChild = { id: 'h1', first: 'Hydrated', last: '', birth: NOW, color: '#000' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [savedChild],
      entries: [],
      measurements: [],
      selectedChildId: 'h1',
      lastFeed: {},
      legacyLastFeed: null,
    });
    await s().hydrate();
    expect(s().connected).toBe(true);
    expect(s().children).toEqual([savedChild]);
    expect(s().selectedChildId).toBe('h1');
  });

  it('local hydrate starts empty when nothing was ever persisted', async () => {
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    vi.mocked(loadEntities).mockResolvedValueOnce(null);
    await s().hydrate();
    expect(s().children).toEqual([]);
    expect(s().entries).toEqual([]);
    expect(s().measurements).toEqual([]);
    expect(s().selectedChildId).toBe('');
  });

  it('the entity subscribe persists children on change (mirrors the timers subscribe)', () => {
    vi.mocked(saveChildren).mockClear();
    useAppStore.setState((st) => ({ children: [...st.children, { id: 'newc', first: 'New', last: '', birth: NOW, color: '#111' }] }));
    expect(saveChildren).toHaveBeenCalledWith(s().children);
  });

  it('disconnect clears the durable entity store', () => {
    s().disconnect();
    expect(clearEntities).toHaveBeenCalled();
  });

  // Finding 1 (merge blocker): without this, offline edit/delete ops queued
  // against one server's serverIds would survive a disconnect and replay
  // against whatever record holds those numeric ids on the NEXT server.
  it('disconnect clears pendingOps so a stale op cannot replay against a different server', () => {
    s().disconnect();
    expect(clearPendingOps).toHaveBeenCalled();
  });
});

describe('connectivity', () => {
  it('losing the network forces offline; regaining clears it', () => {
    s().setNetworkOnline(false);
    expect(s().offline).toBe(true);
    s().setNetworkOnline(true);
    expect(s().offline).toBe(false);
  });

  it('simulate-offline overrides even when the network is up', () => {
    s().setNetworkOnline(true);
    s().toggleOffline();
    expect(s().offline).toBe(true);
    expect(s().simulateOffline).toBe(true);
    s().toggleOffline();
    expect(s().offline).toBe(false);
  });
});

describe('refresh / reconnect', () => {
  it('clears a stuck offline flag when the server is reachable again', async () => {
    useAppStore.setState({ offline: true, networkOnline: true });
    await s().refresh();
    expect(s().offline).toBe(false);
    expect(s().networkOnline).toBe(true);
  });

  it('marks offline when the server is unreachable', async () => {
    useAppStore.setState({ offline: false });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await s().refresh();
    expect(s().offline).toBe(true);
  });

  it('preserves local running timers across a refresh (server has none)', async () => {
    const timer: Timer = { id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 5 * M, saveAs: 'sleep' };
    useAppStore.setState({ timers: [timer], offline: true });
    await s().refresh();
    expect(s().timers).toEqual([timer]);
  });

  it('keeps an existing child avatar tint across a refresh, end to end', async () => {
    // The unit case lives with `reconcileChildren`; this is the whole path,
    // store to store. A deliberately non-first tint, so a re-derived one would
    // come back as CHILD_COLORS[0] and fail rather than coincide.
    useAppStore.setState({
      children: [{ id: 'localA', serverId: 501, first: 'Mira', last: 'O', birth: NOW, color: CHILD_COLORS[3] }],
      selectedChildId: 'localA',
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '501', serverId: 501, first: 'Mira', last: 'O', birth: NOW }],
      entries: [],
      timers: [],
      selectedChildId: '501',
      lastFeed: {},
      measurements: [],
    });

    await s().refresh();

    expect(s().children).toHaveLength(1);
    expect(s().children[0].id).toBe('localA');
    expect(s().children[0].color).toBe(CHILD_COLORS[3]);
  });

  it('keeps the selected child when it still exists after refresh', async () => {
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [
        { id: 'c0', first: 'A', last: '', birth: NOW },
        { id: 'c1', first: 'Mira', last: 'O', birth: NOW },
      ],
      entries: [],
      timers: [],
      selectedChildId: 'c0',
      lastFeed: {},
      measurements: [],
    });
    useAppStore.setState({ selectedChildId: 'c1' });
    await s().refresh();
    expect(s().selectedChildId).toBe('c1'); // not reset to the server's first child
  });

  it('flushes queued writes after reconnecting', async () => {
    h.q = [{ id: 'x', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }];
    useAppStore.setState({ offline: true, queueCount: 1 });
    // refresh() replaces `children` wholesale with the server's list (merged
    // with any still-unsynced locals), so the synced child the queued flush
    // needs has to come back from loadFromServer, not from local setState.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [SYNCED_C1],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().refresh();
    await flush();
    expect(h.pushed).toHaveLength(1);
    expect(s().queueCount).toBe(0);
  });

  it('does not clear a manual simulate-offline override', async () => {
    vi.mocked(loadFromServer).mockClear();
    useAppStore.setState({ simulateOffline: true, offline: true });
    await s().refresh();
    expect(s().offline).toBe(true);
    expect(loadFromServer).not.toHaveBeenCalled();
  });

  it('is a no-op in demo mode', async () => {
    vi.mocked(loadFromServer).mockClear();
    useAppStore.setState({ connection: { mode: 'local' }, offline: false });
    await s().refresh();
    expect(loadFromServer).not.toHaveBeenCalled();
    expect(s().offline).toBe(false);
  });

  it('clears the connection when the token has expired (401/403)', async () => {
    vi.mocked(loadFromServer).mockRejectedValueOnce(new ApiError(401, 'Invalid token'));
    await s().refresh();
    expect(s().connection).toBeNull();
    expect(s().connected).toBe(false);
    expect(s().connectError).toBeTruthy();
  });

  it('resets profile state on session expiry (401/403) so a later loadProfile refetches', async () => {
    useAppStore.setState({
      profile: { username: 'alex' },
      profileLoaded: true,
      profileLoading: false,
      profileError: false,
    });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new ApiError(401, 'Invalid token'));
    await s().refresh();
    expect(s().profile).toBeNull();
    expect(s().profileLoaded).toBe(false);
    expect(s().profileError).toBe(false);
    expect(s().profileLoading).toBe(false);

    // A later loadProfile (e.g. after reconnecting) can refetch since
    // profileLoaded no longer blocks it.
    useAppStore.setState({ connection: { mode: 'server', serverUrl: 'http://x', token: 't2' } });
    await s().loadProfile();
    expect(loadProfileFromServer).toHaveBeenCalled();
    expect(s().profileLoaded).toBe(true);
  });

  it('keeps selectedChildId pointing at an offline-created child still visible after refresh (regression)', async () => {
    // Bug: refresh() used to check the server's child list only, so an
    // offline-created child (kept visible via mergeUnsynced) that's currently
    // selected would get silently deselected back to the server's first child.
    const localChild: Child = { id: 'localZ', first: 'Off', last: 'line', birth: NOW, color: '#abc' };
    useAppStore.setState({ children: [...s().children, localChild], selectedChildId: 'localZ' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW }],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().refresh();
    expect(s().selectedChildId).toBe('localZ'); // not reset to the server's first child
    expect(s().children.map((c) => c.id)).toContain('localZ');
  });

  it('keeps an in-memory serverId==null child (created offline) across a refresh whose server data omits it', async () => {
    const localChild: Child = { id: 'localX', first: 'Off', last: 'line', birth: NOW, color: '#abc' };
    useAppStore.setState({ children: [...s().children, localChild] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW }],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().refresh();
    expect(s().children.map((c) => c.id)).toEqual(['localX', 'c1']);
  });

  it('keeps an in-memory serverId==null measurement (created offline) across a refresh whose server data omits it', async () => {
    const localMeasurement: Measurement = { id: 'localM', childId: 'c1', kind: 'weight', value: 4.2, date: NOW };
    useAppStore.setState({ measurements: [localMeasurement] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW }],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });
    await s().refresh();
    expect(s().measurements.map((m) => m.id)).toEqual(['localM']);
  });

  it('an entry created before its child was pushed still resolves to that child after a refresh', async () => {
    // Server mode, online. Create a child locally, log an entry against it,
    // let the child push (stamping serverId without rewriting id), then
    // refresh with a stubbed loadFromServer that echoes the pushed child back
    // (matched by serverId) plus the entry that referenced its local id. The
    // entry must still point at a child that exists. This is the regression
    // test for the whole orphaning class the id-rewrite bug caused.
    useAppStore.setState({ children: [], entries: [], selectedChildId: '' });

    s().saveChild({ first: 'Ada', last: '', birth: NOW - 30 * 86400000 });
    const localId = s().children[0].id;

    // Let the push settle so serverId is stamped.
    await flush();

    const pushedChild = s().children.find((c) => c.id === localId);
    expect(pushedChild?.id).toBe(localId); // id must NOT have been rewritten
    expect(pushedChild?.serverId).toBe(777);

    // An entry logged against the local id, the way commitWrite always writes it.
    useAppStore.setState((st) => ({
      entries: [...st.entries, { id: 'e1', childId: localId, type: 'note', time: NOW, text: 'hi', tags: [] } as Entry],
    }));

    // A real server load never knows the local id: it writes the SERVER child
    // id verbatim (see `listFeedings` et al in src/api/client.ts), same as
    // `selectedChildId` below.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '777', serverId: 777, first: 'Ada', last: '', birth: NOW - 30 * 86400000 }],
      entries: [{ id: 'e1', childId: '777', type: 'note', time: NOW, text: 'hi', tags: [] } as Entry],
      timers: [],
      selectedChildId: '777',
      lastFeed: {},
      measurements: [],
    });
    await s().refresh();

    const entry = s().entries.find((e) => e.id === 'e1');
    const owner = s().children.find((c) => c.id === entry?.childId);
    expect(owner).toBeDefined(); // the entry is not orphaned
    expect(owner?.id).toBe(localId);
    expect(entry?.childId).toBe(localId); // the server id was remapped to the local id
  });

  // Coverage gap: entries (above) and timers each have an integration-level
  // test proving `refresh` wires remapChildIds's REMAPPED collection into
  // its `set()`, not `data.measurements`/`data.entries`/`data.timers`
  // verbatim. Measurements previously only had a direct unit test of the
  // `remapChildIds` helper (below): that exercises the helper in isolation
  // and would not catch a copy-paste slip in `refresh`'s (or `hydrate`'s /
  // `adopt`'s) own measurements block, e.g. wiring `data.measurements`
  // straight into `set()` instead of `remappedMeasurements`.
  it('a measurement created before its child was pushed still resolves to that child after a refresh', async () => {
    useAppStore.setState({ children: [], measurements: [], selectedChildId: '' });

    s().saveChild({ first: 'Ada', last: '', birth: NOW - 30 * 86400000 });
    const localId = s().children[0].id;

    // Let the push settle so serverId is stamped.
    await flush();

    const pushedChild = s().children.find((c) => c.id === localId);
    expect(pushedChild?.id).toBe(localId); // id must NOT have been rewritten
    expect(pushedChild?.serverId).toBe(777);

    // A real server load never knows the local id: it writes the SERVER
    // child id verbatim (see `listMeasurements` in src/api/client.ts), same
    // as the entries/timers case above.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '777', serverId: 777, first: 'Ada', last: '', birth: NOW - 30 * 86400000 }],
      entries: [],
      timers: [],
      selectedChildId: '777',
      lastFeed: {},
      measurements: [{ id: 'm1', childId: '777', kind: 'weight', value: 6.1, date: NOW }],
    });
    await s().refresh();

    const measurement = s().measurements.find((m) => m.id === 'm1');
    const owner = s().children.find((c) => c.id === measurement?.childId);
    expect(owner).toBeDefined(); // the measurement is not orphaned
    expect(owner?.id).toBe(localId);
    expect(measurement?.childId).toBe(localId); // the server id was remapped to the local id
  });

  it('remapChildIds rewrites a server-sourced childId to the matching local child id, leaving unresolved ones as-is', () => {
    const children: Child[] = [
      { id: 'local-abc', serverId: 777, first: 'Ada', last: '', birth: NOW, color: '#fff' },
    ];
    const entries = [
      { id: 'e1', childId: '777', type: 'note', time: NOW, text: 'hi', tags: [] } as Entry,
      // No child in `children` has serverId 999: it must be left untouched, not dropped.
      { id: 'e2', childId: '999', type: 'note', time: NOW, text: 'orphan-ish', tags: [] } as Entry,
    ];
    const measurements: Measurement[] = [{ id: 'm1', childId: '777', kind: 'weight', value: 4.2, date: NOW }];

    expect(remapChildIds(entries, children).map((e) => e.childId)).toEqual(['local-abc', '999']);
    expect(remapChildIds(measurements, children).map((m) => m.childId)).toEqual(['local-abc']);
  });

  it('selectedChildId still points at a real child after a push and a refresh', async () => {
    useAppStore.setState({ children: [], selectedChildId: '' });

    s().saveChild({ first: 'Ada', last: '', birth: NOW - 30 * 86400000 });
    const localId = s().children[0].id;
    expect(s().selectedChildId).toBe(localId);

    await flush();

    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '777', serverId: 777, first: 'Ada', last: '', birth: NOW - 30 * 86400000 }],
      entries: [],
      timers: [],
      selectedChildId: '777',
      lastFeed: {},
      measurements: [],
    });
    await s().refresh();

    const sel = s().selectedChildId;
    expect(s().children.some((c) => c.id === sel)).toBe(true);
    expect(sel).toBe(localId); // selection follows the stable id, not the server id
  });
});

// F8: connect() used to take the server load wholesale (`...data`), re-keying
// every child to its server-derived id. After a session expiry (refresh's
// 401 branch clears the connection; the entity store still holds the old
// children under local ids + serverIds), reconnecting through connect()
// destroyed the local-id mapping: the persistence subscription wrote the
// server-shaped list over the entity store, and a queued entry referencing
// an adopt-origin LOCAL child id could never resolve (`childServerIdFor`
// misses), so it sat in the queue failing forever. Local-only running timers
// and unsynced measurements were dropped the same wholesale way. connect()
// now routes through the same `applyServerLoad` pipeline as refresh().
describe('connect() reconciles the server load with local data (session-expiry reconnect)', () => {
  it('a post-expiry reconnect keeps local child ids from the entity store, so a queued entry still resolves and flushes', async () => {
    // Post-401 cold-start shape: no connection, memory empty, the entity
    // store still holding the adopt-origin child under its LOCAL id, and a
    // queued entry referencing that id. The stored data came from THIS
    // server (the origin matches), which is what licenses the merge.
    h.entityOrigin = 'http://x';
    const queued: Entry = { id: 'qx', childId: 'child1712-abc', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] };
    h.q = [queued];
    useAppStore.setState({
      connection: null,
      connected: false,
      children: [],
      entries: [],
      measurements: [],
      selectedChildId: '',
      queueCount: 1,
      queuedIds: ['qx'],
    });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [{ id: 'child1712-abc', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
      entries: [],
      measurements: [{ id: 'mLocal', childId: 'child1712-abc', kind: 'weight', value: 5.1, date: NOW }],
      selectedChildId: 'child1712-abc',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '501', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000 }],
      entries: [],
      timers: [],
      selectedChildId: '501',
      lastFeed: {},
      measurements: [],
    });

    await s().connect('http://x', 't2');
    await flush(); // let the post-connect flush trio settle

    expect(s().connected).toBe(true);
    expect(s().connecting).toBe(false);
    // The child kept its LOCAL id (reconciled by serverId, not replaced).
    expect(s().children.map((c) => c.id)).toEqual(['child1712-abc']);
    expect(s().selectedChildId).toBe('child1712-abc');
    expectSelectionNamesARealChild();
    // The queued entry stayed visible AND flushed: its local childId resolved
    // to serverId 501 through the kept child. The old wholesale replace left
    // `childServerIdFor` missing forever, so nothing ever pushed.
    expect(s().entries.map((e) => e.id)).toContain('qx');
    expect(h.pushed).toHaveLength(1);
    expect(h.q).toHaveLength(0);
    // The unsynced measurement survived the reconnect too.
    expect(s().measurements.map((m) => m.id)).toContain('mLocal');
  });

  it('a running local-only timer (serverId == null) survives connect even when the server answers an empty timers list', async () => {
    h.entityOrigin = 'http://x'; // same-server reconnect: the merge is licensed
    const running: Timer = { id: 't-local', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: NOW - 5 * M, childId: 'c1' };
    // Warm post-expiry state: connection cleared, memory (and the on-device
    // timer copy, via the persistence subscribe) still holds the timer.
    useAppStore.setState({ connection: null, connected: false, timers: [running] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000 }],
      entries: [],
      // A real empty answer, NOT null: F7's null-guard never fires here, and
      // the old wholesale spread dropped the running timer on exactly this
      // shape.
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });

    await s().connect('http://x', 't2');
    await flush();

    // Assert on id only: the post-connect flushUnsynced may already have
    // stamped a serverId on the kept timer (its child is synced).
    expect(s().timers).toHaveLength(1);
    expect(s().timers[0]).toMatchObject({ id: 't-local' });
  });

  it('a fresh connect with no local data takes the server load as-is (children under server-derived ids, server selection)', async () => {
    useAppStore.setState({
      connection: null,
      connected: false,
      children: [],
      entries: [],
      measurements: [],
      selectedChildId: '',
      timers: [],
    });
    // The entity store is empty too (the loadEntities mock default is null).
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '7', serverId: 7, first: 'Nova', last: 'O', birth: NOW - 10 * 86400000 }],
      entries: [{ id: 'se1', serverId: 21, childId: '7', type: 'note', time: NOW, text: 'hi', tags: [] } as Entry],
      timers: [{ id: 'tsrv3', serverId: 3, childId: '7', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: NOW - M }],
      selectedChildId: '7',
      lastFeed: { '7': { feedType: 'formula', method: 'bottle' } },
      measurements: [{ id: 'sm1', serverId: 11, childId: '7', kind: 'weight', value: 4.4, date: NOW }],
    });

    await s().connect('http://x', 't');
    await flush();

    expect(s().children.map((c) => c.id)).toEqual(['7']);
    expect(s().selectedChildId).toBe('7');
    expect(s().entries.map((e) => e.id)).toEqual(['se1']);
    expect(s().measurements.map((m) => m.id)).toEqual(['sm1']);
    expect(s().timers.map((t) => t.id)).toEqual(['tsrv3']);
    expect(s().lastFeed).toEqual({ '7': { feedType: 'formula', method: 'bottle' } });
    expectSelectionNamesARealChild();
    // connect stamps the origin, so the entity store's new contents are
    // labeled with the server they came from (and a pre-origin install
    // self-heals here: its NEXT expiry-reconnect gets the merge).
    expect(h.entityOrigin).toBe('http://x');
  });

  it('connecting to a DIFFERENT server than the stored data came from takes the server load wholesale (no cross-server merge)', async () => {
    // Same post-expiry shape as the merge test above, but the stored data
    // belongs to another server. Numeric server ids collide across servers
    // (child 501 exists on both), so a merge here would graft one family's
    // local records onto another family's children; the origin gate must
    // force the pre-reconcile wholesale behavior instead.
    h.entityOrigin = 'https://old.lan';
    const queued: Entry = { id: 'qx', childId: 'child1712-abc', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] };
    h.q = [queued];
    useAppStore.setState({
      connection: null,
      connected: false,
      children: [],
      entries: [],
      measurements: [],
      selectedChildId: '',
      queueCount: 1,
      queuedIds: ['qx'],
    });
    // Not `mockResolvedValueOnce`: the gate must not even need this read, and
    // a leftover one-shot value would leak into a later test's loadEntities.
    vi.mocked(loadEntities).mockResolvedValue({
      children: [{ id: 'child1712-abc', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
      entries: [],
      measurements: [],
      selectedChildId: 'child1712-abc',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '501', serverId: 501, first: 'Zoe', last: 'Q', birth: NOW - 30 * 86400000 }],
      entries: [],
      timers: [],
      selectedChildId: '501',
      lastFeed: {},
      measurements: [],
    });

    await s().connect('http://x', 't2');
    await flush();

    // Server-derived ids only: the old server's local id must not survive.
    expect(s().children.map((c) => c.id)).toEqual(['501']);
    expect(s().selectedChildId).toBe('501');
    expectSelectionNamesARealChild();
    // The other family's queued entry must NOT flush into this server's
    // children; it stays queued (visible in the queue view) instead.
    expect(h.pushed).toHaveLength(0);
    expect(h.q).toHaveLength(1);
    // The data now stored belongs to the new server: origin re-stamped.
    expect(h.entityOrigin).toBe('http://x');
  });

  it('in-memory children from another origin are not merged either (the gate sits ahead of both local sides)', async () => {
    // Warm shape: a 401 cleared the connection but left server A's children
    // in memory, serverIds and all. Connecting to server B, whose child list
    // reuses the same numeric id, must not keep A's local id (that is the
    // cross-server serverId collision graft).
    h.entityOrigin = 'https://old.lan';
    useAppStore.setState({
      connection: null,
      connected: false,
      children: [{ id: 'cA', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
      entries: [],
      measurements: [],
      selectedChildId: 'cA',
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '501', serverId: 501, first: 'Zoe', last: 'Q', birth: NOW - 30 * 86400000 }],
      entries: [],
      timers: [],
      selectedChildId: '501',
      lastFeed: {},
      measurements: [],
    });

    await s().connect('http://x', 't2');
    await flush();

    expect(s().children.map((c) => c.id)).toEqual(['501']);
    expect(s().selectedChildId).toBe('501');
    expectSelectionNamesARealChild();
  });

  it('enterLocal stamps the entity origin as local, so a later server connect cannot merge local-mode data by serverId', async () => {
    await s().enterLocal();
    expect(h.entityOrigin).toBe('local');
  });
});

describe('selectedChildId fallback resolves in local id space (regression: a server-space id used as a local-space fallback)', () => {
  it('refresh: a sibling deleted server-side re-points selectedChildId at a REMAINING local child, not a bare server id', async () => {
    // Repro from the branch review: two children created in Budkin
    // (childAAA/serverId 1, childBBB/serverId 2). The other parent deletes
    // childBBB in Baby Buddy's web UI, and Budkin refreshes with childBBB
    // still selected. `loadFromServer` (repository.ts) sets its own
    // `selectedChildId` to `children[0]?.id`, which is a SERVER id string:
    // that must be resolved back into local id space (via
    // `resolveSelectedChildId`), not compared against local ids directly.
    const childAAA: Child = { id: 'childAAA', serverId: 1, first: 'A', last: '', birth: NOW, color: '#fff' };
    const childBBB: Child = { id: 'childBBB', serverId: 2, first: 'B', last: '', birth: NOW, color: '#eee' };
    useAppStore.setState({ children: [childAAA, childBBB], selectedChildId: 'childBBB' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '1', serverId: 1, first: 'A', last: '', birth: NOW }], // childBBB gone
      entries: [],
      timers: [],
      selectedChildId: '1', // repository.ts: children[0]?.id, a SERVER id, not a local one
      lastFeed: {},
      measurements: [],
    });

    await s().refresh();

    expect(s().children.map((c) => c.id)).toEqual(['childAAA']);
    expect(s().selectedChildId).toBe('childAAA'); // resolved into local id space, not left as '1'
    expectSelectionNamesARealChild();
  });

  it('hydrate: a sibling deleted server-side re-points the persisted selection at a REMAINING local child', async () => {
    const childAAA: Child = { id: 'childAAA', serverId: 1, first: 'A', last: '', birth: NOW, color: '#fff' };
    const childBBB: Child = { id: 'childBBB', serverId: 2, first: 'B', last: '', birth: NOW, color: '#eee' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [childAAA, childBBB],
      entries: [],
      measurements: [],
      selectedChildId: 'childBBB',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '1', serverId: 1, first: 'A', last: '', birth: NOW }],
      entries: [],
      timers: [],
      selectedChildId: '1',
      lastFeed: {},
      measurements: [],
    });

    await s().hydrate();
    await flush(); // let the background refresh finish its merge

    expect(s().children.map((c) => c.id)).toEqual(['childAAA']);
    expect(s().selectedChildId).toBe('childAAA');
    expectSelectionNamesARealChild();
  });

  it('adopt: a stale selection not carried into the reconciled list falls back to a REAL local child, not a bare server id', async () => {
    const localChild: Child = { id: 'localM', first: 'M', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [localChild],
      // A selection naming no local child at all (e.g. left over from a
      // deleted child) forces adopt's post-upload reconciliation into its
      // fallback branch.
      selectedChildId: 'stale-not-a-real-child',
    });
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children.map((c) => ({ ...c, serverId: 501 })),
      entries: state.entries,
      measurements: state.measurements,
    }));
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '501', serverId: 501, first: 'M', last: '', birth: NOW }],
      entries: [],
      timers: [],
      selectedChildId: '501',
      lastFeed: {},
      measurements: [],
    });

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'done' });
    expect(s().children.map((c) => c.id)).toEqual(['localM']); // local id preserved
    expect(s().selectedChildId).toBe('localM');
    expectSelectionNamesARealChild();
  });
});

describe('history is scoped to the selected child', () => {
  const mira: Child = { id: 'localMira', serverId: 1, first: 'Mira', last: '', birth: NOW - 200 * 86400000, color: '#fff' };
  const theo: Child = { id: 'localTheo', serverId: 2, first: 'Theo', last: '', birth: NOW - 90 * 86400000, color: '#eee' };
  const expecting: Child = { id: 'localBean', first: 'Bean', last: '', birth: NOW + 60 * 86400000, color: '#ddd', expected: true };
  /** A record owned by Mira, the server's FIRST child, as it arrives from
   *  loadFromServer: `childId` is still in SERVER id space at that point. */
  const miraFeed: Entry = { id: 'f1', childId: '1', tags: [], type: 'feeding', start: NOW - 3600000, end: NOW - 3000000, feedType: 'breast', method: 'left', amount: null };
  const serverChildren = [
    { id: '1', serverId: 1, first: 'Mira', last: '', birth: NOW - 200 * 86400000, color: '#fff' },
    { id: '2', serverId: 2, first: 'Theo', last: '', birth: NOW - 90 * 86400000, color: '#eee' },
  ];

  it('refresh asks the server for the SELECTED child, not the server\'s first', async () => {
    useAppStore.setState({ children: [mira, theo], selectedChildId: 'localTheo' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: serverChildren,
      entries: [],
      timers: [],
      selectedChildId: '2',
      lastFeed: {},
      measurements: [],
    });

    await s().refresh();

    // The SERVER id of the locally selected child, bridged from local id space.
    expect(vi.mocked(loadFromServer).mock.calls.at(-1)?.[1]).toBe(2);
    expect(s().selectedChildId).toBe('localTheo');
    expectSelectionNamesARealChild();
  });

  it('hydrate asks the server for the persisted local selection', async () => {
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [mira, theo],
      entries: [],
      measurements: [],
      selectedChildId: 'localTheo',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: serverChildren,
      entries: [],
      timers: [],
      selectedChildId: '2',
      lastFeed: {},
      measurements: [],
    });

    await s().hydrate();

    expect(vi.mocked(loadFromServer).mock.calls.at(-1)?.[1]).toBe(2);
    expect(s().selectedChildId).toBe('localTheo');
  });

  it('hydrate passes no preferred child when the selection has never been pushed', async () => {
    // An expecting child has no serverId, so there is nothing the server could
    // match. loadFromServer must fall back to its own children[0], as before.
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [mira, expecting],
      entries: [],
      measurements: [],
      selectedChildId: 'localBean',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: serverChildren,
      entries: [],
      timers: [],
      selectedChildId: '1',
      lastFeed: {},
      measurements: [],
    });

    await s().hydrate();

    expect(vi.mocked(loadFromServer).mock.calls.at(-1)?.[1]).toBeNull();
  });

  it("refresh with an expecting child selected does not surface a sibling's entries", async () => {
    // The reported bug: for an expected child, the history shown was the
    // previous child's. An expecting child has no serverId, so loadFromServer
    // still falls back to the server's first child (Mira) and her records DO
    // land in the flat `entries` array. What must not happen is those records
    // being shown under the expecting child, which is what every history
    // surface reads via `entriesForChild`.
    useAppStore.setState({ children: [mira, expecting], selectedChildId: 'localBean', entries: [] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: serverChildren,
      entries: [miraFeed],
      timers: [],
      selectedChildId: '1',
      lastFeed: {},
      measurements: [],
    });

    await s().refresh();

    expect(s().selectedChildId).toBe('localBean');
    // The store still holds the sibling's record, remapped into local id space.
    expect(s().entries.find((e) => e.id === 'f1')?.childId).toBe('localMira');
    // But nothing is shown for the expecting child.
    expect(entriesForChild(s().entries, s().selectedChildId)).toEqual([]);
    // ...while the sibling's own history is intact.
    expect(entriesForChild(s().entries, 'localMira').map((e) => e.id)).toEqual(['f1']);
  });

  it("switching to a sibling never shows the other child's records", async () => {
    // The same bug with no expecting child involved: the demo seed owns all
    // entries under c1, so selecting c2 used to render c1's history verbatim.
    useAppStore.setState({ children: [mira, theo], selectedChildId: 'localTheo', entries: [] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: serverChildren,
      entries: [miraFeed],
      timers: [],
      selectedChildId: '2',
      lastFeed: {},
      measurements: [],
    });

    await s().refresh();

    expect(entriesForChild(s().entries, 'localTheo')).toEqual([]);
  });
});

describe('switching child refetches that child\'s records (server mode)', () => {
  const mira: Child = { id: 'localMira', serverId: 1, first: 'Mira', last: '', birth: NOW - 200 * 86400000, color: '#fff' };
  const theo: Child = { id: 'localTheo', serverId: 2, first: 'Theo', last: '', birth: NOW - 90 * 86400000, color: '#eee' };
  const expecting: Child = { id: 'localBean', first: 'Bean', last: '', birth: NOW + 60 * 86400000, color: '#ddd', expected: true };
  const serverChildren = [
    { id: '1', serverId: 1, first: 'Mira', last: '', birth: NOW - 200 * 86400000, color: '#fff' },
    { id: '2', serverId: 2, first: 'Theo', last: '', birth: NOW - 90 * 86400000, color: '#eee' },
  ];
  const theoFeed: Entry = { id: 'tf1', childId: '2', tags: [], type: 'feeding', start: NOW - 3600000, end: NOW - 3000000, feedType: 'breast', method: 'left', amount: null };

  it("fetches the newly selected child, so its history is not left empty", async () => {
    // In server mode `entries` only ever holds the ONE child the last fetch
    // asked for. Scoping the display by child (the history-scope fix) is
    // therefore only half the story: without a refetch, switching to a
    // sibling shows "Nothing logged yet" until the user pulls to refresh.
    useAppStore.setState({ children: [mira, theo], selectedChildId: 'localMira', entries: [] });
    vi.mocked(loadFromServer).mockClear();
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: serverChildren,
      entries: [theoFeed],
      timers: [],
      selectedChildId: '2',
      lastFeed: {},
      measurements: [],
    });

    s().selectChild('localTheo');
    await flush();

    // Asked the server for Theo, not Mira.
    expect(vi.mocked(loadFromServer).mock.calls.at(-1)?.[1]).toBe(2);
    // And his records are now what the History surfaces will render.
    expect(entriesForChild(s().entries, 'localTheo').map((e) => e.id)).toEqual(['tf1']);
  });

  it("keeps the other child's feeding prefill through the refetch", async () => {
    // A load only ever covers the child it fetched, and this refetch fires on
    // EVERY child switch, so taking the server's answer wholesale would wipe
    // the sibling's prefill on each Mira-to-Theo-to-Mira round trip. The
    // incoming key is a SERVER id and has to land under the local one.
    useAppStore.setState({
      children: [mira, theo],
      selectedChildId: 'localMira',
      lastFeed: { localMira: { feedType: 'solid', method: 'self' } },
    });
    vi.mocked(loadFromServer).mockClear();
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: serverChildren,
      entries: [theoFeed],
      timers: [],
      selectedChildId: '2',
      lastFeed: { '2': { feedType: 'breast', method: 'left' } },
      measurements: [],
    });

    s().selectChild('localTheo');
    await flush();

    expect(s().lastFeed).toEqual({
      localMira: { feedType: 'solid', method: 'self' },
      localTheo: { feedType: 'breast', method: 'left' },
    });
  });

  it('does not hit the server in local mode', async () => {
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [mira, theo],
      selectedChildId: 'localMira',
    });
    vi.mocked(loadFromServer).mockClear();

    s().selectChild('localTheo');
    await flush();

    // Local mode already holds every child's records in memory, so there is
    // nothing to fetch and no server to fetch it from.
    expect(vi.mocked(loadFromServer)).not.toHaveBeenCalled();
    expect(s().selectedChildId).toBe('localTheo');
  });

  it('still selects the child when the refetch fails', async () => {
    useAppStore.setState({ children: [mira, theo], selectedChildId: 'localMira', entries: [] });
    vi.mocked(loadFromServer).mockClear();
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));

    s().selectChild('localTheo');
    await flush();

    // The switch is a local UI action: it must land regardless of the network.
    expect(s().selectedChildId).toBe('localTheo');
  });

  it('passes no preferred child when switching to an expecting one', async () => {
    // An expecting child has no serverId, so there is nothing to ask for and
    // loadFromServer falls back to the server's first child. The display
    // filter is what keeps the sibling's records off the expecting screen.
    useAppStore.setState({ children: [mira, expecting], selectedChildId: 'localMira', entries: [] });
    vi.mocked(loadFromServer).mockClear();
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: serverChildren,
      entries: [],
      timers: [],
      selectedChildId: '1',
      lastFeed: {},
      measurements: [],
    });

    s().selectChild('localBean');
    await flush();

    expect(vi.mocked(loadFromServer).mock.calls.at(-1)?.[1]).toBeNull();
  });

  it('keeps resetting the insights cache (pre-existing behaviour)', async () => {
    useAppStore.setState({
      children: [mira, theo],
      selectedChildId: 'localMira',
      insightsLoaded: true,
      insightsEntries: [theoFeed],
      insightsError: true,
    });
    vi.mocked(loadFromServer).mockClear();

    s().selectChild('localTheo');
    await flush();

    expect(s().insightsLoaded).toBe(false);
    expect(s().insightsEntries).toEqual([]);
    expect(s().insightsError).toBe(false);
  });
});

describe('refresh timer reconcile (widget writes timers out-of-band)', () => {
  const sleepTimer: Timer = { id: 't1', activity: 'sleep', name: 'Sleep', start: NOW, saveAs: 'sleep' };

  it('picks up a widget-started timer the in-memory list does not have', async () => {
    useAppStore.setState({ timers: [] });   // app thinks no timers running
    h.timers = [sleepTimer];                // widget wrote storage while app was warm
    await useAppStore.getState().refresh();
    expect(useAppStore.getState().timers).toEqual([sleepTimer]);
  });

  it('drops a timer the widget has stopped (absent from storage)', async () => {
    useAppStore.setState({ timers: [sleepTimer] });  // app still holds the running timer
    h.timers = [];                                   // widget stopped it → storage empty
    await useAppStore.getState().refresh();
    expect(useAppStore.getState().timers).toEqual([]);
  });

  it('reconciles timers from storage even when the server is unreachable', async () => {
    useAppStore.setState({ timers: [sleepTimer] }); // persist mock writes this to storage too
    h.timers = [];                                  // widget stopped it out-of-band
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await useAppStore.getState().refresh();
    expect(useAppStore.getState().offline).toBe(true);
    expect(useAppStore.getState().timers).toEqual([]); // still cleared despite being offline
  });
});

describe('feeding extras', () => {
  it('breastfeed "both" records the start side as a tag + the intake level in amount', () => {
    s().openSheet('feeding');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'right', amount: 3 });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.method).toBe('both');
    expect(e.tags).toContain('right');
    // The level stays a plain number locally; only the API layer turns it into
    // a tag, so the start side is the only tag folded in here.
    expect(e.amount).toBe(3);
    expect(e.tags).toEqual(['right']);
  });
});

// `amount` means millilitres on one side of `feedAmountIsVolume` and an intake
// level on the other, so a draft that crosses the line mid-sheet must not carry
// its old number over: 3 ("A lot") is not 3 ml, and 90 ml is not a level.
describe('feeding draft: amount clears when the volume/level boundary is crossed', () => {
  it('drops an intake level when the feed becomes a volume', () => {
    s().openSheet('feeding');
    s().setTE({ feedType: 'breast', method: 'left', amount: 2 });
    s().setTE({ method: 'bottle' });
    expect(s().te.amount).toBeUndefined();
    s().save();
    expect((s().entries[0] as Extract<Entry, { type: 'feeding' }>).amount).toBeNull();
  });

  it('drops a volume when the feed becomes an intake level', () => {
    s().openSheet('feeding');
    s().setTE({ feedType: 'formula', method: 'bottle', amount: 90 });
    s().setTE({ feedType: 'breast', method: 'left' });
    expect(s().te.amount).toBeUndefined();
    s().save();
    expect((s().entries[0] as Extract<Entry, { type: 'feeding' }>).amount).toBeNull();
  });

  it('keeps the amount when the change stays on the same side of the line', () => {
    s().openSheet('feeding');
    s().setTE({ feedType: 'breast', method: 'left', amount: 2 });
    s().setTE({ method: 'both' }); // still at the breast
    expect(s().te.amount).toBe(2);

    s().setTE({ feedType: 'formula', method: 'bottle', amount: 90 });
    s().setTE({ feedType: 'fortified' }); // still a bottle volume
    expect(s().te.amount).toBe(90);
  });

  it('honours an amount named in the same patch as the crossing', () => {
    // Setting the whole shape at once (as the timer editor does) states the
    // amount for where the draft is landing, so it is not second-guessed.
    s().openSheet('feeding');
    s().setTE({ feedType: 'breast', method: 'left', amount: 2 });
    s().setTE({ feedType: 'formula', method: 'bottle', amount: 120 });
    expect(s().te.amount).toBe(120);
  });

  it('leaves other activities alone', () => {
    s().openSheet('pumping');
    s().setTE({ amount: 90, method: 'both' });
    expect(s().te.amount).toBe(90);
  });
});

describe('diaper amount', () => {
  it('saves a solid diaper amount (Medium = 2)', () => {
    s().openSheet('diaper');
    s().setTE({ solid: true, amount: 2 });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'diaper' }>;
    expect(e.amount).toBe(2);
  });

  it('drops the amount when the diaper is not solid (wet only)', () => {
    s().openSheet('diaper');
    s().setTE({ wet: true, solid: false, amount: 2 });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'diaper' }>;
    expect(e.amount).toBeNull();
  });
});

describe('per-entry notes', () => {
  it('save() writes a trimmed notes onto a feeding entry', () => {
    s().openSheet('feeding');
    s().setTE({ notes: '  fussy at the end  ' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.notes).toBe('fussy at the end');
  });

  it('save() omits notes when blank (whitespace trims to undefined)', () => {
    s().openSheet('sleep');
    s().setTE({ notes: '   ' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.notes).toBeUndefined();
  });

  it('save() never puts notes on a bath entry (bath excluded)', () => {
    s().openSheet('bath');
    s().setTE({ notes: 'should be ignored' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'bath' }>;
    expect((e as { notes?: string }).notes).toBeUndefined();
  });

  it('openEdit prefills notes from the entry', () => {
    useAppStore.setState({
      entries: [
        { id: 'tummy-1', serverId: 3, childId: 'c1', type: 'tummy', start: NOW - 20 * M, end: NOW - 5 * M, milestone: 'rolled', notes: 'on the mat', tags: [] },
      ],
    });
    s().openEdit('tummy-1');
    expect(s().te.notes).toBe('on the mat');
  });

  it('edit round-trip: openEdit prefills, edited notes survives save', () => {
    useAppStore.setState({
      entries: [
        { id: 'pumping-1', serverId: 4, childId: 'c1', type: 'pumping', start: NOW - 15 * M, end: NOW, amount: 90, notes: 'left side', tags: [] },
      ],
    });
    s().openEdit('pumping-1');
    expect(s().te.notes).toBe('left side');
    s().setTE({ notes: 'both sides now' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'pumping' }>;
    expect(e.notes).toBe('both sides now');
  });
});

describe('adjustTimerStart', () => {
  it('shifts a timer start earlier', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 10 * M, saveAs: 'sleep' }],
    });
    s().adjustTimerStart('t1', -5);
    expect(s().timers[0].start).toBe(NOW - 15 * M);
  });
});

describe('setTimerStart', () => {
  it('sets an exact start, clamped to now', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 10 * M, saveAs: 'sleep' }],
    });
    s().setTimerStart('t1', NOW - 37 * M);
    expect(s().timers[0].start).toBe(NOW - 37 * M);
    s().setTimerStart('t1', Date.now() + 60 * M); // future → clamped
    expect(s().timers[0].start).toBeLessThanOrEqual(Date.now());
  });
});

describe('time-entry: keep last two selected', () => {
  it('pinning Start derives Lasted (start+end both set)', () => {
    s().openSheet('feeding'); // active {end, lasted}, derived start
    s().setStartedAt(NOW - 40 * M); // now active {start, end}, derived lasted
    expect(s().te.order?.[2]).toBe('lasted');
    expect(teStart(s().te, NOW)).toBe(NOW - 40 * M);
    expect(teEnd(s().te, NOW)).toBe(NOW);
  });

  it('setEndedAbs pins an exact end and clears the relative pick', () => {
    s().openSheet('feeding'); // end=now (agoMin 0), lasted=default, start derived
    s().setEndedAbs(NOW - 13 * M);
    expect(s().te.endAbs).toBe(NOW - 13 * M);
    expect(s().te.endAgoMin).toBeUndefined();
    expect(teEnd(s().te, NOW)).toBe(NOW - 13 * M);
  });

  it('with start+end both pinned, re-pinning one endpoint keeps the other fixed', () => {
    s().openSheet('feeding');
    s().setStartedAt(NOW - 40 * M);
    s().setEndedAbs(NOW - 10 * M); // active {end, start}, derived lasted = 30
    s().setStartedAt(NOW - 47 * M); // fine-tune start; end must not move
    expect(teEnd(s().te, NOW)).toBe(NOW - 10 * M);
    expect(teStart(s().te, NOW)).toBe(NOW - 47 * M);
    expect(s().te.order?.[2]).toBe('lasted'); // lasted re-derives (37 min)
  });

  it('an Ended chip after setEndedAbs clears the absolute pin', () => {
    s().openSheet('feeding');
    s().setEndedAbs(NOW - 13 * M);
    s().setEnded(15);
    expect(s().te.endAbs).toBeUndefined();
    expect(teEnd(s().te, NOW)).toBe(NOW - 15 * M);
  });

  it('with lasted+end active, nudging start moves only start and re-derives lasted', () => {
    s().openSheet('feeding');
    s().setLasted(20); // active {lasted, end@now}, start derived (= now-20)
    s().setStartedAt(NOW - 50 * M); // nudge start earlier — must overrule lasted
    expect(teStart(s().te, NOW)).toBe(NOW - 50 * M); // start moved
    expect(teEnd(s().te, NOW)).toBe(NOW); // end stayed put (frozen)
    expect(teDurationMin(s().te, NOW)).toBe(50); // duration recomputed as end − start
    expect(s().te.order?.[2]).toBe('lasted'); // lasted deselected → derived
    expect(isActive(s().te.order, 'lasted')).toBe(false);
  });

  it('with lasted+start active, nudging end moves only end and re-derives lasted', () => {
    s().openSheet('feeding');
    s().setStartedAt(NOW - 60 * M); // pin start (freezes end, lasted → derived)
    s().setLasted(30); // active {lasted, start}, end derived (= now-30)
    s().setEndedAbs(NOW - 5 * M); // nudge end later — must overrule lasted
    expect(teEnd(s().te, NOW)).toBe(NOW - 5 * M); // end moved
    expect(teStart(s().te, NOW)).toBe(NOW - 60 * M); // start stayed put (frozen)
    expect(teDurationMin(s().te, NOW)).toBe(55); // duration recomputed
    expect(s().te.order?.[2]).toBe('lasted'); // lasted deselected → derived
  });
});

describe('edit a running timer', () => {
  it('openTimerEdit prefills from the timer and shows the ongoing editing view', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    expect(s().sheet?.type).toBe('sleep');
    expect(s().fromTimerId).toBe('t1');
    expect(s().te.startAbs).toBe(NOW - 40 * M);
    // the timer is running, so TimeEntry must render its ongoing view (editable
    // start + live "now" end), not dead end/lasted pills
    expect(s().te.ongoing).toBe(true);
  });

  it('pressing the sheet\'s save button (save()) on a timer-edit keeps the timer running instead of stopping it', () => {
    // Regression guard for the original bug: editing a running timer used to
    // route through save()'s normal "consume into an entry" path because
    // openTimerEdit sets ongoing:false. save() must now detect fromTimerId
    // and delegate to saveTimerDetails instead.
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    s().save();
    expect(s().timers).toHaveLength(1); // still running, not consumed
    expect(s().entries).toHaveLength(0); // no entry created
    expect(s().sheet).toBeNull();
    expect(s().fromTimerId).toBeNull();
  });

  it('closing the timer-edit sheet keeps the timer running', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'feeding', name: 'Feeding', start: NOW - 10 * M, saveAs: 'feeding' }],
    });
    s().openTimerEdit('t1');
    s().closeSheet();
    expect(s().sheet).toBeNull();
    expect(s().timers).toHaveLength(1);
    expect(s().fromTimerId).toBeNull();
  });

  it('editing the end to an earlier time then saving stops the timer and logs an entry at that end', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    s().setEndedAbs(NOW - 5 * M); // pin an earlier end; flips ongoing:false
    s().save();
    expect(s().timers).toHaveLength(0); // source timer consumed
    expect(s().entries).toHaveLength(1);
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.start).toBe(NOW - 40 * M); // original timer start preserved
    expect(e.end).toBe(NOW - 5 * M); // logged at the pinned end
    expect(s().fromTimerId).toBeNull();
  });

  it('editing the end then tapping Still running keeps the timer live and creates no entry', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    s().setEndedAbs(NOW - 5 * M);
    s().setOngoing(); // "Still running" — back to live
    s().save();
    expect(s().timers).toHaveLength(1); // still running (saveTimerDetails path)
    expect(s().entries).toHaveLength(0); // no entry created
    expect(s().timers[0].start).toBe(NOW - 40 * M);
    expect(s().sheet).toBeNull();
    expect(s().fromTimerId).toBeNull();
  });

  it('tapping Now on the end then saving stops the timer and logs an entry ending at now', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    s().setEnded(0); // "Now" chip: end at now, clears endAbs, flips ongoing:false
    s().save();
    expect(s().timers).toHaveLength(0); // timer consumed
    expect(s().entries).toHaveLength(1);
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.start).toBe(NOW - 40 * M); // original timer start preserved
    expect(e.end).toBe(NOW); // ended at now (store now === NOW in tests)
    expect(s().te.endAbs).toBeUndefined(); // Now clears the absolute pin
    expect(s().fromTimerId).toBeNull();
  });
});

describe('saveTimerDetails: persisting edits to a running timer', () => {
  const feedingTimer = (id: string): Timer => ({
    id,
    activity: 'feeding',
    name: 'Feeding',
    start: NOW - 12 * M,
    saveAs: 'feeding',
  });

  it('writes amount + side onto the Timer and keeps it running (not converted to an entry)', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'right', amount: 45 });
    s().saveTimerDetails();
    expect(s().timers).toHaveLength(1);
    expect(s().entries).toHaveLength(0);
    const tm = s().timers[0];
    expect(tm.amount).toBe(45);
    expect(tm.startSide).toBe('right');
    expect(tm.method).toBe('both');
    expect(s().sheet).toBeNull();
    expect(s().fromTimerId).toBeNull();
  });

  it('persists via the store subscribe (AsyncStorage-backed)', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    vi.mocked(saveTimers).mockClear();
    s().openTimerEdit('t1');
    s().setTE({ amount: 45 });
    s().saveTimerDetails();
    expect(saveTimers).toHaveBeenCalled();
  });

  it('reopening the editor shows the previously saved details', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'right', amount: 45 });
    s().saveTimerDetails();
    s().openTimerEdit('t1');
    expect(s().te.amount).toBe(45);
    expect(s().te.startSide).toBe('right');
    expect(s().te.method).toBe('both');
    expect(s().te.feedType).toBe('breast');
  });

  it('stopTimer uses the saved amount/side instead of hard-coded defaults', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ feedType: 'formula', method: 'bottle', amount: 120 });
    s().saveTimerDetails();
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.feedType).toBe('formula');
    expect(e.method).toBe('bottle');
    expect(e.amount).toBe(120);
  });

  it('stopTimer folds a saved breastfeeding "both" startSide into the tags, like a normal save', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'left' });
    s().saveTimerDetails();
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.tags).toContain('left');
  });

  it('carries a note typed while editing a running timer through saveTimerDetails → reopen → stopTimer', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ notes: '  spit up a little  ' });
    s().saveTimerDetails();
    // persisted on the still-running timer (trimmed), not lost
    expect(s().timers[0].notes).toBe('spit up a little');
    // reopening the editor shows it again
    s().openTimerEdit('t1');
    expect(s().te.notes).toBe('spit up a little');
    // and it survives the final stop into the entry
    s().saveTimerDetails();
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.notes).toBe('spit up a little');
  });

  it('carries a note through a sleep timer stop (buildSleepEntry path)', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    s().setTE({ notes: 'down easy' });
    s().saveTimerDetails();
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.type).toBe('sleep');
    expect(e.notes).toBe('down easy');
  });

  it('a timer with no saved metadata still stops with the existing default behavior (regression guard)', () => {
    useAppStore.setState({ timers: [feedingTimer('t2')] });
    s().stopTimer('t2');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.feedType).toBe('breast');
    expect(e.method).toBe('left');
    expect(e.amount).toBeNull();
    expect(e.tags).toEqual([]);
  });

  it('sleep: saved nap flag survives reopen and stopTimer (regression guard for the no-metadata default too)', () => {
    useAppStore.setState({
      timers: [{ id: 't3', activity: 'sleep', name: 'Sleep', start: NOW - 5 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t3');
    s().setTE({ nap: false });
    s().saveTimerDetails();
    s().openTimerEdit('t3');
    expect(s().te.nap).toBe(false);
    s().stopTimer('t3');
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.nap).toBe(false);
  });

  it('pumping: saved amount/method survive reopen and stopTimer', () => {
    useAppStore.setState({
      timers: [{ id: 't4', activity: 'pumping', name: 'Pumping', start: NOW - 5 * M, saveAs: 'pumping' }],
    });
    s().openTimerEdit('t4');
    s().setTE({ amount: 150, method: 'left' });
    s().saveTimerDetails();
    s().openTimerEdit('t4');
    expect(s().te.amount).toBe(150);
    expect(s().te.method).toBe('left');
    s().stopTimer('t4');
    const e = s().entries[0] as Extract<Entry, { type: 'pumping' }>;
    expect(e.amount).toBe(150);
    expect(e.method).toBe('left');
  });

  it('tummy: persists the milestone it claims to save (no false "Details saved" for a no-op)', () => {
    useAppStore.setState({
      timers: [{ id: 't5', activity: 'tummy', name: 'Tummy time', start: NOW - 5 * M, saveAs: 'tummy' }],
    });
    s().openTimerEdit('t5');
    s().setTE({ milestone: 'lifted head' });
    s().saveTimerDetails();
    expect(s().timers).toHaveLength(1); // still running
    expect(s().entries).toHaveLength(0);
    // the toast asserts a save happened — so something must actually be persisted
    expect(s().timers[0].milestone).toBe('lifted head');
    expect(s().toast).toBe('Details saved');
    s().openTimerEdit('t5'); // reopen reflects it
    expect(s().te.milestone).toBe('lifted head');
    s().stopTimer('t5');
    const e = s().entries[0] as Extract<Entry, { type: 'tummy' }>;
    expect(e.milestone).toBe('lifted head');
  });

  it('persists an edited start time onto the running timer', () => {
    useAppStore.setState({ timers: [feedingTimer('t6')] }); // start NOW - 12m
    s().openTimerEdit('t6');
    s().setStartedAt(NOW - 40 * M); // user re-anchors the start earlier
    s().saveTimerDetails();
    expect(s().timers).toHaveLength(1);
    expect(s().timers[0].start).toBe(NOW - 40 * M);
    s().openTimerEdit('t6'); // reopen reflects the new start
    expect(s().te.startAbs).toBe(NOW - 40 * M);
  });

  it('tapping "Now" while editing a running timer resets and persists its start (ongoing stays true)', () => {
    useAppStore.setState({ timers: [feedingTimer('t6b')] }); // start NOW - 12m
    s().openTimerEdit('t6b');
    s().setStartedAt(NOW, 'now'); // user taps the "Now" chip
    expect(s().te.startAnchor).toBe('now');
    expect(s().te.ongoing).toBe(true); // setStartedAt must not disturb ongoing
    s().saveTimerDetails();
    expect(s().timers).toHaveLength(1); // still running, not stopped
    expect(s().timers[0].start).toBe(NOW);
  });

  it('leaves the start unchanged when it was not edited', () => {
    useAppStore.setState({ timers: [feedingTimer('t7')] }); // start NOW - 12m
    s().openTimerEdit('t7');
    s().setTE({ amount: 30 });
    s().saveTimerDetails();
    expect(s().timers[0].start).toBe(NOW - 12 * M);
  });

  it('setTimerLasted keeps the fixed start and derives the end (start + X)', () => {
    useAppStore.setState({ timers: [feedingTimer('t9')] }); // start NOW - 12m
    s().openTimerEdit('t9');
    s().setTimerLasted(45); // "oh, it lasted about 45 min"
    expect(s().te.ongoing).toBe(false); // marked finished
    expect(s().te.startAbs).toBe(NOW - 12 * M); // start NOT rewritten
    expect(s().te.durationMin).toBe(45);
    expect(s().te.order?.[2]).toBe('end'); // end is the derived point
  });

  it('nudging the end after setTimerLasted moves only the end; the real start stays fixed', () => {
    useAppStore.setState({ timers: [feedingTimer('t9c')] }); // real start NOW - 12m
    s().openTimerEdit('t9c');
    s().setTimerLasted(45); // active {lasted, start}, end derived (= start + 45)
    s().setEndedAbs(NOW - 2 * M); // fine-tune the end — must overrule the lasted estimate
    expect(teStart(s().te, NOW)).toBe(NOW - 12 * M); // real elapsed start untouched
    expect(teEnd(s().te, NOW)).toBe(NOW - 2 * M); // only the end moved
    expect(teDurationMin(s().te, NOW)).toBe(10); // duration re-derives (end − start)
    expect(s().te.order?.[2]).toBe('lasted'); // lasted deselected
  });

  it('Save with a chosen length stops the timer into a fixed-start entry', () => {
    useAppStore.setState({ timers: [feedingTimer('t9b')] }); // start NOW - 12m
    s().openTimerEdit('t9b');
    s().setTE({ amount: 60, method: 'both', startSide: 'right' });
    s().setTimerLasted(45);
    s().save();
    expect(s().timers).toHaveLength(0); // timer stopped
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.type).toBe('feeding');
    expect(e.start).toBe(NOW - 12 * M); // fixed start preserved
    expect(e.end).toBe(NOW - 12 * M + 45 * M); // end = start + 45m
    expect(e.amount).toBe(60);
    expect(e.method).toBe('both');
    expect(e.tags).toContain('right'); // "both" folds the starting side into a tag
    expect(s().sheet).toBeNull();
  });

  it('stopping via "lasted X" files the entry against the timer\'s child, not the selection', async () => {
    // The Timers tab deliberately lists every child's timers with no per-child
    // filter, so tapping a sibling's running timer while another child is
    // selected is the obvious thing to do. `stopTimer` gets this right; save()'s
    // timer-stop path did not, because `existing` is null for a brand-new entry
    // and the owner had nowhere to come from but the selection.
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
      offline: false,
      children: [
        { id: 'localMira', serverId: 11, first: 'Mira', last: '', birth: NOW - 90 * 86400000, color: '#fff' },
        { id: 'localTheo', serverId: 22, first: 'Theo', last: '', birth: NOW - 90 * 86400000, color: '#fff' },
      ],
      selectedChildId: 'localTheo',
      timers: [{ id: 'tm', childId: 'localMira', activity: 'sleep', name: 'Sleep', start: NOW - 20 * M, saveAs: 'sleep' }],
      entries: [],
    });

    s().openTimerEdit('tm');
    s().setTimerLasted(20);
    s().save();

    expect(s().timers).toHaveLength(0); // the timer was stopped
    expect(s().entries[0].childId).toBe('localMira');
    await flush();
    // And the server row lands under Mira: `commitWrite` resolves the child
    // server id from the ENTRY, so a wrong owner here creates the record under
    // the wrong child, which no local fix can take back.
    expect(h.pushedChildServerIds).toEqual([11]);
  });

  it('"Still running" after a length keeps the timer live on save', () => {
    useAppStore.setState({ timers: [feedingTimer('t9c')] }); // start NOW - 12m
    s().openTimerEdit('t9c');
    s().setTimerLasted(30); // considered stopping...
    s().setOngoing(); // ...then tapped "Still running" to keep it going
    expect(s().te.ongoing).toBe(true);
    s().save();
    expect(s().timers).toHaveLength(1); // still running, not stopped
    expect(s().entries).toHaveLength(0);
    expect(s().timers[0].start).toBe(NOW - 12 * M);
  });

  it('persists tags edited on a running timer and folds them into the stopped entry', () => {
    useAppStore.setState({ timers: [feedingTimer('t8')] });
    s().openTimerEdit('t8');
    s().toggleTag('Cluster');
    s().saveTimerDetails();
    expect(s().timers[0].tags).toEqual(['Cluster']);
    s().openTimerEdit('t8');
    expect(s().te.tags).toEqual(['Cluster']);
    s().stopTimer('t8');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.tags).toContain('Cluster');
  });
});

describe('saved servers', () => {
  it('connect adds the connected server to the retry list', async () => {
    useAppStore.setState({ savedServers: [], connected: false });
    await s().connect('https://a.lan', 'tok');
    expect(s().savedServers.map((x) => x.serverUrl)).toContain('https://a.lan');
    expect(h.servers).toHaveLength(1); // persisted
  });

  it('forgetServer removes a server, persists, and toasts', () => {
    useAppStore.setState({
      savedServers: [
        { serverUrl: 'https://a.lan', token: 't', lastUsedAt: 1 },
        { serverUrl: 'https://b.lan', token: 't', lastUsedAt: 2 },
      ],
    });
    s().forgetServer('https://a.lan');
    expect(s().savedServers.map((x) => x.serverUrl)).toEqual(['https://b.lan']);
    expect(h.servers).toEqual([{ serverUrl: 'https://b.lan', token: 't', lastUsedAt: 2 }]);
    expect(s().toast).toBe('Removed');
  });

  it('hydrate loads saved servers and migrates the active connection', async () => {
    h.servers = [];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    await s().hydrate();
    expect(s().savedServers.map((x) => x.serverUrl)).toContain('http://x');
    expect(h.servers.map((x: any) => x.serverUrl)).toContain('http://x');
  });

  it('a failed connect does not save the server', async () => {
    useAppStore.setState({ savedServers: [], connected: false });
    h.servers = [];
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('net'));
    await s().connect('https://bad.lan', 'tok');
    expect(s().connectError).toBeTruthy();
    expect(s().savedServers).toEqual([]);
    expect(h.servers).toEqual([]); // persistServers never called
  });
});

describe('insights slice', () => {
  it('loadInsights in demo mode fills insightsEntries from local entries scoped to the child', async () => {
    useAppStore.setState({
      connection: { mode: 'local' } as any,
      selectedChildId: 'c1',
      entries: [
        { id: 's1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any,
        { id: 's2', type: 'sleep', childId: 'c2', start: 3, end: 4, nap: false, tags: [] } as any,
      ],
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    await useAppStore.getState().loadInsights();
    const s = useAppStore.getState();
    expect(s.insightsLoaded).toBe(true);
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['s1']); // c2's entry excluded
  });

  it('selectChild resets the insights cache', () => {
    useAppStore.setState({ insightsLoaded: true, insightsEntries: [{ id: 'x' } as any], insightsError: true });
    useAppStore.getState().selectChild('c2');
    expect(useAppStore.getState().insightsLoaded).toBe(false);
    expect(useAppStore.getState().insightsEntries).toEqual([]);
    expect(useAppStore.getState().insightsError).toBe(false);
  });

  it('loadInsights in non-demo mode fetches deep history from the server, keyed by the child\'s SERVER id', async () => {
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [SYNCED_C1], // serverId 501: loadInsights must request the SERVER id
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockResolvedValueOnce([
      { id: 'r1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any,
    ]);
    await useAppStore.getState().loadInsights();
    expect(loadInsightsHistory).toHaveBeenCalledWith(
      { mode: 'server', serverUrl: 'x', token: 'y' },
      '501', // the child's SERVER id, not its local id 'c1'
      expect.any(Number),
    );
    const s = useAppStore.getState();
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['r1']);
    expect(s.insightsLoaded).toBe(true);
  });

  // Regression: a Budkin-local id (e.g. 'child' + Date.now(), see saveChild)
  // must never reach the server. `/api/sleep/?child=...` and its siblings
  // (repository.ts's `loadInsightsHistory`) need the numeric server id.
  it('loadInsights requests the SERVER id, not Budkin\'s local id, for a locally-created (already-synced) child', async () => {
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'child1752999999999',
      children: [{ id: 'child1752999999999', serverId: 9, first: 'Ada', last: '', birth: NOW, color: '#fff' }],
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockResolvedValueOnce([]);
    await useAppStore.getState().loadInsights();
    expect(loadInsightsHistory).toHaveBeenCalledWith(
      { mode: 'server', serverUrl: 'x', token: 'y' },
      '9',
      expect.any(Number),
    );
  });

  // Regression companion: a child that has never been pushed has no server
  // id at all. Before the fix this still hit the API with the local id,
  // which `pageAll`'s per-page `.catch(() => [])` silently swallowed,
  // leaving Insights permanently empty with no error surfaced. Skipping the
  // fetch is the correct outcome here, not an error.
  it('loadInsights skips the fetch (no error) for a child that has never been pushed to the server', async () => {
    vi.mocked(loadInsightsHistory).mockClear();
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW, color: '#fff' }], // no serverId
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    await useAppStore.getState().loadInsights();
    expect(loadInsightsHistory).not.toHaveBeenCalled();
    const s = useAppStore.getState();
    expect(s.insightsEntries).toEqual([]);
    expect(s.insightsLoaded).toBe(true);
    expect(s.insightsError).toBe(false);
  });

  it('discards an in-flight fetch when the child switches mid-load and reloads for the new child', async () => {
    vi.mocked(loadInsightsHistory).mockClear();
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [
        { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW, color: '#fff' },
        { id: 'c2', serverId: 502, first: 'Rio', last: '', birth: NOW, color: '#eee' },
      ],
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    // First call: a manually-controlled deferred so we can switch children
    // while the 90-day fetch is still in flight.
    let resolveC1!: (v: Entry[]) => void;
    vi.mocked(loadInsightsHistory).mockImplementationOnce(
      () => new Promise<Entry[]>((r) => { resolveC1 = r; }),
    );
    const inFlight = useAppStore.getState().loadInsights(); // c1 fetch starts
    // selectChild also refetches the child's records now (see 'switching child
    // refetches...'), so give that fetch a server view matching this test's own
    // fixture. The shared default mock reports an EMPTY server, which
    // reconcileChildren correctly reads as "both children deleted server-side"
    // and drops them, which is not the situation under test here.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [
        { id: '501', serverId: 501, first: 'Mira', last: 'O', birth: NOW },
        { id: '502', serverId: 502, first: 'Rio', last: '', birth: NOW },
      ],
      entries: [],
      timers: [],
      selectedChildId: '502',
      lastFeed: {},
      measurements: [],
    });
    useAppStore.getState().selectChild('c2'); // switch lands mid-flight
    resolveC1([{ id: 'a1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any]);
    await inFlight;
    await flush(); // let the re-triggered c2 load settle (default mock resolves [])

    const st = useAppStore.getState();
    // c1's stale entries must NOT be stored under c2...
    expect(st.insightsEntries.map((e) => e.id)).not.toContain('a1');
    // ...and a fresh load for c2 must have been kicked off, keyed by c2's SERVER id.
    expect(loadInsightsHistory).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadInsightsHistory).mock.calls[1][1]).toBe('502');
    expect(st.insightsEntries).toEqual([]); // c2's (empty) result
    expect(st.insightsLoaded).toBe(true);
    expect(st.insightsLoading).toBe(false);
  });

  it('loadInsights surfaces an error and recovers on retry', async () => {
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [SYNCED_C1],
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockRejectedValueOnce(new Error('network'));
    await useAppStore.getState().loadInsights();
    expect(useAppStore.getState().insightsError).toBe(true);
    expect(useAppStore.getState().insightsLoading).toBe(false);
    expect(useAppStore.getState().insightsLoaded).toBe(false);

    // Retry: the CenteredState error view resets insightsLoading before
    // calling loadInsights again — mirror that here.
    vi.mocked(loadInsightsHistory).mockResolvedValueOnce([
      { id: 'r2', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any,
    ]);
    useAppStore.setState({ insightsLoading: false });
    await useAppStore.getState().loadInsights();
    expect(useAppStore.getState().insightsLoaded).toBe(true);
    expect(useAppStore.getState().insightsError).toBe(false);
  });

  it('reloadInsights re-fetches from the server even when already loaded, and swaps in the result', async () => {
    vi.mocked(loadInsightsHistory).mockClear();
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [SYNCED_C1],
      insightsLoaded: true, insightsLoading: false,
      insightsEntries: [{ id: 'old', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any],
      insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockResolvedValueOnce([
      { id: 'fresh', type: 'sleep', childId: 'c1', start: 3, end: 4, nap: false, tags: [] } as any,
    ]);
    await useAppStore.getState().reloadInsights();
    expect(loadInsightsHistory).toHaveBeenCalledTimes(1);
    const s = useAppStore.getState();
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['fresh']);
    expect(s.insightsLoaded).toBe(true);
    expect(s.insightsLoading).toBe(false);
  });

  it('reloadInsights keeps existing entries and does not set insightsError when the fetch fails', async () => {
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [SYNCED_C1],
      insightsLoaded: true, insightsLoading: false,
      insightsEntries: [{ id: 'keep', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any],
      insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockRejectedValueOnce(new Error('network'));
    await useAppStore.getState().reloadInsights();
    const s = useAppStore.getState();
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['keep']); // charts intact
    expect(s.insightsError).toBe(false); // good screen not replaced by the error state
    expect(s.insightsLoading).toBe(false);
    expect(s.insightsLoaded).toBe(true);
  });

  it('reloadInsights discards its result when the child switches mid-flight', async () => {
    vi.mocked(loadInsightsHistory).mockClear();
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [
        { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW, color: '#fff' },
        { id: 'c2', serverId: 502, first: 'Rio', last: '', birth: NOW, color: '#eee' },
      ],
      insightsLoaded: true, insightsLoading: false,
      insightsEntries: [{ id: 'c2keep', type: 'sleep', childId: 'c2', start: 1, end: 2, nap: false, tags: [] } as any],
      insightsError: false,
    });
    let resolveC1!: (v: Entry[]) => void;
    vi.mocked(loadInsightsHistory).mockImplementationOnce(
      () => new Promise<Entry[]>((r) => { resolveC1 = r; }),
    );
    const inFlight = useAppStore.getState().reloadInsights(); // c1 fetch starts
    useAppStore.setState({ selectedChildId: 'c2' }); // switch lands mid-flight
    resolveC1([{ id: 'c1stale', type: 'sleep', childId: 'c1', start: 9, end: 10, nap: false, tags: [] } as any]);
    await inFlight;
    const st = useAppStore.getState();
    expect(st.insightsEntries.map((e) => e.id)).toEqual(['c2keep']); // untouched, c1's result dropped
    expect(st.insightsLoading).toBe(false);
  });

  it('reloadInsights in demo mode re-scopes insightsEntries from local entries', async () => {
    useAppStore.setState({
      connection: { mode: 'local' } as any,
      selectedChildId: 'c1',
      entries: [
        { id: 'l1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any,
        { id: 'l2', type: 'sleep', childId: 'c2', start: 3, end: 4, nap: false, tags: [] } as any,
      ],
      insightsLoaded: true, insightsLoading: false,
      insightsEntries: [], insightsError: false,
    });
    await useAppStore.getState().reloadInsights();
    const s = useAppStore.getState();
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['l1']); // c2 excluded
    expect(s.insightsLoaded).toBe(true);
  });

  it('reloadInsights no-ops while an initial load is already in flight', async () => {
    vi.mocked(loadInsightsHistory).mockClear();
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [SYNCED_C1],
      insightsLoaded: false, insightsLoading: true, // a load is running
      insightsEntries: [], insightsError: false,
    });
    await useAppStore.getState().reloadInsights();
    expect(loadInsightsHistory).not.toHaveBeenCalled();
  });
});

describe('theme persistence', () => {
  it('toggleTheme persists the new mode via savePrefs', () => {
    useAppStore.setState({ themeMode: 'dark' });
    s().toggleTheme();
    expect(s().themeMode).toBe('light');
    expect(savePrefs).toHaveBeenCalledWith({ themeMode: 'light' });
  });

  it('toggling back to dark persists dark too', () => {
    useAppStore.setState({ themeMode: 'light' });
    s().toggleTheme();
    expect(s().themeMode).toBe('dark');
    expect(savePrefs).toHaveBeenCalledWith({ themeMode: 'dark' });
  });

  it('hydrate applies a persisted themeMode', async () => {
    h.prefs = { themeMode: 'light' };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ themeMode: 'dark' });
    await s().hydrate();
    expect(s().themeMode).toBe('light');
  });

  it('hydrate leaves themeMode alone when nothing was persisted', async () => {
    h.prefs = {};
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ themeMode: 'dark' });
    await s().hydrate();
    expect(s().themeMode).toBe('dark');
  });

  it('hydrate applies a persisted theme for a demo connection too', async () => {
    h.prefs = { themeMode: 'light' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    useAppStore.setState({ themeMode: 'dark' });
    await s().hydrate();
    expect(s().themeMode).toBe('light');
  });
});

describe('unit-system persistence', () => {
  it('setUnitSystem updates state and persists via savePrefs', () => {
    useAppStore.setState({ unitSystem: 'metric' });
    s().setUnitSystem('imperial');
    expect(s().unitSystem).toBe('imperial');
    expect(savePrefs).toHaveBeenCalledWith({ unitSystem: 'imperial' });
  });

  it('toggleUnitSystem flips metric <-> imperial and persists each direction', () => {
    useAppStore.setState({ unitSystem: 'metric' });
    s().toggleUnitSystem();
    expect(s().unitSystem).toBe('imperial');
    expect(savePrefs).toHaveBeenCalledWith({ unitSystem: 'imperial' });
    s().toggleUnitSystem();
    expect(s().unitSystem).toBe('metric');
    expect(savePrefs).toHaveBeenCalledWith({ unitSystem: 'metric' });
  });

  it('hydrate applies a persisted unitSystem', async () => {
    h.prefs = { unitSystem: 'imperial' };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ unitSystem: 'metric' });
    await s().hydrate();
    expect(s().unitSystem).toBe('imperial');
  });

  it('hydrate leaves unitSystem at its default when nothing was persisted', async () => {
    h.prefs = {};
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ unitSystem: 'metric' });
    await s().hydrate();
    expect(s().unitSystem).toBe('metric');
  });
});

describe('reminder preference persistence', () => {
  it('setReminderPref updates state and persists via savePrefs for a plain toggle', () => {
    useAppStore.setState({ dueDateReminders: true });
    s().setReminderPref('dueDateReminders', false);
    expect(s().dueDateReminders).toBe(false);
    expect(savePrefs).toHaveBeenCalledWith({ dueDateReminders: false });
  });

  it('setReminderPref updates staleTimerReminders and persists', () => {
    useAppStore.setState({ staleTimerReminders: true });
    s().setReminderPref('staleTimerReminders', false);
    expect(s().staleTimerReminders).toBe(false);
    expect(savePrefs).toHaveBeenCalledWith({ staleTimerReminders: false });
  });

  it('setReminderPref updates ageMilestones and persists', () => {
    useAppStore.setState({ ageMilestones: true });
    s().setReminderPref('ageMilestones', false);
    expect(s().ageMilestones).toBe(false);
    expect(savePrefs).toHaveBeenCalledWith({ ageMilestones: false });
  });

  it('switching pumpingReminders ON stamps pumpingEnabledAt with the current time', () => {
    useAppStore.setState({ pumpingReminders: false, pumpingEnabledAt: null });
    const before = Date.now();
    s().setReminderPref('pumpingReminders', true);
    const after = Date.now();
    expect(s().pumpingReminders).toBe(true);
    expect(s().pumpingEnabledAt).not.toBeNull();
    expect(s().pumpingEnabledAt as number).toBeGreaterThanOrEqual(before);
    expect(s().pumpingEnabledAt as number).toBeLessThanOrEqual(after);
    expect(savePrefs).toHaveBeenCalledWith({ pumpingReminders: true, pumpingEnabledAt: s().pumpingEnabledAt });
  });

  it('switching pumpingReminders OFF clears pumpingEnabledAt to null', () => {
    useAppStore.setState({ pumpingReminders: true, pumpingEnabledAt: NOW });
    s().setReminderPref('pumpingReminders', false);
    expect(s().pumpingReminders).toBe(false);
    expect(s().pumpingEnabledAt).toBeNull();
    expect(savePrefs).toHaveBeenCalledWith({ pumpingReminders: false, pumpingEnabledAt: null });
  });

  it('setPumpingInterval updates state and persists via savePrefs', () => {
    useAppStore.setState({ pumpingIntervalMin: 180 });
    s().setPumpingInterval(240);
    expect(s().pumpingIntervalMin).toBe(240);
    expect(savePrefs).toHaveBeenCalledWith({ pumpingIntervalMin: 240 });
  });

  it('hydrate applies persisted reminder prefs', async () => {
    h.prefs = {
      dueDateReminders: false,
      staleTimerReminders: false,
      ageMilestones: false,
      pumpingReminders: true,
      pumpingIntervalMin: 120,
      pumpingEnabledAt: NOW,
    };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({
      dueDateReminders: true,
      staleTimerReminders: true,
      ageMilestones: true,
      pumpingReminders: false,
      pumpingIntervalMin: 180,
      pumpingEnabledAt: null,
    });
    await s().hydrate();
    expect(s().dueDateReminders).toBe(false);
    expect(s().staleTimerReminders).toBe(false);
    expect(s().ageMilestones).toBe(false);
    expect(s().pumpingReminders).toBe(true);
    expect(s().pumpingIntervalMin).toBe(120);
    expect(s().pumpingEnabledAt).toBe(NOW);
  });

  it('hydrate leaves reminder prefs at their defaults when nothing was persisted', async () => {
    h.prefs = {};
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({
      dueDateReminders: true,
      staleTimerReminders: true,
      ageMilestones: true,
      pumpingReminders: false,
      pumpingIntervalMin: 180,
      pumpingEnabledAt: null,
    });
    await s().hydrate();
    expect(s().dueDateReminders).toBe(true);
    expect(s().staleTimerReminders).toBe(true);
    expect(s().ageMilestones).toBe(true);
    expect(s().pumpingReminders).toBe(false);
    expect(s().pumpingIntervalMin).toBe(180);
    expect(s().pumpingEnabledAt).toBeNull();
  });

  // Regression guard: a persisted `false` is meaningful and must survive
  // hydration. A truthiness check (`if (prefs.dueDateReminders)`) would treat
  // a stored `false` as "nothing persisted" and silently resurrect the
  // default `true`. This test fails under that regression.
  it('hydrate restores a persisted false, not the default true (truthiness regression guard)', async () => {
    h.prefs = { dueDateReminders: false };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ dueDateReminders: true });
    await s().hydrate();
    expect(s().dueDateReminders).toBe(false);
  });

  // pumpingEnabledAt's own guard is `!== undefined` rather than `!= null`,
  // because a persisted explicit `null` (pumping was turned off) must
  // overwrite a stale non-null value already in memory.
  it('hydrate restores a persisted null pumpingEnabledAt over a stale in-memory value', async () => {
    h.prefs = { pumpingEnabledAt: null };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ pumpingEnabledAt: NOW });
    await s().hydrate();
    expect(s().pumpingEnabledAt).toBeNull();
  });

  it('napSuggestions defaults to off, because it is advice rather than a fact', () => {
    expect(s().napSuggestions).toBe(false);
  });

  it('setReminderPref updates napSuggestions and persists', () => {
    useAppStore.setState({ napSuggestions: false });
    s().setReminderPref('napSuggestions', true);
    expect(s().napSuggestions).toBe(true);
    expect(savePrefs).toHaveBeenCalledWith({ napSuggestions: true });
  });

  it('hydrate applies a persisted napSuggestions, including a stored false', async () => {
    h.prefs = { napSuggestions: true };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ napSuggestions: false });
    await s().hydrate();
    expect(s().napSuggestions).toBe(true);

    // `!= null`, not truthiness: a persisted false has to survive hydration.
    h.prefs = { napSuggestions: false };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ napSuggestions: true });
    await s().hydrate();
    expect(s().napSuggestions).toBe(false);
  });

  it('treatmentReminders defaults on', () => {
    expect(useAppStore.getState().treatmentReminders).toBe(true);
  });

  it('switching treatmentReminders ON stamps treatmentRemindersEnabledAt with the current time', () => {
    useAppStore.setState({ treatmentReminders: false, treatmentRemindersEnabledAt: null });
    const before = Date.now();
    s().setReminderPref('treatmentReminders', true);
    const after = Date.now();
    expect(s().treatmentReminders).toBe(true);
    expect(s().treatmentRemindersEnabledAt).not.toBeNull();
    expect(s().treatmentRemindersEnabledAt as number).toBeGreaterThanOrEqual(before);
    expect(s().treatmentRemindersEnabledAt as number).toBeLessThanOrEqual(after);
    expect(savePrefs).toHaveBeenCalledWith({
      treatmentReminders: true,
      treatmentRemindersEnabledAt: s().treatmentRemindersEnabledAt,
    });
  });

  it('switching treatmentReminders OFF clears treatmentRemindersEnabledAt to null', () => {
    useAppStore.setState({ treatmentReminders: true, treatmentRemindersEnabledAt: NOW });
    s().setReminderPref('treatmentReminders', false);
    expect(s().treatmentReminders).toBe(false);
    expect(s().treatmentRemindersEnabledAt).toBeNull();
    expect(savePrefs).toHaveBeenCalledWith({
      treatmentReminders: false,
      treatmentRemindersEnabledAt: null,
    });
  });

  it('hydrate applies persisted treatment reminder prefs', async () => {
    h.prefs = { treatmentReminders: false, treatmentRemindersEnabledAt: 1234 };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ treatmentReminders: true, treatmentRemindersEnabledAt: null });
    await s().hydrate();
    expect(s().treatmentReminders).toBe(false);
    expect(s().treatmentRemindersEnabledAt).toBe(1234);
  });

  // treatmentRemindersEnabledAt's own guard is `!== undefined` rather than
  // `!= null`, because a persisted explicit `null` (treatments were turned
  // off) must overwrite a stale non-null value already in memory.
  it('hydrate restores a persisted null treatmentRemindersEnabledAt over a stale in-memory value', async () => {
    h.prefs = { treatmentRemindersEnabledAt: null };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ treatmentRemindersEnabledAt: NOW });
    await s().hydrate();
    expect(s().treatmentRemindersEnabledAt).toBeNull();
  });
});

describe('growth-reference persistence', () => {
  it('setGrowthReference toggles the flag and persists it', () => {
    useAppStore.setState({ showGrowthReference: true });
    s().setGrowthReference(false);
    expect(s().showGrowthReference).toBe(false);
    expect(savePrefs).toHaveBeenCalledWith({ showGrowthReference: false });
  });

  it('hydrate restores a persisted false (the state worth remembering)', async () => {
    h.prefs = { showGrowthReference: false };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ showGrowthReference: true });
    await s().hydrate();
    expect(s().showGrowthReference).toBe(false);
  });
});

describe('rhythm-layer persistence', () => {
  it('setRhythmLayer toggles one layer and persists all three', () => {
    useAppStore.setState({ rhythmShowSleep: true, rhythmShowFeeds: true, rhythmShowDiapers: true });
    s().setRhythmLayer('diapers', false);
    expect(s().rhythmShowDiapers).toBe(false);
    expect(s().rhythmShowSleep).toBe(true);
    expect(s().rhythmShowFeeds).toBe(true);
    expect(savePrefs).toHaveBeenCalledWith({ rhythmShowSleep: true, rhythmShowFeeds: true, rhythmShowDiapers: false });
  });

  it('setRhythmLayer can turn a layer back on', () => {
    useAppStore.setState({ rhythmShowSleep: true, rhythmShowFeeds: false, rhythmShowDiapers: true });
    s().setRhythmLayer('feeds', true);
    expect(s().rhythmShowFeeds).toBe(true);
    expect(savePrefs).toHaveBeenCalledWith({ rhythmShowSleep: true, rhythmShowFeeds: true, rhythmShowDiapers: true });
  });

  it('hydrate restores a persisted false layer (the state worth remembering)', async () => {
    h.prefs = { rhythmShowDiapers: false };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ rhythmShowDiapers: true });
    await s().hydrate();
    expect(s().rhythmShowDiapers).toBe(false);
  });

  it('hydrate leaves layers on by default when nothing was persisted', async () => {
    h.prefs = {};
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ rhythmShowSleep: true, rhythmShowFeeds: true, rhythmShowDiapers: true });
    await s().hydrate();
    expect(s().rhythmShowSleep).toBe(true);
    expect(s().rhythmShowFeeds).toBe(true);
    expect(s().rhythmShowDiapers).toBe(true);
  });
});

describe('bath rhythm persistence', () => {
  // `AsyncStorage.setItem('budkin.prefs.v1', ...)` in the task brief becomes
  // `h.prefs = {...}` here: `@/data/prefs` is mocked file-wide (see the
  // "REQUIRED" comment above), so `loadPrefs()` reads `h.prefs`, never real
  // AsyncStorage, exactly like every other hydrate test in this file.
  it('seeds a child rhythm from the legacy pref, plus one day', async () => {
    h.prefs = { smallWashesPerBig: 5 };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().legacyRhythm).toEqual({ fullEveryDays: 6, quickEveryDays: 1 });
    expect(useAppStore.getState().bathRhythms).toEqual({});
  });

  it('falls back to the built-in default with no legacy pref stored', async () => {
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().legacyRhythm).toEqual({ fullEveryDays: 3, quickEveryDays: 1 });
  });

  it('writes one child rhythm without disturbing another', async () => {
    useAppStore.setState({ bathRhythms: { c2: { fullEveryDays: 7, quickEveryDays: 2 } } });
    useAppStore.getState().setBathRhythm('c1', { fullEveryDays: 1 });
    expect(useAppStore.getState().bathRhythms).toEqual({
      c1: { fullEveryDays: 1, quickEveryDays: 1 },
      c2: { fullEveryDays: 7, quickEveryDays: 2 },
    });
  });

  it('clamps on the way in, so persistence never holds an out-of-range value', () => {
    useAppStore.setState({ bathRhythms: {} });
    useAppStore.getState().setBathRhythm('c1', { fullEveryDays: 900, quickEveryDays: -3 });
    expect(useAppStore.getState().bathRhythms.c1).toEqual({ fullEveryDays: 30, quickEveryDays: 0 });
  });
});

describe('loadProfile (lazy fetch of read-only Baby Buddy server settings)', () => {
  it('demo mode: profile stays null, marked loaded, no fetch', async () => {
    useAppStore.setState({ connection: { mode: 'local' } });
    await s().loadProfile();
    expect(s().profile).toBeNull();
    expect(s().profileLoaded).toBe(true);
    expect(s().profileLoading).toBe(false);
    expect(loadProfileFromServer).not.toHaveBeenCalled();
  });

  it('success: fetches and stores the profile', async () => {
    h.profile = { username: 'alex', timezone: 'UTC', language: 'en' } as Profile;
    await s().loadProfile();
    expect(s().profile).toEqual(h.profile);
    expect(s().profileLoaded).toBe(true);
    expect(s().profileLoading).toBe(false);
    expect(s().profileError).toBe(false);
    expect(loadProfileFromServer).toHaveBeenCalledWith(s().connection);
  });

  it('error: sets profileError and clears loading, logs the status, without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.profileFails = true;
    await expect(s().loadProfile()).resolves.toBeUndefined();
    expect(s().profileError).toBe(true);
    expect(s().profileLoading).toBe(false);
    expect(s().profileLoaded).toBe(false);
    expect(warn).toHaveBeenCalled(); // diagnostic log fired for the failed /api/profile/
    warn.mockRestore();
  });

  it('laziness: a second call no-ops once loaded', async () => {
    await s().loadProfile();
    expect(vi.mocked(loadProfileFromServer)).toHaveBeenCalledTimes(1);
    await s().loadProfile();
    expect(vi.mocked(loadProfileFromServer)).toHaveBeenCalledTimes(1);
  });

  it('laziness: a second call no-ops while already loading', async () => {
    let resolve!: (v: Profile | null) => void;
    vi.mocked(loadProfileFromServer).mockImplementationOnce(
      () => new Promise<Profile | null>((r) => { resolve = r; }),
    );
    const first = s().loadProfile();
    const second = s().loadProfile(); // fires while the first is still in flight
    resolve({ username: 'alex' });
    await Promise.all([first, second]);
    expect(vi.mocked(loadProfileFromServer)).toHaveBeenCalledTimes(1);
  });

  it('drops a stale result if the session changed while /api/profile/ was in flight', async () => {
    let resolve!: (v: Profile | null) => void;
    vi.mocked(loadProfileFromServer).mockImplementationOnce(
      () => new Promise<Profile | null>((r) => { resolve = r; }),
    );
    const p = s().loadProfile();
    // session switches to a different server mid-fetch (as a reset would)
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'https://b', token: 'b' },
      profile: null,
      profileLoaded: false,
    });
    resolve({ username: 'server-a-user' });
    await p;
    // server A's profile must NOT repopulate server B's settings
    expect(s().profile).toBeNull();
    expect(s().profileLoaded).toBe(false);
  });

  it('no connection: no-ops without fetching', async () => {
    useAppStore.setState({ connection: null });
    await s().loadProfile();
    expect(s().profileLoaded).toBe(false);
    expect(loadProfileFromServer).not.toHaveBeenCalled();
  });

  it('disconnect clears the profile state', async () => {
    await s().loadProfile();
    expect(s().profileLoaded).toBe(true);
    s().disconnect();
    expect(s().profile).toBeNull();
    expect(s().profileLoaded).toBe(false);
    expect(s().profileError).toBe(false);
  });

  it('connect resets profile state so a newly-connected server refetches', async () => {
    await s().loadProfile();
    expect(s().profileLoaded).toBe(true);
    await s().connect('https://new.lan', 'tok2');
    expect(s().profileLoaded).toBe(false);
    expect(s().profile).toBeNull();
    expect(s().profileError).toBe(false);
  });
});

describe('loadTags (lazy, cached server tag list for the picker)', () => {
  it('success: fetches, stores the tag list, and marks loaded', async () => {
    h.tags = [{ name: 'Fussy', color: '#f80' }, { name: 'Sleepy' }];
    await s().loadTags();
    expect(s().tags).toEqual(h.tags);
    expect(s().tagsLoaded).toBe(true);
    expect(s().tagsLoading).toBe(false);
    expect(loadTagsFromServer).toHaveBeenCalledWith(s().connection);
  });

  it('laziness: a second call no-ops once loaded', async () => {
    await s().loadTags();
    expect(vi.mocked(loadTagsFromServer)).toHaveBeenCalledTimes(1);
    await s().loadTags();
    expect(vi.mocked(loadTagsFromServer)).toHaveBeenCalledTimes(1);
  });

  it('laziness: a second call no-ops while already loading', async () => {
    let resolve!: (v: Tag[]) => void;
    vi.mocked(loadTagsFromServer).mockImplementationOnce(
      () => new Promise<Tag[]>((r) => { resolve = r; }),
    );
    const first = s().loadTags();
    const second = s().loadTags();
    resolve([{ name: 'Fussy' }]);
    await Promise.all([first, second]);
    expect(vi.mocked(loadTagsFromServer)).toHaveBeenCalledTimes(1);
  });

  it('local mode: seeds the fallback tag list without hitting the server', async () => {
    useAppStore.setState({ connection: { mode: 'local' } });
    await s().loadTags();
    expect(s().tags).toEqual(DEMO_TAGS);
    expect(s().tags.map((t) => t.name)).toEqual(['Left side', 'Cluster', 'Spit-up', 'Fussy', 'Sleepy']);
    expect(s().tagsLoaded).toBe(true);
    expect(loadTagsFromServer).not.toHaveBeenCalled();
  });

  it('no connection: no-ops without fetching', async () => {
    useAppStore.setState({ connection: null });
    await s().loadTags();
    expect(s().tagsLoaded).toBe(false);
    expect(loadTagsFromServer).not.toHaveBeenCalled();
  });

  it('error: tolerates staleness — keeps existing tags, clears loading, stays unloaded for retry', async () => {
    useAppStore.setState({ tags: [{ name: 'Cached' }] });
    h.tagsFails = true;
    await expect(s().loadTags()).resolves.toBeUndefined();
    expect(s().tags).toEqual([{ name: 'Cached' }]); // not wiped
    expect(s().tagsLoading).toBe(false);
    expect(s().tagsLoaded).toBe(false); // can retry on the next open
  });

  it('drops a stale result if the session changed while /api/tags/ was in flight', async () => {
    let resolve!: (v: Tag[]) => void;
    vi.mocked(loadTagsFromServer).mockImplementationOnce(
      () => new Promise<Tag[]>((r) => { resolve = r; }),
    );
    const p = s().loadTags();
    // session switches to a different server mid-fetch (as a reset would)
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'https://b', token: 'b' },
      tags: [],
      tagsLoaded: false,
    });
    resolve([{ name: 'ServerA-only' }]);
    await p;
    // server A's tags must NOT repopulate server B's picker
    expect(s().tags).toEqual([]);
    expect(s().tagsLoaded).toBe(false);
  });
});

describe('createTag (free-form tag creation)', () => {
  it('trims a new name and selects it onto the working entry', () => {
    s().openSheet('feeding');
    s().createTag('  Growth spurt  ');
    expect(s().te.tags).toContain('Growth spurt');
  });

  it('rejects a blank / whitespace-only name', () => {
    s().openSheet('feeding');
    s().createTag('   ');
    s().createTag('');
    expect(s().te.tags).toEqual([]);
  });

  it('rejects the structural HIDDEN_TAGS so they can never be created', () => {
    s().openSheet('feeding');
    for (const t of ['bath', 'small', 'big', 'left', 'right']) s().createTag(t);
    expect(s().te.tags).toEqual([]);
  });

  it('does not duplicate an already-selected tag', () => {
    s().openSheet('feeding');
    s().createTag('Fussy');
    s().createTag('Fussy');
    expect(s().te.tags.filter((t) => t === 'Fussy')).toHaveLength(1);
  });

  it('a created tag rides onto the saved entry.tags', () => {
    s().openSheet('feeding');
    s().createTag('Teething');
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.tags).toContain('Teething');
  });
});

describe('visibleTags (union of server + selected, minus structural)', () => {
  const server: Tag[] = [
    { name: 'Fussy', color: '#f80' },
    { name: 'Sleepy', color: '#08f' },
    { name: 'left' }, // a structural marker that leaked into the server list
  ];

  it('unions server tags with entry-only tags and drops HIDDEN_TAGS', () => {
    const out = visibleTags(server, ['Cluster', 'right']);
    expect(out.map((t) => t.name)).toEqual(['Fussy', 'Sleepy', 'Cluster']);
    // structural 'left' (server) and 'right' (selected) never surface
    expect(out.map((t) => t.name)).not.toContain('left');
    expect(out.map((t) => t.name)).not.toContain('right');
  });

  it('carries the server color through and leaves entry-only tags colorless', () => {
    const out = visibleTags(server, ['Cluster']);
    expect(out.find((t) => t.name === 'Fussy')?.color).toBe('#f80');
    expect(out.find((t) => t.name === 'Cluster')?.color).toBeUndefined();
  });

  it('does not duplicate a selected tag that is already a server tag', () => {
    const out = visibleTags(server, ['Fussy']);
    expect(out.filter((t) => t.name === 'Fussy')).toHaveLength(1);
  });

  it('a breastfeeding "both" entry folds left/right into tags, but they never show as chips', () => {
    s().openSheet('feeding');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'left' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.tags).toContain('left'); // structural side marker survives on the entry
    const chips = visibleTags(server, e.tags).map((t) => t.name);
    expect(chips).not.toContain('left');
    expect(chips).not.toContain('right');
  });
});

describe('adopt (push a local-mode user\'s data up to a Baby Buddy server)', () => {
  beforeEach(() => {
    useAppStore.setState({ connection: { mode: 'local' }, connected: true });
    vi.mocked(serverHasData).mockClear();
    vi.mocked(uploadUnsynced).mockClear();
    vi.mocked(matchServerChild).mockClear();
    vi.mocked(loadFromServer).mockClear();
    vi.mocked(saveConnection).mockClear();
    vi.mocked(serverHasData).mockResolvedValue(false);
    vi.mocked(matchServerChild).mockReturnValue(null);
    // Full-success stamping default for this block: any serverId==null record
    // gets stamped, mirroring uploadUnsynced's real "everything pushed"
    // outcome. Individual tests override with mockImplementationOnce for the
    // partial-upload / server-switch scenarios.
    vi.mocked(uploadUnsynced).mockImplementation(async (state) => ({
      children: state.children.map((c) => (c.serverId == null ? { ...c, serverId: 501 } : c)),
      entries: state.entries.map((e) => (e.serverId == null ? { ...e, serverId: 601 } : e)),
      measurements: state.measurements.map((m) => (m.serverId == null ? { ...m, serverId: 701 } : m)),
    }));
  });

  it('against an empty server: uploads the local data and switches to server mode', async () => {
    const localChild: Child = { id: 'localA', first: 'Ann', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'done' });
    expect(serverHasData).toHaveBeenCalledWith({ mode: 'server', serverUrl: 'https://new.lan', token: 'tok' });
    const uploaded = vi.mocked(uploadUnsynced).mock.calls[0][0];
    expect(uploaded.children).toEqual([localChild]); // the not-yet-synced local child was uploaded
    expect(s().connection).toEqual({ mode: 'server', serverUrl: 'https://new.lan', token: 'tok' });
    expect(s().connected).toBe(true);
    expect(loadFromServer).toHaveBeenCalledWith({ mode: 'server', serverUrl: 'https://new.lan', token: 'tok' });
    expect(saveConnection).toHaveBeenCalledWith({ mode: 'server', serverUrl: 'https://new.lan', token: 'tok' });
    // The adopted (uploaded + reconciled) entities now belong to this server:
    // the origin is stamped alongside the connection, licensing a later
    // post-expiry reconnect through connect() to reconcile them.
    expect(h.entityOrigin).toBe('https://new.lan');
    // Full success clears the persisted adopt target (Finding 2) — a later
    // adopt against a different server has nothing stale to reset.
    expect(clearAdoptTarget).toHaveBeenCalled();
  });

  it('a local child\'s id survives a successful adopt, and selectedChildId still points at a real child', async () => {
    const localChild: Child = { id: 'localF', first: 'Fay', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild], selectedChildId: 'localF' });
    // The post-success reload: the server now knows this child (serverId 501,
    // matching the describe block's default `uploadUnsynced` stamp), returned
    // under its own server-derived id/fields.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '501', serverId: 501, first: 'Fay', last: '', birth: NOW }],
      entries: [], timers: [], selectedChildId: '501',
      lastFeed: {}, measurements: [],
    });

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'done' });
    // Reconciliation keeps the LOCAL id (entries/measurements reference it);
    // the server's numeric id is not substituted in.
    expect(s().children.map((c) => c.id)).toEqual(['localF']);
    expect(s().children[0].serverId).toBe(501);
    // selectedChildId still points at a child that exists in the resulting list.
    expect(s().selectedChildId).toBe('localF');
    expect(s().children.some((c) => c.id === s().selectedChildId)).toBe(true);
  });

  it('keeps running timers when the post-adopt reload\'s timers fetch failed (timers: null)', async () => {
    const localChild: Child = { id: 'localT', first: 'Tia', last: '', birth: NOW, color: '#fff' };
    const running: Timer = { id: 't-run', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: NOW - 5 * M, childId: 'localT' };
    useAppStore.setState({ children: [localChild], selectedChildId: 'localT', timers: [running] });
    // The post-success reload answers everything except /api/timers/.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '501', serverId: 501, first: 'Tia', last: '', birth: NOW }],
      entries: [], measurements: [], selectedChildId: '501',
      lastFeed: {},
      timers: null,
    });

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'done' });
    // null ("unknown") keeps the in-memory timers; only a real timers answer
    // may replace them wholesale.
    expect(s().timers).toHaveLength(1);
    expect(s().timers[0]).toMatchObject({ id: 't-run' });
  });

  it('on success, upserts the adopted server into savedServers (so it appears in the reconnect list)', async () => {
    useAppStore.setState({ savedServers: [] });
    h.servers = [];

    const result = await s().adopt('https://adopted.lan', 'tok');

    expect(result).toEqual({ status: 'done' });
    expect(s().savedServers.map((x) => x.serverUrl)).toContain('https://adopted.lan');
    expect(h.servers).toHaveLength(1); // persisted, mirroring connect()
  });

  it('does NOT upsert savedServers on a guard/partial/error outcome (only on done)', async () => {
    useAppStore.setState({ savedServers: [] });
    h.servers = [];
    vi.mocked(serverHasData).mockResolvedValueOnce(true);

    const result = await s().adopt('https://guarded.lan', 'tok');

    expect(result).toEqual({ status: 'guard' });
    expect(s().savedServers).toEqual([]);
    expect(h.servers).toEqual([]);
  });

  it('against a non-empty server without override: guards instead of uploading, stays local', async () => {
    vi.mocked(serverHasData).mockResolvedValueOnce(true);

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'guard' });
    expect(uploadUnsynced).not.toHaveBeenCalled();
    expect(s().connection).toEqual({ mode: 'local' });
    expect(s().connected).toBe(true);
  });

  it('non-empty WITH uploadAnyway: dedups against a matching server child, then uploads', async () => {
    const localChild: Child = { id: 'localB', first: 'Ben', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });
    vi.mocked(serverHasData).mockResolvedValueOnce(true);
    const serverChild: Child = { id: '900', serverId: 900, first: 'Ben', last: '', birth: NOW, color: '#eee' };
    vi.mocked(loadFromServer)
      .mockResolvedValueOnce({ treatments: [], // the dedup fetch
        children: [serverChild], entries: [], timers: [], selectedChildId: '900',
        lastFeed: {}, measurements: [],
      })
      .mockResolvedValueOnce({ treatments: [], // the post-success reload
        children: [serverChild], entries: [], timers: [], selectedChildId: '900',
        lastFeed: {}, measurements: [],
      });
    vi.mocked(matchServerChild).mockReturnValueOnce(900);

    const result = await s().adopt('https://new.lan', 'tok', { uploadAnyway: true });

    expect(matchServerChild).toHaveBeenCalledWith(localChild, [serverChild]);
    // Attached to the existing server child (not duplicated) BEFORE uploading
    // — uploadUnsynced then sees serverId already set and skips it.
    const uploaded = vi.mocked(uploadUnsynced).mock.calls[0][0];
    expect(uploaded.children.find((c) => c.id === 'localB')?.serverId).toBe(900);
    expect(result).toEqual({ status: 'done' });
  });

  it('when uploadUnsynced leaves a record serverId==null: returns partial, stays local', async () => {
    const localChild: Child = { id: 'localC', first: 'Cara', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children, // unchanged: the push never completed
      entries: state.entries,
      measurements: state.measurements,
    }));

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'partial' });
    expect(s().connection).toEqual({ mode: 'local' });
    expect(s().children.find((c) => c.id === 'localC')?.serverId).toBeUndefined();
  });

  it('when serverHasData throws: returns error, stays local', async () => {
    vi.mocked(serverHasData).mockRejectedValueOnce(new Error('bad token'));

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'error', message: 'bad token' });
    expect(s().connection).toEqual({ mode: 'local' });
    expect(uploadUnsynced).not.toHaveBeenCalled();
  });

  it('server-switch reset: adopting a DIFFERENT server clears serverIds stamped by an abandoned adoption (persists across a simulated app restart)', async () => {
    const childA: Child = { id: 'localD', first: 'Dee', last: '', birth: NOW, color: '#fff' };
    const childB: Child = { id: 'localE', first: 'Eve', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [childA, childB] });
    // Server A: only childA's push succeeds -> the overall result is
    // `partial`, so the persisted adopt target stays pointed at server A (an
    // "abandoned" adoption in local mode).
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children.map((c) => (c.id === 'localD' ? { ...c, serverId: 111 } : c)),
      entries: state.entries,
      measurements: state.measurements,
    }));

    const first = await s().adopt('https://server-a.lan', 'tok');
    expect(first).toEqual({ status: 'partial' });
    expect(s().children.find((c) => c.id === 'localD')?.serverId).toBe(111);

    // Simulate the app being killed and relaunched between the abandoned
    // attempt and this retry: the ONLY thing carrying the prior target
    // forward is durable storage (there is no module-memory fallback left),
    // so stub `loadAdoptTarget` directly rather than relying on the previous
    // call's `saveAdoptTarget` having landed in the same in-memory mock.
    vi.mocked(loadAdoptTarget).mockResolvedValueOnce('https://server-a.lan');

    // Adopting a DIFFERENT server must clear the stale serverId from A BEFORE
    // uploading, or childA would be wrongly skipped as "already synced" (to
    // the wrong server).
    await s().adopt('https://server-b.lan', 'tok');
    const secondUpload = vi.mocked(uploadUnsynced).mock.calls[1][0];
    expect(secondUpload.children.every((c) => c.serverId == null)).toBe(true);
  });

  it('server-switch reset fires purely off a persisted target (loadAdoptTarget -> "A"), even with no prior adopt() call in this session', async () => {
    const stamped: Child = { id: 'localZ', serverId: 111, first: 'Zed', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [stamped] });
    vi.mocked(loadAdoptTarget).mockResolvedValueOnce('https://server-a.lan');

    await s().adopt('https://server-b.lan', 'tok');

    const uploaded = vi.mocked(uploadUnsynced).mock.calls[0][0];
    expect(uploaded.children.find((c) => c.id === 'localZ')?.serverId).toBeUndefined();
  });

  it('on full success, an expecting child (deliberately never uploaded) survives the post-success reload instead of being dropped', async () => {
    const bornChild: Child = { id: 'localBorn', first: 'Amy', last: '', birth: NOW, color: '#fff' };
    const expectingChild: Child = {
      id: 'localDue',
      first: 'Sky',
      last: '',
      birth: NOW + 30 * 86400000,
      color: '#eee',
      expected: true,
    };
    useAppStore.setState({ children: [bornChild, expectingChild], selectedChildId: 'localDue' });
    // Mirror uploadUnsynced's real contract for this test: an expecting child
    // is deliberately skipped and never gets a serverId (see src/data/sync.ts),
    // unlike this block's default mock which stamps every serverId==null record.
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children.map((c) => (c.serverId == null && !c.expected ? { ...c, serverId: 501 } : c)),
      entries: state.entries,
      measurements: state.measurements,
    }));
    // Post-success reload: the server only knows about the born (now-synced)
    // child. The expecting child was never uploaded, so it's absent here too,
    // exactly the case that must not wipe it from `children`.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '501', serverId: 501, first: 'Amy', last: '', birth: NOW }],
      entries: [],
      timers: [],
      selectedChildId: '501',
      lastFeed: {},
      measurements: [],
    });

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'done' });
    const stillThere = s().children.find((c) => c.id === 'localDue');
    expect(stillThere).toBeDefined();
    expect(stillThere?.expected).toBe(true);
    expect(stillThere?.birth).toBe(expectingChild.birth);
    // Selection must not silently jump to the server's first child.
    expect(s().selectedChildId).toBe('localDue');
    expect(s().children.some((c) => c.id === s().selectedChildId)).toBe(true);
  });

  it('on full success, a note entry belonging to the expecting child is not treated as leftover work and survives the reload', async () => {
    const bornChild: Child = { id: 'localBorn', first: 'Amy', last: '', birth: NOW, color: '#fff' };
    const expectingChild: Child = {
      id: 'localDue',
      first: 'Sky',
      last: '',
      birth: NOW + 30 * 86400000,
      color: '#eee',
      expected: true,
    };
    // `heldBack: true` mirrors what `commitWrite` would have stamped at
    // write time (the note's owner had no `serverId` and was `expected`).
    // This is now a stored fact, not something re-derived from `expected` or
    // a timestamp at merge time.
    const note: Entry = { id: 'noteDue', childId: 'localDue', tags: [], type: 'note', time: NOW, text: 'Scan: 20 weeks, all clear', heldBack: true };
    useAppStore.setState({ children: [bornChild, expectingChild], entries: [note], selectedChildId: 'localBorn' });
    // Mirror uploadUnsynced's real contract: the note's parent (the expecting
    // child) never gets a serverId, so uploadUnsynced skips pushing the note
    // too (no server child to attach it to) and leaves it serverId==null,
    // exactly the case Fix 1(a) must exclude from `stillUnsynced`.
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children.map((c) => (c.serverId == null && !c.expected ? { ...c, serverId: 501 } : c)),
      entries: state.entries,
      measurements: state.measurements,
    }));
    // Post-success reload: the server only knows about the born child and has
    // no entries at all (the note was never uploaded).
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '501', serverId: 501, first: 'Amy', last: '', birth: NOW }],
      entries: [],
      timers: [],
      selectedChildId: '501',
      lastFeed: {},
      measurements: [],
    });

    const result = await s().adopt('https://new.lan', 'tok');

    // The held-back note must NOT read as failed/leftover work: this is the
    // "Connect Baby Buddy" dead end one level down from the children fix.
    expect(result).toEqual({ status: 'done' });
    const stillThere = s().entries.find((e) => e.id === 'noteDue');
    expect(stillThere).toBeDefined();
    expect(stillThere?.childId).toBe('localDue');
  });

  it('Fix 3: clears heldBack once a previously-withheld note is actually pushed, even on a partial outcome', async () => {
    // `localBorn` was expecting when this note was written (commitWrite
    // stamped heldBack: true then), and has SINCE been confirmed born
    // (expected: false already), but in local mode nothing ever pushes it,
    // so the note still carries heldBack: true with no serverId right up
    // until this adopt(). `localStuck` deliberately fails to push, so the
    // overall result is `partial` and the set() right after uploadUnsynced
    // (the one this fix touches) is the FINAL state, not papered over by the
    // post-success reconciliation reload.
    const bornChild: Child = { id: 'localBorn', first: 'Amy', last: '', birth: NOW, color: '#fff' };
    const stuckChild: Child = { id: 'localStuck', first: 'Stuck', last: '', birth: NOW, color: '#eee' };
    const note: Entry = { id: 'noteWasDue', childId: 'localBorn', tags: [], type: 'note', time: NOW, text: 'now-born note', heldBack: true };
    useAppStore.setState({ children: [bornChild, stuckChild], entries: [note], selectedChildId: 'localBorn' });
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children.map((c) => (c.id === 'localBorn' ? { ...c, serverId: 501 } : c)),
      entries: state.entries.map((e) => (e.id === 'noteWasDue' ? { ...e, serverId: 601 } : e)),
      measurements: state.measurements,
    }));

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'partial' });
    const pushedNote = s().entries.find((e) => e.id === 'noteWasDue');
    expect(pushedNote?.serverId).toBe(601);
    // Self-consistent with the field's own doc comment: heldBack must be
    // cleared in the same update that stamps a real serverId, mirroring
    // flushUnsynced. isHeldBackEntry also guards on serverId == null today,
    // so nothing downstream depends on this yet, but the stored fact itself
    // must not contradict its own contract.
    expect(pushedNote?.heldBack).not.toBe(true);
  });
});

describe('flushUnsynced (reconnect flush of offline-created children/measurements)', () => {
  beforeEach(() => {
    vi.mocked(uploadUnsynced).mockClear();
    vi.mocked(uploadUnsynced).mockImplementation(async (state) => ({
      children: state.children.map((c) => (c.serverId == null ? { ...c, serverId: 501 } : c)),
      entries: state.entries,
      measurements: state.measurements.map((m) => (m.serverId == null ? { ...m, serverId: 701 } : m)),
    }));
  });

  it('stamps a serverId==null child while online in server mode', async () => {
    const localChild: Child = { id: 'localF', first: 'Finn', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });

    await s().flushUnsynced();

    expect(uploadUnsynced).toHaveBeenCalled();
    // entries: [] here because nothing in `entries` is held-back (see
    // `isHeldBackEntry`): an ordinary entry still flows through queue.ts's
    // flushQueue only; a held-back one (see the describe block below) would
    // appear here instead.
    expect(vi.mocked(uploadUnsynced).mock.calls[0][0].entries).toEqual([]);
    expect(s().children.find((c) => c.id === 'localF')?.serverId).toBe(501);
  });

  it('stamps a serverId==null measurement', async () => {
    useAppStore.setState({
      children: [{ id: 'c1', serverId: 42, first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      measurements: [{ id: 'localG', childId: 'c1', kind: 'weight', value: 5, date: NOW }],
    });

    await s().flushUnsynced();

    expect(s().measurements.find((m) => m.id === 'localG')?.serverId).toBe(701);
  });

  it('stamps a held-back entry (logged against an expecting child) once its owner is synced', async () => {
    // Mirrors saveChild's create push having already stamped the child's
    // serverId (e.g. via confirmBirth): the entry itself never went through
    // the write queue (see commitWrite's `expected` guard), so this is its
    // only path to the server. See `isHeldBackEntry`. `heldBack: true`
    // mirrors what `commitWrite` stamped at write time (while the owner was
    // still expected); the flag outlives the child's later confirmBirth.
    const bornChild: Child = { id: 'localP', serverId: 900, first: 'Nova', last: '', birth: NOW - 60 * M, color: '#fff' };
    const heldBack: Entry = { id: 'noteP', childId: 'localP', tags: [], type: 'note', time: NOW - 120 * M, text: 'pre-birth note', heldBack: true };
    useAppStore.setState({ children: [bornChild], entries: [heldBack] });
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children,
      entries: state.entries.map((e) => (e.serverId == null ? { ...e, serverId: 42 } : e)),
      measurements: state.measurements,
    }));

    await s().flushUnsynced();

    expect(vi.mocked(uploadUnsynced).mock.calls[0][0].entries).toEqual([heldBack]);
    expect(s().entries.find((e) => e.id === 'noteP')?.serverId).toBe(42);
  });

  it('is a no-op while offline', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'localH', first: 'H', last: '', birth: NOW, color: '#fff' }],
    });

    await s().flushUnsynced();

    expect(uploadUnsynced).not.toHaveBeenCalled();
  });

  it('is a no-op in local mode', async () => {
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [{ id: 'localI', first: 'I', last: '', birth: NOW, color: '#fff' }],
    });

    await s().flushUnsynced();

    expect(uploadUnsynced).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is unsynced', async () => {
    useAppStore.setState({
      children: [{ id: 'c1', serverId: 42, first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      measurements: [],
    });

    await s().flushUnsynced();

    expect(uploadUnsynced).not.toHaveBeenCalled();
  });

  // Finding 3: two concurrent reconnect triggers (e.g. setNetworkOnline(true)
  // + a foreground refresh()) both calling flushUnsynced must not both POST
  // the same serverId==null child — that would duplicate it on the server.
  it('guards against overlapping flushes: a second call while one is in flight is a no-op', async () => {
    const localChild: Child = { id: 'localJ', first: 'J', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });
    let resolveUpload!: (v: { children: Child[]; entries: Entry[]; measurements: Measurement[] }) => void;
    vi.mocked(uploadUnsynced).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );

    const first = s().flushUnsynced();
    const second = s().flushUnsynced(); // fires while `first` is still awaiting uploadUnsynced

    expect(uploadUnsynced).toHaveBeenCalledTimes(1);
    resolveUpload({ children: [{ ...localChild, serverId: 501 }], entries: [], measurements: [] });
    await first;
    await second;

    expect(uploadUnsynced).toHaveBeenCalledTimes(1);
    expect(s().children.find((c) => c.id === 'localJ')?.serverId).toBe(501);
  });

  // Finding 3 (functional merge): the wholesale `set({ children: result.children,
  // ... })` off the pre-await snapshot would clobber a create that lands
  // during the await; the functional merge-by-id must preserve it instead.
  it('a create landing during the in-flight upload is not dropped by the functional merge', async () => {
    const localChild: Child = { id: 'localK', first: 'K', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });
    let resolveUpload!: (v: { children: Child[]; entries: Entry[]; measurements: Measurement[] }) => void;
    vi.mocked(uploadUnsynced).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );

    const pending = s().flushUnsynced();
    // A concurrent create lands mid-flush (e.g. via saveChild) — simulated
    // directly on state rather than driving the whole saveChild flow.
    const newChild: Child = { id: 'localL', first: 'L', last: '', birth: NOW, color: '#eee' };
    useAppStore.setState((st) => ({ children: [...st.children, newChild] }));

    resolveUpload({ children: [{ ...localChild, serverId: 501 }], entries: [], measurements: [] });
    await pending;

    expect(s().children.find((c) => c.id === 'localL')).toBeDefined();
    expect(s().children.find((c) => c.id === 'localK')?.serverId).toBe(501);
  });

  // End-to-end offline-measurement parity: a measurement created while offline
  // stays local (serverId==null) and syncs on reconnect via flushUnsynced.
  it('an offline-created measurement persists (serverId==null) and gets stamped on reconnect', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'c1', serverId: 42, first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      measurements: [],
    });
    s().openMeasurement('weight');
    s().saveMeasurement(6.2, NOW);
    await flush();
    // Offline: no server push, no serverId — the create is pending on-device.
    expect(h.measPushed).toHaveLength(0);
    const created = s().measurements.find((m) => m.value === 6.2);
    expect(created).toBeDefined();
    expect(created?.serverId).toBeUndefined();

    // Reconnect and flush.
    useAppStore.setState({ offline: false });
    await s().flushUnsynced();

    expect(s().measurements.find((m) => m.value === 6.2)?.serverId).toBe(701);
  });

  it('shows a "Synced 1 item" toast when it stamps a single unsynced measurement', async () => {
    useAppStore.setState({
      children: [{ id: 'c1', serverId: 42, first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      measurements: [{ id: 'localG', childId: 'c1', kind: 'weight', value: 5, date: NOW }],
      toast: null,
    });

    await s().flushUnsynced();

    expect(s().toast).toBe('Synced 1 item');
  });

  it('the sync toast counts both children and measurements it stamps (plural)', async () => {
    useAppStore.setState({
      children: [{ id: 'localF', first: 'Finn', last: '', birth: NOW, color: '#fff' }],
      measurements: [{ id: 'localG', childId: 'localF', kind: 'weight', value: 5, date: NOW }],
      toast: null,
    });

    await s().flushUnsynced();

    expect(s().toast).toBe('Synced 2 items');
  });

  it('does not toast when the upload leaves records unsynced (nothing actually stamped)', async () => {
    useAppStore.setState({
      children: [{ id: 'localM', first: 'M', last: '', birth: NOW, color: '#fff' }],
      toast: null,
    });
    // The push never completes: records come back with serverId still null.
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children,
      entries: state.entries,
      measurements: state.measurements,
    }));

    await s().flushUnsynced();

    expect(s().toast).toBeNull();
  });

  it('does not toast on the offline early-return (nothing synced)', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'localN', first: 'N', last: '', birth: NOW, color: '#fff' }],
      toast: null,
    });

    await s().flushUnsynced();

    expect(uploadUnsynced).not.toHaveBeenCalled();
    expect(s().toast).toBeNull();
  });
});

describe('selectPendingCount (offline banner pending count)', () => {
  it('sums queued entries and unsynced (serverId==null) measurements; ignores synced ones', () => {
    useAppStore.setState({
      queueCount: 2,
      measurements: [
        { id: 'm-unsynced', childId: 'c1', kind: 'weight', value: 5, date: NOW },
        { id: 'm-synced', serverId: 9, childId: 'c1', kind: 'height', value: 60, date: NOW },
      ],
    });
    expect(selectPendingCount(s())).toBe(3);
  });

  it('is queueCount alone when no measurement is unsynced', () => {
    useAppStore.setState({ queueCount: 1, measurements: [] });
    expect(selectPendingCount(s())).toBe(1);
  });

  it('counts an offline-created measurement even with an empty entry queue', () => {
    useAppStore.setState({
      queueCount: 0,
      measurements: [{ id: 'm-unsynced', childId: 'c1', kind: 'weight', value: 5, date: NOW }],
    });
    expect(selectPendingCount(s())).toBe(1);
  });
});

describe('milestone store actions', () => {
  it('logMilestone prepends a milestone entry with the catalog title and empty user tags', () => {
    useAppStore.setState({ selectedChildId: '5', entries: [], connection: null });
    useAppStore.getState().logMilestone('first-steps', 1_000_000, 'took three');
    const e = useAppStore.getState().entries[0];
    expect(e.type).toBe('milestone');
    expect(e).toMatchObject({ key: 'first-steps', text: 'First steps', note: 'took three', time: 1_000_000, childId: '5', tags: [] });
  });

  it('editMilestone updates date and note in place', () => {
    const existing: MilestoneEntry = { id: 'e-x', childId: '5', type: 'milestone', key: 'first-word', time: 1, text: 'First word', note: 'a', tags: [] };
    useAppStore.setState({ selectedChildId: '5', entries: [existing], connection: null });
    useAppStore.getState().editMilestone('e-x', 2_000_000, undefined);
    const e = useAppStore.getState().entries.find((x) => x.id === 'e-x');
    expect(e).toMatchObject({ time: 2_000_000, note: undefined });
  });
});

describe('answerMilestonePrompt', () => {
  it('appends per selected child and is idempotent', () => {
    useAppStore.setState({ selectedChildId: 'c1', answeredMilestonePrompts: {} });
    s().answerMilestonePrompt('waves-bye');
    expect(s().answeredMilestonePrompts.c1).toEqual(['waves-bye']);
    s().answerMilestonePrompt('waves-bye'); // one prompt per milestone: no duplicate
    expect(s().answeredMilestonePrompts.c1).toEqual(['waves-bye']);
    s().answerMilestonePrompt('first-word');
    expect(s().answeredMilestonePrompts.c1).toEqual(['waves-bye', 'first-word']);
  });

  it('does not touch another child\'s answered set', () => {
    useAppStore.setState({ selectedChildId: 'c1', answeredMilestonePrompts: { c2: ['crawls'] } });
    s().answerMilestonePrompt('waves-bye');
    expect(s().answeredMilestonePrompts).toEqual({ c2: ['crawls'], c1: ['waves-bye'] });
  });

  it('no-ops when no child is selected', () => {
    useAppStore.setState({ selectedChildId: '', answeredMilestonePrompts: {} });
    s().answerMilestonePrompt('waves-bye');
    expect(s().answeredMilestonePrompts).toEqual({});
  });
});

describe('walkthrough persistence', () => {
  it('completeTutorial sets tutorialSeen and persists via savePrefs', () => {
    useAppStore.setState({ tutorialSeen: false });
    s().completeTutorial();
    expect(s().tutorialSeen).toBe(true);
    expect(savePrefs).toHaveBeenCalledWith({ tutorialSeen: true });
  });

  it('hydrate applies a persisted tutorialSeen', async () => {
    h.prefs = { tutorialSeen: true };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ tutorialSeen: false });
    await s().hydrate();
    expect(s().tutorialSeen).toBe(true);
  });

  it('hydrate leaves tutorialSeen false when nothing was persisted', async () => {
    h.prefs = {};
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ tutorialSeen: false });
    await s().hydrate();
    expect(s().tutorialSeen).toBe(false);
  });
});

describe('expecting children', () => {
  it('creates an expected child carrying the flag, and selects it', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });

    const kids = useAppStore.getState().children;
    expect(kids).toHaveLength(1);
    expect(kids[0].expected).toBe(true);
    expect(kids[0].serverId).toBeUndefined();
    expect(useAppStore.getState().selectedChildId).toBe(kids[0].id);
  });

  it('creates a born child with no expected flag', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Wren', last: '', birth: Date.parse('2026-01-05') });
    expect(useAppStore.getState().children[0].expected).toBeUndefined();
  });

  it('confirmBirth clears the flag and sets the real birth date', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    const id = useAppStore.getState().children[0].id;

    const actual = Date.parse('2026-11-24');
    useAppStore.getState().confirmBirth(id, actual);

    const kid = useAppStore.getState().children[0];
    expect(kid.expected).toBe(false);
    expect(kid.birth).toBe(actual);
  });

  it('leaves the confirmed child sync-eligible', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    const id = useAppStore.getState().children[0].id;
    useAppStore.getState().confirmBirth(id, Date.parse('2026-11-24'));

    const kid = useAppStore.getState().children[0];
    expect(kid.serverId).toBeUndefined(); // still unsynced, so the reconnect flush picks it up
    expect(kid.expected).toBe(false); // and no longer held back
  });

  it('confirmBirth on an unknown id is a no-op', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    const before = useAppStore.getState().children;
    useAppStore.getState().confirmBirth('nope', Date.now());
    expect(useAppStore.getState().children).toEqual(before);
  });

  it('confirmBirth on an already-born child is a no-op', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Wren', last: '', birth: Date.parse('2026-01-05') });
    const before = useAppStore.getState().children;
    useAppStore.getState().confirmBirth(before[0].id, Date.parse('2026-11-24'));
    expect(useAppStore.getState().children).toEqual(before);
  });

  it('server mode: an expected child is not pushed, a born one is', async () => {
    useAppStore.setState({
      children: [],
      selectedChildId: '',
      connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
      offline: false,
    });

    // The `!fields.expected` clause is the only thing that can block this push:
    // conn.mode === 'server' and !s.offline are both satisfied.
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    await flush();
    expect(h.childPushed).toHaveLength(0);

    // Positive control: without `expected`, the same server-mode setup does push.
    useAppStore.getState().saveChild({ first: 'Wren', last: '', birth: Date.parse('2026-01-05') });
    await flush();
    expect(h.childPushed).toHaveLength(1);
  });

  it('server mode online: a note written against an expecting child is neither pushed nor queued', async () => {
    // Queueing it would let it flush silently through `flushQueue`, which
    // never stamps a local serverId on an entry: only `flushUnsynced`'s
    // held-back push (once confirmBirth gives the child one) does that (see
    // commitWrite's `expected` guard and `isHeldBackEntry`). So it must stay
    // off the queue entirely, the same way a local-mode write does.
    useAppStore.setState({
      children: [],
      selectedChildId: '',
      connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
      offline: false,
    });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    const dueId = useAppStore.getState().children[0].id;
    useAppStore.setState({ selectedChildId: dueId });

    useAppStore.getState().openSheet('note');
    useAppStore.getState().setTE({ noteText: 'Scan: 20 weeks, all clear' });
    useAppStore.getState().save();
    await flush();

    expect(useAppStore.getState().entries).toHaveLength(1);
    expect(h.pushed).toHaveLength(0);
    expect(h.q).toHaveLength(0);
  });

  it('confirmBirth in server mode online: pushes the newly born child; keeps the local id and stamps serverId instead of rewriting it', async () => {
    useAppStore.setState({
      children: [],
      selectedChildId: '',
      connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
      offline: false,
    });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    await flush();
    expect(h.childPushed).toHaveLength(0); // still expected: saveChild's own push is held back
    const localId = useAppStore.getState().children[0].id;
    expect(useAppStore.getState().selectedChildId).toBe(localId);

    const actual = Date.parse('2026-11-24');
    useAppStore.getState().confirmBirth(localId, actual);
    await flush();

    expect(h.childPushed).toHaveLength(1);
    // Pushed with the post-birth fields (real birth date, no longer expected),
    // not the stale due date.
    expect(h.childPushed[0]).toMatchObject({ expected: false, birth: actual });
    const kid = useAppStore.getState().children[0];
    // the local id is NOT rewritten to the server id, and selection keeps
    // following it: entries/measurements reference this id, and rewriting it
    // would orphan them (the bug this whole design exists to prevent).
    expect(kid.id).toBe(localId);
    expect(useAppStore.getState().selectedChildId).toBe(localId);
    // serverId is stamped instead (like saveChild's create push) so
    // server-child ops (update / delete / sync) recognise it before the next
    // refresh. The slug comes from the same response, and is what the child
    // endpoints are actually keyed by.
    expect(kid.serverId).toBe(777);
    expect(kid.slug).toBe(SERVER_SLUG);
  });

  it('confirmBirth in local mode does not attempt a push and keeps the local id', async () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    const localId = useAppStore.getState().children[0].id;

    useAppStore.getState().confirmBirth(localId, Date.parse('2026-11-24'));
    await flush();

    expect(h.childPushed).toHaveLength(0);
    const kid = useAppStore.getState().children[0];
    expect(kid.id).toBe(localId);
    expect(kid.serverId).toBeUndefined();
    expect(useAppStore.getState().selectedChildId).toBe(localId);
  });
});

describe('held-back entries survive refresh/hydrate (regression for the blocking item)', () => {
  const expectingChild: Child = {
    id: 'localDue',
    first: 'Sky',
    last: '',
    birth: NOW + 30 * 86400000,
    color: '#eee',
    expected: true,
  };
  // `heldBack: true` mirrors what `commitWrite` stamps at write time for any
  // entry logged against a child with no `serverId` (an expecting child, see
  // `Child.expected`). A stored fact, not something re-derived later from
  // `expected` or a timestamp comparison.
  const note: Entry = {
    id: 'noteDue',
    childId: 'localDue',
    tags: [],
    type: 'note',
    time: NOW,
    text: 'Scan: 20 weeks, all clear',
    heldBack: true,
  };
  const bornOnServer = { id: 'c1', first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' };

  it('a note written for an expecting child survives refresh() in server mode', async () => {
    // The note was written while the child was expecting and is already in
    // memory (mirrors adopt() having just merged it back in); the server
    // reload naturally omits both the expecting child and its note, since
    // neither was ever pushed.
    useAppStore.setState({
      children: [...s().children, expectingChild],
      entries: [note],
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [bornOnServer],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });

    await s().refresh();

    const stillThere = s().entries.find((e) => e.id === 'noteDue');
    expect(stillThere).toBeDefined();
    expect(stillThere?.childId).toBe('localDue');
  });

  it('a note written for an expecting child survives hydrate() in server mode (app restart), when it is in the entity store but not on the queue and not on the server', async () => {
    // Cold restart: the note lives only in the durable entity store (it was
    // never queued: commitWrite returns early for local-mode writes, and the
    // note was written before the child's owner ever adopted a server). The
    // write queue itself stays empty for this test (h.q defaults to []),
    // which is what distinguishes this from the ordinary queued-entry case.
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [expectingChild],
      entries: [note],
      measurements: [],
      selectedChildId: 'localDue',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [bornOnServer],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: {},
      measurements: [],
    });

    await s().hydrate();

    expect(h.q).toEqual([]); // confirms this is the not-queued case, not mergeQueuedEntries'
    const stillThere = s().entries.find((e) => e.id === 'noteDue');
    expect(stillThere).toBeDefined();
    expect(stillThere?.childId).toBe('localDue');
  });

  it('a note written for an expecting child survives confirmBirth() then refresh() in server mode (expected clearing must not orphan it from protection)', async () => {
    // The note is written while the child is still expecting (mirrors the two
    // tests above): it lives only in memory/entity-store, never on the server
    // or the queue. confirmBirth then clears `expected` and stamps a
    // serverId. The note's `heldBack` flag was stamped once, at write time,
    // and confirmBirth flipping `expected` does not touch it, so the note
    // stays protected regardless of how the child's birth compares to the
    // note's own timestamp (see Finding 1: `clampBirth` returns local
    // midnight, which routinely lands BEFORE a same-day note, not after).
    useAppStore.setState({
      children: [...s().children, expectingChild],
      entries: [note],
    });
    const localId = expectingChild.id;
    // Realistic: `clampBirth` (src/lib/birthDate.ts) can only ever produce
    // local midnight of some day, never a future timestamp. Local midnight
    // of "now" is EARLIER than the note's own `time` (NOW), not later.
    const midnightOfNow = new Date(NOW);
    midnightOfNow.setHours(0, 0, 0, 0);
    const actualBirth = midnightOfNow.getTime();

    useAppStore.getState().confirmBirth(localId, actualBirth);
    await flush(); // let confirmBirth's own push resolve and stamp serverId

    const born = s().children.find((c) => c.id === localId);
    expect(born?.expected).toBe(false);
    expect(born?.serverId).toBe(777);

    // The server now knows the child (by the serverId confirmBirth just
    // stamped) but not yet the note: nothing has pushed it there.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '777', serverId: 777, first: 'Sky', last: '', birth: actualBirth }],
      entries: [],
      timers: [],
      selectedChildId: '777',
      lastFeed: {},
      measurements: [],
    });

    await s().refresh();

    const stillThere = s().entries.find((e) => e.id === 'noteDue');
    expect(stillThere).toBeDefined();
    expect(stillThere?.childId).toBe(localId);
  });
});

describe('Fix 1: editing a held-back entry must not drop heldBack', () => {
  it('expecting child, write a note, edit it, then refresh() with server data lacking it: the note survives and still carries heldBack', async () => {
    useAppStore.setState({
      children: [],
      selectedChildId: '',
      connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
      offline: false,
    });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: NOW + 30 * 86400000, expected: true });
    const dueId = useAppStore.getState().children[0].id;
    useAppStore.setState({ selectedChildId: dueId });

    // Write the note (create path, commitWrite stamps heldBack: true here).
    useAppStore.getState().openSheet('note');
    useAppStore.getState().setTE({ noteText: 'Scan: 20 weeks, all clear' });
    useAppStore.getState().save();
    await flush();
    const noteId = useAppStore.getState().entries[0].id;
    expect(useAppStore.getState().entries[0].heldBack).toBe(true);

    // Edit it (fix a typo): this is save()'s EDIT branch, which rebuilds a
    // brand-new entry object per activity type rather than calling
    // commitWrite. Before the fix it carried across only `serverId`.
    useAppStore.getState().openEdit(noteId);
    useAppStore.getState().setTE({ noteText: 'Scan: 20 weeks, all clear (typo fixed)' });
    useAppStore.getState().save();
    await flush();

    const edited = useAppStore.getState().entries.find((e) => e.id === noteId);
    expect(edited).toBeDefined();
    expect(edited?.type === 'note' ? edited.text : undefined).toBe('Scan: 20 weeks, all clear (typo fixed)');
    expect(edited?.heldBack).toBe(true);

    // A refresh with server data that (correctly) has never heard of this
    // note must not let it fall out of `entries`: `flushUnsynced` no longer
    // owns it if heldBack was dropped, and the persistence subscription would
    // write the shortened array straight over durable storage.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [],
      entries: [],
      timers: [],
      selectedChildId: '',
      lastFeed: {},
      measurements: [],
    });
    await useAppStore.getState().refresh();

    const survivor = useAppStore.getState().entries.find((e) => e.id === noteId);
    expect(survivor).toBeDefined();
    expect(survivor?.heldBack).toBe(true);
  });
});

describe('Finding 1 & 2 reproductions (heldBack must be a stored fact, never inferred)', () => {
  it('Finding 1a (ordinary path): a note written earlier the same day survives confirmBirth with a realistic midnight-today birth, then refresh()', async () => {
    // Reproduces the failure as it actually happens: `clampBirth` (see
    // src/lib/birthDate.ts) returns LOCAL MIDNIGHT, and `ConfirmBirthSheet`
    // prefills with today, so a same-day note's own timestamp is routinely
    // AFTER the birth that later gets recorded for it, not before.
    useAppStore.setState({
      children: [],
      selectedChildId: '',
      connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
      offline: false,
    });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: NOW + 30 * 86400000, expected: true });
    const dueId = useAppStore.getState().children[0].id;
    useAppStore.setState({ selectedChildId: dueId });

    // The 08:30 note, written while the child is still expecting.
    useAppStore.getState().openSheet('note');
    useAppStore.getState().setTE({ noteText: 'Kicking a lot today' });
    useAppStore.getState().save();
    await flush();
    expect(useAppStore.getState().entries).toHaveLength(1);
    const noteId = useAppStore.getState().entries[0].id;
    expect(useAppStore.getState().entries[0].childId).toBe(dueId);

    // confirmBirth with what `clampBirth` actually produces: local midnight
    // TODAY, which lands BEFORE the note's own (later, same-day) timestamp.
    const midnightOfNow = new Date(NOW);
    midnightOfNow.setHours(0, 0, 0, 0);
    const actualBirth = midnightOfNow.getTime();
    useAppStore.getState().confirmBirth(dueId, actualBirth);
    await flush();

    // Baby Buddy has no record of the note (it was never pushed): a refresh
    // must not let the server's blank slate silently drop it.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [{ id: '777', serverId: 777, first: 'Rowan', last: '', birth: actualBirth }],
      entries: [],
      timers: [],
      selectedChildId: '777',
      lastFeed: {},
      measurements: [],
    });
    await useAppStore.getState().refresh();

    const survivor = useAppStore.getState().entries.find((e) => e.id === noteId);
    expect(survivor).toBeDefined();
  });

  it('Finding 1b (overdue pregnancy): a note written after an already-past due date survives refresh() while the child is still expecting', async () => {
    // `clampDueDate` deliberately lets a past date through (an already
    // overdue pregnancy keeps its real due date). An overdue pregnancy is
    // common, not exceptional.
    useAppStore.setState({
      children: [],
      selectedChildId: '',
      connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
      offline: false,
    });
    const overdueDue = NOW - 10 * 86400000;
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: overdueDue, expected: true });
    const dueId = useAppStore.getState().children[0].id;
    useAppStore.setState({ selectedChildId: dueId });

    useAppStore.getState().openSheet('note');
    useAppStore.getState().setTE({ noteText: 'Still waiting...' });
    useAppStore.getState().save();
    await flush();
    const noteId = useAppStore.getState().entries[0].id;

    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [],
      entries: [],
      timers: [],
      selectedChildId: '',
      lastFeed: {},
      measurements: [],
    });
    await useAppStore.getState().refresh();

    const survivor = useAppStore.getState().entries.find((e) => e.id === noteId);
    expect(survivor).toBeDefined();
  });

  it("Finding 2: an ordinary QUEUED entry timestamped before its (born, synced) owner's birth is pushed exactly once, not double-pushed by flushUnsynced too", async () => {
    const bornSynced: Child = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW, color: '#fff' };
    const queuedEntry: Entry = {
      id: 'q1',
      childId: 'c1',
      tags: [],
      type: 'note',
      time: NOW - 60 * M, // before the recorded birth, the old timestamp-based check's blind spot
      text: 'early log',
    };
    h.q = [queuedEntry]; // an ordinary offline write, sitting on the retry queue
    useAppStore.setState({ children: [bornSynced], entries: [queuedEntry] });
    // Simulate uploadUnsynced ALSO pushing whatever entries it's handed, so a
    // double-push is directly observable via `h.pushed` (which
    // `pushEntryToServer`, used by `flushQueue`, already tracks). Persistent
    // (not `Once`): post-fix, `flushUnsynced` never even calls `uploadUnsynced`
    // here (nothing is held back), so a `mockImplementationOnce` would go
    // unconsumed and leak into a later, unrelated test.
    vi.mocked(uploadUnsynced).mockImplementation(async (state) => {
      for (const e of state.entries) {
        if (e.serverId == null) h.pushed.push(e);
      }
      return {
        children: state.children,
        entries: state.entries.map((e) => (e.serverId == null ? { ...e, serverId: 42 } : e)),
        measurements: state.measurements,
      };
    });

    await s().flushQueue();
    await s().flushUnsynced();

    expect(h.pushed.filter((e: any) => e.id === 'q1')).toHaveLength(1);
    // Restore the file's baseline passthrough default so this test's
    // side-effecting mock can't affect any test that runs after it.
    vi.mocked(uploadUnsynced).mockImplementation(async (state) => ({
      children: state.children,
      entries: state.entries,
      measurements: state.measurements,
    }));
  });
});

describe('heldBack migration (entries written before the field existed)', () => {
  beforeEach(() => {
    // Explicit, neutral passthrough: this describe's `hydrate()` calls
    // legitimately trigger `flushUnsynced` -> `uploadUnsynced` (a backfilled
    // entry makes `hasUnsynced` true), so pin the mock rather than depend on
    // whatever a previous describe block happened to leave it as.
    vi.mocked(uploadUnsynced).mockImplementation(async (state) => ({
      children: state.children,
      entries: state.entries,
      measurements: state.measurements,
    }));
  });

  it('backfills heldBack on a legacy flagless entry owned by a still-expecting child, on hydrate, and it survives a later refresh', async () => {
    const expectingChild: Child = { id: 'localDue', first: 'Sky', last: '', birth: NOW + 30 * 86400000, color: '#eee', expected: true };
    // No `heldBack` field at all: exactly what an entry persisted by a
    // pre-fix version of the app looks like on disk.
    const legacyNote: Entry = { id: 'legacyNote', childId: 'localDue', tags: [], type: 'note', time: NOW, text: 'pre-fix note' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [expectingChild],
      entries: [legacyNote],
      measurements: [],
      selectedChildId: 'localDue',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [],
      entries: [],
      timers: [],
      selectedChildId: '',
      lastFeed: {},
      measurements: [],
    });

    await s().hydrate();

    const backfilled = s().entries.find((e) => e.id === 'legacyNote');
    expect(backfilled?.heldBack).toBe(true);

    // Prove it actually protects the note across a LATER refresh too, not
    // just the load that backfilled it.
    vi.mocked(loadFromServer).mockResolvedValueOnce({ treatments: [],
      children: [],
      entries: [],
      timers: [],
      selectedChildId: '',
      lastFeed: {},
      measurements: [],
    });
    await s().refresh();
    expect(s().entries.find((e) => e.id === 'legacyNote')).toBeDefined();
  });

  it('does not backfill a flagless entry whose owning child is NOT expecting (an ordinary already-queued-or-pushed entry)', async () => {
    const born: Child = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW, color: '#fff' };
    const ordinary: Entry = { id: 'ord1', childId: 'c1', tags: [], type: 'note', time: NOW, text: 'ordinary' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [born],
      entries: [ordinary],
      measurements: [],
      selectedChildId: 'c1',
      lastFeed: {},
      legacyLastFeed: null,
    });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));

    await s().hydrate();

    const loaded = s().entries.find((e) => e.id === 'ord1');
    expect(loaded?.heldBack).toBeFalsy();
  });
});

describe('reconcileChildren', () => {
  const kid = (over: Partial<Child> = {}): Child => ({
    id: 'x',
    first: 'Ada',
    last: '',
    birth: Date.parse('2026-01-01'),
    color: '#E8A87C',
    ...over,
  });

  it('keeps the LOCAL id when a server child matches by serverId', () => {
    const server = [kid({ id: '501', serverId: 501, first: 'Ada' })];
    const local = [kid({ id: 'child1752', serverId: 501, first: 'Ada' })];
    const out = reconcileChildren(server, local);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('child1752');
    expect(out[0].serverId).toBe(501);
  });

  it('takes the server copy of every other field on a match, except the color', () => {
    const server = [kid({ id: '501', serverId: 501, first: 'Adaline', picture: 'https://s/a.jpg', color: '#000000' })];
    const local = [kid({ id: 'child1752', serverId: 501, first: 'Ada', picture: 'file:///tmp/a.jpg', color: '#ABCDEF' })];
    const out = reconcileChildren(server, local);
    expect(out[0].first).toBe('Adaline');
    expect(out[0].picture).toBe('https://s/a.jpg');
    // Baby Buddy has no color field, so a server-side one is fabricated and
    // must never clobber the persisted local tint on hydrate/refresh/adopt.
    expect(out[0].color).toBe('#ABCDEF');
  });

  it('assigns a fresh palette tint to a server child it has never seen', () => {
    const out = reconcileChildren([kid({ id: '502', serverId: 502, color: '#000000' })], []);
    expect(out[0].color).toBe(CHILD_COLORS[0]);
  });

  it('gives two never-seen server children different tints', () => {
    const server = [kid({ id: '501', serverId: 501 }), kid({ id: '502', serverId: 502 })];
    const out = reconcileChildren(server, []);
    expect(out[0].color).not.toBe(out[1].color);
  });

  it('does not hand a new server child a tint a local child already wears', () => {
    const local = [kid({ id: 'local1', color: CHILD_COLORS[0] })];
    const out = reconcileChildren([kid({ id: '501', serverId: 501 })], local);
    expect(out.find((c) => c.id === '501')?.color).toBe(CHILD_COLORS[1]);
  });

  it('does not reissue a matched sibling tint to a new child the server listed FIRST', () => {
    // Baby Buddy orders /api/children/ by name, not by creation, so a second
    // child added through its web UI whose name sorts first arrives AHEAD of
    // the child this device already knows, which almost always wears
    // CHILD_COLORS[0]. Seeding the tint search only with never-pushed locals
    // made the answer depend on that ordering.
    const local = [kid({ id: 'cA', serverId: 501, color: CHILD_COLORS[0] })];
    const server = [kid({ id: '502', serverId: 502 }), kid({ id: '501', serverId: 501 })];
    const out = reconcileChildren(server, local);
    expect(out.map((c) => [c.id, c.color])).toEqual([
      ['502', CHILD_COLORS[1]],
      ['cA', CHILD_COLORS[0]],
    ]);
  });

  it('gives every child a distinct tint whatever order the server lists them in', () => {
    // The property, stated directly: one matched local, one never-pushed local
    // and two new arrivals interleaved so the matched one comes after a new one.
    const local = [
      kid({ id: 'cA', serverId: 501, color: CHILD_COLORS[0] }),
      kid({ id: 'cB', color: CHILD_COLORS[1] }),
    ];
    const server = [
      kid({ id: '503', serverId: 503 }),
      kid({ id: '501', serverId: 501 }),
      kid({ id: '502', serverId: 502 }),
    ];
    const colors = reconcileChildren(server, local).map((c) => c.color);
    expect(colors).toHaveLength(4);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('adds a server child the app has never seen, keeping its server-derived id', () => {
    const out = reconcileChildren([kid({ id: '502', serverId: 502 })], []);
    expect(out.map((c) => c.id)).toEqual(['502']);
  });

  it('keeps a local child that has never been pushed', () => {
    const local = [kid({ id: 'child999' })]; // no serverId
    const out = reconcileChildren([kid({ id: '501', serverId: 501 })], local);
    expect(out.map((c) => c.id)).toEqual(['child999', '501']);
  });

  it('never duplicates a child that is both local-with-serverId and on the server', () => {
    const server = [kid({ id: '501', serverId: 501 })];
    const local = [kid({ id: 'child1752', serverId: 501 })];
    expect(reconcileChildren(server, local)).toHaveLength(1);
  });

  it('prepends local-only children and preserves the server order', () => {
    const server = [kid({ id: '501', serverId: 501 }), kid({ id: '502', serverId: 502 })];
    const local = [kid({ id: 'localA' }), kid({ id: 'localB' })];
    expect(reconcileChildren(server, local).map((c) => c.id)).toEqual(['localA', 'localB', '501', '502']);
  });

  it('drops a local child whose serverId is no longer on the server', () => {
    // Deleted from Baby Buddy elsewhere. The server is authoritative for
    // children it knows about, which is today's behaviour and must not change.
    const out = reconcileChildren([], [kid({ id: 'child1752', serverId: 501 })]);
    expect(out).toEqual([]);
  });

  it('returns an empty list when both sides are empty', () => {
    expect(reconcileChildren([], [])).toEqual([]);
  });

  it('drops a never-pushed local child whose id collides with a server child id', () => {
    const server = [kid({ id: 'c1', serverId: 501 })];
    const local = [kid({ id: 'c1' })]; // no serverId, id happens to collide
    const out = reconcileChildren(server, local);
    expect(out.map((c) => c.id)).toEqual(['c1']);
    const ids = out.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('nap-window persistence', () => {
  it('the store boots on 07:00-19:00, preserving the old hardcoded behaviour', () => {
    expect(s().napWindowStartMin).toBe(420);
    expect(s().napWindowEndMin).toBe(1140);
  });

  it('setNapWindow updates both endpoints and persists them together', () => {
    s().setNapWindow(480, 1200);
    expect(s().napWindowStartMin).toBe(480);
    expect(s().napWindowEndMin).toBe(1200);
    expect(savePrefs).toHaveBeenCalledWith({ napWindowStartMin: 480, napWindowEndMin: 1200 });
  });

  it('setNapWindow accepts midnight (0) rather than treating it as unset', () => {
    s().setNapWindow(0, 720);
    expect(s().napWindowStartMin).toBe(0);
    expect(savePrefs).toHaveBeenCalledWith({ napWindowStartMin: 0, napWindowEndMin: 720 });
  });

  it('setNapWindow accepts an inverted pair, which wraps midnight', () => {
    s().setNapWindow(1200, 240);
    expect(s().napWindowStartMin).toBe(1200);
    expect(s().napWindowEndMin).toBe(240);
  });

  it('setNapWindow clamps out-of-day input before storing it', () => {
    s().setNapWindow(-60, 5000);
    expect(s().napWindowStartMin).toBe(0);
    expect(s().napWindowEndMin).toBe(1439);
    expect(savePrefs).toHaveBeenCalledWith({ napWindowStartMin: 0, napWindowEndMin: 1439 });
  });

  it('hydrate applies a persisted nap window', async () => {
    h.prefs = { napWindowStartMin: 390, napWindowEndMin: 1110 };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    await s().hydrate();
    expect(s().napWindowStartMin).toBe(390);
    expect(s().napWindowEndMin).toBe(1110);
  });

  it('hydrate applies a persisted midnight boundary, which a truthy guard would drop', async () => {
    // The whole point of the `!= null` guard: 0 is a legitimate wall-clock
    // value, so `if (prefs.napWindowStartMin)` would silently reset it to 07:00.
    h.prefs = { napWindowStartMin: 0, napWindowEndMin: 720 };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    await s().hydrate();
    expect(s().napWindowStartMin).toBe(0);
    expect(s().napWindowEndMin).toBe(720);
  });

  it('hydrate clamps a persisted value from outside the day', async () => {
    h.prefs = { napWindowStartMin: -5, napWindowEndMin: 99999 };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    await s().hydrate();
    expect(s().napWindowStartMin).toBe(0);
    expect(s().napWindowEndMin).toBe(1439);
  });

  it('hydrate leaves the window alone when nothing was persisted', async () => {
    h.prefs = {};
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ napWindowStartMin: 480, napWindowEndMin: 1200 });
    await s().hydrate();
    expect(s().napWindowStartMin).toBe(480);
    expect(s().napWindowEndMin).toBe(1200);
  });

  it('hydrate applies one endpoint independently of the other', async () => {
    h.prefs = { napWindowEndMin: 1230 };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    await s().hydrate();
    expect(s().napWindowStartMin).toBe(420); // untouched default
    expect(s().napWindowEndMin).toBe(1230);
  });
});

describe('nap classification', () => {
  // openSheet('sleep') opens a 90-minute interval ending "now", so the draft's
  // START is now - 90min. That start, not `now`, is the classifying instant.
  const at = (h: number, m = 0) => new Date(2026, 0, 15, h, m, 0).getTime();

  it('openSheet seeds nap=true for a draft starting inside the window', () => {
    useAppStore.setState({ now: at(14) }); // start 12:30, inside 07:00-19:00
    s().openSheet('sleep');
    expect(s().te.nap).toBe(true);
  });

  it('openSheet seeds nap=false for a draft starting outside the window', () => {
    useAppStore.setState({ now: at(3) }); // start 01:30, outside
    s().openSheet('sleep');
    expect(s().te.nap).toBe(false);
  });

  it('openSheet classifies on the draft START, not on now', () => {
    // 07:30 now, so the 90-minute draft started at 06:00, before the window
    // opens. The old rule looked at `now` (07:30) and called this a nap.
    useAppStore.setState({ now: at(7, 30) });
    s().openSheet('sleep');
    expect(s().te.nap).toBe(false);
  });

  it('openSheet follows a custom window', () => {
    // Window 10:00-13:00. At 11:00 the 90-minute draft starts at 09:30, before
    // the window opens, so it is night sleep under this setting even though the
    // default 07:00 window would have called it a nap.
    useAppStore.setState({ now: at(11), napWindowStartMin: 600, napWindowEndMin: 780 });
    s().openSheet('sleep');
    expect(s().te.nap).toBe(false);

    // Half an hour later the draft starts at 10:00, exactly on the inclusive
    // start boundary, so it flips to a nap.
    useAppStore.setState({ now: at(11, 30) });
    s().openSheet('sleep');
    expect(s().te.nap).toBe(true);
  });

  it('openSheet honours a window that wraps midnight', () => {
    // Naps run 20:00 to 04:00. A draft ending at 02:00 started at 00:30.
    useAppStore.setState({ now: at(2), napWindowStartMin: 1200, napWindowEndMin: 240 });
    s().openSheet('sleep');
    expect(s().te.nap).toBe(true);
  });

  it('openSheet treats start === end as no nap window at all', () => {
    useAppStore.setState({ now: at(14), napWindowStartMin: 420, napWindowEndMin: 420 });
    s().openSheet('sleep');
    expect(s().te.nap).toBe(false);
  });

  it('openTimerEdit seeds nap from the running timer start, not from now', () => {
    useAppStore.setState({
      now: at(20),
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: at(13), saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    // Started 13:00, still running at 20:00: still a nap.
    expect(s().te.nap).toBe(true);
  });

  it('openTimerEdit lets an explicit timer flag beat the window', () => {
    useAppStore.setState({
      now: at(14),
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: at(13), nap: false, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    expect(s().te.nap).toBe(false);
  });

  it('openTimerEdit follows a custom window', () => {
    useAppStore.setState({
      now: at(11),
      napWindowStartMin: 600,
      napWindowEndMin: 780, // 10:00-13:00
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: at(9), saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    expect(s().te.nap).toBe(false); // started 09:00, before the window opens
  });

  it('setNap flips the draft, and save() keeps the manual choice', () => {
    useAppStore.setState({ now: at(14) });
    s().openSheet('sleep');
    expect(s().te.nap).toBe(true); // auto-seeded
    s().setNap(false);
    expect(s().te.nap).toBe(false);
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.nap).toBe(false); // no "user touched it" flag needed
  });

  it('setNap can also force a nap out of a night-time draft', () => {
    useAppStore.setState({ now: at(3) });
    s().openSheet('sleep');
    expect(s().te.nap).toBe(false);
    s().setNap(true);
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.nap).toBe(true);
  });

  it('stopTimer classifies the finished sleep with the configured window', () => {
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [SYNCED_C1],
      selectedChildId: SYNCED_C1.id,
      now: at(11),
      napWindowStartMin: 600,
      napWindowEndMin: 780, // 10:00-13:00
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: at(9), saveAs: 'sleep', childId: SYNCED_C1.id }],
    });
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.nap).toBe(false); // started 09:00, before the window opens
  });

  it('stopTimer classifies on the timer start, not on the wake', () => {
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [SYNCED_C1],
      selectedChildId: SYNCED_C1.id,
      now: at(20),
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: at(13), saveAs: 'sleep', childId: SYNCED_C1.id }],
    });
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    // Woke at 20:00, outside the window, but started at 13:00 inside it. The
    // old wake-time rule called this night sleep.
    expect(e.nap).toBe(true);
  });

  it('stopTimer keeps an explicit nap flag set on the timer', () => {
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [SYNCED_C1],
      selectedChildId: SYNCED_C1.id,
      now: at(14),
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: at(13), nap: false, saveAs: 'sleep', childId: SYNCED_C1.id }],
    });
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.nap).toBe(false);
  });
});
