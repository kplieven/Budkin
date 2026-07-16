/**
 * Global app state (Zustand). Mirrors the design handoff reference's state
 * model and behavior: connection, theme/offline, ticking `now`, the selected
 * child, entries/timers, the working time-entry (`te`), toast, and the
 * open-sheet / save / timer logic.
 */

import { create, type StoreApi } from 'zustand';

import {
  ACTIVITY_SHAPE,
  ACTIVITY_LABEL,
  DEFAULT_DURATION_MIN,
} from '@/lib/activities';
import {
  type Connection,
  deleteChildFromServer,
  deleteEntryFromServer,
  deleteMeasurementFromServer,
  deleteTimerFromServer,
  loadFromServer,
  loadInsightsHistory,
  loadProfileFromServer,
  loadTagsFromServer,
  pushChildToServer,
  pushEntryToServer,
  pushMeasurementToServer,
  pushTimerToServer,
  serverHasData,
  updateChildOnServer,
  updateEntryOnServer,
  updateMeasurementOnServer,
  updateTimerOnServer,
} from '@/data/repository';
import { reconcileTimers } from '@/data/serverTimers';
import { matchServerChild, uploadUnsynced, type UploadDeps } from '@/data/sync';
import { ApiError, childColor, isHiddenTag } from '@/api/client';
import { DEMO_TAGS } from '@/data/seed';
import { clearAdoptTarget, loadAdoptTarget, saveAdoptTarget } from '@/data/adoptTarget';
import {
  clearEntities,
  loadEntities,
  saveChildren,
  saveEntries,
  saveLastFeed,
  saveMeasurements,
  saveSelectedChildId,
} from '@/data/entityStore';
import { loadMilestonePrompts, saveMilestonePrompts } from '@/data/milestonePrompts';
import {
  addPendingOp,
  clearPendingOps,
  loadPendingOps,
  savePendingOps,
  type PendingOp,
} from '@/data/pendingOps';
import { loadPrefs, savePrefs } from '@/data/prefs';
import { clearQueue, enqueueEntry, loadQueue, saveQueue } from '@/data/queue';
import { buildSleepEntry } from '@/data/sleepTimer';
import { clearConnection, loadConnection, saveConnection } from '@/data/storage';
import {
  loadServers,
  persistServers,
  removeServer,
  upsertServer,
  type SavedServer,
} from '@/data/servers';
import { loadTimers, saveTimers } from '@/data/timers';
import { fmtClock } from '@/lib/format';
import { MILESTONE_BY_KEY } from '@/lib/milestones';
import type { UnitSystem } from '@/lib/units';
import { nextStartSide, nextWashKind, overruleLasted, reorder, teEnd, teStart } from '@/store/selectors';
import type { ThemeMode } from '@/theme/tokens';
import type {
  ActivityType,
  Child,
  Entry,
  FeedMethod,
  FeedType,
  Measurement,
  MeasurementKind,
  MilestoneEntry,
  PhotoChange,
  Profile,
  Tag,
  Timer,
} from '@/types/models';
import type { TimeEntryState } from '@/types/timeEntry';

interface AppState {
  // connection
  connection: Connection | null;
  connected: boolean;
  connecting: boolean;
  connectError: string | null;
  /** true while restoring a persisted connection on launch */
  hydrating: boolean;
  /** number of writes queued offline (for the banner) */
  queueCount: number;
  /** servers the user has connected to before (one-tap retry list) */
  savedServers: SavedServer[];

  // ui / theme
  themeMode: ThemeMode;
  /** Budkin-local metric/imperial display lens (default 'metric'). Stored
   *  values stay canonical metric; this only relabels + converts on display. */
  unitSystem: UnitSystem;
  /** effective offline flag = manual override OR no network */
  offline: boolean;
  /** real network reachability (from expo-network) */
  networkOnline: boolean;
  /** manual "simulate offline" override from Settings */
  simulateOffline: boolean;
  now: number;
  toast: string | null;
  /** optional action button shown alongside the current toast (e.g. Undo) */
  toastAction: ToastAction | null;
  showChildSwitcher: boolean;
  /** true while the add/edit-child sheet is open (layers above the switcher) */
  childSheet: boolean;
  /** id of the child being edited, or null when creating a new one */
  editingChildId: string | null;
  /** true while the "Connect Baby Buddy" adopt sheet is open (Settings, local mode) */
  adoptSheet: boolean;
  sheet: { type: ActivityType } | null;
  /** id of the entry being edited, or null when logging a new one */
  editingId: string | null;
  /** id of the running timer being stopped+edited via the log sheet, or null */
  fromTimerId: string | null;
  measurementSheet: { kind: MeasurementKind } | null;
  editingMeasurementId: string | null;
  /** Which milestone sheet is open (rendered at the app root like the other
   *  sheets, so its overlay anchors to the viewport, not the page). `log` names
   *  a catalog key to mark reached; `edit` names an existing milestone entry. */
  milestoneSheet: { mode: 'log'; key: string } | { mode: 'edit'; id: string } | null;

  // data
  selectedChildId: string;
  /** Milestone catch-up prompts the user has answered, per child id. One prompt
   *  per milestone: any answer (Yes, Not yet, dismiss) adds the key here so the
   *  nudge never re-asks. Persisted via src/data/milestonePrompts. */
  answeredMilestonePrompts: Record<string, string[]>;
  children: Child[];
  entries: Entry[];
  timers: Timer[];
  measurements: Measurement[];
  lastFeed: { feedType: FeedType; method: FeedMethod };
  insightsEntries: Entry[];
  insightsLoaded: boolean;
  insightsLoading: boolean;
  insightsError: boolean;
  loadInsights: () => Promise<void>;

  // read-only Baby Buddy server settings (Settings screen "Baby Buddy" group)
  profile: Profile | null;
  profileLoading: boolean;
  profileError: boolean;
  profileLoaded: boolean;
  loadProfile: () => Promise<void>;

  // server tag list for the log-sheet picker (lazy, cached like `profile`)
  tags: Tag[];
  tagsLoading: boolean;
  tagsLoaded: boolean;
  loadTags: () => Promise<void>;

  // working time-entry
  te: TimeEntryState;
}

/** Outcome of `adopt` — pushing a local-mode user's data up to a Baby Buddy
 *  server. `partial` means the upload was interrupted (network drop mid-way);
 *  the app stays in local mode with whatever serverIds got stamped, so a
 *  retry (calling `adopt` again against the same server) resumes cleanly. */
export type AdoptResult =
  | { status: 'guard' } // server already has data; awaiting the user's choice
  | { status: 'done' } // uploaded (or the server was empty) + now in server mode
  | { status: 'partial' } // upload interrupted; STILL local mode; retry-able
  | { status: 'error'; message: string };

interface AppActions {
  tick: (now: number) => void;
  toggleTheme: () => void;
  setUnitSystem: (system: UnitSystem) => void;
  toggleUnitSystem: () => void;
  setOffline: (v: boolean) => void;
  toggleOffline: () => void;
  setNetworkOnline: (online: boolean) => void;

  hydrate: () => Promise<void>;
  /** Re-check the server and reload data (on foreground / pull-to-refresh). */
  refresh: () => Promise<void>;
  connect: (serverUrl: string, token: string) => Promise<void>;
  /** Push a local-mode user's data up to a Baby Buddy server and switch to
   *  server mode. `opts.uploadAnyway` overrides the non-empty-server guard,
   *  attaching to matching existing server children (see `matchServerChild`)
   *  instead of duplicating them. Safe to call again after a `partial` result
   *  — the upload is resumable (already-stamped records are skipped). */
  adopt: (serverUrl: string, token: string, opts?: { uploadAnyway?: boolean }) => Promise<AdoptResult>;
  enterLocal: () => Promise<void>;
  disconnect: () => void;
  forgetServer: (serverUrl: string) => void;
  flushQueue: () => Promise<void>;
  /** Replay durable offline update/delete ops (Unit D's `pendingOps` log) on reconnect. */
  flushPendingOps: () => Promise<void>;
  /** Push offline-created children/measurements (serverId == null) up on
   *  reconnect. Entries are deliberately excluded — they still flow through
   *  the queue.ts path (flushQueue); mixing the two would double-push. */
  flushUnsynced: () => Promise<void>;
  commitWrite: (entry: Entry) => void;

  selectChild: (id: string) => void;
  openSwitcher: () => void;
  closeSwitcher: () => void;

  openAddChild: () => void;
  openEditChild: (id: string) => void;
  closeChildSheet: () => void;
  saveChild: (fields: { first: string; last: string; birth: number; photo?: PhotoChange }) => void;
  /** Delete a child (cascades all their history server-side; NOT undoable). See
   *  the implementation for the selection re-point + in-memory purge rules. */
  deleteChild: (id: string) => void;

  openAdopt: () => void;
  closeAdopt: () => void;

  openSheet: (type: ActivityType) => void;
  openEdit: (entryId: string) => void;
  openTimerEdit: (timerId: string) => void;
  closeSheet: () => void;
  deleteEntry: (id: string) => void;
  /** Restore the entry removed by the most recent deleteEntry (undo). */
  undoDelete: () => void;
  /** Record a reached milestone as a tagged note (create). */
  logMilestone: (key: string, dateMs: number, note?: string) => void;
  /** Edit a reached milestone's date/note. Remove reuses deleteEntry(id). */
  editMilestone: (id: string, dateMs: number, note?: string) => void;
  /** Open the milestone sheet to mark a catalog milestone reached. */
  openMilestone: (key: string) => void;
  /** Open the milestone sheet to edit an already-reached milestone entry. */
  openEditMilestone: (id: string) => void;
  closeMilestoneSheet: () => void;
  /** Retire a milestone catch-up prompt for the selected child (idempotent). */
  answerMilestonePrompt: (key: string) => void;

  openMeasurement: (kind: MeasurementKind) => void;
  openEditMeasurement: (id: string) => void;
  closeMeasurementSheet: () => void;
  saveMeasurement: (value: number, date: number, notes?: string) => void;
  deleteMeasurement: (id: string) => void;
  setTE: (patch: Partial<TimeEntryState>) => void;
  adjustAmount: (delta: number) => void;
  toggleWet: () => void;
  toggleSolid: () => void;
  /** bath: pick the wash size (small/big) */
  setWash: (wash: 'small' | 'big') => void;
  toggleTag: (tag: string) => void;
  /** Add a brand-new free-form tag as selected. Trims, rejects blank / structural
   *  (HIDDEN_TAGS) names, and no-ops on a tag already selected. */
  createTag: (name: string) => void;
  setEnded: (agoMin: number) => void;
  setEndedAbs: (ms: number) => void;
  setOngoing: () => void;
  setLasted: (min: number) => void;
  /** Timer-edit "lasted X": pin the duration off the fixed start (end becomes
   * the derived point) and mark the entry finished, so save() stops the timer. */
  setTimerLasted: (min: number) => void;
  setStartedAt: (ms: number, anchor?: 'lastfeed' | 'wake' | 'diaper' | 'now') => void;
  setStartedAgo: (min: number) => void;
  sleepWoke: () => void;
  sleepStillSleeping: () => void;
  save: () => void;

  startQuickTimer: () => void;
  /** Stop a running timer and log it. `endMs`, if given (from the ephemeral
   * "Ended earlier…" editor), is clamped into `[start, now]`; omitted = now. */
  stopTimer: (id: string, endMs?: number) => void;
  adjustTimerStart: (id: string, deltaMin: number) => void;
  setTimerStart: (id: string, ms: number) => void;
  discardTimer: (id: string) => void;
  setTimerSaveAs: (id: string, saveAs: ActivityType) => void;
  /** Persist `te`'s metadata onto the running timer named by `fromTimerId`,
   * WITHOUT stopping it or creating an entry, then close the sheet. */
  saveTimerDetails: () => void;

  showToast: (msg: string, action?: ToastAction) => void;
}

/** A tappable action rendered inside a toast (e.g. "Undo" after a delete). */
export interface ToastAction {
  label: string;
  run: () => void;
}

export type AppStore = AppState & AppActions;

/**
 * Merge not-yet-flushed queued entries (from the offline write queue) into a
 * set of freshly-loaded server entries for display, so an entry created
 * offline stays visible across an app kill instead of only being reflected in
 * `queueCount`. Queued entries are prepended: they're the newest, matching how
 * `save()` prepends new entries.
 *
 * No de-duplication happens here, and none is needed: server data loaded from
 * the API never contains a not-yet-flushed queued entry (a queued entry only
 * reaches the server via `flushQueue`, and that copy comes back with a server
 * shape/id on a *later* load). The post-flush no-duplication guarantee comes
 * entirely from `refresh()`/`hydrate()` replacing `entries` wholesale with the
 * next `...data` load once the server has the entry — which drops the local
 * copy. This helper's only job is the initial "keep it visible" prepend.
 */
export function mergeQueuedEntries(serverEntries: Entry[], queuedEntries: Entry[]): Entry[] {
  return [...queuedEntries, ...serverEntries];
}

/**
 * The chip set the tag picker renders: the union of the server tag list and the
 * entry's currently-selected tags, MINUS the structural `HIDDEN_TAGS`. Server
 * tags come first (carrying their display color); a selected tag not in the
 * server list (created elsewhere) is appended colorless so it still shows as a
 * selected chip. De-duplicated by name. Structural markers (`bath`/`small`/`big`,
 * breastfeeding `left`/`right`) are dropped from BOTH sides so they never appear
 * as chips even though they still round-trip on the entries that carry them.
 */
export function visibleTags(serverTags: Tag[], selected: string[]): Tag[] {
  const seen = new Set<string>();
  const out: Tag[] = [];
  for (const tag of serverTags) {
    if (isHiddenTag(tag.name) || seen.has(tag.name)) continue;
    seen.add(tag.name);
    out.push(tag);
  }
  for (const name of selected) {
    if (isHiddenTag(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ name });
  }
  return out;
}

/**
 * Merge locally-created-but-unsynced records (serverId == null) back into a
 * freshly-loaded server list, so an offline create stays visible across a
 * wholesale refresh/hydrate. Unsynced locals are prepended (newest-first, like
 * save()); a local whose id already appears in the server list is skipped
 * (belt-and-suspenders — a serverId==null local always has a local id, never a
 * server id, so this only guards against pathological duplicates).
 *
 * Children/measurements only — NOT entries. Entries still flow through
 * `src/data/queue.ts`, whose `flushQueue` pushes them to the server WITHOUT
 * stamping the in-memory record's `serverId`; merging entries here would
 * duplicate an entry that has already flushed. See `mergeQueuedEntries` above
 * for the entry-specific (queue-based) equivalent.
 */
export function mergeUnsynced<T extends { id: string; serverId?: number }>(
  serverList: T[],
  localList: T[],
): T[] {
  const serverIds = new Set(serverList.map((r) => r.id));
  const unsynced = localList.filter((r) => r.serverId == null && !serverIds.has(r.id));
  return [...unsynced, ...serverList];
}

/** Build uploadUnsynced's push-fn deps bound to a server connection. Shared by
 *  `adopt` and `flushUnsynced` — the only two callers that push local-only
 *  (serverId == null) records up to the server. */
function buildUploadDeps(conn: Connection): UploadDeps {
  return {
    pushChild: (c) => pushChildToServer(conn, c).then((r) => r?.id),
    pushEntry: (e) => pushEntryToServer(conn, e),
    pushMeasurement: (m) => pushMeasurementToServer(conn, m),
  };
}

type Get = StoreApi<AppStore>['getState'];
type Set = StoreApi<AppStore>['setState'];

/** Mirror a freshly-created local timer to the server (create + stamp serverId),
 *  reusing the offline-first optimistic pattern. No-op unless online + server
 *  mode and the timer's child is already synced. If the timer was stopped or
 *  discarded before the POST resolved (serverId never landed locally), delete
 *  the orphan the POST created so it can't linger on the server. */
function mirrorTimerCreate(get: Get, set: Set, timerId: string): void {
  const s = get();
  const conn = s.connection;
  if (!conn || conn.mode !== 'server' || s.offline) return;
  const timer = s.timers.find((t) => t.id === timerId);
  if (!timer) return;
  const child = s.children.find((c) => c.id === (timer.childId ?? s.selectedChildId));
  if (!child || child.serverId == null) return; // child not synced yet — reconnect flush handles it
  void pushTimerToServer(conn, timer, child.serverId)
    .then((serverId) => {
      if (serverId == null) return;
      if (get().timers.some((t) => t.id === timerId)) {
        set((st) => ({ timers: st.timers.map((t) => (t.id === timerId ? { ...t, serverId } : t)) }));
      } else {
        // Stopped/discarded during the POST: clean up the orphan.
        void deleteTimerFromServer(conn, serverId).catch(() => {});
      }
    })
    .catch(() => {});
}

/** Mirror an edit to an already-synced timer: PATCH online, queue offline.
 *  Unsynced (serverId == null) timers need nothing here; their eventual create
 *  encodes the current fields. */
function mirrorTimerEdit(get: Get, timer: Timer): void {
  const s = get();
  const conn = s.connection;
  if (!conn || conn.mode !== 'server' || timer.serverId == null) return;
  if (s.offline) {
    void addPendingOp({ op: 'update', entity: 'timer', payload: timer });
  } else {
    void updateTimerOnServer(conn, timer).catch(() => {
      void addPendingOp({ op: 'update', entity: 'timer', payload: timer });
    });
  }
}

/** Mirror a stop/discard: delete the server timer (online) or queue the delete
 *  (offline). Unsynced timers (serverId == null) have no server record. */
function mirrorTimerDelete(get: Get, timer: Timer): void {
  const conn = get().connection;
  if (!conn || conn.mode !== 'server' || timer.serverId == null) return;
  if (get().offline) {
    void addPendingOp({ op: 'delete', entity: 'timer', serverId: timer.serverId });
  } else {
    const serverId = timer.serverId;
    void deleteTimerFromServer(conn, serverId).catch(() => {
      void addPendingOp({ op: 'delete', entity: 'timer', serverId });
    });
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
// The most recently deleted entry, held so an "Undo" toast can restore it.
// `didServerDelete` records whether the delete actually reached the server, so
// undo only re-creates it server-side when a server record was really removed.
let lastDeleted: { entry: Entry; index: number; didServerDelete: boolean } | null = null;
// Guards against overlapping refreshes (e.g. a foreground event landing while a
// pull-to-refresh is still in flight).
let refreshInFlight = false;
// Guards against overlapping flushUnsynced calls (e.g. setNetworkOnline(true)
// and a foreground refresh() both firing at once) — see `flushUnsynced` below.
let flushUnsyncedInFlight = false;

export const useAppStore = create<AppStore>((set, get) => ({
  // ---- initial state ----
  connection: null,
  connected: false,
  connecting: false,
  connectError: null,
  hydrating: true,
  queueCount: 0,
  savedServers: [],

  themeMode: 'dark',
  unitSystem: 'metric',
  offline: false,
  networkOnline: true,
  simulateOffline: false,
  now: Date.now(),
  toast: null,
  toastAction: null,
  showChildSwitcher: false,
  childSheet: false,
  editingChildId: null,
  adoptSheet: false,
  sheet: null,
  editingId: null,
  fromTimerId: null,
  measurementSheet: null,
  editingMeasurementId: null,
  milestoneSheet: null,
  answeredMilestonePrompts: {},

  selectedChildId: '',
  children: [],
  entries: [],
  timers: [],
  measurements: [],
  lastFeed: { feedType: 'breast', method: 'left' },
  insightsEntries: [],
  insightsLoaded: false,
  insightsLoading: false,
  insightsError: false,

  profile: null,
  profileLoading: false,
  profileError: false,
  profileLoaded: false,

  tags: [],
  tagsLoading: false,
  tagsLoaded: false,

  te: { shape: 'interval', tags: [] },

  // ---- ticking clock ----
  tick: (now) => set({ now }),

  // ---- theme / offline ----
  toggleTheme: () => {
    const next: ThemeMode = get().themeMode === 'dark' ? 'light' : 'dark';
    set({ themeMode: next });
    void savePrefs({ themeMode: next });
  },
  setUnitSystem: (system) => {
    set({ unitSystem: system });
    void savePrefs({ unitSystem: system });
  },
  toggleUnitSystem: () => {
    const next: UnitSystem = get().unitSystem === 'metric' ? 'imperial' : 'metric';
    set({ unitSystem: next });
    void savePrefs({ unitSystem: next });
  },
  setOffline: (v) => {
    const offline = v || !get().networkOnline;
    set({ simulateOffline: v, offline });
    if (!offline) {
      void get().flushQueue();
      void get().flushPendingOps();
      void get().flushUnsynced();
    }
  },
  toggleOffline: () => {
    const sim = !get().simulateOffline;
    const offline = sim || !get().networkOnline;
    set({ simulateOffline: sim, offline });
    if (!offline) {
      void get().flushQueue();
      void get().flushPendingOps();
      void get().flushUnsynced();
    }
  },
  setNetworkOnline: (online) => {
    const offline = get().simulateOffline || !online;
    set({ networkOnline: online, offline });
    if (!offline) {
      void get().flushQueue();
      void get().flushPendingOps();
      void get().flushUnsynced();
    }
  },

  // ---- connection ----
  hydrate: async () => {
    const conn = await loadConnection();
    const q = await loadQueue();
    // themeMode is independent of connection state, so apply it once here up
    // front and it covers every branch below (no connection, demo, real).
    const prefs = await loadPrefs();
    if (prefs.themeMode) set({ themeMode: prefs.themeMode });
    if (prefs.unitSystem) set({ unitSystem: prefs.unitSystem });
    // Answered milestone prompts are independent of connection state, so load
    // them once here (merges into state like the prefs above).
    set({ answeredMilestonePrompts: await loadMilestonePrompts() });
    // Running timers are local-only (the server has no matching record), so
    // restore them from on-device storage regardless of how the rest of the
    // state is loaded below.
    const savedTimers = await loadTimers();
    let savedServers = await loadServers();
    // Migration: ensure the active real server is in the retry list for users
    // who connected before the saved-servers feature existed.
    if (conn && conn.mode === 'server') {
      savedServers = upsertServer(savedServers, {
        serverUrl: conn.serverUrl,
        token: conn.token,
        lastUsedAt: Date.now(),
      });
      void persistServers(savedServers);
    }
    set({ savedServers }); // merges; later set() calls in this fn keep it
    if (!conn) {
      set({ hydrating: false, queueCount: q.length, timers: savedTimers });
      return;
    }
    if (conn.mode === 'local') {
      const e = await loadEntities();
      set({
        connection: conn,
        connected: true,
        hydrating: false,
        children: e?.children ?? [],
        entries: e?.entries ?? [],
        measurements: e?.measurements ?? [],
        selectedChildId: e?.selectedChildId ?? '',
        lastFeed: e?.lastFeed ?? { feedType: 'breast', method: 'left' },
        timers: savedTimers,
        queueCount: q.length,
      });
      return;
    }
    set({ connection: conn, queueCount: q.length });
    try {
      const data = await loadFromServer(conn);
      // `data.timers` is always [] (the server has none); the on-device copy wins.
      // Queued (not-yet-flushed) entries aren't in `data.entries` yet, so merge
      // them in to keep them visible — flushQueue below pushes them, and the
      // NEXT refresh()/hydrate() will replace `entries` with server data that
      // includes them, naturally dropping the local copy.
      // Children/measurements created offline (serverId == null) have no flush
      // yet (Phase 3), so read the durable copy and merge it back in the same
      // way — see `mergeUnsynced`. Entries are deliberately excluded from this
      // merge (see `mergeUnsynced`'s doc comment).
      const e = await loadEntities();
      set({
        connected: true,
        hydrating: false,
        ...data,
        children: mergeUnsynced(data.children, e?.children ?? []),
        measurements: mergeUnsynced(data.measurements, e?.measurements ?? []),
        entries: mergeQueuedEntries(data.entries, q),
        timers: reconcileTimers(savedTimers, data.timers),
      });
      void get().flushQueue();
      void get().flushPendingOps();
      void get().flushUnsynced();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await clearConnection();
        set({
          connection: null,
          connected: false,
          hydrating: false,
          connectError: 'Session expired — please reconnect.',
          profile: null,
          profileLoaded: false,
          profileError: false,
          profileLoading: false,
          tags: [],
          tagsLoaded: false,
          tagsLoading: false,
        });
      } else {
        // network/server unreachable: enter the app in offline mode. There's
        // no server data to merge with, so the queued entries are all we have
        // — best-effort restore so they aren't dropped from view.
        set({ connected: true, offline: true, hydrating: false, entries: q, timers: savedTimers });
      }
    }
  },
  refresh: async () => {
    const s = get();
    const conn = s.connection;
    // Nothing to re-check for demo, no connection, or a manual offline override.
    if (!conn || conn.mode !== 'server' || s.simulateOffline || refreshInFlight) return;
    refreshInFlight = true;
    // Running timers are local-only (the server has none) and can be mutated
    // out-of-band by the home-screen widget while the app is warm. Re-read the
    // on-device copy — the source of truth — rather than trusting the possibly
    // stale in-memory list, so a widget-started nap isn't lost and a
    // widget-stopped nap isn't left "running" in the app. Done up front so it
    // reconciles even when the server is unreachable (offline), not just on a
    // successful fetch — otherwise a widget-stopped nap keeps showing in-app
    // until connectivity returns. Mirrors cold `hydrate`.
    const localTimers = await loadTimers();
    try {
      const data = await loadFromServer(conn);
      // Children/measurements created offline (serverId == null) have no flush
      // yet (Phase 3): merge the in-memory unsynced ones back in so a wholesale
      // reload doesn't drop them from view. Entries are deliberately excluded
      // from this merge (see `mergeUnsynced`'s doc comment) — `...data` below
      // is entries' only source, unchanged.
      const mergedChildren = mergeUnsynced(data.children, s.children);
      // Keep the user's current child if it's still visible — checked against
      // the MERGED list (not just the server's), so an offline-created child
      // kept visible by mergeUnsynced above doesn't get silently deselected;
      // otherwise fall back to the server's first child (matches cold `hydrate`).
      const selectedChildId = mergedChildren.some((c) => c.id === s.selectedChildId)
        ? s.selectedChildId
        : data.selectedChildId;
      set({
        connected: true,
        offline: false,
        networkOnline: true,
        ...data,
        children: mergedChildren,
        measurements: mergeUnsynced(data.measurements, s.measurements),
        selectedChildId,
        timers: reconcileTimers(localTimers, data.timers),
      });
      void get().flushQueue();
      void get().flushPendingOps();
      void get().flushUnsynced();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await clearConnection();
        set({
          connection: null,
          connected: false,
          connectError: 'Session expired — please reconnect.',
          profile: null,
          profileLoaded: false,
          profileError: false,
          profileLoading: false,
          tags: [],
          tagsLoaded: false,
          tagsLoading: false,
        });
      } else {
        // server unreachable — stay/enter offline; queued writes hold until the
        // next successful refresh. Still reconcile local timers so a widget
        // start/stop is reflected even while offline.
        set({ offline: true, timers: localTimers });
      }
    } finally {
      refreshInFlight = false;
    }
  },
  connect: async (serverUrl, token) => {
    set({ connecting: true, connectError: null });
    const conn: Connection = { mode: 'server', serverUrl, token };
    try {
      const data = await loadFromServer(conn);
      const savedServers = upsertServer(get().savedServers, {
        serverUrl,
        token,
        lastUsedAt: Date.now(),
      });
      set({
        connection: conn,
        connected: true,
        connecting: false,
        savedServers,
        ...data,
        // a newly-connected server's profile + tags haven't been fetched yet
        profile: null,
        profileLoaded: false,
        profileError: false,
        profileLoading: false,
        tags: [],
        tagsLoaded: false,
        tagsLoading: false,
      });
      void saveConnection(conn);
      void persistServers(savedServers);
      void get().flushQueue();
      void get().flushPendingOps();
      void get().flushUnsynced();
    } catch (e) {
      set({
        connecting: false,
        connectError: e instanceof Error ? e.message : "Couldn't connect to server.",
      });
    }
  },
  adopt: async (serverUrl, token, opts) => {
    const conn: Connection = { mode: 'server', serverUrl, token };
    // Server-switch reset: a prior abandoned adoption (a `partial` result)
    // stamped serverIds against a DIFFERENT server. Those ids must not cause
    // this adoption to wrongly skip records that were never pushed to
    // `serverUrl` — clear them before doing anything else. The target is
    // read from durable storage (not module memory) so this reset still
    // fires across an app kill between the abandoned attempt and this call.
    const prevAdoptTarget = await loadAdoptTarget();
    if (prevAdoptTarget != null && prevAdoptTarget !== serverUrl) {
      set((st) => ({
        children: st.children.map((c) => ({ ...c, serverId: undefined })),
        entries: st.entries.map((e) => ({ ...e, serverId: undefined })),
        measurements: st.measurements.map((m) => ({ ...m, serverId: undefined })),
        timers: st.timers.map((t) => ({ ...t, serverId: undefined })),
      }));
    }
    await saveAdoptTarget(serverUrl);

    // Probe first — this also validates the token.
    let hasData: boolean;
    try {
      hasData = await serverHasData(conn);
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : "Couldn't reach the server." };
    }
    if (hasData && !opts?.uploadAnyway) {
      // Non-empty server, no override: don't upload — the UI offers "upload
      // anyway" or "use server data" from here.
      return { status: 'guard' };
    }

    const s = get();
    let state = { children: s.children, entries: s.entries, measurements: s.measurements };
    if (hasData && opts?.uploadAnyway) {
      // Dedup: attach each not-yet-synced local child to a matching existing
      // server child (by name + birth date) instead of duplicating it.
      const data = await loadFromServer(conn);
      const serverChildren = data.children;
      state = {
        ...state,
        children: state.children.map((c) => {
          if (c.serverId != null) return c;
          const matched = matchServerChild(c, serverChildren);
          return matched != null ? { ...c, serverId: matched } : c;
        }),
      };
    }

    const result = await uploadUnsynced(state, buildUploadDeps(conn));
    // Persist stamped serverIds immediately so a partial upload is resumable
    // on retry, even before we know whether it fully succeeded.
    set({ children: result.children, entries: result.entries, measurements: result.measurements });

    const stillUnsynced =
      result.children.some((c) => c.serverId == null) ||
      result.entries.some((e) => e.serverId == null) ||
      result.measurements.some((m) => m.serverId == null);
    if (stillUnsynced) {
      // Interrupted mid-upload: stay in local mode, keep `adoptTarget` so a
      // retry against the SAME server doesn't wrongly reset the ids we just stamped.
      return { status: 'partial' };
    }

    // Full success: switch to server mode, mirroring connect()'s structure —
    // including upserting the server into the "previously connected" retry
    // list, so an adopted server shows up there too (not just a fresh connect()).
    const savedServers = upsertServer(get().savedServers, {
      serverUrl,
      token,
      lastUsedAt: Date.now(),
    });
    set({ connection: conn, connected: true, savedServers });
    void saveConnection(conn);
    void persistServers(savedServers);
    const data = await loadFromServer(conn);
    set({
      ...data,
      // a newly-adopted server's profile hasn't been fetched yet
      profile: null,
      profileLoaded: false,
      profileError: false,
      profileLoading: false,
    });
    await clearAdoptTarget();
    return { status: 'done' };
  },
  enterLocal: async () => {
    const conn: Connection = { mode: 'local' };
    const e = await loadEntities();
    set({
      connection: conn,
      connected: true,
      connecting: false,
      connectError: null,
      children: e?.children ?? [],
      entries: e?.entries ?? [],
      measurements: e?.measurements ?? [],
      selectedChildId: e?.selectedChildId ?? '',
      lastFeed: e?.lastFeed ?? { feedType: 'breast', method: 'left' },
      profile: null,
      profileLoaded: false,
      profileError: false,
      profileLoading: false,
      tags: [],
      tagsLoaded: false,
      tagsLoading: false,
    });
    void saveConnection(conn);
  },
  disconnect: () => {
    void clearConnection();
    void clearQueue();
    void clearEntities();
    void clearPendingOps();
    set({
      connection: null,
      connected: false,
      connectError: null,
      children: [],
      entries: [],
      timers: [],
      measurements: [],
      selectedChildId: '',
      queueCount: 0,
      profile: null,
      profileLoaded: false,
      profileError: false,
      profileLoading: false,
      tags: [],
      tagsLoaded: false,
      tagsLoading: false,
    });
  },
  forgetServer: (serverUrl) => {
    const next = removeServer(get().savedServers, serverUrl);
    set({ savedServers: next });
    void persistServers(next);
    get().showToast('Removed');
  },
  flushQueue: async () => {
    const s = get();
    const conn = s.connection;
    if (!conn || conn.mode !== 'server' || s.offline) return;
    const q = await loadQueue();
    if (q.length === 0) return;
    const remaining: Entry[] = [];
    for (const entry of q) {
      try {
        await pushEntryToServer(conn, entry);
      } catch {
        remaining.push(entry);
      }
    }
    await saveQueue(remaining);
    set({ queueCount: remaining.length });
    if (remaining.length === 0) {
      get().showToast(`Synced ${q.length} ${q.length === 1 ? 'entry' : 'entries'}`);
    }
  },
  flushPendingOps: async () => {
    const s = get();
    const conn = s.connection;
    if (!conn || conn.mode !== 'server' || s.offline) return;
    const ops = await loadPendingOps();
    if (ops.length === 0) return;
    const remaining: PendingOp[] = [];
    for (const op of ops) {
      try {
        if (op.op === 'update' && op.entity === 'child') await updateChildOnServer(conn, op.payload);
        else if (op.op === 'update' && op.entity === 'measurement') await updateMeasurementOnServer(conn, op.payload);
        else if (op.op === 'update' && op.entity === 'entry') await updateEntryOnServer(conn, op.payload);
        else if (op.op === 'delete' && op.entity === 'measurement') await deleteMeasurementFromServer(conn, op.kind, op.serverId);
        else if (op.op === 'delete' && op.entity === 'entry') await deleteEntryFromServer(conn, op.entryType, op.serverId);
        else if (op.op === 'update' && op.entity === 'timer') await updateTimerOnServer(conn, op.payload);
        else if (op.op === 'delete' && op.entity === 'timer') await deleteTimerFromServer(conn, op.serverId);
      } catch {
        remaining.push(op);
      }
    }
    await savePendingOps(remaining);
  },
  flushUnsynced: async () => {
    // Guards against overlapping flushes (e.g. setNetworkOnline(true) and a
    // foreground refresh() both firing at once), which would otherwise both
    // read the same serverId==null child and both POST it, duplicating it
    // on the server.
    if (flushUnsyncedInFlight) return;
    flushUnsyncedInFlight = true;
    try {
      const s = get();
      const conn = s.connection;
      if (!conn || conn.mode !== 'server' || s.offline) return;
      // Only children & measurements here — entries still flow through
      // queue.ts (flushQueue), and mixing would double-push. (Full entry
      // unification is a later change.) Note: an offline entry created for an
      // offline-created child while CONNECTED is a niche case not handled here
      // either — it stays on the queue path.
      const hasUnsynced = s.children.some((c) => c.serverId == null) || s.measurements.some((m) => m.serverId == null);
      const hasUnsyncedTimer = s.timers.some((t) => t.serverId == null);
      if (!hasUnsynced && !hasUnsyncedTimer) return;
      if (hasUnsynced) {
        const result = await uploadUnsynced(
          { children: s.children, entries: [], measurements: s.measurements },
          buildUploadDeps(conn),
        );
        // Count only records that WERE serverId==null in the pre-upload snapshot
        // `s` and actually came back stamped in `result` (a push that didn't
        // complete leaves serverId==null and must not be counted).
        const syncedCount =
          s.children.filter(
            (c) => c.serverId == null && result.children.find((r) => r.id === c.id)?.serverId != null,
          ).length +
          s.measurements.filter(
            (m) => m.serverId == null && result.measurements.find((r) => r.id === m.id)?.serverId != null,
          ).length;
        // Functional merge-by-id (reads the CURRENT state via `st`, not the
        // pre-await snapshot `s`) that only stamps serverIds, so a create that
        // landed during the await isn't dropped by a wholesale replace.
        set((st) => ({
          children: st.children.map((c) => {
            const u = result.children.find((r) => r.id === c.id);
            return u && u.serverId != null ? { ...c, serverId: u.serverId } : c;
          }),
          measurements: st.measurements.map((m) => {
            const u = result.measurements.find((r) => r.id === m.id);
            return u && u.serverId != null ? { ...m, serverId: u.serverId } : m;
          }),
        }));
        // Mirrors flushQueue's `Synced N entries`; here the flush legitimately
        // pushes both children & measurements, so report the true total.
        if (syncedCount > 0) {
          get().showToast(`Synced ${syncedCount} ${syncedCount === 1 ? 'item' : 'items'}`);
        }
      }
      // Timers created offline (serverId == null): POST each whose child is
      // synced, then stamp serverId. Read the CURRENT state so a child stamped
      // just above (this same flush) is visible. Mirrors the merge above.
      const st2 = get();
      for (const timer of st2.timers) {
        if (timer.serverId != null) continue;
        const child = st2.children.find((c) => c.id === (timer.childId ?? st2.selectedChildId));
        if (!child || child.serverId == null) continue;
        const serverId = await pushTimerToServer(conn, timer, child.serverId).catch(() => undefined);
        if (serverId != null) {
          set((s3) => ({ timers: s3.timers.map((t) => (t.id === timer.id ? { ...t, serverId } : t)) }));
        }
      }
    } finally {
      flushUnsyncedInFlight = false;
    }
  },
  commitWrite: (entry) => {
    const s = get();
    const conn = s.connection;
    if (!conn || conn.mode !== 'server') return; // local: nothing to push
    if (s.offline) {
      void enqueueEntry(entry).then((q) => set({ queueCount: q.length }));
    } else {
      void pushEntryToServer(conn, entry)
        .then((serverId) => {
          if (serverId != null) {
            set((st) => ({
              entries: st.entries.map((e) => (e.id === entry.id ? { ...e, serverId } : e)),
            }));
          }
        })
        .catch(() => enqueueEntry(entry).then((q) => set({ queueCount: q.length })));
    }
  },

  // ---- child switcher ----
  selectChild: (id) =>
    set({
      selectedChildId: id,
      showChildSwitcher: false,
      insightsLoaded: false,
      insightsEntries: [],
      insightsError: false,
    }),
  openSwitcher: () => set({ showChildSwitcher: true }),
  closeSwitcher: () => set({ showChildSwitcher: false }),

  openAddChild: () => set({ childSheet: true, editingChildId: null }),
  openEditChild: (id) => set({ childSheet: true, editingChildId: id }),
  closeChildSheet: () => set({ childSheet: false, editingChildId: null }),

  openAdopt: () => set({ adoptSheet: true }),
  closeAdopt: () => set({ adoptSheet: false }),

  saveChild: (fields) => {
    const s = get();
    const change: PhotoChange = fields.photo ?? { kind: 'none' };
    // Optimistic picture: the local URI on set, null on remove, unchanged on none.
    const pending = change.kind === 'set' ? change.photo.uri : change.kind === 'remove' ? null : undefined;
    const existing = s.editingChildId ? s.children.find((c) => c.id === s.editingChildId) : null;
    if (existing) {
      const child: Child = {
        ...existing,
        first: fields.first,
        last: fields.last,
        birth: fields.birth,
        picture: change.kind === 'none' ? existing.picture : pending,
      };
      set({
        children: s.children.map((c) => (c.id === child.id ? child : c)),
        childSheet: false,
        editingChildId: null,
      });
      get().showToast('Updated');
      const conn = s.connection;
      if (conn && conn.mode === 'server' && !s.offline) {
        void updateChildOnServer(conn, child, change)
          .then((url) => {
            // Swap the ephemeral local file URI for the durable server URL.
            if (change.kind === 'none' || url === undefined) return;
            set((st) => ({
              children: st.children.map((c) => (c.id === child.id ? { ...c, picture: url } : c)),
            }));
          })
          .catch(() => {});
      } else if (conn && conn.mode === 'server' && s.offline && child.serverId != null) {
        // Already on the server, editing while offline: record the update so
        // it replays on reconnect instead of being silently overwritten by the
        // next refresh(). A not-yet-synced local (serverId == null) needs no
        // op — its create is still pending.
        void addPendingOp({ op: 'update', entity: 'child', payload: child });
      }
      return;
    }
    // Creating: assign a local id + the next tint from the shared palette,
    // optimistically add it, and auto-select it (mirrors saveMeasurement's
    // optimistic-local-then-push pattern).
    const localId = 'child' + Date.now();
    const child: Child = {
      id: localId,
      first: fields.first,
      last: fields.last,
      birth: fields.birth,
      color: childColor(s.children.length),
      picture: change.kind === 'set' ? change.photo.uri : null,
    };
    set({
      children: [...s.children, child],
      selectedChildId: localId,
      childSheet: false,
      editingChildId: null,
      showChildSwitcher: false,
      insightsLoaded: false,
      insightsEntries: [],
      insightsError: false,
    });
    get().showToast('Saved');
    const conn = s.connection;
    if (conn && conn.mode === 'server' && !s.offline) {
      void pushChildToServer(conn, child, change)
        .then((res) => {
          if (!res || res.id == null) return;
          // Patch the local id -> the real server id so the new child stays
          // selected across the next refresh()/hydrate(), which replaces
          // `children` wholesale with server data keyed by real ids. Adopt the
          // server picture URL in place of the local file URI. Stamp `serverId`
          // too (like commitWrite/saveMeasurement do for entries/measurements):
          // server-child ops — updateChild, deleteChild, flushUnsynced's
          // synced-vs-unsynced check — all key off `serverId`, so leaving it
          // unset until the next refresh loses edits, skips deletes (the child
          // resurrects), and re-uploads a duplicate on reconnect.
          set((st) => ({
            children: st.children.map((c) =>
              c.id === localId
                ? { ...c, id: String(res.id), serverId: res.id, picture: res.picture ?? c.picture }
                : c,
            ),
            selectedChildId: st.selectedChildId === localId ? String(res.id) : st.selectedChildId,
          }));
        })
        .catch(() => {});
    }
  },

  deleteChild: (id) => {
    const s = get();
    const child = s.children.find((c) => c.id === id);
    if (!child) return;
    const conn = s.connection;
    // A server-backed child carries a numeric `serverId` (stamped on
    // create/sync; mirrors updateChild keying off serverId). A local-only child
    // (created in local mode / offline) has none.
    const serverBacked = child.serverId != null;
    // Server delete only when it can be made durable now: server-backed +
    // server mode + online. Otherwise the removal is in-memory only — in local
    // mode it persists to the entity store via the subscription below (the UI
    // blocks an offline server-backed delete, which a refresh would resurrect).
    const doServerDelete = serverBacked && !!conn && conn.mode === 'server' && !s.offline;

    const nextChildren = s.children.filter((c) => c.id !== id);
    // Purge the deleted child's entries/measurements. In local mode every
    // child's data lives in state, so this drops the orphans — and, via the
    // persistence subscription, from the durable entity store (saveEntries /
    // saveMeasurements fire on the new array refs). In server mode only the
    // selected child's entries are loaded, so this is a no-op for a
    // non-selected child there.
    const patch: Partial<AppState> = {
      children: nextChildren,
      entries: s.entries.filter((e) => e.childId !== id),
      measurements: s.measurements.filter((m) => m.childId !== id),
      childSheet: false,
      editingChildId: null,
      showChildSwitcher: false,
    };
    if (s.selectedChildId === id) {
      // Deleting the selected child: re-point selection (mirrors refresh's
      // fallback), clear the running timers (they implicitly belong to the
      // selected child, so a later stop must not log against a different one),
      // and reset insights (as selectChild does).
      patch.selectedChildId = nextChildren[0]?.id ?? '';
      patch.timers = [];
      patch.insightsLoaded = false;
      patch.insightsEntries = [];
      patch.insightsError = false;
    }
    set(patch);
    if (doServerDelete) {
      void deleteChildFromServer(conn, child.serverId as number).catch(() => {});
    }
    get().showToast(`${child.first} deleted`);
  },

  // ---- insights (lazy deep-history load) ----
  loadInsights: async () => {
    const s = get();
    if (s.insightsLoaded || s.insightsLoading) return;
    const conn = s.connection;
    const childId = s.selectedChildId;
    if (!conn || !childId) return;
    set({ insightsLoading: true, insightsError: false });
    try {
      // Demo: the store's `entries` hold the local seed history for ALL
      // children — scope to the selected child, matching the per-child fetch.
      const entries = conn.mode === 'local'
        ? s.entries.filter((e) => e.childId === childId)
        : await loadInsightsHistory(conn, childId, s.now - 90 * 86400000);
      if (get().selectedChildId !== childId) {
        // A child switch landed while this fetch was in flight — discard the
        // stale result and load for the now-selected child instead.
        set({ insightsLoading: false });
        get().loadInsights();
        return;
      }
      set({ insightsEntries: entries, insightsLoaded: true, insightsLoading: false });
    } catch {
      set({ insightsLoading: false, insightsError: true });
    }
  },

  // ---- read-only Baby Buddy server settings (lazy, fetched on Settings mount) ----
  loadProfile: async () => {
    const s = get();
    if (s.profileLoaded || s.profileLoading) return;
    const conn = s.connection;
    if (!conn) return;
    if (conn.mode === 'local') {
      set({ profile: null, profileLoaded: true });
      return;
    }
    set({ profileLoading: true, profileError: false });
    try {
      const profile = await loadProfileFromServer(conn);
      // If the session changed while /api/profile/ was in flight (switch server,
      // disconnect, session-expiry), drop this stale result rather than
      // repopulating another account's profile. Mirrors the loadTags guard.
      if (get().connection !== conn) return;
      set({ profile, profileLoaded: true, profileLoading: false });
    } catch (e) {
      // /api/profile/ can 500 on some instances (e.g. a user without a Settings
      // row). Log the status for diagnosis; Settings simply omits the Baby Buddy
      // group when there's no profile, so this stays non-blocking.
      console.warn('[settings] /api/profile/ failed:', e instanceof ApiError ? `HTTP ${e.status}` : e);
      set({ profileLoading: false, profileError: true });
    }
  },

  // ---- server tag list (lazy, fetched on first LogSheet open, cached) ----
  loadTags: async () => {
    const s = get();
    if (s.tagsLoaded || s.tagsLoading) return;
    const conn = s.connection;
    if (!conn) return;
    if (conn.mode !== 'server') {
      // No server to read /api/tags/ — seed the fallback list so the picker
      // isn't empty (keeps the old hardcoded defaults).
      set({ tags: DEMO_TAGS, tagsLoaded: true });
      return;
    }
    set({ tagsLoading: true });
    try {
      const tags = await loadTagsFromServer(conn);
      // If the session changed while /api/tags/ was in flight (switch server,
      // disconnect, session-expiry), drop this stale result rather than
      // repopulating another account's tags into the picker.
      if (get().connection !== conn) return;
      set({ tags, tagsLoaded: true, tagsLoading: false });
    } catch {
      // Tolerate staleness: keep whatever tags were already cached and leave
      // tagsLoaded false so the next LogSheet open retries. A new tag typed in
      // the meantime still saves fine (Baby Buddy auto-creates it on POST).
      set({ tagsLoading: false });
    }
  },

  // ---- log sheet ----
  openSheet: (type) => {
    const last = get().lastFeed;
    const shape = ACTIVITY_SHAPE[type];
    const te: TimeEntryState = { shape, tags: [] };
    if (shape === 'interval') {
      te.endAgoMin = 0;
      te.durationMin = DEFAULT_DURATION_MIN[type];
      te.ongoing = false;
      te.order = ['end', 'lasted', 'start'];
    } else {
      te.agoMin = 0;
    }
    if (type === 'feeding') {
      te.feedType = last.feedType || 'breast';
      te.method = last.method === 'left' ? 'right' : last.method === 'right' ? 'left' : last.method || 'left';
      // suggested starting breast, alternating from the last feed
      te.startSide = nextStartSide(get().entries);
    }
    if (type === 'pumping') {
      te.amount = 90;
      te.method = 'both';
    }
    if (type === 'diaper') {
      te.wet = true;
      te.solid = false;
      te.color = 'yellow';
    }
    if (type === 'sleep') {
      const hr = new Date().getHours();
      te.nap = hr >= 7 && hr < 19;
    }
    if (type === 'bath') {
      // Pre-select the wash that's due from the small/big rhythm.
      te.wash = nextWashKind(get().entries);
    }
    if (type === 'temperature') {
      // Seed a normal baseline so the decimal input opens on a sensible value.
      te.temperature = 37.0;
    }
    if (type === 'note') {
      // Blank body — the multiline note input opens empty.
      te.noteText = '';
    }
    set({ sheet: { type }, te, editingId: null, fromTimerId: null });
  },
  openEdit: (entryId) => {
    const s = get();
    const entry = s.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const now = s.now;
    const isPoint =
      entry.type === 'diaper' ||
      entry.type === 'bath' ||
      entry.type === 'temperature' ||
      entry.type === 'note' ||
      entry.type === 'milestone';
    const te: TimeEntryState = {
      shape: isPoint ? 'point' : 'interval',
      tags: entry.tags ?? [],
    };
    // Free-text notes exist on every real activity but bath (structural note
    // body), note (whose body IS its primary text), and milestone (edited via its
    // own sheet) — seed it so an edit doesn't silently drop an existing note.
    if (entry.type !== 'bath' && entry.type !== 'note' && entry.type !== 'milestone') te.notes = entry.notes;
    if (entry.type === 'diaper') {
      te.absTime = entry.time;
      te.agoMin = Math.max(0, Math.round((now - entry.time) / 60000));
      te.wet = entry.wet;
      te.solid = entry.solid;
      te.color = entry.color ?? 'yellow';
      te.amount = entry.amount ?? undefined;
    } else if (entry.type === 'bath') {
      te.absTime = entry.time;
      te.agoMin = Math.max(0, Math.round((now - entry.time) / 60000));
      te.wash = entry.wash;
    } else if (entry.type === 'temperature') {
      te.absTime = entry.time;
      te.agoMin = Math.max(0, Math.round((now - entry.time) / 60000));
      te.temperature = entry.value;
    } else if (entry.type === 'note') {
      te.absTime = entry.time;
      te.agoMin = Math.max(0, Math.round((now - entry.time) / 60000));
      te.noteText = entry.text;
    } else if (entry.type === 'milestone') {
      // Milestones are edited via their own sheet, never this generic editor;
      // this branch only keeps the point/interval narrowing total.
      te.absTime = entry.time;
      te.agoMin = Math.max(0, Math.round((now - entry.time) / 60000));
    } else {
      if (entry.end != null) {
        te.endAbs = entry.end;
        te.durationMin = Math.max(1, Math.round((entry.end - entry.start) / 60000));
        te.order = ['end', 'lasted', 'start']; // start derived from the pinned end + duration
        te.ongoing = false;
      } else {
        te.ongoing = true;
        te.startAbs = entry.start;
        te.order = ['end', 'start', 'lasted'];
      }
      if (entry.type === 'feeding') {
        te.feedType = entry.feedType;
        te.method = entry.method;
        te.amount = entry.amount ?? undefined;
        te.startSide = entry.tags.includes('left')
          ? 'left'
          : entry.tags.includes('right')
            ? 'right'
            : undefined;
      }
      if (entry.type === 'pumping') {
        te.amount = entry.amount ?? 90;
        te.method = entry.method ?? 'both';
      }
      if (entry.type === 'sleep') te.nap = entry.nap;
      if (entry.type === 'tummy') te.milestone = entry.milestone;
    }
    set({ sheet: { type: entry.type }, te, editingId: entryId, fromTimerId: null });
  },
  openTimerEdit: (timerId) => {
    const s = get();
    const tm = s.timers.find((t) => t.id === timerId);
    if (!tm) return;
    const type = tm.saveAs;
    const last = s.lastFeed;
    // The timer IS running, so show TimeEntry's ongoing editing view (start
    // editable, live "now" end) rather than dead end/lasted pills. save()
    // short-circuits to saveTimerDetails on fromTimerId BEFORE its
    // ongoing-creation branch, so ongoing:true here never spawns a new timer.
    const te: TimeEntryState = {
      shape: 'interval',
      tags: tm.tags ?? [],
      startAbs: tm.start,
      ongoing: true,
      order: ['end', 'start', 'lasted'],
    };
    if (type === 'feeding') {
      te.feedType = tm.feedType ?? (last.feedType || 'breast');
      te.method =
        tm.method ??
        (last.method === 'left' ? 'right' : last.method === 'right' ? 'left' : last.method || 'left');
      te.startSide = tm.startSide ?? nextStartSide(s.entries);
      if (tm.amount != null) te.amount = tm.amount;
    }
    if (type === 'pumping') {
      te.amount = tm.amount ?? 90;
      te.method = tm.method ?? 'both';
    }
    if (type === 'sleep') {
      const hr = new Date().getHours();
      te.nap = tm.nap ?? (hr >= 7 && hr < 19);
    }
    if (type === 'tummy' && tm.milestone != null) te.milestone = tm.milestone;
    if (tm.notes != null) te.notes = tm.notes;
    set({ sheet: { type }, te, editingId: null, fromTimerId: timerId });
  },
  closeSheet: () => set({ sheet: null, editingId: null, fromTimerId: null }),
  deleteEntry: (id) => {
    const s = get();
    const index = s.entries.findIndex((e) => e.id === id);
    if (index === -1) return;
    const entry = s.entries[index];
    const conn = s.connection;
    const didServerDelete = entry.serverId != null && !!conn && conn.mode === 'server' && !s.offline;
    set({
      entries: s.entries.filter((e) => e.id !== id),
      sheet: s.editingId === id ? null : s.sheet,
      editingId: s.editingId === id ? null : s.editingId,
    });
    lastDeleted = { entry, index, didServerDelete };
    if (didServerDelete) {
      void deleteEntryFromServer(conn, entry.type, entry.serverId as number).catch(() => {});
    } else if (entry.serverId != null && !!conn && conn.mode === 'server' && s.offline) {
      // Already on the server, deleted while offline: record the delete so it
      // replays on reconnect instead of the record resurrecting on the next refresh().
      void addPendingOp({ op: 'delete', entity: 'entry', entryType: entry.type, serverId: entry.serverId });
    }
    get().showToast('Deleted', { label: 'Undo', run: () => get().undoDelete() });
  },
  undoDelete: () => {
    const d = lastDeleted;
    if (!d) return;
    lastDeleted = null;
    set((s) => {
      if (s.entries.some((e) => e.id === d.entry.id)) return {};
      const next = s.entries.slice();
      next.splice(Math.min(d.index, next.length), 0, d.entry);
      return { entries: next };
    });
    // Only re-create server-side if the delete actually removed a server record;
    // a local-only (offline/demo) delete leaves the server copy intact.
    if (d.didServerDelete) get().commitWrite(d.entry);
    // Cancel any queued offline pending-delete op for this entry so it doesn't
    // replay on reconnect and delete the just-restored record out from under the
    // user. Harmless no-op if no such op was recorded (online delete, or a
    // local-only unsynced entry).
    if (d.entry.serverId != null) {
      void loadPendingOps().then((ops) =>
        savePendingOps(ops.filter((o) => !(o.op === 'delete' && o.entity === 'entry' && o.serverId === d.entry.serverId))),
      );
    }
    set({ toast: null, toastAction: null });
    if (toastTimer) clearTimeout(toastTimer);
  },
  logMilestone: (key, dateMs, note) => {
    const s = get();
    const childId = s.selectedChildId;
    if (!childId) return;
    const entry: MilestoneEntry = {
      id: 'e' + Date.now(),
      childId,
      type: 'milestone',
      key,
      time: dateMs,
      text: MILESTONE_BY_KEY[key]?.title ?? key,
      note: note?.trim() || undefined,
      tags: [],
    };
    set({ entries: [entry, ...s.entries] });
    get().commitWrite(entry);
    const queued = s.offline && !!s.connection && s.connection.mode === 'server';
    get().showToast(queued ? 'Milestone saved · queued offline' : 'Milestone reached');
  },
  editMilestone: (id, dateMs, note) => {
    const s = get();
    const existing = s.entries.find((e) => e.id === id);
    if (!existing || existing.type !== 'milestone') return;
    const entry: MilestoneEntry = { ...existing, time: dateMs, note: note?.trim() || undefined };
    set({ entries: s.entries.map((e) => (e.id === id ? entry : e)) });
    get().showToast('Updated');
    if (s.connection && s.connection.mode === 'server' && !s.offline) {
      void updateEntryOnServer(s.connection, entry).catch(() => {});
    } else if (s.connection && s.connection.mode === 'server' && s.offline && entry.serverId != null) {
      void addPendingOp({ op: 'update', entity: 'entry', payload: entry });
    }
  },
  openMilestone: (key) => set({ milestoneSheet: { mode: 'log', key } }),
  openEditMilestone: (id) => {
    const e = get().entries.find((x) => x.id === id);
    if (!e || e.type !== 'milestone') return;
    set({ milestoneSheet: { mode: 'edit', id } });
  },
  closeMilestoneSheet: () => set({ milestoneSheet: null }),
  answerMilestonePrompt: (key) => {
    const s = get();
    const childId = s.selectedChildId;
    if (!childId) return;
    const cur = s.answeredMilestonePrompts[childId] ?? [];
    if (cur.includes(key)) return; // one prompt per milestone: already answered
    const next = { ...s.answeredMilestonePrompts, [childId]: [...cur, key] };
    set({ answeredMilestonePrompts: next });
    void saveMilestonePrompts(next);
  },
  openMeasurement: (kind) => set({ measurementSheet: { kind }, editingMeasurementId: null }),
  openEditMeasurement: (id) => {
    const m = get().measurements.find((x) => x.id === id);
    if (!m) return;
    set({ measurementSheet: { kind: m.kind }, editingMeasurementId: id });
  },
  closeMeasurementSheet: () => set({ measurementSheet: null, editingMeasurementId: null }),
  saveMeasurement: (value, date, notes) => {
    const s = get();
    const kind = s.measurementSheet?.kind;
    if (kind == null) return;
    const existing = s.editingMeasurementId
      ? s.measurements.find((m) => m.id === s.editingMeasurementId)
      : null;
    const m: Measurement = {
      id: existing ? existing.id : 'm' + Date.now(),
      serverId: existing?.serverId,
      childId: s.selectedChildId,
      kind,
      value,
      date,
      notes,
    };
    set({
      measurements: existing
        ? s.measurements.map((x) => (x.id === m.id ? m : x))
        : [m, ...s.measurements],
      measurementSheet: null,
      editingMeasurementId: null,
    });
    get().showToast(existing ? 'Updated' : 'Saved');
    const conn = s.connection;
    if (conn && conn.mode === 'server' && !s.offline) {
      if (existing) {
        void updateMeasurementOnServer(conn, m).catch(() => {});
      } else {
        void pushMeasurementToServer(conn, m)
          .then((serverId) => {
            if (serverId != null) {
              set((st) => ({
                measurements: st.measurements.map((x) => (x.id === m.id ? { ...x, serverId } : x)),
              }));
            }
          })
          .catch(() => {});
      }
    } else if (conn && conn.mode === 'server' && s.offline && existing && m.serverId != null) {
      // Already on the server, editing while offline: record the update so it
      // replays on reconnect. A brand-new (existing == null) offline
      // measurement needs no op — its create is still pending.
      void addPendingOp({ op: 'update', entity: 'measurement', payload: m });
    }
  },
  deleteMeasurement: (id) => {
    const s = get();
    const m = s.measurements.find((x) => x.id === id);
    set({
      measurements: s.measurements.filter((x) => x.id !== id),
      measurementSheet: s.editingMeasurementId === id ? null : s.measurementSheet,
      editingMeasurementId: s.editingMeasurementId === id ? null : s.editingMeasurementId,
    });
    get().showToast('Deleted');
    const conn = s.connection;
    if (m && m.serverId != null && conn && conn.mode === 'server' && !s.offline) {
      void deleteMeasurementFromServer(conn, m.kind, m.serverId).catch(() => {});
    } else if (m && m.serverId != null && conn && conn.mode === 'server' && s.offline) {
      void addPendingOp({ op: 'delete', entity: 'measurement', kind: m.kind, serverId: m.serverId });
    }
  },
  setTE: (patch) =>
    set((s) => {
      const next = { ...s.te, ...patch };
      if ('agoMin' in patch) next.absTime = undefined; // point: a relative pick drops the edit anchor
      return { te: next };
    }),
  adjustAmount: (delta) =>
    set((s) => ({ te: { ...s.te, amount: Math.max(0, (s.te.amount ?? 0) + delta) } })),
  toggleWet: () => set((s) => ({ te: { ...s.te, wet: !s.te.wet } })),
  toggleSolid: () => set((s) => ({ te: { ...s.te, solid: !s.te.solid } })),
  setWash: (wash) => set((s) => ({ te: { ...s.te, wash } })),
  toggleTag: (tag) =>
    set((s) => {
      const has = s.te.tags.includes(tag);
      return { te: { ...s.te, tags: has ? s.te.tags.filter((t) => t !== tag) : [...s.te.tags, tag] } };
    }),
  createTag: (name) => {
    const trimmed = name.trim();
    // Reject blanks and the structural tags (bath/small/big, breastfeeding
    // left/right, milestone/mk:*), which must never be user-created. No server
    // call: Baby Buddy auto-creates the tag when the entry is POSTed with the name.
    if (!trimmed || isHiddenTag(trimmed)) return;
    set((s) => (s.te.tags.includes(trimmed) ? {} : { te: { ...s.te, tags: [...s.te.tags, trimmed] } }));
  },
  // ----- interval time-entry (keep the last two of start/end/lasted) -----
  setEnded: (agoMin) =>
    set((s) => {
      const ov = overruleLasted(s.te, s.now, 'end');
      const next = { ...s.te, endAgoMin: agoMin, endAbs: undefined, ongoing: false };
      if (ov) {
        next.startAbs = ov.frozen; // freeze the un-nudged start so lasted no longer drives it
        next.startAgoMin = undefined;
        next.order = ov.order;
      } else {
        next.order = reorder(s.te.order, 'end');
      }
      return { te: next };
    }),
  setEndedAbs: (ms) =>
    set((s) => {
      const ov = overruleLasted(s.te, s.now, 'end');
      const next = { ...s.te, endAbs: ms, endAgoMin: undefined, ongoing: false };
      if (ov) {
        next.startAbs = ov.frozen; // freeze the un-nudged start so lasted no longer drives it
        next.startAgoMin = undefined;
        next.order = ov.order;
      } else {
        next.order = reorder(s.te.order, 'end');
      }
      return { te: next };
    }),
  setOngoing: () =>
    set((s) => {
      const startMs = teStart(s.te, s.now) ?? s.now;
      return { te: { ...s.te, ongoing: true, startAbs: startMs, order: ['end', 'start', 'lasted'] } };
    }),
  setLasted: (min) =>
    set((s) => {
      const next = { ...s.te, durationMin: min, order: reorder(s.te.order, 'lasted') };
      if (s.te.ongoing) {
        next.ongoing = false; // specifying a length ends it (now)
        next.endAgoMin = 0;
        next.endAbs = undefined;
      }
      return { te: next };
    }),
  // Naming a length for a running timer: unlike setLasted (which pins the end at
  // "now" and lets the start slide back), keep the START fixed and make the END
  // the derived point (start + X). ongoing:false marks the entry finished so
  // save() stops the timer into a completed entry rather than keeping it live.
  setTimerLasted: (min) =>
    set((s) => ({
      te: {
        ...s.te,
        ongoing: false,
        durationMin: min,
        endAbs: undefined,
        endAgoMin: undefined,
        order: ['lasted', 'start', 'end'],
      },
    })),
  setStartedAt: (ms, anchor) =>
    set((s) => {
      const ov = overruleLasted(s.te, s.now, 'start');
      const next = { ...s.te, startAbs: ms, startAnchor: anchor, startAgoMin: undefined };
      if (ov) {
        next.endAbs = ov.frozen; // freeze the un-nudged end so lasted no longer drives it
        next.endAgoMin = undefined;
        next.order = ov.order;
      } else {
        next.order = reorder(s.te.order, 'start');
      }
      return { te: next };
    }),
  setStartedAgo: (min) =>
    set((s) => {
      const ov = overruleLasted(s.te, s.now, 'start');
      const next = { ...s.te, startAbs: undefined, startAgoMin: min, startAnchor: undefined };
      if (ov) {
        next.endAbs = ov.frozen; // freeze the un-nudged end so lasted no longer drives it
        next.endAgoMin = undefined;
        next.order = ov.order;
      } else {
        next.order = reorder(s.te.order, 'start');
      }
      return { te: next };
    }),
  sleepWoke: () => get().setEnded(0),
  sleepStillSleeping: () => get().setOngoing(),

  save: () => {
    const s = get();
    const type = s.sheet?.type;
    if (!type) return;
    // Editing a running timer (opened via openTimerEdit): while it is still
    // ongoing, keep it running and just persist the details onto the Timer
    // (saveTimerDetails). Once the user names a length ("lasted X" →
    // setTimerLasted flips ongoing:false), fall through and stop it into a
    // completed entry, dropping the source timer below.
    if (s.fromTimerId && s.te.ongoing) {
      get().saveTimerDetails();
      return;
    }
    // A general note whose body trims to empty isn't worth saving — no-op and
    // leave the sheet open (the X closes it) so a stray tap can't create a blank.
    if (type === 'note' && !s.te.noteText?.trim()) return;
    const te = s.te;
    const now = s.now;
    const childId = s.selectedChildId;
    const existing = s.editingId ? s.entries.find((e) => e.id === s.editingId) : null;
    const id = existing ? existing.id : 'e' + Date.now();
    // for breastfeeding "both", record the starting side as a left/right tag
    const tags =
      type === 'feeding' &&
      te.feedType === 'breast' &&
      te.method === 'both' &&
      te.startSide &&
      !te.tags.includes(te.startSide)
        ? [...te.tags, te.startSide]
        : te.tags;

    // build entry
    let entry: Entry;
    if (type === 'feeding') {
      entry = {
        id,
        childId,
        type: 'feeding',
        start: teStart(te, now) as number,
        end: te.ongoing ? null : teEnd(te, now),
        feedType: te.feedType ?? 'breast',
        method: te.method ?? 'left',
        amount: te.amount ?? null,
        notes: te.notes?.trim() || undefined,
        tags,
      };
    } else if (type === 'sleep') {
      entry = {
        id,
        childId,
        type: 'sleep',
        start: teStart(te, now) as number,
        end: te.ongoing ? null : teEnd(te, now),
        nap: te.nap ?? false,
        notes: te.notes?.trim() || undefined,
        tags,
      };
    } else if (type === 'pumping') {
      entry = {
        id,
        childId,
        type: 'pumping',
        start: teStart(te, now) as number,
        end: te.ongoing ? null : teEnd(te, now),
        amount: te.amount ?? null,
        method: te.method,
        notes: te.notes?.trim() || undefined,
        tags,
      };
    } else if (type === 'tummy') {
      entry = {
        id,
        childId,
        type: 'tummy',
        start: teStart(te, now) as number,
        end: te.ongoing ? null : teEnd(te, now),
        milestone: te.milestone,
        notes: te.notes?.trim() || undefined,
        tags,
      };
    } else if (type === 'bath') {
      // bath (point) — stored server-side as a tagged note (see the API client)
      entry = {
        id,
        childId,
        type: 'bath',
        time: teEnd(te, now),
        wash: te.wash ?? 'small',
        tags,
      };
    } else if (type === 'temperature') {
      // temperature (point) — a decimal reading + notes
      entry = {
        id,
        childId,
        type: 'temperature',
        time: teEnd(te, now),
        value: te.temperature ?? 37.0,
        notes: te.notes?.trim() || undefined,
        tags,
      };
    } else if (type === 'note') {
      // note (point) — the trimmed body is the primary content (guaranteed
      // non-empty by the blank-note guard above)
      entry = {
        id,
        childId,
        type: 'note',
        time: teEnd(te, now),
        text: te.noteText?.trim() ?? '',
        tags,
      };
    } else {
      // diaper (point)
      entry = {
        id,
        childId,
        type: 'diaper',
        time: teEnd(te, now),
        wet: te.wet ?? false,
        solid: te.solid ?? false,
        color: te.solid ? (te.color ?? null) : null,
        amount: te.solid && te.amount && te.amount > 0 ? te.amount : null,
        notes: te.notes?.trim() || undefined,
        tags,
      };
    }

    entry.serverId = existing?.serverId;

    // live interval => create a running timer instead of an entry (create only)
    if (!existing && te.ongoing && te.shape === 'interval') {
      const timer: Timer = {
        id: 't' + Date.now(),
        activity: type,
        name: ACTIVITY_LABEL[type],
        start: teStart(te, now) as number,
        saveAs: type,
        childId,
      };
      set({
        timers: [...s.timers.filter((tm) => tm.id !== s.fromTimerId), timer],
        sheet: null,
        fromTimerId: null,
      });
      get().showToast('Live timer started');
      mirrorTimerCreate(get, set, timer.id);
      return;
    }

    const patch: Partial<AppState> = existing
      ? { entries: s.entries.map((e) => (e.id === id ? entry : e)), sheet: null, editingId: null }
      : {
          entries: [entry, ...s.entries],
          sheet: null,
          fromTimerId: null,
          // stopping a running timer via "lasted X" drops the source timer
          ...(s.fromTimerId ? { timers: s.timers.filter((tm) => tm.id !== s.fromTimerId) } : {}),
        };
    if (type === 'feeding') {
      patch.lastFeed = { feedType: te.feedType ?? 'breast', method: te.method ?? 'left' };
    }
    set(patch);
    if (existing) {
      get().showToast('Updated');
      if (s.connection && s.connection.mode === 'server' && !s.offline) {
        void updateEntryOnServer(s.connection, entry).catch(() => {});
      } else if (s.connection && s.connection.mode === 'server' && s.offline && entry.serverId != null) {
        // Already on the server, edited while offline: record the update so
        // it replays on reconnect. A not-yet-synced local edit needs no op.
        void addPendingOp({ op: 'update', entity: 'entry', payload: entry });
      }
    } else {
      // Stopping a running timer via "lasted X" drops its source timer above;
      // delete the server mirror too.
      if (s.fromTimerId) {
        const src = s.timers.find((tm) => tm.id === s.fromTimerId);
        if (src) mirrorTimerDelete(get, src);
      }
      get().commitWrite(entry);
      const queued = s.offline && !!s.connection && s.connection.mode === 'server';
      get().showToast(queued ? 'Saved · queued offline' : 'Saved');
    }
  },

  saveTimerDetails: () => {
    const s = get();
    const timerId = s.fromTimerId;
    if (!timerId) return;
    const tm = s.timers.find((t) => t.id === timerId);
    if (!tm) return;
    const te = s.te;
    // Generic edits available on every timer type: tags, plus the (possibly
    // re-anchored) start time. Only trust the start when the sheet is still in
    // the ongoing/start-adjust state: tapping Ended/Lasted flips ongoing:false
    // and can make `start` a DERIVED value (end − duration ≈ now − 30m),
    // unrelated to the real elapsed start — persisting that would silently
    // corrupt the running timer. In that case keep tm.start (details still save).
    const patch: Partial<Timer> = { tags: te.tags, notes: te.notes?.trim() || undefined };
    if (te.ongoing) patch.start = teStart(te, s.now) ?? tm.start;
    if (tm.saveAs === 'feeding') {
      patch.feedType = te.feedType;
      patch.method = te.method;
      patch.startSide = te.startSide;
      patch.amount = te.amount;
    } else if (tm.saveAs === 'pumping') {
      patch.method = te.method;
      patch.amount = te.amount;
    } else if (tm.saveAs === 'sleep') {
      patch.nap = te.nap;
    } else if (tm.saveAs === 'tummy') {
      patch.milestone = te.milestone;
    }
    set({
      timers: s.timers.map((t) => (t.id === timerId ? { ...t, ...patch } : t)),
      sheet: null,
      fromTimerId: null,
    });
    get().showToast('Details saved');
    const updated = get().timers.find((t) => t.id === timerId);
    if (updated) mirrorTimerEdit(get, updated);
  },

  startQuickTimer: () => {
    const s = get();
    const timer: Timer = {
      id: 't' + Date.now(),
      activity: 'feeding',
      name: ACTIVITY_LABEL.feeding,
      start: Date.now(),
      saveAs: 'feeding',
      childId: s.selectedChildId,
    };
    set({ timers: [...s.timers, timer] });
    get().showToast('Timer started');
    mirrorTimerCreate(get, set, timer.id);
  },
  stopTimer: (id, endMs) => {
    const s = get();
    const tm = s.timers.find((t) => t.id === id);
    if (!tm) return;
    const saveAs = tm.saveAs;
    const now = Date.now();
    // An explicit past end (from the ephemeral "Ended earlier…" editor) is
    // clamped into [start, now]; otherwise end at now.
    const resolvedEnd = endMs != null ? Math.min(now, Math.max(tm.start, endMs)) : now;
    const savedTags = tm.tags ?? [];
    const childId = tm.childId ?? s.selectedChildId;
    const base = { id: 'e' + now, childId, tags: savedTags, notes: tm.notes };
    let entry: Entry;
    if (saveAs === 'feeding') {
      const feedType = tm.feedType ?? 'breast';
      const method = tm.method ?? 'left';
      // mirror save()'s breastfeeding "both" → startSide-as-tag conversion
      const tags =
        feedType === 'breast' && method === 'both' && tm.startSide && !savedTags.includes(tm.startSide)
          ? [...savedTags, tm.startSide]
          : savedTags;
      entry = { ...base, tags, type: 'feeding', start: tm.start, end: resolvedEnd, feedType, method, amount: tm.amount ?? null };
    } else if (saveAs === 'pumping') {
      entry = { ...base, type: 'pumping', start: tm.start, end: resolvedEnd, amount: tm.amount ?? 90, method: tm.method };
    } else if (saveAs === 'tummy') {
      entry = { ...base, type: 'tummy', start: tm.start, end: resolvedEnd, milestone: tm.milestone };
    } else {
      entry = buildSleepEntry(tm, resolvedEnd, childId);
    }
    set({ timers: s.timers.filter((t) => t.id !== id), entries: [entry, ...s.entries] });
    get().commitWrite(entry);
    mirrorTimerDelete(get, tm);
    const queued = s.offline && !!s.connection && s.connection.mode === 'server';
    // Only call out the resolved end when the caller asked for a back-dated
    // stop — ending "now" needs no confirmation of what time it is.
    const backdated = endMs != null ? ` · ended ${fmtClock(resolvedEnd)}` : '';
    get().showToast(queued ? `Saved · queued offline${backdated}` : `Saved as ${ACTIVITY_LABEL[saveAs].toLowerCase()}${backdated}`);
  },
  discardTimer: (id) => {
    const tm = get().timers.find((t) => t.id === id);
    set((s) => ({ timers: s.timers.filter((t) => t.id !== id) }));
    if (tm) mirrorTimerDelete(get, tm);
  },
  setTimerSaveAs: (id, saveAs) => {
    set((s) => ({
      timers: s.timers.map((t) => (t.id === id ? { ...t, saveAs, name: ACTIVITY_LABEL[saveAs] } : t)),
    }));
    const updated = get().timers.find((t) => t.id === id);
    if (updated) mirrorTimerEdit(get, updated);
  },
  adjustTimerStart: (id, deltaMin) => {
    set((s) => ({
      timers: s.timers.map((t) =>
        t.id === id ? { ...t, start: Math.min(Date.now(), t.start + deltaMin * 60000) } : t,
      ),
    }));
    const updated = get().timers.find((t) => t.id === id);
    if (updated) mirrorTimerEdit(get, updated);
  },
  setTimerStart: (id, ms) => {
    set((s) => ({
      timers: s.timers.map((t) => (t.id === id ? { ...t, start: Math.min(Date.now(), ms) } : t)),
    }));
    const updated = get().timers.find((t) => t.id === id);
    if (updated) mirrorTimerEdit(get, updated);
  },

  showToast: (msg, action) => {
    set({ toast: msg, toastAction: action ?? null });
    if (toastTimer) clearTimeout(toastTimer);
    // Actionable toasts (e.g. Undo) linger longer so there's time to react.
    toastTimer = setTimeout(() => set({ toast: null, toastAction: null }), action ? 5000 : 2400);
  },
}));

// Persist running timers to on-device storage whenever they change, so they
// survive the app being closed and reopened. Every timer mutation replaces the
// `timers` array (`set({ timers: ... })`); the per-second `now` tick and other
// updates keep the same reference, so this writes only on an actual change.
useAppStore.subscribe((state, prev) => {
  if (state.timers !== prev.timers) void saveTimers(state.timers);
});

// Persist the durable local-mode entities to on-device storage whenever they
// change, mirroring the timers subscribe above: reference-equality checks so
// each key is written only on an actual change, not on every unrelated `set`.
useAppStore.subscribe((state, prev) => {
  if (state.children !== prev.children) void saveChildren(state.children);
  if (state.entries !== prev.entries) void saveEntries(state.entries);
  if (state.measurements !== prev.measurements) void saveMeasurements(state.measurements);
  if (state.selectedChildId !== prev.selectedChildId) void saveSelectedChildId(state.selectedChildId);
  if (state.lastFeed !== prev.lastFeed) void saveLastFeed(state.lastFeed);
});
