/**
 * Global app state (Zustand). Mirrors the design handoff reference's state
 * model and behavior: connection, theme/offline, ticking `now`, the selected
 * child, entries/timers, the working time-entry (`te`), toast, and the
 * open-sheet / save / timer logic.
 */

import { create } from 'zustand';

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
  loadFromServer,
  loadInsightsHistory,
  loadProfileFromServer,
  loadTagsFromServer,
  pushChildToServer,
  pushEntryToServer,
  pushMeasurementToServer,
  updateChildOnServer,
  updateEntryOnServer,
  updateMeasurementOnServer,
} from '@/data/repository';
import { ApiError, childColor, HIDDEN_TAGS } from '@/api/client';
import { DEMO_TAGS, makeSeed } from '@/data/seed';
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
  sheet: { type: ActivityType } | null;
  /** id of the entry being edited, or null when logging a new one */
  editingId: string | null;
  /** id of the running timer being stopped+edited via the log sheet, or null */
  fromTimerId: string | null;
  measurementSheet: { kind: MeasurementKind } | null;
  editingMeasurementId: string | null;

  // data
  selectedChildId: string;
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

interface AppActions {
  tick: (now: number) => void;
  toggleTheme: () => void;
  setOffline: (v: boolean) => void;
  toggleOffline: () => void;
  setNetworkOnline: (online: boolean) => void;

  hydrate: () => Promise<void>;
  /** Re-check the server and reload data (on foreground / pull-to-refresh). */
  refresh: () => Promise<void>;
  connect: (serverUrl: string, token: string) => Promise<void>;
  enterDemo: () => void;
  disconnect: () => void;
  forgetServer: (serverUrl: string) => void;
  flushQueue: () => Promise<void>;
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

  openSheet: (type: ActivityType) => void;
  openEdit: (entryId: string) => void;
  openTimerEdit: (timerId: string) => void;
  closeSheet: () => void;
  deleteEntry: (id: string) => void;
  /** Restore the entry removed by the most recent deleteEntry (undo). */
  undoDelete: () => void;

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
    if (HIDDEN_TAGS.has(tag.name) || seen.has(tag.name)) continue;
    seen.add(tag.name);
    out.push(tag);
  }
  for (const name of selected) {
    if (HIDDEN_TAGS.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ name });
  }
  return out;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
// The most recently deleted entry, held so an "Undo" toast can restore it.
// `didServerDelete` records whether the delete actually reached the server, so
// undo only re-creates it server-side when a server record was really removed.
let lastDeleted: { entry: Entry; index: number; didServerDelete: boolean } | null = null;
// Guards against overlapping refreshes (e.g. a foreground event landing while a
// pull-to-refresh is still in flight).
let refreshInFlight = false;

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
  offline: false,
  networkOnline: true,
  simulateOffline: false,
  now: Date.now(),
  toast: null,
  toastAction: null,
  showChildSwitcher: false,
  childSheet: false,
  editingChildId: null,
  sheet: null,
  editingId: null,
  fromTimerId: null,
  measurementSheet: null,
  editingMeasurementId: null,

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
  setOffline: (v) => {
    const offline = v || !get().networkOnline;
    set({ simulateOffline: v, offline });
    if (!offline) void get().flushQueue();
  },
  toggleOffline: () => {
    const sim = !get().simulateOffline;
    const offline = sim || !get().networkOnline;
    set({ simulateOffline: sim, offline });
    if (!offline) void get().flushQueue();
  },
  setNetworkOnline: (online) => {
    const offline = get().simulateOffline || !online;
    set({ networkOnline: online, offline });
    if (!offline) void get().flushQueue();
  },

  // ---- connection ----
  hydrate: async () => {
    const conn = await loadConnection();
    const q = await loadQueue();
    // themeMode is independent of connection state, so apply it once here up
    // front and it covers every branch below (no connection, demo, real).
    const prefs = await loadPrefs();
    if (prefs.themeMode) set({ themeMode: prefs.themeMode });
    // Running timers are local-only (the server has no matching record), so
    // restore them from on-device storage regardless of how the rest of the
    // state is loaded below.
    const savedTimers = await loadTimers();
    let savedServers = await loadServers();
    // Migration: ensure the active real server is in the retry list for users
    // who connected before the saved-servers feature existed.
    if (conn && !conn.demo && conn.serverUrl) {
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
    if (conn.demo) {
      const now = Date.now();
      const seed = makeSeed(now);
      set({
        connection: conn,
        connected: true,
        hydrating: false,
        now,
        children: seed.children,
        entries: seed.entries,
        timers: savedTimers.length ? savedTimers : seed.timers,
        selectedChildId: seed.selectedChildId,
        lastFeed: seed.lastFeed,
        measurements: seed.measurements,
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
      set({
        connected: true,
        hydrating: false,
        ...data,
        entries: mergeQueuedEntries(data.entries, q),
        timers: savedTimers,
      });
      void get().flushQueue();
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
    if (!conn || conn.demo || s.simulateOffline || refreshInFlight) return;
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
      // Keep the user's current child if the server still has it; otherwise fall
      // back to the server's first child (matches a cold `hydrate`).
      const selectedChildId = data.children.some((c) => c.id === s.selectedChildId)
        ? s.selectedChildId
        : data.selectedChildId;
      set({
        connected: true,
        offline: false,
        networkOnline: true,
        ...data,
        selectedChildId,
        timers: localTimers,
      });
      void get().flushQueue();
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
    const conn: Connection = { demo: false, serverUrl, token };
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
    } catch (e) {
      set({
        connecting: false,
        connectError: e instanceof Error ? e.message : "Couldn't connect to server.",
      });
    }
  },
  enterDemo: () => {
    const now = Date.now();
    const seed = makeSeed(now);
    const conn: Connection = { demo: true, serverUrl: '', token: '' };
    set({
      connection: conn,
      connected: true,
      connecting: false,
      connectError: null,
      now,
      children: seed.children,
      entries: seed.entries,
      timers: seed.timers,
      selectedChildId: seed.selectedChildId,
      lastFeed: seed.lastFeed,
      measurements: seed.measurements,
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
    if (!conn || conn.demo || s.offline) return;
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
  commitWrite: (entry) => {
    const s = get();
    const conn = s.connection;
    if (!conn || conn.demo) return; // demo: local only, nothing to push
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
      if (conn && !conn.demo && !s.offline) {
        void updateChildOnServer(conn, child, change)
          .then((url) => {
            // Swap the ephemeral local file URI for the durable server URL.
            if (change.kind === 'none' || url === undefined) return;
            set((st) => ({
              children: st.children.map((c) => (c.id === child.id ? { ...c, picture: url } : c)),
            }));
          })
          .catch(() => {});
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
    if (conn && !conn.demo && !s.offline) {
      void pushChildToServer(conn, child, change)
        .then((res) => {
          if (!res || res.id == null) return;
          // Patch the local id -> the real server id so the new child stays
          // selected across the next refresh()/hydrate(), which replaces
          // `children` wholesale with server data keyed by real ids. Adopt the
          // server picture URL in place of the local file URI.
          set((st) => ({
            children: st.children.map((c) =>
              c.id === localId ? { ...c, id: String(res.id), picture: res.picture ?? c.picture } : c,
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
    // A server-backed child has a numeric id (mirrors updateChild's guard); a
    // local-only child (created offline) has id = 'child'+timestamp → NaN.
    const serverBacked = Number.isFinite(Number(child.id));
    // Server delete only when it can be made durable now: server-backed +
    // online + non-demo. Otherwise the removal is in-memory only (the UI blocks
    // an offline server-backed delete, since a refresh would resurrect it).
    const doServerDelete = serverBacked && !!conn && !conn.demo && !s.offline;

    const nextChildren = s.children.filter((c) => c.id !== id);
    const patch: Partial<AppState> = {
      children: nextChildren,
      childSheet: false,
      editingChildId: null,
      showChildSwitcher: false,
    };
    if (s.selectedChildId === id) {
      // Deleting the selected child: re-point selection (mirrors refresh's
      // fallback), purge its loaded entries/measurements, clear the running
      // timers (they implicitly belong to the selected child, so a later stop
      // must not log against a different one), and reset insights (as
      // selectChild does). A non-selected child has nothing else loaded.
      patch.selectedChildId = nextChildren[0]?.id ?? '';
      patch.entries = s.entries.filter((e) => e.childId !== id);
      patch.measurements = s.measurements.filter((m) => m.childId !== id);
      patch.timers = [];
      patch.insightsLoaded = false;
      patch.insightsEntries = [];
      patch.insightsError = false;
    }
    set(patch);
    if (doServerDelete) {
      void deleteChildFromServer(conn, Number(child.id)).catch(() => {});
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
      const entries = conn.demo
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
    if (conn.demo) {
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
    if (conn.demo) {
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
      entry.type === 'note';
    const te: TimeEntryState = {
      shape: isPoint ? 'point' : 'interval',
      tags: entry.tags ?? [],
    };
    // Free-text notes exist on every real activity but bath (structural note
    // body) and note (whose body IS its primary text, not an annotation) —
    // seed it so an edit doesn't silently drop an existing note.
    if (entry.type !== 'bath' && entry.type !== 'note') te.notes = entry.notes;
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
    const didServerDelete = entry.serverId != null && !!conn && !conn.demo && !s.offline;
    set({
      entries: s.entries.filter((e) => e.id !== id),
      sheet: s.editingId === id ? null : s.sheet,
      editingId: s.editingId === id ? null : s.editingId,
    });
    lastDeleted = { entry, index, didServerDelete };
    if (didServerDelete) {
      void deleteEntryFromServer(conn, entry.type, entry.serverId as number).catch(() => {});
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
    set({ toast: null, toastAction: null });
    if (toastTimer) clearTimeout(toastTimer);
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
    if (conn && !conn.demo && !s.offline) {
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
    if (m && m.serverId != null && conn && !conn.demo && !s.offline) {
      void deleteMeasurementFromServer(conn, m.kind, m.serverId).catch(() => {});
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
    // left/right) — those must never be user-created. No server call: Baby Buddy
    // auto-creates the tag when the entry is POSTed with the new name.
    if (!trimmed || HIDDEN_TAGS.has(trimmed)) return;
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
        amount: te.amount && te.amount > 0 ? te.amount : null,
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
      };
      set({
        timers: [...s.timers.filter((tm) => tm.id !== s.fromTimerId), timer],
        sheet: null,
        fromTimerId: null,
      });
      get().showToast('Live timer started');
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
      if (s.connection && !s.connection.demo && !s.offline) {
        void updateEntryOnServer(s.connection, entry).catch(() => {});
      }
    } else {
      get().commitWrite(entry);
      const queued = s.offline && !!s.connection && !s.connection.demo;
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
  },

  startQuickTimer: () => {
    const s = get();
    const timer: Timer = {
      id: 't' + Date.now(),
      activity: 'feeding',
      name: ACTIVITY_LABEL.feeding,
      start: Date.now(),
      saveAs: 'feeding',
    };
    set({ timers: [...s.timers, timer] });
    get().showToast('Timer started');
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
    const base = { id: 'e' + now, childId: s.selectedChildId, tags: savedTags, notes: tm.notes };
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
      entry = buildSleepEntry(tm, resolvedEnd, s.selectedChildId);
    }
    set({ timers: s.timers.filter((t) => t.id !== id), entries: [entry, ...s.entries] });
    get().commitWrite(entry);
    const queued = s.offline && !!s.connection && !s.connection.demo;
    // Only call out the resolved end when the caller asked for a back-dated
    // stop — ending "now" needs no confirmation of what time it is.
    const backdated = endMs != null ? ` · ended ${fmtClock(resolvedEnd)}` : '';
    get().showToast(queued ? `Saved · queued offline${backdated}` : `Saved as ${ACTIVITY_LABEL[saveAs].toLowerCase()}${backdated}`);
  },
  discardTimer: (id) => set((s) => ({ timers: s.timers.filter((t) => t.id !== id) })),
  setTimerSaveAs: (id, saveAs) =>
    set((s) => ({
      timers: s.timers.map((t) => (t.id === id ? { ...t, saveAs, name: ACTIVITY_LABEL[saveAs] } : t)),
    })),
  adjustTimerStart: (id, deltaMin) =>
    set((s) => ({
      timers: s.timers.map((t) =>
        t.id === id ? { ...t, start: Math.min(Date.now(), t.start + deltaMin * 60000) } : t,
      ),
    })),
  setTimerStart: (id, ms) =>
    set((s) => ({
      timers: s.timers.map((t) => (t.id === id ? { ...t, start: Math.min(Date.now(), ms) } : t)),
    })),

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
