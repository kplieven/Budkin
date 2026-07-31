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
  feedAmountIsVolume,
} from '@/lib/activities';
import {
  type Connection,
  deleteChildFromServer,
  deleteTreatmentFromServer,
  deleteEntryFromServer,
  deleteMeasurementFromServer,
  deleteTimerFromServer,
  loadFromServer,
  loadInsightsHistory,
  loadProfileFromServer,
  loadTagsFromServer,
  pushChildToServer,
  pushTreatmentToServer,
  setChildGenderOnServer,
  pushEntryToServer,
  pushMeasurementToServer,
  pushTimerToServer,
  serverHasData,
  updateChildOnServer,
  updateTreatmentOnServer,
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
import { loadTreatments, saveTreatments } from '@/data/treatments';
import { loadMilestonePrompts, saveMilestonePrompts } from '@/data/milestonePrompts';
import {
  addPendingOp,
  clearPendingOps,
  loadPendingOps,
  removePendingOp,
  savePendingOps,
} from '@/data/pendingOps';
import { loadPrefs, savePrefs } from '@/data/prefs';
import { clearQueue, enqueueEntry, loadQueue, removeQueuedEntry, updateQueuedEntry } from '@/data/queue';
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
import { MILESTONE_BY_KEY } from '@/lib/milestones';
import { snapVolume, stepVolume, type UnitSystem } from '@/lib/units';
import {
  activeTreatmentsForChildToday,
  clampHourOfDay,
  clampMinuteOfDay,
  clampSmallWashesPerBig,
  entriesForChild,
  isNapStart,
  NAP_WINDOW_END_DEFAULT,
  NAP_WINDOW_START_DEFAULT,
  nextStartSide,
  nextWashKind,
  overruleLasted,
  reorder,
  RHYTHM_ORIGIN_DEFAULT,
  SMALL_WASHES_PER_BIG_DEFAULT,
  startOfDay,
  teEnd,
  teStart,
} from '@/store/selectors';
import type { ThemeMode } from '@/theme/tokens';
import type {
  ActivityType,
  Child,
  ChildGender,
  Treatment,
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
  /**
   * The LOCAL ids of the entries currently sitting on the offline write queue
   * (`budkin.queue.v1`), so History can mark a row as still waiting to upload.
   * The queue itself is the only truthful source for that: `flushQueue` pushes
   * an entry without stamping its `serverId` back onto the in-memory record, so
   * `serverId == null` stays true long after an entry has gone up.
   *
   * A mirror of `queueCount`'s population, kept in sync at exactly the same
   * sites, and it inherits the same known drift: the Android nap widget
   * enqueues from a headless task in another process and never touches the
   * store (see `src/widgets/napToggle.ts`), so both go stale until the next
   * hydrate. Never derived inside a `useAppStore` selector, see
   * `src/features/activity/queuedMarker.ts`.
   */
  queuedIds: string[];
  /** servers the user has connected to before (one-tap retry list) */
  savedServers: SavedServer[];

  // ui / theme
  themeMode: ThemeMode;
  /** Budkin-local metric/imperial display lens (default 'metric'). Stored
   *  values stay canonical metric; this only relabels + converts on display. */
  unitSystem: UnitSystem;
  /** true once first-run setup has been completed. */
  tutorialSeen: boolean;
  /** Scheduled reminder toggles. See src/notifications/scheduled.ts. */
  dueDateReminders: boolean;
  staleTimerReminders: boolean;
  ageMilestones: boolean;
  pumpingReminders: boolean;
  pumpingIntervalMin: number;
  /** when the pumping toggle was last switched on, epoch ms */
  pumpingEnabledAt: number | null;
  napSuggestions: boolean;
  treatmentReminders: boolean;
  /** when the treatments toggle was last switched on, epoch ms */
  treatmentRemindersEnabledAt: number | null;
  /** Milestone catch-up nudges (default off). See src/data/prefs.ts. */
  milestoneCatchUp: boolean;
  /** Growth charts: whether the WHO percentile reference is drawn (default true). */
  showGrowthReference: boolean;
  /** Bath rhythm: how many SMALL washes fall between two big ones (default 3,
   *  range 1..30). Global rather than per-child, like every other pref. Local
   *  only: it drives the wash pre-selection, never anything sent to the server. */
  smallWashesPerBig: number;
  /** Sleep rhythm: the window in which a sleep counts as a NAP, as minutes
   *  since local midnight (default 420/1140 = 07:00 to 19:00). Start inclusive,
   *  end exclusive; a start later than the end wraps midnight. Global, like
   *  every other pref. It only seeds NEW entries: `SleepEntry.nap` is a stored
   *  boolean, so changing the window never re-classifies history. */
  napWindowStartMin: number;
  napWindowEndMin: number;
  /** Insights "Rhythm" graph day boundary: the hour (0..23) the 24h window
   *  starts at (default 12 = noon-to-noon). Drives both the heatmap and the
   *  per-window trend bucketing on the tab, so the graph and the numbers agree.
   *  Global, persisted, like every other pref. */
  rhythmOriginHour: number;
  /** Insights "Rhythm" graph layer toggles: which series the heatmap draws.
   *  Persisted so a hidden layer stays hidden across restarts. Global, all
   *  default to visible. */
  rhythmShowSleep: boolean;
  rhythmShowFeeds: boolean;
  rhythmShowDiapers: boolean;
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
  /** id of the expected child whose birth is being confirmed, or null */
  confirmBirthFor: string | null;
  /** true while the "Connect Baby Buddy" adopt sheet is open (Settings, local mode) */
  adoptSheet: boolean;
  sheet: { type: ActivityType; confirm?: boolean } | null;
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
  /** true while the treatment-picker sheet is open (tapping the Medication tile when
   *  the selected child has active treatments today; picks a treatment to pre-fill a dose). */
  treatmentPicker: { open: boolean } | null;
  /** Treatment create/edit sheet: `editingId` null = creating a new treatment, otherwise
   *  the id of the treatment being edited. null (the field itself) = closed. */
  treatmentEditor: { editingId: string | null } | null;

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
  /** Per-child medication regimens ("treatments"). Synced to Baby Buddy as
   *  `treatment`-tagged notes. Persisted via src/data/treatments, which is the local-mode
   *  store and the offline cache when connected; survives disconnect (user
   *  data, not the synced entity store). */
  treatments: Treatment[];
  lastFeed: { feedType: FeedType; method: FeedMethod };
  insightsEntries: Entry[];
  insightsLoaded: boolean;
  insightsLoading: boolean;
  insightsError: boolean;
  loadInsights: () => Promise<void>;
  /** Force a re-fetch of the insights history, keeping current charts on screen
   *  during the load (pull-to-refresh). Unlike loadInsights it ignores the
   *  loaded guard, and on failure it neither clears data nor sets an error. */
  reloadInsights: () => Promise<void>;

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
  /** Mark first-run setup as complete (persisted). */
  completeTutorial: () => void;
  setUnitSystem: (system: UnitSystem) => void;
  toggleUnitSystem: () => void;
  setReminderPref: (
    key:
      | 'dueDateReminders'
      | 'staleTimerReminders'
      | 'ageMilestones'
      | 'pumpingReminders'
      | 'napSuggestions'
      | 'treatmentReminders'
      | 'milestoneCatchUp',
    value: boolean,
  ) => void;
  setPumpingInterval: (minutes: number) => void;
  setSmallWashesPerBig: (n: number) => void;
  setNapWindow: (startMin: number, endMin: number) => void;
  setRhythmOriginHour: (hour: number) => void;
  /** Toggle one Insights "Rhythm" graph layer on/off and persist the choice. */
  setRhythmLayer: (layer: 'sleep' | 'feeds' | 'diapers', on: boolean) => void;
  /** Toggle the WHO growth-reference overlay on the metric charts, and persist it. */
  setGrowthReference: (on: boolean) => void;
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
  openConfirmBirth: (id: string) => void;
  closeConfirmBirth: () => void;
  saveChild: (fields: {
    first: string;
    last: string;
    birth: number;
    expected?: boolean;
    photo?: PhotoChange;
    /** the child's gender, or undefined for "not recorded". Synced as a
     *  `gender`-tagged note, since Baby Buddy's Child has no such field.
     *
     *  AUTHORITATIVE on edit, exactly like `first`/`last`/`birth`: passing
     *  undefined CLEARS a recorded gender (which is how the picker's "Not set"
     *  works), so an edit caller must always pass the current value. Only the
     *  create-path callers may omit it. */
    gender?: ChildGender;
  }) => void;
  /** Turn an expected child into a born one: clear the flag, set the real birth
   *  date, and release it for sync. The single implementation of that
   *  transition, shared by Home's confirm sheet and the child sheet's toggle. */
  confirmBirth: (id: string, birth: number) => void;
  /** Delete a child (cascades all their history server-side; NOT undoable). See
   *  the implementation for the selection re-point + in-memory purge rules.
   *  Async because the server DELETE is awaited: it has no replay path, so a
   *  failure has to restore the child rather than being swallowed. Callers may
   *  fire and forget. */
  deleteChild: (id: string) => Promise<void>;

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

  // treatments (medication regimens; synced as `treatment`-tagged notes)
  /** Add a fully-formed treatment (the editor stamps id + childId). */
  addTreatment: (treatment: Treatment) => void;
  /** Replace a treatment by id with an updated copy. */
  updateTreatment: (treatment: Treatment) => void;
  /** Remove a treatment by id. */
  deleteTreatment: (id: string) => void;
  /** Open the treatment create/edit sheet: no id = create, an id = edit that treatment. */
  openTreatmentEditor: (id?: string) => void;
  closeTreatmentEditor: () => void;
  openTreatmentPicker: () => void;
  closeTreatmentPicker: () => void;
  /** Medication tile tap: open the treatment picker when the selected child has an
   *  active treatment covering today, otherwise open the plain manual log form. */
  openMedicationLog: () => void;
  /** Tapping a saved treatment: seed the medication draft from it (name/dosage/unit,
   *  plus the next-dose interval for an interval treatment) and open the medication
   *  sheet in confirm mode (a read-only summary + the time picker), closing the
   *  picker. No dose is written here; save() commits it once the user confirms. */
  logMedicationFromTreatment: (treatmentId: string) => void;
  /** Reveal the full editable medication form from the confirm modal: drop the
   *  `confirm` flag on the medication sheet, keeping the seeded draft. */
  expandMedicationLog: () => void;
  setTE: (patch: Partial<TimeEntryState>) => void;
  /** One press of the amount stepper: +1 or -1 step in the user's display
   *  units (10 ml metric, 0.5 fl oz imperial). Stores canonical ml. */
  adjustAmount: (dir: 1 | -1) => void;
  toggleWet: () => void;
  toggleSolid: () => void;
  /** bath: pick the wash size (small/big) */
  setWash: (wash: 'small' | 'big') => void;
  setNap: (nap: boolean) => void;
  toggleTag: (tag: string) => void;
  /** Add a brand-new free-form tag as selected. Trims, rejects blank / structural
   *  (HIDDEN_TAGS) names, and no-ops on a tag already selected. */
  createTag: (name: string) => void;
  setEnded: (agoMin: number) => void;
  /** Pin the end to an absolute ms. An `anchor` marks which "Ended" chip drove it
   * (for highlighting); omitting it (a manual/precise edit) clears that mark. */
  setEndedAbs: (ms: number, anchor?: TimeEntryState['endAnchor']) => void;
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
  /** Stop a running timer at now and log it. */
  stopTimer: (id: string) => void;
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
 * from `refresh()`/`hydrate()` replacing `entries` wholesale with the next
 * `...data` load once the server has the entry, which drops the local copy.
 * This helper's only job is the initial "keep it visible" prepend. An entry
 * whose owning child is expecting can never flush this way (the server never
 * has that child to attach it to); see `mergeHeldBackEntries` below for that
 * case instead.
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
 * for the entry-specific (queue-based) equivalent, and `mergeHeldBackEntries`
 * below for the narrower expecting-child subset that can never flush at all.
 */
export function mergeUnsynced<T extends { id: string; serverId?: number }>(
  serverList: T[],
  localList: T[],
): T[] {
  const serverIds = new Set(serverList.map((r) => r.id));
  const unsynced = localList.filter((r) => r.serverId == null && !serverIds.has(r.id));
  return [...unsynced, ...serverList];
}

/**
 * Merge server-loaded treatments with the on-device copy. The local list is BOTH the
 * offline cache and the only home of treatments created offline (serverId == null),
 * so a wholesale refresh must not replace it outright, and incoming treatments carry
 * the server's child id until `remapChildIds` rewrites it. Same shape as the
 * measurement merge one line up, kept as a named helper because all three load
 * paths (hydrate / refresh / adopt) need the identical pair of steps.
 */
export function mergeTreatments(serverTreatments: Treatment[], localTreatments: Treatment[], children: Child[]): Treatment[] {
  return mergeUnsynced(remapChildIds(serverTreatments, children), localTreatments);
}

/**
 * True when `entry` is a WITHHELD record (see `mergeHeldBackEntries` below):
 * written against a child that had no `serverId` at write time, so it was
 * never offered to the server and never queued for the ordinary retry path.
 * This reads the `heldBack` flag stamped once, at write time, by
 * `commitWrite`. See that field's doc comment on `EntryBase`
 * (`types/models.ts`) for the full contract.
 *
 * Deliberately NOT inferred here from `expected`, `birth`, or a timestamp.
 * Four earlier attempts at exactly that each picked a proxy that quietly
 * expired at a different transition (a push landing, a birth being
 * confirmed, a due date passing) and silently dropped real records. Reading
 * a stored fact has no such expiry, and that is the entire point of the flag.
 *
 * `entry.serverId == null` is checked too, purely as belt-and-suspenders:
 * once a withheld entry is actually pushed, `commitWrite`/`flushUnsynced`
 * clear `heldBack` in the same update that stamps `serverId`, so the two
 * should never disagree, but this guarantees an already-synced entry can
 * never be re-treated as withheld even if that ever drifted.
 */
function isHeldBackEntry(entry: Entry): boolean {
  return entry.heldBack === true && entry.serverId == null;
}

/**
 * Merge back held-back entries (see `isHeldBackEntry`) into a freshly-loaded
 * entries list, so a wholesale refresh/hydrate/adopt reload doesn't drop
 * them. This is the entries analogue of `mergeUnsynced` for the one record
 * shape that helper deliberately excludes: an expecting child is never pushed
 * to the server (its `birth` is a due date, not a valid birth_date; see
 * `uploadUnsynced`), so NONE of its entries can ever be on the server either.
 * Unlike an ordinary offline-queued entry, which eventually flushes and must
 * stop being merged once it does (that's `mergeQueuedEntries`'s job, not this
 * one), a held-back entry has no such expiry: it stays local for as long as
 * it stays unsynced.
 *
 * De-duplication is by id against the list already assembled (typically
 * server data, possibly already merged with the write queue): this also
 * covers the edge case where a still-expecting child's entry was logged after
 * `adopt()`, failed to push (the server has no such child), and landed in the
 * write queue too: it would already be present via that queue merge, so it's
 * skipped here rather than duplicated.
 *
 * `children` is used only as a referential-integrity guard: a held-back
 * entry is re-merged only when its owning child is still present in the
 * given list, so a child that was actually deleted can't resurrect its
 * entries. It is NOT used to decide held-back-ness itself (see
 * `isHeldBackEntry`); pass the list AFTER any child merge (`mergeUnsynced`)
 * has already run, so an expecting (or just-born) child that only survives
 * via that merge still counts as present here. Held-back entries are
 * prepended like the other merge helpers (newest-first, matching `save()`).
 */
export function mergeHeldBackEntries(entries: Entry[], localEntries: Entry[], children: Child[]): Entry[] {
  const existingIds = new Set(entries.map((e) => e.id));
  const ownerIds = new Set(children.map((c) => c.id));
  const heldBack = localEntries.filter(
    (e) => !existingIds.has(e.id) && isHeldBackEntry(e) && ownerIds.has(e.childId),
  );
  return [...heldBack, ...entries];
}

/**
 * MIGRATION: backfill `heldBack` on entries persisted by a version of the app
 * that predates the flag (see `EntryBase.heldBack` in `types/models.ts`).
 * Called on every load of the entity store (`loadEntities()`), immediately
 * before those entries are used for anything. Idempotent, since it only
 * touches entries where the flag is `undefined` and never overwrites `true`
 * or `false`, so re-running it on every app launch is harmless.
 *
 * The criterion, the owning child is CURRENTLY `expected`, is a precise
 * fact, not another decaying proxy: an entry can only ever be an ordinary
 * QUEUED write (the population this must NOT catch) if its owner was NOT
 * `expected` at write time, because `commitWrite` has never queued an
 * expecting child's entries, in any version of this feature. Checking a
 * child's live `expected` field has no false positives.
 *
 * It has one narrow, theoretical gap: a legacy entry whose owner WAS
 * expecting when the entry was written but has SINCE been confirmed born (by
 * the time the user upgrades to a version with this fix) would read
 * `expected: false` here and be missed. In practice that gap is EMPTY, not a
 * live risk: `Child.expected` has never shipped to a release (this feature
 * lands on this branch, unmerged), so no entry persisted by any real install
 * can have an expecting owner yet for this migration to need to recover.
 * This backfill is defensible insurance against that gap opening up later
 * (e.g. if `heldBack` itself ever shipped a release behind `expected`), not a
 * patch for a loss that has already happened. Closing even the theoretical
 * gap would mean falling back to the very timestamp/`expected` inference this
 * fix exists to remove, so it stays accepted rather than chased. Every entry
 * written from this version onward is flagged correctly and permanently at
 * write time (`commitWrite`).
 */
function backfillHeldBack(entries: Entry[], children: Child[]): Entry[] {
  const expectingIds = new Set(children.filter((c) => c.expected).map((c) => c.id));
  return entries.map((e) =>
    e.heldBack === undefined && e.serverId == null && expectingIds.has(e.childId) ? { ...e, heldBack: true } : e,
  );
}

/** Reconcile a server child list onto the local one WITHOUT changing any local
 *  `id`. A child that exists on both sides is matched by `serverId` and the
 *  server's field values win, but the local `id` is preserved, because entries
 *  and measurements reference it and rewriting it would orphan them. That
 *  orphaning is the bug this whole design exists to prevent.
 *
 *  Local children with no `serverId` were never pushed (an offline creation, or
 *  a child deliberately held back) and are kept, prepended, which is where
 *  `mergeUnsynced` put them. Server children the app has not seen are added
 *  with their server-derived id: they never had a local phase, so that id is
 *  already stable. A local child whose `serverId` is absent from the server list
 *  was deleted server-side and is dropped, matching today's behaviour. A
 *  never-pushed local whose `id` collides with a reconciled child's id is
 *  dropped too, so the result can never contain duplicate ids, matching what
 *  `mergeUnsynced` guaranteed. */
export function reconcileChildren(serverChildren: Child[], localChildren: Child[]): Child[] {
  const localByServerId = new Map<number, Child>();
  for (const c of localChildren) {
    if (c.serverId != null) localByServerId.set(c.serverId, c);
  }
  const reconciled = serverChildren.map((sc) => {
    const local = sc.serverId != null ? localByServerId.get(sc.serverId) : undefined;
    return local ? { ...sc, id: local.id } : sc;
  });
  const reconciledIds = new Set(reconciled.map((c) => c.id));
  const neverPushed = localChildren.filter((c) => c.serverId == null && !reconciledIds.has(c.id));
  return [...neverPushed, ...reconciled];
}

/** Translate incoming server-loaded records' `childId` from the server's child
 *  id (what `loadFromServer` writes verbatim, since it has no local state to
 *  consult) to the LOCAL id of the child that owns it, matched by `serverId`
 *  against the just-reconciled child list. Must run AFTER `reconcileChildren`,
 *  using its output: that is the only place the authoritative local id for a
 *  previously-local, since-synced child is known. A record whose child can't
 *  be resolved (e.g. deleted server-side mid-request) keeps its existing
 *  `childId` rather than being dropped or reassigned to the wrong owner.
 *  `childId` is typed optional here (not just `string`) so this same helper
 *  covers `Timer`, whose `childId` can be genuinely absent (defaults to the
 *  selected child); entries and measurements always carry one. */
export function remapChildIds<T extends { childId?: string }>(records: T[], children: Child[]): T[] {
  const localIdByServerId = new Map<string, string>();
  for (const c of children) {
    if (c.serverId != null) localIdByServerId.set(String(c.serverId), c.id);
  }
  return records.map((r) => {
    if (r.childId == null) return r;
    const localId = localIdByServerId.get(r.childId);
    return localId ? { ...r, childId: localId } : r;
  });
}

/** The server id of the child a record belongs to, or null when that child has
 *  never been pushed. A record whose child has no server id MUST NOT be sent:
 *  the server would reject it and the retry queue would replay it verbatim
 *  forever. Callers enqueue instead and let the reconnect flush handle it once
 *  the child exists server-side. */
function childServerIdFor(children: Child[], childId: string): number | null {
  return children.find((c) => c.id === childId)?.serverId ?? null;
}

// 90-day insights history for a child: local seed rows in demo mode, the server
// history otherwise (empty for a child that has never been pushed). Shared by
// loadInsights (first fill) and reloadInsights (manual refresh). Callers guard
// `connection` and `selectedChildId` before calling.
async function fetchInsightsEntries(s: AppState, childId: string): Promise<Entry[]> {
  const conn = s.connection!;
  if (conn.mode === 'local') return s.entries.filter((e) => e.childId === childId);
  const childServerId = childServerIdFor(s.children, childId);
  return childServerId == null
    ? []
    : loadInsightsHistory(conn, String(childServerId), s.now - 90 * 86400000);
}

/** Resolve `loadFromServer`'s `selectedChildId` (see repository.ts) into the
 *  RECONCILED (local id) space. That value is `String(children[0]?.serverId)`,
 *  i.e. a SERVER-space id; it is only ever used as a fallback once a caller's
 *  own preferred selection is no longer valid, so it must be translated the
 *  same way `remapChildIds` translates an incoming `childId`, by matching
 *  `serverId` against the just-reconciled child list, not compared to local
 *  ids directly. Falls back to the reconciled list's first child (covers a
 *  locally-created, not-yet-synced child, whose `serverId` is absent), then to
 *  `''` when there is no child at all. */
function resolveSelectedChildId(reconciledChildren: Child[], serverSelectedChildId: string): string {
  return (
    reconciledChildren.find((c) => String(c.serverId) === serverSelectedChildId)?.id ??
    reconciledChildren[0]?.id ??
    ''
  );
}

/** Build uploadUnsynced's push-fn deps bound to a server connection. Shared by
 *  `adopt` and `flushUnsynced` — the only two callers that push local-only
 *  (serverId == null) records up to the server. */
function buildUploadDeps(conn: Connection): UploadDeps {
  return {
    pushChild: (c) => pushChildToServer(conn, c).then((r) => r?.id),
    pushEntry: (e, childServerId) => pushEntryToServer(conn, e, childServerId),
    pushMeasurement: (m, childServerId) => pushMeasurementToServer(conn, m, childServerId),
    pushTreatment: (c, childServerId) => pushTreatmentToServer(conn, c, childServerId),
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
  // A genuine new create: give the retry chain a fresh budget, so a timer
  // started an hour after some earlier failure isn't stuck with a spent one.
  timerRetryAttempt = 0;
  const child = s.children.find((c) => c.id === (timer.childId ?? s.selectedChildId));
  // Child not on the server yet. `flushUnsynced` pushes the child first and the
  // timer straight after (it re-reads state between the two for exactly this
  // reason), so schedule it instead of leaving the timer for whenever a refresh
  // or a reconnect next happens.
  if (!child || child.serverId == null) {
    scheduleUnsyncedTimerFlush(get);
    return;
  }
  void pushTimerToServer(conn, timer, child.serverId)
    .then((serverId) => {
      // A response with no id is a create that did not land: retry it rather
      // than leaving the timer silently unsynced.
      if (serverId == null) {
        scheduleUnsyncedTimerFlush(get);
        return;
      }
      if (get().timers.some((t) => t.id === timerId)) {
        set((st) => ({ timers: st.timers.map((t) => (t.id === timerId ? { ...t, serverId } : t)) }));
      } else {
        // Stopped/discarded during the POST: clean up the orphan.
        void deleteTimerFromServer(conn, serverId).catch(() => {});
      }
    })
    .catch((e) => {
      // Was a bare swallow, which left no trace of why a timer never synced.
      console.warn('[timers] create failed, retrying:', e);
      scheduleUnsyncedTimerFlush(get);
    });
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

/**
 * Where a "still ongoing" interval actually started.
 *
 * When the draft is an EDIT of an already-logged entry, that entry's own
 * `start` is the only exact answer. `openEdit` pins the end plus a duration
 * ROUNDED to whole minutes and leaves the start derived (`end − lasted`), so
 * the resolved start drifts the moment the user nudges either of those, and the
 * rounding alone can move it by half a minute. Only prefer the draft's own
 * start once the user has actually set it (`startEdited`).
 *
 * Either way a start later than `now` is clamped to `now`, matching
 * `adjustTimerStart`/`setTimerStart`: nothing can have started in the future. A
 * start in the past is kept however old it is.
 */
function ongoingStartMs(
  te: TimeEntryState,
  entries: Entry[],
  editingId: string | null,
  now: number,
): number {
  if (!te.startEdited && editingId) {
    const src = entries.find((e) => e.id === editingId);
    if (src && 'start' in src) return Math.min(src.start, now);
  }
  return Math.min(teStart(te, now) ?? now, now);
}

/**
 * Build a running Timer from the log sheet's draft.
 *
 * Shared by the two paths that turn a live interval into a timer: starting one
 * from a fresh draft, and converting an already-logged entry back into one
 * ("Still ongoing" while editing). Both used to create the timer bare, which
 * silently dropped a note or an amount the user had just typed, so everything
 * the draft carries rides along. The per-activity split mirrors
 * `saveTimerDetails`, so a timer never carries another activity's metadata.
 *
 * `notes` and `tags` stay device-local: `encodeTimerName` deliberately keeps
 * them out of the server timer's name (that grammar is a cross-device wire
 * format, see serverTimers.ts), so another device picking this timer up sees
 * the structural fields only.
 */
function buildTimerFromDraft(
  id: string,
  type: ActivityType,
  te: TimeEntryState,
  start: number,
  childId: string,
): Timer {
  const timer: Timer = {
    id,
    activity: type,
    name: ACTIVITY_LABEL[type],
    start,
    saveAs: type,
    childId,
    notes: te.notes?.trim() || undefined,
    tags: te.tags,
  };
  if (type === 'feeding') {
    timer.feedType = te.feedType;
    timer.method = te.method;
    timer.startSide = te.startSide;
    timer.amount = te.amount;
  } else if (type === 'pumping') {
    timer.method = te.method;
    timer.amount = te.amount;
  } else if (type === 'sleep') {
    timer.nap = te.nap;
  } else if (type === 'tummy') {
    timer.milestone = te.milestone;
  }
  return timer;
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

/**
 * Does this draft's `amount` hold a VOLUME the stepper edits?
 *
 * Pumping is always millilitres. A feeding's `amount` is dual-purpose, so it
 * defers to the one predicate the log sheet and the history line already share:
 * a breast feed records a dimensionless intake level, which must never be
 * treated as a measurement. No other activity shows the stepper (a diaper's
 * solid amount is its own scale), so nothing else qualifies.
 */
function draftAmountIsVolume(type: ActivityType, te: TimeEntryState): boolean {
  if (type === 'pumping') return true;
  if (type === 'feeding') return feedAmountIsVolume(te.feedType, te.method);
  return false;
}

/**
 * Snap a draft's volume amount onto the active unit system's step grid.
 *
 * The stepper shows imperial to one decimal, so a stored value that sits just
 * off a grid point renders identically to the grid point below it: 90 ml shows
 * as "3.0" fl oz, and the minus press that moves it to exactly 3.0 also shows
 * "3.0". The press looks dead. Aligning the draft the moment a sheet opens (and
 * again if the unit system flips while it is open) makes the shown number and
 * the stored number agree, so every press moves the display.
 *
 * Only the in-memory draft is touched. Persisted entries keep their canonical
 * millilitres until the user actually saves an edit.
 */
function snapDraftAmount(type: ActivityType, te: TimeEntryState, system: UnitSystem): TimeEntryState {
  if (te.amount == null || !draftAmountIsVolume(type, te)) return te;
  return { ...te, amount: snapVolume(te.amount, system) };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
// The most recently removed entry, held so an "Undo" toast can restore it.
// `didServerDelete` records whether the delete actually reached the server, so
// undo only re-creates it server-side when a server record was really removed.
// `timerId` is set when the entry was REPLACED by a running timer ("Still
// ongoing" on a logged entry): undo must discard that timer in the same step,
// so the user can never end up holding both. `requeue` records that the entry
// came off the offline write queue and has to go back on it.
let lastDeleted: {
  entry: Entry;
  index: number;
  didServerDelete: boolean;
  timerId?: string;
  requeue: boolean;
} | null = null;

/**
 * The two pieces of state that mirror the offline write queue, derived together
 * from the queue itself so no site can update the count and forget the ids (or
 * the reverse), which would put a "waiting to upload" marker on History and the
 * banner's number in direct contradiction.
 */
function queueMirror(q: Entry[]): { queueCount: number; queuedIds: string[] } {
  return { queueCount: q.length, queuedIds: q.map((e) => e.id) };
}

/**
 * Take an entry out of circulation everywhere it might still exist, and record
 * what Undo needs to put it back. Shared by `deleteEntry` and by `save()`'s
 * convert-to-timer path, which removes the entry for the same reason: it is not
 * an entry any more.
 *
 * The write-queue scrub is the non-obvious half. An entry created offline sits
 * on `budkin.queue.v1` until a reconnect, and `flushQueue` pushes whatever it
 * finds there without consulting `entries`, so without this the deleted entry
 * would be POSTed on reconnect anyway, resurrecting it (and, on the convert
 * path, duplicating the timer that replaced it).
 *
 * Caller removes the entry from `entries`; this only handles what lives outside
 * the store.
 */
function detachEntry(get: Get, set: Set, entry: Entry, index: number, timerId?: string): void {
  const s = get();
  const conn = s.connection;
  const didServerDelete = entry.serverId != null && !!conn && conn.mode === 'server' && !s.offline;
  const record = { entry, index, didServerDelete, timerId, requeue: false };
  lastDeleted = record;
  if (didServerDelete) {
    void deleteEntryFromServer(conn, entry.type, entry.serverId as number).catch(() => {});
  } else if (entry.serverId != null && !!conn && conn.mode === 'server' && s.offline) {
    // Already on the server, removed while offline: record the delete so it
    // replays on reconnect instead of the record resurrecting on the next refresh().
    void addPendingOp({ op: 'delete', entity: 'entry', entryType: entry.type, serverId: entry.serverId });
  }
  void removeQueuedEntry(entry.id).then(({ removed, queue }) => {
    if (!removed) return;
    set(queueMirror(queue));
    record.requeue = true;
  });
}

/**
 * Retry schedule for a timer create that didn't land.
 *
 * A create has no queue of its own, and deliberately so: `PendingOp` has no
 * `create` variant, because an unsynced record is already durable on its own
 * (`serverId == null` in the persisted timers list) and `flushUnsynced` is the
 * idempotent reconciler for exactly that state. What was missing is anything to
 * RUN that reconciler. It only fires from hydrate, refresh, and the
 * offline/network transitions, so two cases sat unsynced until the user
 * happened to pull to refresh: a create the server rejected, and one started
 * against a child that had not reached the server yet. Every other write
 * already had a fallback (entries queue via `enqueueEntry`, timer edit/delete
 * via `addPendingOp`); create was the one that dropped the failure on the floor.
 *
 * Bounded on purpose. After the last delay the ordinary paths take over
 * (foreground refresh, reconnect), so a server that stays broken cannot keep a
 * retry chain spinning for the life of the process. The budget is refreshed by
 * the next create, since a fresh user action deserves a fresh set of attempts.
 */
const TIMER_RETRY_DELAYS_MS = [2000, 8000, 30000];
let timerRetryAttempt = 0;
let timerRetryHandle: ReturnType<typeof setTimeout> | undefined;

function scheduleUnsyncedTimerFlush(get: Get): void {
  if (timerRetryHandle || timerRetryAttempt >= TIMER_RETRY_DELAYS_MS.length) return;
  const delay = TIMER_RETRY_DELAYS_MS[timerRetryAttempt];
  timerRetryAttempt += 1;
  timerRetryHandle = setTimeout(() => {
    timerRetryHandle = undefined;
    const s = get();
    // Offline or no longer on a server: `setNetworkOnline`/`setOffline` already
    // flush on the way back up, so stand down rather than spend attempts here.
    if (!s.connection || s.connection.mode !== 'server' || s.offline) {
      timerRetryAttempt = 0;
      return;
    }
    if (!s.timers.some((t) => t.serverId == null)) {
      timerRetryAttempt = 0;
      return;
    }
    // `catch` before `finally`: flushUnsynced does not catch its own uploader,
    // so a bare `.finally()` here would leave the rejection unhandled.
    void s
      .flushUnsynced()
      .catch(() => {})
      .finally(() => {
        // Still unsynced (server still refusing, child still not pushed): keep
        // the chain going until the attempt budget runs out.
        if (get().timers.some((t) => t.serverId == null)) scheduleUnsyncedTimerFlush(get);
        else timerRetryAttempt = 0;
      });
  }, delay);
}

/** Drop any scheduled timer retry. Tests only: the handle is module state, so
 *  without this a chain armed by one test fires during a later one. */
export function resetTimerRetryForTests(): void {
  if (timerRetryHandle) clearTimeout(timerRetryHandle);
  timerRetryHandle = undefined;
  timerRetryAttempt = 0;
}

// Guards against overlapping refreshes (e.g. a foreground event landing while a
// pull-to-refresh is still in flight).
let refreshInFlight = false;
// Guards against overlapping flushUnsynced calls (e.g. setNetworkOnline(true)
// and a foreground refresh() both firing at once) — see `flushUnsynced` below.
let flushUnsyncedInFlight = false;
// Guards against overlapping flushQueue calls, which would both read the same
// stored queue before either saves and POST every entry on it twice. `refresh()`
// fires a flush of its own on success and does not await it, so a caller that
// awaits `flushQueue()` right after awaiting `refresh()` (the offline queue
// screen's Retry button, which has to count the queue once the upload is done)
// lands a second flush straight on top of the first.
//
// Holds the PROMISE rather than a boolean like the flag above: a second caller
// has to be able to await the flush already running. A bare early return would
// hand it back a queue that has not finished draining, and the screen would
// report a successful sync as "Nothing uploaded".
//
// The trap that comes with joining: a caller handed this promise inherits the
// RUNNING flush's view of the world, not its own. `const s = get()` and
// `loadQueue()` both happen once, inside the run, so an entry enqueued after
// those lines is not in the batch being uploaded, and the joiner still gets a
// resolved promise for a flush that never saw its entry. Nothing does that
// today (the write paths fire their flush and forget, and the queue screen
// enqueues nothing), so this is documentation rather than a live bug. An
// enqueue-then-await-flush caller would be the first one it bites, and it would
// need a fresh flush after this one rather than a seat on it.
let flushQueueInFlight: Promise<void> | null = null;
// Guards against overlapping flushPendingOps calls, the op-log twin of
// `flushQueueInFlight` above. Foregrounding fires the AppState `refresh()`
// (whose success schedules a flush of its own) and the network-state effect
// (`setNetworkOnline`, a second one) within milliseconds of each other, so two
// concurrent runs are the ordinary case: both would read the same stored op
// log before either removes anything and replay every op twice, and the loser
// of a replayed delete then sees a 404 for a record the winner already
// removed.
//
// Holds the PROMISE rather than a boolean for the same reason flushQueue's
// guard does: a second caller has to be able to await the flush already
// running rather than being handed an early return while the log still
// drains. The same joiner trap applies too: a joiner inherits the RUNNING
// flush's view of the log (`loadPendingOps` happens once, inside the run), so
// an op recorded after that read is not in the batch being replayed, and the
// joiner still resolves. No caller records-then-awaits today; one that did
// would need a fresh flush after this one, not a seat on it.
let flushPendingOpsInFlight: Promise<void> | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
  // ---- initial state ----
  connection: null,
  connected: false,
  connecting: false,
  connectError: null,
  hydrating: true,
  queueCount: 0,
  queuedIds: [],
  savedServers: [],

  themeMode: 'dark',
  unitSystem: 'metric',
  showGrowthReference: true,
  tutorialSeen: false,
  dueDateReminders: true,
  staleTimerReminders: true,
  ageMilestones: true,
  pumpingReminders: false,
  pumpingIntervalMin: 180,
  pumpingEnabledAt: null,
  napSuggestions: false,
  treatmentReminders: true,
  treatmentRemindersEnabledAt: null,
  milestoneCatchUp: false,
  smallWashesPerBig: SMALL_WASHES_PER_BIG_DEFAULT,
  napWindowStartMin: NAP_WINDOW_START_DEFAULT,
  napWindowEndMin: NAP_WINDOW_END_DEFAULT,
  rhythmOriginHour: RHYTHM_ORIGIN_DEFAULT,
  rhythmShowSleep: true,
  rhythmShowFeeds: true,
  rhythmShowDiapers: true,
  offline: false,
  networkOnline: true,
  simulateOffline: false,
  now: Date.now(),
  toast: null,
  toastAction: null,
  showChildSwitcher: false,
  childSheet: false,
  editingChildId: null,
  confirmBirthFor: null,
  adoptSheet: false,
  sheet: null,
  editingId: null,
  fromTimerId: null,
  measurementSheet: null,
  editingMeasurementId: null,
  milestoneSheet: null,
  treatmentPicker: null,
  treatmentEditor: null,
  answeredMilestonePrompts: {},

  selectedChildId: '',
  children: [],
  entries: [],
  timers: [],
  measurements: [],
  treatments: [],
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
  completeTutorial: () => {
    set({ tutorialSeen: true });
    void savePrefs({ tutorialSeen: true });
  },
  setUnitSystem: (system) => {
    // Flipping the lens under an open log sheet re-aligns its draft amount onto
    // the new system's grid, so the stepper keeps showing exactly what it holds.
    set((s) => ({
      unitSystem: system,
      te: s.sheet ? snapDraftAmount(s.sheet.type, s.te, system) : s.te,
    }));
    void savePrefs({ unitSystem: system });
  },
  toggleUnitSystem: () => {
    get().setUnitSystem(get().unitSystem === 'metric' ? 'imperial' : 'metric');
  },
  setReminderPref: (key, value) => {
    // Switching pumping ON stamps the anchor the reminder grid is built from,
    // so a parent who has never logged a pump still gets reminders. Switching
    // OFF clears it, so re-enabling later does not resume an ancient phase.
    if (key === 'pumpingReminders') {
      const pumpingEnabledAt = value ? Date.now() : null;
      set({ pumpingReminders: value, pumpingEnabledAt });
      void savePrefs({ pumpingReminders: value, pumpingEnabledAt });
      return;
    }
    if (key === 'treatmentReminders') {
      // The same resync lever pumping has, for the same gap: a parent who gives
      // a dose and forgets to log it gets a reminder that is early, with no way
      // to nudge it. Toggling off and on rebases the phase to now.
      //
      // One deliberate difference from pumping. This stamp can only ever MOVE an
      // existing interval grid, never bring one into being: `treatmentReminders`
      // returns early when the treatment has no logged dose, before it consults this
      // value. It also does nothing at all to a times-of-day treatment, whose instants
      // come off the wall clock rather than a phase. See scheduled.ts.
      const treatmentRemindersEnabledAt = value ? Date.now() : null;
      set({ treatmentReminders: value, treatmentRemindersEnabledAt });
      void savePrefs({ treatmentReminders: value, treatmentRemindersEnabledAt });
      return;
    }
    set({ [key]: value } as Pick<AppState, typeof key>);
    void savePrefs({ [key]: value });
  },
  setPumpingInterval: (minutes) => {
    set({ pumpingIntervalMin: minutes });
    void savePrefs({ pumpingIntervalMin: minutes });
  },
  setSmallWashesPerBig: (n) => {
    // Clamp before storing so a bad value can never reach persistence, and so
    // the number shown in Settings is the one the rhythm actually uses.
    const v = clampSmallWashesPerBig(n);
    set({ smallWashesPerBig: v });
    void savePrefs({ smallWashesPerBig: v });
  },
  setNapWindow: (startMin, endMin) => {
    // Both endpoints move together in one action, so the pair is always written
    // as a unit. Two independent setters would each do a load-then-merge inside
    // savePrefs, and back-to-back edits could interleave and drop one endpoint.
    const start = clampMinuteOfDay(startMin, NAP_WINDOW_START_DEFAULT);
    const end = clampMinuteOfDay(endMin, NAP_WINDOW_END_DEFAULT);
    set({ napWindowStartMin: start, napWindowEndMin: end });
    void savePrefs({ napWindowStartMin: start, napWindowEndMin: end });
  },
  setRhythmOriginHour: (hour) => {
    const h = clampHourOfDay(hour, RHYTHM_ORIGIN_DEFAULT);
    set({ rhythmOriginHour: h });
    void savePrefs({ rhythmOriginHour: h });
  },
  setRhythmLayer: (layer, on) => {
    set((s) => ({
      rhythmShowSleep: layer === 'sleep' ? on : s.rhythmShowSleep,
      rhythmShowFeeds: layer === 'feeds' ? on : s.rhythmShowFeeds,
      rhythmShowDiapers: layer === 'diapers' ? on : s.rhythmShowDiapers,
    }));
    const s = get();
    void savePrefs({
      rhythmShowSleep: s.rhythmShowSleep,
      rhythmShowFeeds: s.rhythmShowFeeds,
      rhythmShowDiapers: s.rhythmShowDiapers,
    });
  },
  setGrowthReference: (on) => {
    set({ showGrowthReference: on });
    void savePrefs({ showGrowthReference: on });
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
    if (prefs.showGrowthReference != null) set({ showGrowthReference: prefs.showGrowthReference });
    if (prefs.tutorialSeen) set({ tutorialSeen: true });
    if (prefs.dueDateReminders != null) set({ dueDateReminders: prefs.dueDateReminders });
    if (prefs.staleTimerReminders != null) set({ staleTimerReminders: prefs.staleTimerReminders });
    if (prefs.ageMilestones != null) set({ ageMilestones: prefs.ageMilestones });
    if (prefs.pumpingReminders != null) set({ pumpingReminders: prefs.pumpingReminders });
    if (prefs.pumpingIntervalMin != null) set({ pumpingIntervalMin: prefs.pumpingIntervalMin });
    if (prefs.pumpingEnabledAt !== undefined) set({ pumpingEnabledAt: prefs.pumpingEnabledAt });
    if (prefs.napSuggestions != null) set({ napSuggestions: prefs.napSuggestions });
    if (prefs.treatmentReminders != null) set({ treatmentReminders: prefs.treatmentReminders });
    // `!== undefined`, not `!= null`: a persisted null is a real value here
    // (the toggle is off) and must not be skipped. Matches pumpingEnabledAt.
    if (prefs.treatmentRemindersEnabledAt !== undefined)
      set({ treatmentRemindersEnabledAt: prefs.treatmentRemindersEnabledAt });
    if (prefs.milestoneCatchUp != null) set({ milestoneCatchUp: prefs.milestoneCatchUp });
    // `!= null`, not a truthy guard: this one is a number, and a truthy check
    // would silently discard a legitimately stored value at the low end.
    if (prefs.smallWashesPerBig != null) {
      set({ smallWashesPerBig: clampSmallWashesPerBig(prefs.smallWashesPerBig) });
    }
    // Same `!= null` reasoning, and it bites harder here: 0 is midnight, a
    // perfectly ordinary boundary, and a truthy guard would silently drop it.
    if (prefs.napWindowStartMin != null) {
      set({ napWindowStartMin: clampMinuteOfDay(prefs.napWindowStartMin, NAP_WINDOW_START_DEFAULT) });
    }
    if (prefs.napWindowEndMin != null) {
      set({ napWindowEndMin: clampMinuteOfDay(prefs.napWindowEndMin, NAP_WINDOW_END_DEFAULT) });
    }
    if (prefs.rhythmOriginHour != null) {
      set({ rhythmOriginHour: clampHourOfDay(prefs.rhythmOriginHour, RHYTHM_ORIGIN_DEFAULT) });
    }
    // `!= null`, not truthy: these are booleans and `false` (a hidden layer) is
    // exactly the state worth remembering, which a truthy guard would drop.
    if (prefs.rhythmShowSleep != null) set({ rhythmShowSleep: prefs.rhythmShowSleep });
    if (prefs.rhythmShowFeeds != null) set({ rhythmShowFeeds: prefs.rhythmShowFeeds });
    if (prefs.rhythmShowDiapers != null) set({ rhythmShowDiapers: prefs.rhythmShowDiapers });
    // Answered milestone prompts are independent of connection state, so load
    // them once here (merges into state like the prefs above).
    set({ answeredMilestonePrompts: await loadMilestonePrompts() });
    // Treatments are user data that survives disconnect, so load the on-device copy
    // unconditionally here, exactly like timers below. In server mode this is
    // the offline cache the freshly-loaded server list merges on top of (see
    // `mergeTreatments`); in local mode it is the only copy.
    set({ treatments: await loadTreatments() });
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
      set({ hydrating: false, ...queueMirror(q), timers: savedTimers });
      return;
    }
    if (conn.mode === 'local') {
      const e = await loadEntities();
      set({
        connection: conn,
        connected: true,
        hydrating: false,
        children: e?.children ?? [],
        entries: backfillHeldBack(e?.entries ?? [], e?.children ?? []),
        measurements: e?.measurements ?? [],
        selectedChildId: e?.selectedChildId ?? '',
        lastFeed: e?.lastFeed ?? { feedType: 'breast', method: 'left' },
        timers: savedTimers,
        ...queueMirror(q),
      });
      return;
    }
    // Cache-first: read the durable entity store, enter the app on it
    // IMMEDIATELY, and leave the server to a background refresh(). The old
    // shape awaited the complete server load before clearing `hydrating`, and
    // _layout renders nothing while `hydrating`, so away from the home LAN
    // (where the server address tends to black-hole rather than refuse) every
    // cold start sat on the splash until the platform socket gave up. The
    // entity store mirrors the last good load, so opening on it shows the
    // same data a warm foreground shows before ITS refresh lands.
    // `loadEntities` never rejects (see its doc comment), so no try is needed
    // around the read.
    const saved = await loadEntities();
    const localEntries = backfillHeldBack(saved?.entries ?? [], saved?.children ?? []);
    // Stored entries are the base, queue-only entries layered on top, never
    // the queue alone: `entries` gets a new reference here, and the
    // persistence subscription writes that reference straight back over the
    // entity store, so a list built from `q` alone would silently overwrite
    // (permanently lose) anything the queue didn't have, e.g. an expecting
    // child's held-back notes, whose only home is the entity store. A queued
    // entry the store doesn't already hold (belt-and-suspenders; in practice
    // the two agree, see `commitWrite`) is prepended on top.
    const storedIds = new Set(localEntries.map((entry) => entry.id));
    const queueOnly = q.filter((entry) => !storedIds.has(entry.id));
    set({
      connection: conn,
      connected: true,
      hydrating: false,
      // NOT `offline: true`: nothing has failed yet. The refresh below owns
      // that verdict, exactly as it does for a warm foreground re-check.
      children: saved?.children ?? [],
      entries: [...queueOnly, ...localEntries],
      measurements: saved?.measurements ?? [],
      // Restoring `children` without the selection that names one of them
      // would be its own regression: a present-but-unselected child falls
      // through Home's expecting branch straight to the activity tiles, and
      // a write against it then carries `childId: ''` (flushQueue can never
      // resolve that). Mirrors the local-mode branch above.
      selectedChildId: saved?.selectedChildId ?? '',
      lastFeed: saved?.lastFeed ?? { feedType: 'breast', method: 'left' },
      timers: savedTimers,
      ...queueMirror(q),
    });
    // refresh() IS the fetch-reconcile-merge-flush pipeline, so reuse it
    // rather than duplicating its body here: its 401/403 branch clears the
    // connection and sets the 'Session expired' connectError (routing reacts
    // a moment after the UI appears, the same UX a warm-session 401 already
    // has), its unreachable branch sets `offline: true`, and its
    // `timers: null` guard keeps running timers when only the timers fetch
    // failed. It reads `s.children`/`s.selectedChildId` for the
    // preferred-child fetch, which the set() above just populated from the
    // entity store, so the persisted selection still steers which child is
    // fetched; keep that ordering. Deliberately not awaited: hydrate's
    // contract is now "the UI can render", not "the server has answered".
    void get().refresh();
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
      // Fetch the currently selected child, not the server's first (see
      // `hydrate` above). Null for a child that was never pushed, which keeps
      // the old children[0] fallback.
      const data = await loadFromServer(conn, childServerIdFor(s.children, s.selectedChildId));
      // Read the write queue for the same reason `hydrate` does: this reload
      // replaces `entries` wholesale with server data, and an entry that has
      // not flushed yet is not in that data, so without merging it back the
      // row just disappears from History. Read AFTER the fetch so an entry
      // logged while the request was in flight is included. `flushQueue`
      // removes an entry from the file as soon as the server accepts it, so
      // anything still in here is genuinely not on the server and cannot
      // duplicate a row in `data.entries`.
      const q = await loadQueue();
      // Children are reconciled by `serverId`, not merged: a child already
      // known to the server keeps its local id (entries/measurements
      // reference it), and a child created offline (serverId == null) is kept
      // under its local id too. See `reconcileChildren`. Measurements created
      // offline have no flush yet (Phase 3): merge the in-memory unsynced ones
      // back in so a wholesale reload doesn't drop them from view. Entries are
      // deliberately excluded from this merge (see `mergeUnsynced`'s doc
      // comment); `remapChildIds` below is entries' only source, further
      // merged by `mergeHeldBackEntries` for an expecting child's held-back
      // entries (see below).
      const reconciledChildren = reconcileChildren(data.children, s.children);
      // Incoming entries/measurements/timers carry the SERVER's child id;
      // rewrite it to the local id now that reconciliation has produced the
      // authoritative mapping. See `remapChildIds` (mirrors `hydrate` above).
      const remappedEntries = remapChildIds(data.entries, reconciledChildren);
      const remappedMeasurements = remapChildIds(data.measurements, reconciledChildren);
      // Keep the user's current child if it's still visible — checked against
      // the RECONCILED list (not just the server's), so a local child kept
      // visible by reconcileChildren above doesn't get silently deselected;
      // otherwise fall back to the server's first child, resolved into local
      // id space (matches cold `hydrate`; see `resolveSelectedChildId`).
      const selectedChildId = reconciledChildren.some((c) => c.id === s.selectedChildId)
        ? s.selectedChildId
        : resolveSelectedChildId(reconciledChildren, data.selectedChildId);
      set({
        connected: true,
        offline: false,
        networkOnline: true,
        ...data,
        children: reconciledChildren,
        measurements: mergeUnsynced(remappedMeasurements, s.measurements),
        // An expecting child's entries are held back the same way (see
        // `mergeHeldBackEntries`): they're already in `s.entries` (this is a
        // warm reload, not a cold restart), never on the server, so merge
        // them back the same way `hydrate()` does from the entity store.
        entries: mergeHeldBackEntries(mergeQueuedEntries(remappedEntries, q), s.entries, reconciledChildren),
        treatments: mergeTreatments(data.treatments, s.treatments, reconciledChildren),
        selectedChildId,
        // A null `timers` is "the fetch failed, unknown" (see
        // `LoadResult.timers`), not "none running": keep the on-device copy
        // untouched instead of reconciling against an answer we never got,
        // which would drop every running synced timer as stopped elsewhere.
        // This explicit key must stay AFTER the `...data` spread above, so
        // the null never reaches state. Timers are remapped only when
        // non-null (there is nothing to remap in the null case).
        timers:
          data.timers == null
            ? localTimers
            : reconcileTimers(localTimers, remapChildIds(data.timers, reconciledChildren)),
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
        // A null `timers` is "the fetch failed, unknown" (see
        // `LoadResult.timers`) and must never land in state through the
        // `...data` spread above: keep whatever timers are in memory (e.g. a
        // timer running in local mode across the switch). A non-null answer
        // replaces them wholesale, exactly as the spread always did (connect
        // has no reconcile pipeline).
        timers: data.timers == null ? get().timers : data.timers,
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
        treatments: st.treatments.map((c) => ({ ...c, serverId: undefined })),
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
    let state = { children: s.children, entries: s.entries, measurements: s.measurements, treatments: s.treatments };
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
    // on retry, even before we know whether it fully succeeded. `uploadUnsynced`
    // stamps `serverId` but knows nothing about `heldBack` (that's this
    // store's concept, not the uploader's), so clear it here for any entry
    // that just got a real serverId, mirroring `flushUnsynced`'s "same update
    // that stamps serverId" clear: a pushed entry is no longer withheld, and
    // leaving `heldBack: true` on one would contradict the field's own
    // contract even though nothing reads it that way today (isHeldBackEntry
    // also guards on serverId == null).
    set({
      children: result.children,
      entries: result.entries.map((e) => (e.heldBack && e.serverId != null ? { ...e, heldBack: false } : e)),
      measurements: result.measurements,
      treatments: result.treatments ?? s.treatments,
    });

    // An expected child is deliberately held back from the server (its
    // `birth` is a due date, not a valid birth_date), so it never gets a
    // serverId, and `uploadUnsynced` skips its entries/measurements too (no
    // server child to attach them to). None of that is a failed upload, so it
    // must not count as leftover work below.
    const expectingChildIds = new Set(result.children.filter((c) => c.expected).map((c) => c.id));
    const stillUnsynced =
      result.children.some((c) => c.serverId == null && !c.expected) ||
      result.entries.some((e) => e.serverId == null && !expectingChildIds.has(e.childId)) ||
      result.measurements.some((m) => m.serverId == null && !expectingChildIds.has(m.childId)) ||
      (result.treatments ?? []).some((c) => c.serverId == null && !expectingChildIds.has(c.childId));
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
    // Read the pre-existing local children/entries/measurements before the
    // set() below replaces them with the server's list.
    const localChildren = get().children;
    const localEntries = get().entries;
    const localMeasurements = get().measurements;
    const localSelectedChildId = get().selectedChildId;
    const data = await loadFromServer(conn);
    // Reconcile rather than taking the server list wholesale: the children
    // just uploaded above kept their local ids (only `serverId` was stamped),
    // and entries/measurements still reference those local ids. Taking
    // `data.children` as-is would swap in server ids and orphan them. See
    // `reconcileChildren`. An expecting child is deliberately never uploaded
    // (see `stillUnsynced` above), so it's absent from `data.children` too;
    // `reconcileChildren` keeps it under its local id the same way it keeps
    // any other never-pushed child.
    const reconciledChildren = reconcileChildren(data.children, localChildren);
    // Incoming entries/measurements/timers carry the SERVER's child id;
    // rewrite it to the local id now that reconciliation has produced the
    // authoritative mapping. See `remapChildIds` (mirrors `hydrate`/`refresh`).
    const remappedEntries = remapChildIds(data.entries, reconciledChildren);
    const remappedMeasurements = remapChildIds(data.measurements, reconciledChildren);
    // The expecting child's measurements are held back the same way its
    // record is: they never reach the server (uploadUnsynced skips them, no
    // server child to attach them to), so merge the local copy back in,
    // mirroring hydrate()/refresh()'s general mergeUnsynced treatment.
    const mergedMeasurements = mergeUnsynced(remappedMeasurements, localMeasurements);
    // Its entries are held back too. Use the same expecting-child merge that
    // refresh()/hydrate() use (mergeHeldBackEntries) rather than a blanket
    // serverId==null filter: an expecting child's entries can never reach the
    // server (uploadUnsynced skips them: no server child to attach them to),
    // so this can never duplicate one that already flushed.
    const mergedEntries = mergeHeldBackEntries(remappedEntries, localEntries, reconciledChildren);
    // Keep the current selection if it's still visible after reconciliation
    // (checked against the RECONCILED list, not just the server's, so an
    // expecting child kept visible by reconcileChildren above doesn't get
    // silently deselected); otherwise fall back to the server's first child,
    // resolved into local id space (mirrors `hydrate`/`refresh`; see
    // `resolveSelectedChildId`).
    const selectedChildId = reconciledChildren.some((c) => c.id === localSelectedChildId)
      ? localSelectedChildId
      : resolveSelectedChildId(reconciledChildren, data.selectedChildId);
    set({
      ...data,
      children: reconciledChildren,
      entries: mergedEntries,
      measurements: mergedMeasurements,
      treatments: mergeTreatments(data.treatments, get().treatments, reconciledChildren),
      // A null `timers` is "the fetch failed, unknown" (see
      // `LoadResult.timers`) and must never land in state through the
      // `...data` spread above: keep the in-memory timers as they are. A
      // non-null answer is remapped and taken wholesale, as before.
      timers: data.timers == null ? get().timers : remapChildIds(data.timers, reconciledChildren),
      selectedChildId,
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
      entries: backfillHeldBack(e?.entries ?? [], e?.children ?? []),
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
      queuedIds: [],
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
    // Join the flush already running instead of starting a rival one (see
    // `flushQueueInFlight` above): two passes over the same stored queue push
    // every entry twice.
    if (flushQueueInFlight) return flushQueueInFlight;
    const run = (async () => {
      const s = get();
      const conn = s.connection;
      if (!conn || conn.mode !== 'server' || s.offline) return;
      const q = await loadQueue();
      if (q.length === 0) return;
      let failed = 0;
      for (const entry of q) {
        const childServerId = childServerIdFor(s.children, entry.childId);
        if (childServerId == null) {
          // The child still has no server id (e.g. its own push hasn't landed
          // yet): keep the entry queued for the next flush rather than sending
          // a local id the server would reject.
          failed++;
          continue;
        }
        try {
          await pushEntryToServer(conn, entry, childServerId);
        } catch {
          failed++;
          continue;
        }
        // Drop it the moment the server has it, one entry at a time, rather
        // than saving what is left once the whole run finishes. The queue
        // file is what `refresh()` merges back into `entries` to keep a
        // still-queued row visible, so "in the file" has to keep meaning "the
        // server does not have this". Saving only at the end broke that for
        // the length of the run: a refresh landing mid-flush would show the
        // server's copy and the queued copy as two rows for one feed.
        //
        // `removeQueuedEntry` re-reads the file and drops one id instead of
        // overwriting it wholesale, so an entry enqueued while this ran (the
        // nap widget enqueues from a headless task, in another process) is
        // kept rather than clobbered.
        const { queue } = await removeQueuedEntry(entry.id);
        set(queueMirror(queue));
      }
      // Re-read rather than trusting the last removal: anything enqueued
      // during the run belongs in the count too.
      set(queueMirror(await loadQueue()));
      if (failed === 0) {
        get().showToast(`Synced ${q.length} ${q.length === 1 ? 'entry' : 'entries'}`);
      }
    })();
    flushQueueInFlight = run;
    try {
      await run;
    } finally {
      flushQueueInFlight = null;
    }
  },
  flushPendingOps: async () => {
    // Join the flush already running instead of starting a rival one (see
    // `flushPendingOpsInFlight` above): two passes over the same stored op
    // log replay every op twice.
    if (flushPendingOpsInFlight) return flushPendingOpsInFlight;
    const run = (async () => {
      const s = get();
      const conn = s.connection;
      if (!conn || conn.mode !== 'server' || s.offline) return;
      const ops = await loadPendingOps();
      if (ops.length === 0) return;
      for (const op of ops) {
        try {
          if (op.op === 'update' && op.entity === 'child') {
            // Address the child by the slug state holds RIGHT NOW, not the one
            // frozen into the payload at enqueue time. Op payloads are snapshots
            // and `addPendingOp` appends without dedup, so two offline renames of
            // the same child queue two ops both carrying the ORIGINAL slug.
            // Replaying the first moves the slug server-side, which staled the
            // second before it was ever sent: it would 404, go back on the queue,
            // and 404 again on every later flush, so the rename would never land
            // and the op log would never drain. Read from `get()`, not the `s`
            // snapshot above, so the re-stamp below is visible to the next op.
            const live = get().children.find((c) => c.id === op.payload.id);
            const payload = live?.slug ? { ...op.payload, slug: live.slug } : op.payload;
            const res = await updateChildOnServer(conn, payload);
            // A replayed rename moves the slug server-side, and the child
            // endpoints are keyed by it, so re-stamp it here the same way
            // saveChild's online edit does. Otherwise the next delete goes out
            // with a stale slug, 404s, and the child comes back.
            const slug = res?.slug;
            if (slug) {
              set((st) => ({
                children: st.children.map((c) => (c.id === op.payload.id ? { ...c, slug } : c)),
              }));
            }
            // Gender lives in its own `gender`-tagged note, not on the child
            // record, so replay it as a second write. Deliberately AFTER the slug
            // re-stamp above and deliberately NOT caught: a failure here re-queues
            // the whole op, and replaying the child PATCH is idempotent, so the
            // gender change gets retried instead of being silently dropped.
            if (payload.serverId != null) {
              await setChildGenderOnServer(conn, payload.serverId, payload.gender, Date.now());
            }
          } else if (op.op === 'update' && op.entity === 'measurement') {
            const childServerId = childServerIdFor(s.children, op.payload.childId);
            // Child not on the server (edge case: the entity was synced but the
            // child later lost its server id). Nothing sensible to send; fall
            // through to the catch below so the op stays queued for retry.
            if (childServerId == null) throw new Error('child not synced');
            await updateMeasurementOnServer(conn, op.payload, childServerId);
          } else if (op.op === 'update' && op.entity === 'entry') {
            const childServerId = childServerIdFor(s.children, op.payload.childId);
            if (childServerId == null) throw new Error('child not synced');
            await updateEntryOnServer(conn, op.payload, childServerId);
          } else if (op.op === 'update' && op.entity === 'treatment') {
            const childServerId = childServerIdFor(s.children, op.payload.childId);
            if (childServerId == null) throw new Error('child not synced');
            await updateTreatmentOnServer(conn, op.payload, childServerId);
          } else if (op.op === 'delete' && op.entity === 'treatment') await deleteTreatmentFromServer(conn, op.serverId);
          else if (op.op === 'delete' && op.entity === 'measurement') await deleteMeasurementFromServer(conn, op.kind, op.serverId);
          else if (op.op === 'delete' && op.entity === 'entry') await deleteEntryFromServer(conn, op.entryType, op.serverId);
          else if (op.op === 'update' && op.entity === 'timer') await updateTimerOnServer(conn, op.payload);
          else if (op.op === 'delete' && op.entity === 'timer') await deleteTimerFromServer(conn, op.serverId);
        } catch (e) {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            // The token is dead: every op left on the log would fail the same
            // way, so hammering the server with the rest of the run helps
            // nobody. Stop here. The ops stay on file for after a reconnect,
            // and refresh()'s session-expiry handling owns the situation.
            break;
          }
          if (!(e instanceof ApiError && e.status === 404)) {
            // Retryable (network ApiError(0), 5xx, the "child not synced"
            // throws above): leave the op on the file for the next flush and
            // move on to the next op.
            continue;
          }
          // ApiError 404: the target is already gone, deleted elsewhere or by
          // the winner of an earlier replay race. Terminal for updates and
          // deletes alike: retrying can never succeed, and before this
          // classification such an op was replayed forever on every flush.
          // Fall through and remove it like a success.
        }
        // Replayed, or terminally gone: drop the op from the file one at a
        // time, by value, rather than saving a survivors list once the whole
        // run finishes. The end-of-run save was last-write-wins: it could
        // clobber an op recorded by `addPendingOp` mid-run (an offline edit
        // silently lost), and, when two runs raced, resurrect ops the other
        // run had already replayed. `removePendingOp` re-reads the file and
        // drops one op instead of overwriting the list wholesale, so anything
        // this run was not asked to remove is left alone.
        await removePendingOp(op);
      }
    })();
    flushPendingOpsInFlight = run;
    try {
      await run;
    } finally {
      flushPendingOpsInFlight = null;
    }
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
      // Children & measurements, plus the narrow held-back subset of entries
      // (see `isHeldBackEntry`): entries logged against an expecting child,
      // which `commitWrite`'s own `expected` guard keeps off the write queue
      // for exactly this reason, so pushing them here can never race
      // `flushQueue` into double-posting the same entry. Every OTHER entry
      // still flows through queue.ts (flushQueue) only; mixing those in here
      // would double-push. (Full entry unification is a later change.) Note:
      // an offline entry created for an offline-created (but not expecting)
      // child while CONNECTED is a niche case not handled here either: it
      // stays on the queue path.
      const heldBackEntries = s.entries.filter((e) => isHeldBackEntry(e));
      const hasUnsynced =
        s.children.some((c) => c.serverId == null) ||
        s.measurements.some((m) => m.serverId == null) ||
        s.treatments.some((c) => c.serverId == null) ||
        heldBackEntries.length > 0;
      const hasUnsyncedTimer = s.timers.some((t) => t.serverId == null);
      if (!hasUnsynced && !hasUnsyncedTimer) return;
      if (hasUnsynced) {
        const result = await uploadUnsynced(
          { children: s.children, entries: heldBackEntries, measurements: s.measurements, treatments: s.treatments },
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
          ).length +
          heldBackEntries.filter((e) => result.entries.find((r) => r.id === e.id)?.serverId != null).length +
          s.treatments.filter(
            (c) => c.serverId == null && (result.treatments ?? []).find((r) => r.id === c.id)?.serverId != null,
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
          treatments: st.treatments.map((c) => {
            const u = (result.treatments ?? []).find((r) => r.id === c.id);
            return u && u.serverId != null ? { ...c, serverId: u.serverId } : c;
          }),
          entries: st.entries.map((e) => {
            const u = result.entries.find((r) => r.id === e.id);
            // Successfully pushed: stamp `serverId` and clear `heldBack` in
            // the same update, since the flag is redundant once a real
            // serverId exists (see `isHeldBackEntry`'s belt-and-suspenders
            // check).
            return u && u.serverId != null ? { ...e, serverId: u.serverId, heldBack: false } : e;
          }),
        }));
        // Mirrors flushQueue's `Synced N entries`; here the flush legitimately
        // pushes children, measurements & held-back entries, so report the
        // true total.
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
    const child = s.children.find((c) => c.id === entry.childId);
    // WITHHELD: the owning child is a due-date placeholder with no
    // `serverId` (see `childServerIdFor`) and, being `expected`, will not
    // get one until `confirmBirth` (see `saveChild`). Stamp that as a
    // durable fact on the entry now, ONCE (this is the only place
    // `heldBack` is ever set, see its doc comment on `EntryBase`), rather
    // than something re-derived later from `expected` or a timestamp, which
    // is exactly what kept expiring at the next transition across earlier
    // attempts at this. Runs even in local mode / with no connection at all:
    // `adopt()`'s later merge (`mergeHeldBackEntries`) needs the same marker
    // on an entry written before the app ever had a server connection.
    if (child?.expected && !entry.heldBack) {
      set((st) => ({
        entries: st.entries.map((e) => (e.id === entry.id ? { ...e, heldBack: true } : e)),
      }));
    }
    const conn = s.connection;
    if (!conn || conn.mode !== 'server') return; // local: nothing to push
    // Leave a withheld entry purely local (in `entries` / the entity store,
    // like local mode) rather than queueing it. Queueing it would let it
    // flush silently through `flushQueue`, which never stamps a local
    // `serverId` on an entry: the only path that does is `flushUnsynced`'s
    // held-back push once `confirmBirth` gives the child one (see
    // `isHeldBackEntry`), and mixing the two would risk pushing the same
    // entry to the server twice.
    if (child?.expected) return;
    if (s.offline) {
      void enqueueEntry(entry).then((q) => set(queueMirror(q)));
    } else {
      const childServerId = childServerIdFor(s.children, entry.childId);
      if (childServerId == null) {
        // The child is not on the server yet, so this entry cannot be either.
        // Queue it: the reconnect flush pushes it once the child exists.
        void enqueueEntry(entry).then((q) => set(queueMirror(q)));
      } else {
        void pushEntryToServer(conn, entry, childServerId)
          .then((serverId) => {
            if (serverId == null) return;
            if (get().entries.some((e) => e.id === entry.id)) {
              set((st) => ({
                entries: st.entries.map((e) => (e.id === entry.id ? { ...e, serverId } : e)),
              }));
            } else {
              // Deleted, or replaced by a running timer, while the POST was in
              // flight: the local record never got the serverId, so nothing
              // else can ever remove the copy this call just created. Delete the
              // orphan here, the same way `mirrorTimerCreate` does for timers.
              void deleteEntryFromServer(conn, entry.type, serverId).catch(() => {});
            }
          })
          .catch(() => enqueueEntry(entry).then((q) => set(queueMirror(q))));
      }
    }
  },

  // ---- child switcher ----
  selectChild: (id) => {
    set({
      selectedChildId: id,
      showChildSwitcher: false,
      insightsLoaded: false,
      insightsEntries: [],
      insightsError: false,
    });
    // In server mode `entries`/`measurements` only ever hold the ONE child the
    // last fetch asked for (see `loadFromServer`'s `preferredChildServerId`),
    // so scoping the display by child is only half the fix: without this the
    // sibling we just switched to shows an empty History, Growth and status
    // strip until the user happens to pull to refresh. Local mode already has
    // every child's records in memory, so there is nothing to fetch.
    //
    // Fire-and-forget, like the flushes elsewhere: the switch itself is a local
    // UI action and must land whatever the network does. `refresh` guards its
    // own re-entry (`refreshInFlight`) and no-ops for demo, no connection, and
    // the manual offline override, so this needs no further gating. A failed
    // fetch does leave the offline banner up, which is deliberate: it is the
    // only thing that explains the empty history. What it is not is the retry:
    // in server mode, which is exactly the branch below, pressing it opens the
    // offline queue screen, and the re-check lives on that screen's Retry.
    if (get().connection?.mode === 'server') void get().refresh();
  },
  openSwitcher: () => set({ showChildSwitcher: true }),
  closeSwitcher: () => set({ showChildSwitcher: false }),

  openAddChild: () => set({ childSheet: true, editingChildId: null }),
  openEditChild: (id) => set({ childSheet: true, editingChildId: id }),
  closeChildSheet: () => set({ childSheet: false, editingChildId: null }),

  openConfirmBirth: (id) => set({ confirmBirthFor: id }),
  closeConfirmBirth: () => set({ confirmBirthFor: null }),

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
        gender: fields.gender,
        picture: change.kind === 'none' ? existing.picture : pending,
      };
      const genderChanged = existing.gender !== child.gender;
      set({
        children: s.children.map((c) => (c.id === child.id ? child : c)),
        childSheet: false,
        editingChildId: null,
      });
      get().showToast('Updated');
      const conn = s.connection;
      if (conn && conn.mode === 'server' && !s.offline) {
        // Gender lives in its own `gender`-tagged note, not on the child record,
        // so it is a separate write. Fired only on an actual change: it costs a
        // read before its write, and a plain rename should not pay for that.
        if (genderChanged && child.serverId != null) {
          void setChildGenderOnServer(conn, child.serverId, child.gender, Date.now()).catch(() => {});
        }
        void updateChildOnServer(conn, child, change)
          .then((res) => {
            if (!res) return;
            set((st) => ({
              children: st.children.map((c) => {
                if (c.id !== child.id) return c;
                // Re-stamp the slug. Baby Buddy DERIVES it from the name, so a
                // rename moves it, and the child endpoints are keyed by it (see
                // `BabybuddyClient.childKey`). Holding the old one would 404 the
                // next rename or delete, and a 404'd delete is exactly how a
                // deleted child used to come back.
                const slug = res.slug ?? c.slug;
                // Swap the ephemeral local file URI for the durable server URL.
                return change.kind === 'none' ? { ...c, slug } : { ...c, slug, picture: res.picture };
              }),
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
      expected: fields.expected,
      gender: fields.gender,
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
    // An expected child holds a DUE date in `birth`, which the server's
    // birth_date cannot legitimately hold. confirmBirth releases it later.
    if (conn && conn.mode === 'server' && !s.offline && !fields.expected) {
      void pushChildToServer(conn, child, change)
        .then((res) => {
          if (!res || res.id == null) return;
          // Stamp the server id, the slug and the server's picture URL. The
          // local `id` is deliberately NOT rewritten: entries and measurements
          // reference it, and changing it would orphan them. Reconciliation
          // matches this child by `serverId` from here on. The slug is what the
          // child endpoints are keyed by (see `BabybuddyClient.childKey`), so
          // capturing it here is what lets this child be renamed or deleted
          // before the next refresh has filled it in.
          set((st) => ({
            children: st.children.map((c) =>
              c.id === localId
                ? { ...c, serverId: res.id, slug: res.slug ?? c.slug, picture: res.picture ?? c.picture }
                : c,
            ),
          }));
          // The gender note references the child by SERVER id, so it can only be
          // written once the POST above has produced one.
          if (child.gender != null) {
            void setChildGenderOnServer(conn, res.id, child.gender, Date.now()).catch(() => {});
          }
        })
        .catch(() => {});
    }
  },

  confirmBirth: (id, birth) => {
    const s = get();
    const child = s.children.find((c) => c.id === id);
    if (!child || !child.expected) return;
    // Push the post-birth fields (real birth date, no longer expected), not
    // the stale due date the pre-set() `child` above still carries.
    const bornChild: Child = { ...child, expected: false, birth };
    set({
      children: s.children.map((c) => (c.id === id ? bornChild : c)),
      // The insights cache may hold a stale error from while the child was
      // still expected (loadInsights had nothing to load for it). Reset it
      // the same way selectChild does, so the newly born child starts clean.
      insightsLoaded: false,
      insightsEntries: [],
      insightsError: false,
    });
    get().showToast('Welcome to the world');
    const conn = s.connection;
    // Push the newly born child now (see saveChild's create push above): the
    // confirmation unlocks logging right away, and the local `id` is
    // deliberately NOT rewritten here either, for the same reason. Guarded
    // the same way saveChild's create push is: only in server mode while
    // online. In local mode or offline, leave the child for the normal
    // reconnect path.
    if (conn && conn.mode === 'server' && !s.offline) {
      void pushChildToServer(conn, bornChild)
        .then((res) => {
          if (!res || res.id == null) return;
          // Stamp the server id, the slug and the server's picture URL, exactly
          // as saveChild's create push does (see the note there on why the local
          // `id` is left alone and why the slug matters).
          set((st) => ({
            children: st.children.map((c) =>
              c.id === id
                ? { ...c, serverId: res.id, slug: res.slug ?? c.slug, picture: res.picture ?? c.picture }
                : c,
            ),
          }));
        })
        .catch(() => {});
    }
  },

  deleteChild: async (id) => {
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
    // Kept for the restore below, captured before the purge. `purgedTimers` are
    // the running timers the re-point clears: a server-backed one would come
    // back on the next refresh, but one started offline (serverId == null) lives
    // nowhere else and would be lost for good.
    const priorIndex = s.children.findIndex((c) => c.id === id);
    const purgedEntries = s.entries.filter((e) => e.childId === id);
    const purgedMeasurements = s.measurements.filter((m) => m.childId === id);
    const purgedTimers = s.timers;
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
      try {
        // AWAITED, unlike the fire-and-forget pushes elsewhere. A delete is not
        // recoverable by a later flush: there is no `child` PendingOp variant to
        // replay it, so if this fails the removal has to be undone here and now.
        // Awaiting is also what keeps the refetch below from racing the DELETE,
        // which `reconcileChildren` would otherwise read as "still on the
        // server" and re-add the child.
        await deleteChildFromServer(conn, child);
      } catch {
        // Put the child back and say so. The old code swallowed this and showed
        // an unconditional success toast, so a failed delete looked like a
        // successful one until the next refresh resurrected the child.
        //
        // Merged into CURRENT state rather than snapping back to the pre-delete
        // snapshot: a write may have landed during the round trip and must not
        // be discarded by the undo.
        set((st) => {
          // Already back? Matched on `serverId` as well as the local id, not
          // just the latter: a refresh landing mid-flight puts the child back
          // through `reconcileChildren`, which re-adds a child it cannot match
          // locally under the SERVER-derived id (`String(serverId)`), not the
          // local one. Looking only for the local id would miss it and splice a
          // second copy in beside it, leaving two entries sharing one serverId.
          const alreadyBack = st.children.some(
            (c) => c.id === id || (child.serverId != null && c.serverId === child.serverId),
          );
          if (alreadyBack) return {};
          const children = [...st.children];
          children.splice(Math.min(priorIndex, children.length), 0, child);
          const entryIds = new Set(st.entries.map((e) => e.id));
          const measurementIds = new Set(st.measurements.map((m) => m.id));
          const timerIds = new Set(st.timers.map((t) => t.id));
          return {
            children,
            entries: [...purgedEntries.filter((e) => !entryIds.has(e.id)), ...st.entries],
            measurements: [...purgedMeasurements.filter((m) => !measurementIds.has(m.id)), ...st.measurements],
            timers: [...purgedTimers.filter((t) => !timerIds.has(t.id)), ...st.timers],
            // Only reclaim the selection if nothing else has claimed it since
            // (the user may have switched children while this was in flight).
            selectedChildId:
              patch.selectedChildId !== undefined && st.selectedChildId === patch.selectedChildId
                ? id
                : st.selectedChildId,
          };
        });
        get().showToast(`Could not delete ${child.first}`);
        return;
      }
    }
    get().showToast(`${child.first} deleted`);
    // The re-point above assigns `selectedChildId` directly rather than going
    // through `selectChild`, so it does not inherit selectChild's refetch. In
    // server mode `entries`/`measurements` only ever hold the ONE child the last
    // fetch asked for, so without this the surviving child's History, Growth and
    // status strip would sit empty until the user happened to pull to refresh.
    // Local mode already has every child's records in memory.
    //
    // Deliberately after the awaited DELETE above, never before it. (A refresh
    // that was ALREADY in flight when this ran is a separate, pre-existing race:
    // it can still re-add the child, and `refreshInFlight` then no-ops this
    // refetch. Out of scope here.)
    //
    // Gated on `offline` as well as the mode: `refresh` only bails on the
    // `simulateOffline` override, so an ungated call would fire a doomed fetch
    // while offline, and, once the offline-delete UI block is relaxed, would
    // turn a possible later resurrection into an immediate certain one.
    const st = get();
    if (patch.selectedChildId && st.connection?.mode === 'server' && !st.offline) void st.refresh();
  },

  // ---- insights (lazy deep-history load) ----
  // Demo mode scopes the local seed history to the child; server mode fetches
  // the child's SERVER-id-keyed 90-day history (empty, not an error, for a child
  // never pushed). See `fetchInsightsEntries`.
  loadInsights: async () => {
    const s = get();
    if (s.insightsLoaded || s.insightsLoading) return;
    if (!s.connection || !s.selectedChildId) return;
    const childId = s.selectedChildId;
    set({ insightsLoading: true, insightsError: false });
    try {
      const entries = await fetchInsightsEntries(s, childId);
      if (get().selectedChildId !== childId) {
        // A child switch landed while this fetch was in flight: discard the
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

  reloadInsights: async () => {
    const s = get();
    // Do NOT gate on insightsLoaded: forcing a re-fetch is the whole point.
    // Still bail if an initial load is already running, or there is nothing to fetch.
    if (s.insightsLoading) return;
    if (!s.connection || !s.selectedChildId) return;
    const childId = s.selectedChildId;
    // Leave insightsEntries / insightsLoaded in place so the charts stay on
    // screen while the fetch runs (no flash to the full-screen loading state).
    set({ insightsLoading: true });
    try {
      const entries = await fetchInsightsEntries(s, childId);
      if (get().selectedChildId !== childId) {
        // Child switch landed mid-flight; that child's mount effect will load it.
        set({ insightsLoading: false });
        return;
      }
      set({ insightsEntries: entries, insightsLoaded: true, insightsLoading: false, insightsError: false });
    } catch {
      // Manual refresh failed: keep the existing charts, drop the spinner, and
      // leave insightsError untouched so a good screen is not replaced by the
      // error state (and a pre-existing error stays put for its own retry button).
      set({ insightsLoading: false });
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
      // Seed from the nap window, classified on the draft's START. `te` opens
      // as an interval ending now, so the start is `now - durationMin`; using
      // `now` would misread a long sleep that began on the other side of the
      // window boundary. The user can still override with the Nap/Night toggle,
      // and whatever `te.nap` holds at save time is what gets saved.
      // `s.now` rather than `Date.now()` so the seed is computed against the
      // very clock `save()` will resolve the draft with.
      const now = get().now;
      te.nap = isNapStart(teStart(te, now) ?? now, {
        startMin: get().napWindowStartMin,
        endMin: get().napWindowEndMin,
      });
    }
    if (type === 'bath') {
      // Pre-select the wash that's due from the small/big rhythm. Scoped to the
      // selected child: `entries` holds every child's records, so an unscoped
      // read would let a sibling's baths decide this child's next wash.
      te.wash = nextWashKind(entriesForChild(get().entries, get().selectedChildId), get().smallWashesPerBig);
    }
    if (type === 'temperature') {
      // Seed a normal baseline so the decimal input opens on a sensible value.
      te.temperature = 37.0;
    }
    if (type === 'medication') {
      // Blank name/amount — the medication inputs open empty; the unit is unset
      // until the user picks a chip or types one.
      te.medName = '';
    }
    if (type === 'note') {
      // Blank body — the multiline note input opens empty.
      te.noteText = '';
    }
    set({
      sheet: { type },
      te: snapDraftAmount(type, te, get().unitSystem),
      editingId: null,
      fromTimerId: null,
    });
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
      entry.type === 'medication' ||
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
    } else if (entry.type === 'medication') {
      // Notes are seeded above (medication isn't bath/note/milestone); hydrate
      // the name + amount + free-text unit from the existing entry.
      te.absTime = entry.time;
      te.agoMin = Math.max(0, Math.round((now - entry.time) / 60000));
      te.medName = entry.name;
      te.medDosage = entry.dosage;
      te.medUnit = entry.dosageUnit;
      // Carry any next-dose interval so re-saving an edit doesn't drop it.
      te.medNextDoseIntervalSec = entry.nextDoseIntervalSec;
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
    set({
      sheet: { type: entry.type },
      te: snapDraftAmount(entry.type, te, s.unitSystem),
      editingId: entryId,
      fromTimerId: null,
    });
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
      // The timer's own start is the classifying instant, not "now": a nap
      // begun at 13:00 and still running at 19:30 is a nap. An explicit
      // `tm.nap` (the user already chose) always wins.
      te.nap = tm.nap ?? isNapStart(tm.start, { startMin: s.napWindowStartMin, endMin: s.napWindowEndMin });
    }
    if (type === 'tummy' && tm.milestone != null) te.milestone = tm.milestone;
    if (tm.notes != null) te.notes = tm.notes;
    set({
      sheet: { type },
      te: snapDraftAmount(type, te, s.unitSystem),
      editingId: null,
      fromTimerId: timerId,
    });
  },
  closeSheet: () => set({ sheet: null, editingId: null, fromTimerId: null }),
  deleteEntry: (id) => {
    const s = get();
    const index = s.entries.findIndex((e) => e.id === id);
    if (index === -1) return;
    const entry = s.entries[index];
    set({
      entries: s.entries.filter((e) => e.id !== id),
      sheet: s.editingId === id ? null : s.sheet,
      editingId: s.editingId === id ? null : s.editingId,
    });
    detachEntry(get, set, entry, index);
    get().showToast('Deleted', { label: 'Undo', run: () => get().undoDelete() });
  },
  undoDelete: () => {
    const d = lastDeleted;
    if (!d) return;
    lastDeleted = null;
    // The entry was replaced by a running timer: discard that timer in the same
    // step, so undo can never leave the user holding the entry AND the timer.
    const timer = d.timerId ? get().timers.find((t) => t.id === d.timerId) : undefined;
    set((s) => {
      const patch: Partial<AppState> = {};
      if (!s.entries.some((e) => e.id === d.entry.id)) {
        const next = s.entries.slice();
        next.splice(Math.min(d.index, next.length), 0, d.entry);
        patch.entries = next;
      }
      if (d.timerId) patch.timers = s.timers.filter((t) => t.id !== d.timerId);
      return patch;
    });
    // Drop the server mirror too. A timer whose create POST hasn't landed yet
    // has no serverId to delete, but `mirrorTimerCreate` cleans that orphan up
    // itself once the POST resolves and the timer is gone from the store.
    if (timer) mirrorTimerDelete(get, timer);
    // Re-create server-side only if the removal actually took something away:
    // a real server record, or a place in the not-yet-flushed write queue. A
    // local-only (offline/demo) delete leaves the server copy intact.
    if (d.didServerDelete || d.requeue) get().commitWrite(d.entry);
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
    // Same queue rewrite as `save()`'s edit branch: a milestone logged offline
    // is still on the write queue, and `flushQueue` pushes the file's copy,
    // not this one, so the stale pre-edit version would land on reconnect.
    void updateQueuedEntry(entry).then(({ updated, queue }) => {
      if (updated) set(queueMirror(queue));
    });
    get().showToast('Updated');
    if (s.connection && s.connection.mode === 'server' && !s.offline) {
      const childServerId = childServerIdFor(s.children, entry.childId);
      // No server id for the child means nothing sensible to update
      // server-side; the local edit stands and a future flush handles the
      // child (and, transitively, this entry) once it can be pushed.
      if (childServerId != null) {
        void updateEntryOnServer(s.connection, entry, childServerId).catch(() => {});
      }
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
      const childServerId = childServerIdFor(s.children, m.childId);
      if (existing) {
        // No server id for the child: nothing sensible to update server-side,
        // so leave the local edit as-is (same as the offline case below).
        if (childServerId != null) {
          void updateMeasurementOnServer(conn, m, childServerId).catch(() => {});
        }
      } else if (childServerId != null) {
        void pushMeasurementToServer(conn, m, childServerId)
          .then((serverId) => {
            if (serverId != null) {
              set((st) => ({
                measurements: st.measurements.map((x) => (x.id === m.id ? { ...x, serverId } : x)),
              }));
            }
          })
          .catch(() => {});
      }
      // else (!existing && childServerId == null): leave serverId unset,
      // flushUnsynced picks the measurement up once the child is pushed.
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

  // --- treatments (medication regimens) ---
  // Offline-first, exactly like measurements: the local write lands first and
  // the server mirror is fire-and-forget, with an offline edit/delete recorded
  // as a pending op so it replays on reconnect. A treatment rides on the server as a
  // `treatment`-tagged note (see `treatmentToNoteBody`). The `treatments` subscribe at the
  // bottom of this file persists every change to on-device storage, which is
  // both the local-mode store and the offline cache when connected.
  addTreatment: (treatment) => {
    const s = get();
    set({ treatments: [treatment, ...s.treatments] });
    const conn = s.connection;
    if (conn && conn.mode === 'server' && !s.offline) {
      const childServerId = childServerIdFor(s.children, treatment.childId);
      // No server id for the child yet (an expecting child, say): leave the treatment
      // unstamped and let flushUnsynced push it once the child lands.
      if (childServerId != null) {
        void pushTreatmentToServer(conn, treatment, childServerId)
          .then((serverId) => {
            if (serverId != null) {
              set((st) => ({ treatments: st.treatments.map((c) => (c.id === treatment.id ? { ...c, serverId } : c)) }));
            }
          })
          .catch(() => {});
      }
    }
    // A treatment created offline needs no pending op: its create is still pending,
    // and flushUnsynced picks it up by serverId == null.
  },
  updateTreatment: (treatment) => {
    const s = get();
    set({ treatments: s.treatments.map((c) => (c.id === treatment.id ? treatment : c)) });
    const conn = s.connection;
    if (!conn || conn.mode !== 'server') return;
    const childServerId = childServerIdFor(s.children, treatment.childId);
    if (!s.offline) {
      if (childServerId != null && treatment.serverId != null) {
        void updateTreatmentOnServer(conn, treatment, childServerId).catch(() => {});
      }
    } else if (treatment.serverId != null) {
      void addPendingOp({ op: 'update', entity: 'treatment', payload: treatment });
    }
  },
  deleteTreatment: (id) => {
    const s = get();
    const treatment = s.treatments.find((c) => c.id === id);
    set({
      treatments: s.treatments.filter((c) => c.id !== id),
      // If the sheet is open on the treatment being deleted, close it.
      treatmentEditor: s.treatmentEditor?.editingId === id ? null : s.treatmentEditor,
    });
    const conn = s.connection;
    if (!treatment || treatment.serverId == null || !conn || conn.mode !== 'server') return;
    if (!s.offline) void deleteTreatmentFromServer(conn, treatment.serverId).catch(() => {});
    else void addPendingOp({ op: 'delete', entity: 'treatment', serverId: treatment.serverId });
  },
  openTreatmentEditor: (id) => set({ treatmentEditor: { editingId: id ?? null } }),
  closeTreatmentEditor: () => set({ treatmentEditor: null }),
  openTreatmentPicker: () => set({ treatmentPicker: { open: true } }),
  closeTreatmentPicker: () => set({ treatmentPicker: null }),
  openMedicationLog: () => {
    const s = get();
    // Scope to the selected child and to treatments whose range covers today; if none,
    // there is nothing to pick from, so skip straight to the manual form rather
    // than opening an empty picker. `s.now` (not the wall clock) keys "today".
    const active = activeTreatmentsForChildToday(s.treatments, s.selectedChildId, startOfDay(s.now));
    if (active.length > 0) set({ treatmentPicker: { open: true } });
    else get().openSheet('medication');
  },
  logMedicationFromTreatment: (treatmentId) => {
    const treatment = get().treatments.find((c) => c.id === treatmentId);
    if (!treatment) return;
    // A treatment always carries a name (the editor requires one), but gate on it the
    // same way save() gates a manual dose so a nameless record can never be seeded.
    if (!treatment.name.trim()) return;
    // Confirm-before-log: seed a fresh point medication draft from the treatment and
    // open the sheet in confirm mode (read-only summary + time picker). No entry
    // is written here; save() commits it once the user confirms. openSheet resets
    // the draft to a blank point medication form, so seed it afterwards.
    get().openSheet('medication');
    const patch: Partial<TimeEntryState> = {
      medName: treatment.name,
      medDosage: treatment.dosage,
      medUnit: treatment.dosageUnit,
      // Only an interval treatment carries a next-dose interval onto the dose; a
      // times-of-day treatment leaves it unset.
      medNextDoseIntervalSec:
        treatment.scheduleMode === 'everyHours' && treatment.everyHours != null ? treatment.everyHours * 3600 : undefined,
    };
    set((s) => ({ treatmentPicker: null, sheet: { type: 'medication', confirm: true }, te: { ...s.te, ...patch } }));
  },
  expandMedicationLog: () => set({ sheet: { type: 'medication' } }),

  setTE: (patch) =>
    set((s) => {
      const next = { ...s.te, ...patch };
      // A feeding's `amount` means millilitres on one side of
      // `feedAmountIsVolume` and an intake level on the other. Changing the feed
      // type or method can move the draft across that line, and the number left
      // behind is meaningless there: an intake of 3 is not 3 ml, and 90 ml is
      // not a level. Clear it so the stale value can never be saved, converted
      // or snapped to the volume step grid as the wrong kind of number.
      //
      // A patch that names an `amount` itself is left alone: it is stating the
      // value for where the draft is landing, so there is nothing stale to drop.
      // Every production caller patches one key at a time (the sheet's chips and
      // scales each set exactly one), so this only comes up for a compound patch,
      // which today means a test setting up a draft in a single call.
      if (
        s.sheet?.type === 'feeding' &&
        ('feedType' in patch || 'method' in patch) &&
        !('amount' in patch) &&
        feedAmountIsVolume(s.te.feedType, s.te.method) !== feedAmountIsVolume(next.feedType, next.method)
      ) {
        next.amount = undefined;
      }
      if ('agoMin' in patch) next.absTime = undefined; // point: a relative pick drops the edit anchor
      // A manual time pick (precise editor, "Now") deselects the "When" anchor,
      // unless the patch itself is that anchor selection.
      if (('agoMin' in patch || 'absTime' in patch) && !('pointAnchor' in patch)) {
        next.pointAnchor = undefined;
      }
      return { te: next };
    }),
  adjustAmount: (dir) =>
    set((s) => ({ te: { ...s.te, amount: stepVolume(s.te.amount ?? 0, dir, s.unitSystem) } })),
  toggleWet: () => set((s) => ({ te: { ...s.te, wet: !s.te.wet } })),
  toggleSolid: () => set((s) => ({ te: { ...s.te, solid: !s.te.solid } })),
  setWash: (wash) => set((s) => ({ te: { ...s.te, wash } })),
  // Manual Nap/Night override for the sleep sheet. No companion "user touched
  // this" flag is needed: the sheet seeds `te.nap` from the window on open and
  // saves whatever `te.nap` holds, so a flip here simply wins.
  setNap: (nap) => set((s) => ({ te: { ...s.te, nap } })),
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
      const next = { ...s.te, endAgoMin: agoMin, endAbs: undefined, endAnchor: undefined, ongoing: false };
      if (ov) {
        next.startAbs = ov.frozen; // freeze the un-nudged start so lasted no longer drives it
        next.startAgoMin = undefined;
        next.order = ov.order;
      } else {
        next.order = reorder(s.te.order, 'end');
      }
      return { te: next };
    }),
  setEndedAbs: (ms, anchor) =>
    set((s) => {
      const ov = overruleLasted(s.te, s.now, 'end');
      const next = { ...s.te, endAbs: ms, endAgoMin: undefined, endAnchor: anchor, ongoing: false };
      if (ov) {
        next.startAbs = ov.frozen; // freeze the un-nudged start so lasted no longer drives it
        next.startAgoMin = undefined;
        next.order = ov.order;
      } else {
        next.order = reorder(s.te.order, 'end');
      }
      return { te: next };
    }),
  // Going live pins the start, because the end becomes "now" and can no longer
  // anchor it. Editing a logged entry, that pin must be the entry's OWN start,
  // not the draft's derived one (see `ongoingStartMs`), so the sheet shows the
  // same instant the resulting timer will carry.
  setOngoing: () =>
    set((s) => {
      const startMs = ongoingStartMs(s.te, s.entries, s.editingId, s.now);
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
      const next = { ...s.te, startAbs: ms, startAnchor: anchor, startAgoMin: undefined, startEdited: true };
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
      const next = { ...s.te, startAbs: undefined, startAgoMin: min, startAnchor: undefined, startEdited: true };
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
    // A medication needs a name to be worth saving — same gate as a note's body
    // (the amount + unit stay optional). No-op and leave the sheet open.
    if (type === 'medication' && !s.te.medName?.trim()) return;
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
    } else if (type === 'medication') {
      // medication (point) — a real Baby Buddy /api/medication/ resource. Name is
      // guaranteed non-empty by the guard above; amount + free-text unit are
      // optional. `nextDoseIntervalSec` is seeded from an interval treatment when the
      // dose was logged from one (else undefined), and is preserved across edits.
      entry = {
        id,
        childId,
        type: 'medication',
        time: teEnd(te, now),
        name: te.medName?.trim() ?? '',
        dosage: te.medDosage,
        dosageUnit: te.medUnit?.trim() || undefined,
        nextDoseIntervalSec: te.medNextDoseIntervalSec,
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
    // Carry `heldBack` across the same way: this branch rebuilds a brand-new
    // entry object per activity type above rather than calling `commitWrite`
    // (which is the only place that STAMPS the flag), so an edit must copy
    // the existing value across rather than leaving it undefined. Never
    // re-derive it from `child.expected` here, that is exactly the inference
    // this field replaced.
    entry.heldBack = existing?.heldBack;

    // A live interval is a running timer, never an entry.
    //
    // On a fresh draft that is the plain "start live timer" path. On an EDIT it
    // is a conversion: the user has told us the activity never ended, so the
    // finished entry is simply wrong and gets REPLACED. Patching it to
    // `end: null` (what this used to fall through to) is not a timer at all,
    // and the API client pushes such an entry as `end: entry.end ?? entry.start`,
    // a zero-length record that the next refresh() then copies back over the
    // local one. So the entry is deleted, on the server too, and a timer
    // carrying the same settings and the same original start takes its place.
    //
    // Undo is transactional (see `undoDelete`): it restores the entry and
    // discards the timer together, so the user can never hold both.
    if (te.ongoing && te.shape === 'interval') {
      // A timer belongs to whoever the record was about, not to whoever happens
      // to be selected. Same rule `stopTimer` follows in reverse.
      const timerChildId = existing?.childId ?? childId;
      const timer = buildTimerFromDraft(
        't' + Date.now(),
        type,
        te,
        ongoingStartMs(te, s.entries, s.editingId, now),
        timerChildId,
      );
      const index = existing ? s.entries.findIndex((e) => e.id === existing.id) : -1;
      set({
        entries: existing ? s.entries.filter((e) => e.id !== existing.id) : s.entries,
        timers: [...s.timers.filter((tm) => tm.id !== s.fromTimerId), timer],
        sheet: null,
        editingId: null,
        fromTimerId: null,
      });
      if (existing) {
        detachEntry(get, set, existing, index, timer.id);
        get().showToast('Replaced with a live timer', { label: 'Undo', run: () => get().undoDelete() });
      } else {
        get().showToast('Live timer started');
      }
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
      // If the pre-edit copy still sits on the offline write queue, rewrite it
      // there too: `flushQueue` pushes whatever the FILE holds without
      // consulting `entries`, so leaving the old copy queued would POST the
      // stale version on reconnect and the next refresh() would silently
      // revert this edit (see `updateQueuedEntry`). Unconditional on purpose:
      // on an empty or missing queue it is a cheap no-op, and gating it on
      // connection state would only add ways to miss the rewrite.
      void updateQueuedEntry(entry).then(({ updated, queue }) => {
        if (updated) set(queueMirror(queue));
      });
      if (s.connection && s.connection.mode === 'server' && !s.offline) {
        const childServerId = childServerIdFor(s.children, entry.childId);
        // No server id for the child: nothing sensible to update server-side,
        // so the local edit stands (same as the offline branch below).
        if (childServerId != null) {
          void updateEntryOnServer(s.connection, entry, childServerId).catch(() => {});
        }
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
      // KNOWN LIMITATION: an explicit "Night sleep" choice on a RUNNING timer is
      // device-local. The cross-device wire format in serverTimers.ts encodes
      // the flag as a bare presence token (`nap` is pushed only when true), so
      // `nap: false` round-trips back as `undefined` and another device
      // re-derives it from its own nap window. Storing it locally is still
      // right: this device honours the choice, and stopping the timer here
      // produces the entry the user asked for. Adding a `night` token would fix
      // it but would change a versioned format that is explicitly frozen, so
      // the encoding is deliberately left alone.
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
  stopTimer: (id) => {
    const s = get();
    const tm = s.timers.find((t) => t.id === id);
    if (!tm) return;
    const saveAs = tm.saveAs;
    const now = Date.now();
    const resolvedEnd = now;
    const savedTags = tm.tags ?? [];
    // A running timer belongs to whoever started it, not whoever happens to be
    // selected when Stop is tapped: the Timers tab deliberately shows every
    // child's timers at once, including a running nap for a born sibling while
    // an expecting child is selected. `tm.childId` is the source of truth once
    // a timer carries one (every creation path stamps it). The `?? ...`
    // fallback only matters for a timer that somehow reached here without
    // one; an expecting child can never be logged against (its `birth` is a
    // due date, not a real one), so that fallback must never resolve to one.
    // Prefer the selected child if it's born, else the first born child on
    // file, else fall through to the selection anyway rather than leaving the
    // timer unstoppable.
    const selected = s.children.find((c) => c.id === s.selectedChildId);
    const childId =
      tm.childId ??
      (selected && !selected.expected ? selected.id : s.children.find((c) => !c.expected)?.id) ??
      s.selectedChildId;
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
      entry = buildSleepEntry(tm, resolvedEnd, childId, {
        startMin: s.napWindowStartMin,
        endMin: s.napWindowEndMin,
      });
    }
    set({ timers: s.timers.filter((t) => t.id !== id), entries: [entry, ...s.entries] });
    get().commitWrite(entry);
    mirrorTimerDelete(get, tm);
    const queued = s.offline && !!s.connection && s.connection.mode === 'server';
    get().showToast(queued ? 'Saved · queued offline' : `Saved as ${ACTIVITY_LABEL[saveAs].toLowerCase()}`);
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

// Persist treatments the same single-path way as timers: a reference change
// (add/update/delete replaces the array) writes the whole list to on-device
// storage. This is persistence ONLY — the server mirror is the treatment actions'
// job, so a serverId stamped by a push lands here through the same subscribe.
// Deliberately NOT cleared on disconnect (see `disconnect`).
useAppStore.subscribe((state, prev) => {
  if (state.treatments !== prev.treatments) void saveTreatments(state.treatments);
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
