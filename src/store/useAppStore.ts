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
  deleteEntryFromServer,
  deleteMeasurementFromServer,
  loadFromServer,
  pushEntryToServer,
  pushMeasurementToServer,
  updateEntryOnServer,
  updateMeasurementOnServer,
} from '@/data/repository';
import { ApiError } from '@/api/client';
import { makeSeed } from '@/data/seed';
import { clearQueue, enqueueEntry, loadQueue, saveQueue } from '@/data/queue';
import { clearConnection, loadConnection, saveConnection } from '@/data/storage';
import {
  loadServers,
  persistServers,
  removeServer,
  upsertServer,
  type SavedServer,
} from '@/data/servers';
import { loadTimers, saveTimers } from '@/data/timers';
import { nextStartSide, reorder, teEnd, teStart } from '@/store/selectors';
import type { ThemeMode } from '@/theme/tokens';
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
  showChildSwitcher: boolean;
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

  openSheet: (type: ActivityType) => void;
  openEdit: (entryId: string) => void;
  openTimerEdit: (timerId: string) => void;
  closeSheet: () => void;
  deleteEntry: (id: string) => void;

  openMeasurement: (kind: MeasurementKind) => void;
  openEditMeasurement: (id: string) => void;
  closeMeasurementSheet: () => void;
  saveMeasurement: (value: number, date: number, notes?: string) => void;
  deleteMeasurement: (id: string) => void;
  setTE: (patch: Partial<TimeEntryState>) => void;
  adjustAmount: (delta: number) => void;
  toggleWet: () => void;
  toggleSolid: () => void;
  toggleTag: (tag: string) => void;
  setEnded: (agoMin: number) => void;
  setEndedAbs: (ms: number) => void;
  setOngoing: () => void;
  setLasted: (min: number) => void;
  setStartedAt: (ms: number, anchor?: 'lastfeed' | 'wake' | 'now') => void;
  sleepWoke: () => void;
  sleepStillSleeping: () => void;
  save: () => void;

  startQuickTimer: () => void;
  stopTimer: (id: string) => void;
  adjustTimerStart: (id: string, deltaMin: number) => void;
  setTimerStart: (id: string, ms: number) => void;
  discardTimer: (id: string) => void;
  setTimerSaveAs: (id: string, saveAs: ActivityType) => void;
  /** Persist `te`'s metadata onto the running timer named by `fromTimerId`,
   * WITHOUT stopping it or creating an entry, then close the sheet. */
  saveTimerDetails: () => void;

  showToast: (msg: string) => void;
}

export type AppStore = AppState & AppActions;

/**
 * Merge not-yet-flushed queued entries (from the offline write queue) into a
 * set of server entries for display, so an entry created offline stays
 * visible across an app kill instead of only being reflected in `queueCount`.
 * Queued entries are prepended (they're the newest — `save()` also prepends).
 *
 * De-dup is a defensive safety net for the case where a queued entry has
 * already reached the server (e.g. a flush that pushed successfully but
 * crashed before persisting the shrunk queue): a queued entry is dropped if
 * its `id` or (if present) `serverId` already appears among the server
 * entries. In the common case — a flush completes normally after hydrate —
 * de-duplication instead falls out of `refresh()`'s full replacement of
 * `entries` with fresh server data, which naturally drops the local copy.
 */
export function mergeQueuedEntries(serverEntries: Entry[], queuedEntries: Entry[]): Entry[] {
  const serverIds = new Set(serverEntries.map((e) => e.id));
  const serverServerIds = new Set(
    serverEntries.filter((e) => e.serverId != null).map((e) => e.serverId),
  );
  const notYetOnServer = queuedEntries.filter(
    (q) => !serverIds.has(q.id) && (q.serverId == null || !serverServerIds.has(q.serverId)),
  );
  return [...notYetOnServer, ...serverEntries];
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
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
  showChildSwitcher: false,
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

  te: { shape: 'interval', tags: [] },

  // ---- ticking clock ----
  tick: (now) => set({ now }),

  // ---- theme / offline ----
  toggleTheme: () => set((s) => ({ themeMode: s.themeMode === 'dark' ? 'light' : 'dark' })),
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
    try {
      const data = await loadFromServer(conn);
      // Keep the user's current child if the server still has it; otherwise fall
      // back to the server's first child (matches a cold `hydrate`). Running
      // timers are local-only, so the on-device copy always wins over `data`'s [].
      const selectedChildId = data.children.some((c) => c.id === s.selectedChildId)
        ? s.selectedChildId
        : data.selectedChildId;
      set({
        connected: true,
        offline: false,
        networkOnline: true,
        ...data,
        selectedChildId,
        timers: get().timers,
      });
      void get().flushQueue();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await clearConnection();
        set({
          connection: null,
          connected: false,
          connectError: 'Session expired — please reconnect.',
        });
      } else {
        // server unreachable — stay/enter offline; queued writes hold until the
        // next successful refresh.
        set({ offline: true });
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
      set({ connection: conn, connected: true, connecting: false, savedServers, ...data });
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
  selectChild: (id) => set({ selectedChildId: id, showChildSwitcher: false }),
  openSwitcher: () => set({ showChildSwitcher: true }),
  closeSwitcher: () => set({ showChildSwitcher: false }),

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
    set({ sheet: { type }, te, editingId: null, fromTimerId: null });
  },
  openEdit: (entryId) => {
    const s = get();
    const entry = s.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const now = s.now;
    const te: TimeEntryState = {
      shape: entry.type === 'diaper' ? 'point' : 'interval',
      tags: entry.tags ?? [],
    };
    if (entry.type === 'diaper') {
      te.absTime = entry.time;
      te.agoMin = Math.max(0, Math.round((now - entry.time) / 60000));
      te.wet = entry.wet;
      te.solid = entry.solid;
      te.color = entry.color ?? 'yellow';
      te.amount = entry.amount ?? undefined;
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
    set({ sheet: { type }, te, editingId: null, fromTimerId: timerId });
  },
  closeSheet: () => set({ sheet: null, editingId: null, fromTimerId: null }),
  deleteEntry: (id) => {
    const s = get();
    const entry = s.entries.find((e) => e.id === id);
    set({
      entries: s.entries.filter((e) => e.id !== id),
      sheet: s.editingId === id ? null : s.sheet,
      editingId: s.editingId === id ? null : s.editingId,
    });
    get().showToast('Deleted');
    const conn = s.connection;
    if (entry && entry.serverId != null && conn && !conn.demo && !s.offline) {
      void deleteEntryFromServer(conn, entry.type, entry.serverId).catch(() => {});
    }
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
  toggleTag: (tag) =>
    set((s) => {
      const has = s.te.tags.includes(tag);
      return { te: { ...s.te, tags: has ? s.te.tags.filter((t) => t !== tag) : [...s.te.tags, tag] } };
    }),
  // ----- interval time-entry (keep the last two of start/end/lasted) -----
  setEnded: (agoMin) =>
    set((s) => ({
      te: { ...s.te, endAgoMin: agoMin, endAbs: undefined, ongoing: false, order: reorder(s.te.order, 'end') },
    })),
  setEndedAbs: (ms) =>
    set((s) => ({
      te: { ...s.te, endAbs: ms, endAgoMin: undefined, ongoing: false, order: reorder(s.te.order, 'end') },
    })),
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
  setStartedAt: (ms, anchor) =>
    set((s) => ({ te: { ...s.te, startAbs: ms, startAnchor: anchor, order: reorder(s.te.order, 'start') } })),
  sleepWoke: () => get().setEnded(0),
  sleepStillSleeping: () => get().setOngoing(),

  save: () => {
    const s = get();
    const type = s.sheet?.type;
    if (!type) return;
    // Editing a running timer (opened via openTimerEdit): keep it running and
    // just persist the details onto the Timer instead of stopping it into an
    // entry — see saveTimerDetails.
    if (s.fromTimerId) {
      get().saveTimerDetails();
      return;
    }
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
      : { entries: [entry, ...s.entries], sheet: null, fromTimerId: null };
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
    const patch: Partial<Timer> = { tags: te.tags };
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
  stopTimer: (id) => {
    const s = get();
    const tm = s.timers.find((t) => t.id === id);
    if (!tm) return;
    const saveAs = tm.saveAs;
    const now = Date.now();
    const savedTags = tm.tags ?? [];
    const base = { id: 'e' + now, childId: s.selectedChildId, tags: savedTags };
    let entry: Entry;
    if (saveAs === 'feeding') {
      const feedType = tm.feedType ?? 'breast';
      const method = tm.method ?? 'left';
      // mirror save()'s breastfeeding "both" → startSide-as-tag conversion
      const tags =
        feedType === 'breast' && method === 'both' && tm.startSide && !savedTags.includes(tm.startSide)
          ? [...savedTags, tm.startSide]
          : savedTags;
      entry = { ...base, tags, type: 'feeding', start: tm.start, end: now, feedType, method, amount: tm.amount ?? null };
    } else if (saveAs === 'pumping') {
      entry = { ...base, type: 'pumping', start: tm.start, end: now, amount: tm.amount ?? 90, method: tm.method };
    } else if (saveAs === 'tummy') {
      entry = { ...base, type: 'tummy', start: tm.start, end: now, milestone: tm.milestone };
    } else {
      const hr = new Date().getHours();
      entry = { ...base, type: 'sleep', start: tm.start, end: now, nap: tm.nap ?? (hr >= 7 && hr < 19) };
    }
    set({ timers: s.timers.filter((t) => t.id !== id), entries: [entry, ...s.entries] });
    get().commitWrite(entry);
    const queued = s.offline && !!s.connection && !s.connection.demo;
    get().showToast(queued ? 'Saved · queued offline' : `Saved as ${ACTIVITY_LABEL[saveAs].toLowerCase()}`);
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

  showToast: (msg) => {
    set({ toast: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 2400);
  },
}));

// Persist running timers to on-device storage whenever they change, so they
// survive the app being closed and reopened. Every timer mutation replaces the
// `timers` array (`set({ timers: ... })`); the per-second `now` tick and other
// updates keep the same reference, so this writes only on an actual change.
useAppStore.subscribe((state, prev) => {
  if (state.timers !== prev.timers) void saveTimers(state.timers);
});
