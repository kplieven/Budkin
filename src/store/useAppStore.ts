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
  allowsMultipleChildren,
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
  type LoadResult,
  type LoadSlice,
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
import { ApiError, isHiddenTag, normalizeServerUrl } from '@/api/client';
import { nextChildColor } from '@/lib/color';
import { DEMO_TAGS } from '@/data/seed';
import { clearAdoptTarget, loadAdoptTarget, saveAdoptTarget } from '@/data/adoptTarget';
import {
  clearEntities,
  loadEntities,
  loadEntityOrigin,
  saveChildren,
  saveEntityOrigin,
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
import {
  clearPendingPhoto,
  clearPendingPhotoIf,
  clearPendingPhotos,
  loadPendingPhotos,
  setPendingPhoto,
} from '@/data/pendingPhotos';
import type { PendingPhoto } from '@/data/pendingPhotos';
import { discardPhotoFile, reopenPhotoFile, sweepPhotoFiles } from '@/lib/photoFile';
import { loadPrefs, savePrefs } from '@/data/prefs';
import { clearQueue, enqueueEntries, enqueueEntry, loadQueue, removeQueuedEntry, updateQueuedEntry } from '@/data/queue';
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
import { loadBathRhythms, saveBathRhythms } from '@/data/bathRhythm';
import { anchorChildId, isEligibleTarget, sheetTargetIds, targetChildrenLabel } from '@/lib/logTargets';
import { MILESTONE_BY_KEY } from '@/lib/milestones';
import { snapVolume, stepVolume, type UnitSystem } from '@/lib/units';
import type { WashKind } from '@/lib/wash';
import {
  activeTreatmentsForChildToday,
  BATH_RHYTHM_DEFAULT,
  clampBathRhythm,
  clampHourOfDay,
  clampMinuteOfDay,
  entriesForChild,
  isNapStart,
  LAST_FEED_DEFAULT,
  lastFeedForChild,
  legacyBathRhythm,
  NAP_WINDOW_END_DEFAULT,
  NAP_WINDOW_START_DEFAULT,
  nextStartSide,
  overruleLasted,
  reorder,
  RHYTHM_ORIGIN_DEFAULT,
  rhythmForChild,
  startOfDay,
  teEnd,
  teStart,
  washDueState,
} from '@/store/selectors';
import type { ThemeMode } from '@/theme/tokens';
import type {
  ActivityType,
  BathRhythm,
  Child,
  ChildGender,
  Treatment,
  Entry,
  FeedMethod,
  FeedType,
  LastFeed,
  Measurement,
  MeasurementKind,
  MilestoneEntry,
  PhotoChange,
  Profile,
  ServerChild,
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
  /**
   * Bath rhythm per child, keyed by child id. Local only: Baby Buddy has no
   * notion of wash cadence, so this drives the due hints and the log-sheet
   * pre-selection and nothing else. Persisted by src/data/bathRhythm.ts.
   */
  bathRhythms: Record<string, BathRhythm>;
  /**
   * The rhythm used for a child with no stored entry, derived once at hydration
   * from the retired `smallWashesPerBig` pref, or the built-in default when that
   * pref was never written. See `legacyBathRhythm`.
   */
  legacyRhythm: BathRhythm;
  setBathRhythm: (childId: string, patch: Partial<BathRhythm>) => void;
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
  /**
   * Which children the OPEN log sheet will file against, seeded when it opens
   * and cleared with it. More than one means "log for both": `save()` writes one
   * INDEPENDENT entry per id, separately editable and deletable afterwards.
   *
   * Deliberately NOT a field on `sheet`. `sheet` is replaced wholesale and never
   * spread (`openSheet`, `openEdit`, `openTimerEdit`, `logMedicationFromTreatment`
   * and, worst, `expandMedicationLog`), so a target living there would silently
   * reset the moment the user tapped Edit in medication confirm mode. Not on `te`
   * either: `setTE` coerces the feed amount and would have to learn to ignore it.
   *
   * EMPTY means "never seeded", not "nobody": `save()` then falls back to the
   * binding it always had (the edited entry's child, else the source timer's,
   * else the selection). See `sheetTargetIds`.
   */
  sheetChildIds: string[];
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
   *  the id of the treatment being edited. null (the field itself) = closed.
   *  `openedAt` is `s.now` at open: the editor seeds its date fields from it,
   *  so its render stays pure (no `Date.now()` in render, react-hooks/purity)
   *  and the seed is computed against the same clock the rest of the app uses. */
  treatmentEditor: { editingId: string | null; openedAt: number } | null;

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
  /**
   * What each child was last fed, keyed by child id: the seed the feeding sheet
   * opens on. See `LastFeed` for why it is per child. Written by `save()`'s
   * feeding branch, persisted to `budkin.lastFeed.v1`, and topped up by the
   * server load for every child a refresh fetched that has ever been fed (see
   * `mergeLastFeed`).
   */
  lastFeed: Record<string, LastFeed>;
  /**
   * The prefill for a child with no entry of their own, taken once at hydration
   * from the single account-wide value a pre-map build left on the same storage
   * key, or the built-in default when there was none. See `lastFeedForChild`;
   * exactly the `legacyRhythm` arrangement, and for the same reasons.
   */
  legacyLastFeed: LastFeed;
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
  /** `commitWrite` for a whole save at once. Each entry still routes on its own
   *  child (a withheld `expected` one stays local, a child with no serverId
   *  goes to the queue), but everything bound for the queue is handed over in
   *  ONE batched call. See `enqueueEntries` for why that matters. */
  commitWrites: (entries: Entry[]) => void;

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
  /** Re-aim the open sheet at these children. Does NOT touch the global
   *  selection: after saving for a sibling the user stays on whoever they were
   *  on. An empty list is ignored, so a draft can never lose its owner. */
  setSheetChildren: (ids: string[]) => void;
  /** Add or remove one child from the sheet's target set ("log for both").
   *  Removing the last one is a no-op, for the reason `setSheetChildren`
   *  ignores an empty list. */
  toggleSheetChild: (id: string) => void;
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
  /** bath: pick the wash kind (quick/full) */
  setWash: (wash: WashKind) => void;
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
 * selected chip. De-duplicated by name. Structural markers (the bath tags
 * `bath`, `bath:quick`, `bath:full` plus the legacy bare `small`/`big`, and
 * breastfeeding `left`/`right`) are dropped from BOTH sides so they never
 * appear as chips even though they still round-trip on the entries that
 * carry them.
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
 *
 * `localBefore` is the caller's list as it was when the fetch went OUT, and it
 * closes a second hole that `serverId == null` alone cannot. A record created
 * while the request was in flight is in neither side: not in the answer, which
 * predates it, and not in the unsynced set either, because its own push may
 * already have stamped a `serverId` before this apply ran. It was therefore
 * dropped, silently and unrecoverably. Anything absent from the snapshot is by
 * definition newer than the answer, so it is kept.
 *
 * Why not simply keep every local the answer omits: that would resurrect a
 * record genuinely DELETED server-side on every refresh, forever. The snapshot
 * is what tells "created since the fetch" apart from "deleted elsewhere", and
 * without one this behaves exactly as it always did. Same mechanism, and the
 * same reasoning, as `reconcileChildren`'s `localBefore` (0.14.2).
 *
 * Known gap, deliberately not addressed here: an EDIT to an already-synced
 * record made during the same window is still reverted to the answer's older
 * values, because this merge decides per id and the id IS in the answer.
 * `reconcileChildren` handles that case for children by comparing content.
 */
export function mergeUnsynced<T extends { id: string; serverId?: number }>(
  serverList: T[],
  localList: T[],
  localBefore?: T[],
): T[] {
  const serverIds = new Set(serverList.map((r) => r.id));
  // Absent means "no snapshot passed", which is not the same as an empty one:
  // callers without a pre-fetch snapshot (connect, adopt) keep the original
  // rule, rather than having every local record read as created mid-fetch.
  const beforeIds = localBefore && new Set(localBefore.map((r) => r.id));
  const unsynced = localList.filter(
    (r) => !serverIds.has(r.id) && (r.serverId == null || (beforeIds != null && !beforeIds.has(r.id))),
  );
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

/** Field-wise equality for two records of the same child, over the UNION of
 *  their own keys so a key present-but-undefined on one side (`saveChild`
 *  writes `gender: undefined` rather than omitting it) reads equal to an absent
 *  one, and so a field added to `Child` later is compared without this needing
 *  to be revisited. Deliberately not reference equality: an untouched child IS
 *  the same object across an immutable update, but a map() that rebuilds every
 *  child without changing a value is not an edit, and calling it one would
 *  discard a real server-side change. */
function sameChild(a: Child, b: Child | undefined): boolean {
  if (b === undefined) return false;
  if (a === b) return true;
  // `keyof Child` is asserted at the index rather than on the set, because the
  // store's own `type Set` alias (the zustand setter) shadows the global one in
  // every TYPE position in this file. Same reason `carryOverIncomplete` spells
  // its map/set parameters out.
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k as keyof Child] !== b[k as keyof Child]) return false;
  }
  return true;
}

/** Reconcile a server child list onto the local one WITHOUT changing any local
 *  `id`. A child that exists on both sides is matched by `serverId` and the
 *  server's field values win, with two exceptions. The local `id` is preserved,
 *  because entries and measurements reference it and rewriting it would orphan
 *  them; that orphaning is the bug this whole design exists to prevent. And the
 *  local `color` is preserved, because Baby Buddy has no color field at all
 *  (`ServerChild` omits it): the tint is assigned here, once, and persisted, so
 *  the server is definitionally not authoritative for it.
 *
 *  Local children with no `serverId` were never pushed (an offline creation, or
 *  a child deliberately held back) and are kept, prepended, which is where
 *  `mergeUnsynced` put them. Server children the app has not seen are added
 *  with their server-derived id: they never had a local phase, so that id is
 *  already stable. They are also the only children given a fresh tint, picked
 *  against every child that will be in the result rather than against the ones
 *  seen so far, so the tints do not depend on the order the server happened to
 *  list its children in (see `nextChildColor`). A local child whose `serverId`
 *  is absent from the server list was deleted server-side and is dropped,
 *  matching today's behaviour. A never-pushed local whose `id` collides with a
 *  reconciled child's id is dropped too, so the result can never contain
 *  duplicate ids, matching what `mergeUnsynced` guaranteed.
 *
 *  `localBefore` is the caller's PRE-FETCH snapshot of its own child list: what
 *  it held when the request that produced `serverChildren` went out. Anything
 *  that differs from it (or is missing from it entirely) was written while the
 *  fetch was in flight, so the answer in hand was composed BEFORE that write
 *  and cannot be authoritative for it. Such a child keeps its whole local
 *  record and is never dropped as deleted-server-side. This is the child
 *  equivalent of reading the write queue after the fetch (see `refresh`), and
 *  without it a photo, rename or birthday saved while the AppState 'active'
 *  refresh was fetching was silently reverted, and a child created in that
 *  window disappeared outright.
 *
 *  Keeping the WHOLE local record is deliberate, not a shortcut. `id` and
 *  `color` are local by the rules above. `serverId` is the match key, so a
 *  matched child's local and server values are equal by construction and
 *  preserving it can never strand one; an unmatched kept child has no server
 *  value to take. `slug` is the one field the server truly owns (Baby Buddy
 *  DERIVES it from the name and a rename moves it), but the fresh one arrives
 *  on the PATCH response, not on this GET: the local record either already
 *  holds that re-stamp (then it is newer than the answer) or still holds the
 *  slug the server had when the fetch went out (then it is the correct routing
 *  key until the in-flight PATCH answers, which re-stamps it). Taking the
 *  answer's slug instead would overwrite a completed re-stamp with the name it
 *  replaced, which is exactly the stale key that 404s the next rename or
 *  delete.
 *
 *  The cost of keeping the whole record, named: a field the ANSWER carries that
 *  the local record does not have is dropped for this refresh too. The
 *  realistic one is a `slug` for a child `uploadUnsynced` pushed, since its
 *  `pushChild` captures only the new id. That is self-healing and harmless: the
 *  child is no longer mid-fetch by the next refresh, which fills it in, and
 *  until then `childKey` falls back to a `listChildren()` lookup by `serverId`
 *  rather than failing.
 *
 *  A child REMOVED from the local list mid-fetch (`deleteChild`) is the one
 *  case the snapshot does not overturn: the answer still lists it, so it comes
 *  back exactly as it always did, and `deleteChild`'s own failure path is
 *  written around that. The snapshot only supplies the id and tint it comes
 *  back with, which stay the LOCAL ones so a queued entry written against that
 *  child can still resolve its owner.
 *
 *  Omitted, the pre-fetch snapshot IS the local list, so no child reads as
 *  written mid-fetch and every one of them reconciles as it always has. That is
 *  what `connect` and `adopt` pass, having no snapshot to offer: `connect`
 *  takes none because its fetch precedes its local read entirely, `adopt`
 *  because the gap that leaves is accepted (see the note there, which names
 *  what it does not cover). */
export function reconcileChildren(
  serverChildren: ServerChild[],
  localChildren: Child[],
  localBefore: Child[] = localChildren,
): Child[] {
  const localByServerId = new Map<number, Child>();
  for (const c of localChildren) {
    if (c.serverId != null) localByServerId.set(c.serverId, c);
  }
  const serverIds = new Set<number>();
  for (const c of serverChildren) {
    if (c.serverId != null) serverIds.add(c.serverId);
  }
  // Written while the fetch was in flight, so this answer predates it. Matched
  // by local `id`: `serverId` is exactly one of the things a mid-flight push
  // stamps, so it cannot be the key here.
  const beforeById = new Map(localBefore.map((c) => [c.id, c]));
  const writtenMidFetch = (c: Child) => !sameChild(c, beforeById.get(c.id));
  // The mirror case: REMOVED from the local list while the fetch was in flight
  // (`deleteChild`), and still in the answer, which went out before the DELETE
  // did. It is re-added below, as it always has been, but under its old local
  // id: a queued entry written against that child still carries it, and
  // `childServerIdFor` could never resolve a server-derived one again. Empty
  // whenever no snapshot was passed, since every local id is then present.
  const localIds = new Set(localChildren.map((c) => c.id));
  const removedMidFetch = new Map<number, Child>();
  for (const c of localBefore) {
    if (c.serverId != null && serverIds.has(c.serverId) && !localIds.has(c.id)) removedMidFetch.set(c.serverId, c);
  }
  // Every child whose tint is already settled, gathered UP FRONT: the
  // never-pushed locals (always kept) and the locals a server child matches
  // (their color is preserved below). Seeding this from the local list instead
  // of filling it as the map runs is what makes the answer independent of the
  // server's ordering: a matched sibling listed after a new arrival is still
  // visible to it. Locals absent from the server list are deleted server-side,
  // so they are left out and their tint is free again, unless they were written
  // mid-fetch, which the answer is simply too old to know about. The mid-fetch
  // REMOVALS are seeded here too, for the same ordering reason: they come back
  // below wearing the tint they had.
  const assigned: Child[] = [
    ...localChildren.filter((c) => c.serverId == null || serverIds.has(c.serverId) || writtenMidFetch(c)),
    ...removedMidFetch.values(),
  ];
  const reconciled = serverChildren.map((sc) => {
    const local = sc.serverId != null ? localByServerId.get(sc.serverId) : undefined;
    if (local) return writtenMidFetch(local) ? local : { ...sc, id: local.id, color: local.color };
    const removed = sc.serverId != null ? removedMidFetch.get(sc.serverId) : undefined;
    if (removed) return { ...sc, id: removed.id, color: removed.color };
    // Only a genuinely new child needs a tint, and only it joins `assigned`:
    // the matched ones are already in there, and counting them twice would
    // skew `nextChildColor`'s least-used fallback.
    const child: Child = { ...sc, color: nextChildColor(assigned) };
    assigned.push(child);
    return child;
  });
  const reconciledIds = new Set(reconciled.map((c) => c.id));
  // Locals the server list did not account for: never pushed, or written while
  // the fetch was in flight (a create the answer went out too early to list, a
  // still-unacknowledged edit to a child deleted elsewhere). Prepended, which
  // is where the never-pushed ones have always gone.
  const kept = localChildren.filter(
    (c) => !reconciledIds.has(c.id) && (c.serverId == null || writtenMidFetch(c)),
  );
  return [...kept, ...reconciled];
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
 *  covers `Timer`, whose `childId` can be genuinely absent (see
 *  `stampTimerOwners`); entries and measurements always carry one. */
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

/**
 * Give an owner to timers persisted before every creation path stamped one.
 *
 * `Timer.childId` stays OPTIONAL: `budkin.pendingOps.v1` persists whole `Timer`
 * payloads and AsyncStorage JSON is cast, never validated, so a required type
 * would only be a lie about what is already on disk. The read sites stopped
 * adopting an unowned timer (see `timerBelongsTo`), which is why the stamping
 * has to happen here, once, on load: an unowned timer is otherwise invisible on
 * every per-child surface.
 *
 * Runs in `hydrate`, not in `loadTimers`, because `loadTimers` is a read with no
 * access to the child list or the selection. The persistence subscription writes
 * the stamped list back, so a migrated launch leaves nothing for the next one.
 *
 * `hydrate` is the ONLY stamping site, deliberately, and that makes the window
 * wider than "one launch". Two other paths put disk timers into state with a
 * roster already in hand and do not stamp: `connect()` (whose `applyServerLoad`
 * keeps `serverId == null` timers verbatim through `reconcileTimers`) and
 * `enterLocal()` (which never touches `timers` at all). `hydrate`'s own
 * no-connection branch reads no entity store, so it has nobody to stamp with
 * either. So after a session expiry, a cold start leaves a legacy timer
 * unstamped and reconnecting does not fix it: the real window is until the next
 * cold start that has a connection AND a born child selected. Nothing is lost
 * meanwhile, since an unstamped timer stays visible and stoppable on the Timers
 * tab (which filters by nothing) and `stopTimer` resolves its owner itself.
 *
 * The owner is the SELECTED child and only when that child is born, mirroring
 * `stopTimer`'s refusal to log against an `expected` child (whose `birth` is a
 * due date, not a real one). Anything else is left unstamped rather than guessed
 * at, and NOTHING is ever dropped: that keeps the migration lossless and
 * idempotent, and `stopTimer`'s own fallback chain still resolves a leftover.
 *
 * Returns the input array untouched when there is nothing to stamp, so a launch
 * with no legacy timers does not churn the reference.
 *
 * Deliberately does NOT touch queued `{op:'update', entity:'timer'}` payloads in
 * `budkin.pendingOps.v1`: `removePendingOp` matches ops by `JSON.stringify`, and
 * `updateTimerOnServer` sends only `serverId`, the encoded name and `start`, so
 * a stamp there would risk breaking removal to change nothing on the wire.
 */
function stampTimerOwners(timers: Timer[], children: Child[], selectedChildId: string): Timer[] {
  if (!timers.some((t) => t.childId == null)) return timers;
  const selected = children.find((c) => c.id === selectedChildId);
  if (!selected || selected.expected) return timers;
  return timers.map((t) => (t.childId == null ? { ...t, childId: selected.id } : t));
}

/** Lay a server-loaded feeding prefill over the local one, translating its keys
 *  out of the SERVER's child id space the way `remapChildIds` translates a
 *  record's `childId`, and for the same reason: the load has no local state to
 *  consult. Must run AFTER `reconcileChildren`, on its output.
 *
 *  Merged, never replaced. A load now covers every child, but it still answers
 *  only for those that have ever been fed: a child with no feeds is ABSENT from
 *  the incoming map rather than keyed to a default, so replacing would wipe the
 *  prefill of every never-fed child on each refresh. It also answers for no
 *  child at all whose feeding slice degraded. An empty answer therefore changes
 *  nothing and returns the same reference, so the persistence subscription
 *  doesn't rewrite the key on every refresh. */
function mergeLastFeed(
  local: Record<string, LastFeed>,
  incoming: Record<string, LastFeed>,
  children: Child[],
): Record<string, LastFeed> {
  const entries = Object.entries(incoming);
  if (entries.length === 0) return local;
  const localIdByServerId = new Map<string, string>();
  for (const c of children) {
    if (c.serverId != null) localIdByServerId.set(String(c.serverId), c.id);
  }
  const merged = { ...local };
  for (const [childId, draft] of entries) merged[localIdByServerId.get(childId) ?? childId] = draft;
  return merged;
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
    // A child pushed here may owe the server a photo: one picked while offline,
    // or picked for a child the server had never seen. The record is settled
    // only on a push that actually landed, so a failure retries with the photo
    // still attached, and only if it is still the record this push consumed: a
    // photo re-picked DURING the POST is a new record that this push never
    // carried. The picture is reported back only when one was uploaded, so a
    // `null` from a photoless POST can never blank a local file path.
    pushChild: async (c) => {
      const { change, consumed } = await pendingPhotoChange(c.id);
      const res = await pushChildToServer(conn, c, change);
      if (res?.id != null && consumed) await settlePendingPhoto(c.id, consumed);
      return { id: res?.id, picture: change.kind === 'set' ? (res?.picture ?? undefined) : undefined };
    },
    pushEntry: (e, childServerId) => pushEntryToServer(conn, e, childServerId),
    pushMeasurement: (m, childServerId) => pushMeasurementToServer(conn, m, childServerId),
    pushTreatment: (c, childServerId) => pushTreatmentToServer(conn, c, childServerId),
  };
}

/**
 * Record what a child owes the server, for a save that will not upload the
 * photo itself. Called only when the change is durable: a cache URI recorded
 * here would name a file Android can reclaim before the reconnect.
 *
 * A removal always REPLACES whatever was recorded, never adds to it. On a
 * server-backed child it becomes `{kind:'remove'}`, because the server has to
 * be told; on a child the server has never seen it clears the record instead,
 * because the create that eventually pushes that child carries no photo
 * anyway. Getting this wrong is a live bug rather than a tidiness point: pick a
 * photo offline, then remove it offline, and a stale `set` would upload the
 * photo the user just deleted.
 *
 * The file a record replaces is discarded here rather than left to the launch
 * sweep, so re-picking ten times offline does not hold ten files.
 */
async function recordPendingPhoto(childId: string, change: PhotoChange, serverBacked: boolean): Promise<void> {
  const prev =
    change.kind === 'set'
      ? await setPendingPhoto(childId, {
          kind: 'set',
          uri: change.photo.uri,
          name: change.photo.name,
          type: change.photo.type,
        })
      : serverBacked
        ? await setPendingPhoto(childId, { kind: 'remove' })
        : await clearPendingPhoto(childId);
  if (prev?.kind === 'set' && !(change.kind === 'set' && change.photo.uri === prev.uri)) {
    await discardPhotoFile(prev.uri);
  }
}

/**
 * The PhotoChange a deferred push should carry for this child, reopened from
 * the recorded path, together with the RECORD that change was read from.
 *
 * The record travels with the change because every consumer awaits a network
 * round trip before settling, and the settle has to be able to tell the record
 * it consumed from one written during that round trip. See
 * `settlePendingPhoto`. `consumed` is present exactly when `change.kind` is not
 * `'none'`, so a caller can guard on either.
 *
 * A recorded `set` whose file has gone missing also answers `{kind:'none'}`,
 * and drops the record on the way out: pushing the child without the photo at
 * least lands the name and birthday, and no retry can bring the file back. A
 * document-directory file going missing has no ordinary cause, which is why
 * this is silent rather than a toast. Nothing is reported as consumed there,
 * because the record is already dealt with here.
 */
async function pendingPhotoChange(
  childId: string,
): Promise<{ change: PhotoChange; consumed: PendingPhoto | undefined }> {
  const rec = (await loadPendingPhotos())[childId];
  if (rec == null) return { change: { kind: 'none' }, consumed: undefined };
  if (rec.kind === 'remove') return { change: { kind: 'remove' }, consumed: rec };
  const photo = reopenPhotoFile(rec);
  if (!photo) {
    await settlePendingPhoto(childId, rec);
    return { change: { kind: 'none' }, consumed: undefined };
  }
  return { change: { kind: 'set', photo }, consumed: rec };
}

/**
 * Finished with this child's pending photo: drop the record and the file.
 * Called only where the answer is final, a confirmed upload or a target that
 * is gone server-side, never on a retryable failure.
 *
 * Pass the record the caller CONSUMED whenever there is one. Every consumer
 * reads the record, awaits a round trip, then settles, and a re-pick during
 * that window writes a new record: clearing unconditionally would delete a
 * photo that was never uploaded, file and all, which is the one thing this
 * store exists to prevent. Compare-and-clear leaves such a record alone, and
 * the next push carries it.
 *
 * The unconditional form is for callers that mean "this child is gone, drop
 * whatever is there": `deleteChild`, and a replay that 404s.
 */
async function settlePendingPhoto(childId: string, consumed?: PendingPhoto): Promise<void> {
  const gone = consumed ? await clearPendingPhotoIf(childId, consumed) : await clearPendingPhoto(childId);
  if (gone?.kind === 'set') await discardPhotoFile(gone.uri);
}

/**
 * Delete every stored photo file nothing points at any more: neither a child's
 * `picture` nor a pending record. Collects the orphans no single call site can,
 * a sheet cancelled after picking, a crash between the copy and the save, a
 * record dropped because its child turned out to be gone server-side.
 *
 * Only a `file:` picture is a candidate to keep; a server URL names nothing on
 * this device.
 */
async function sweepChildPhotos(children: Child[]): Promise<void> {
  const keep: string[] = [];
  for (const c of children) {
    if (c.picture && c.picture.startsWith('file:')) keep.push(c.picture);
  }
  for (const rec of Object.values(await loadPendingPhotos())) {
    if (rec.kind === 'set') keep.push(rec.uri);
  }
  await sweepPhotoFiles(keep);
}

type Get = StoreApi<AppStore>['getState'];
type Set = StoreApi<AppStore>['setState'];

/**
 * A server load's degraded slices (see `LoadResult.incompleteSlices`) put into
 * LOCAL child id space: which of each child's record slices came back as a
 * FLOOR rather than an answer because their fetch failed. Those rows must be
 * kept rather than replaced, exactly as a null `timers` keeps the on-device
 * timers.
 *
 * An absent map names nobody: it means every slice of every fetched child came
 * back whole, which is the field's own contract and what lets a caller that
 * cannot degrade say nothing at all. A load names only children it FETCHED and
 * failed for, so a sibling it skipped is never in here; what happens to a
 * sibling's records is a separate question from this one.
 *
 * Keyed by `serverId` against the reconciled list, the way `remapChildIds`
 * translates an incoming record's `childId`. A named child absent from that
 * list (deleted server-side mid-request) has nothing left to protect and is
 * dropped.
 */
function degradedSlicesByChild(
  incompleteSlices: LoadResult['incompleteSlices'],
  reconciledChildren: Child[],
): ReadonlyMap<string, ReadonlySet<LoadSlice>> {
  const out = new Map<string, ReadonlySet<LoadSlice>>();
  if (incompleteSlices == null) return out;
  for (const c of reconciledChildren) {
    if (c.serverId == null) continue;
    const slices = incompleteSlices[String(c.serverId)];
    if (slices != null && slices.length > 0) out.set(c.id, new Set(slices));
  }
  return out;
}

/**
 * Keep the rows this device already holds for a child's DEGRADED slices (see
 * `degradedSlicesByChild`) rather than letting the load's empty answer for
 * them through. Without this, one timed-out per-type request empties that
 * slice in state, and the persistence subscription then has `saveEntries`
 * delete the month chunks the emptying just produced.
 *
 * Kept, deliberately NOT unioned with whatever the load did return for the
 * slice: a union would keep a record deleted in Baby Buddy's own UI alive for
 * as long as that slice kept coming back degraded, while keeping the rows is
 * one refresh late and no more. Again exactly what a null `timers` does.
 *
 * A degraded slice the device holds NO rows for is taken as-is. Nothing is on
 * disk there for an empty answer to delete, so accepting it is strictly safer
 * than discarding rows the server did return. This arm changes nothing under
 * today's producer, which empties a degraded slice completely: the answer has
 * no rows in it to discard either, so per-slice granularity alone is what
 * keeps a first connect to a server with one permanently failing endpoint from
 * opening blank. It is here for the producer that returns PARTIAL rows for a
 * degraded slice (a fetch that fails one page of several), which is where
 * discarding them would blank a first connect for real.
 *
 * `previous` may hold rows the merged list has too (callers fold the write
 * queue into both), so a row already present is skipped rather than
 * duplicated. Returns the input untouched when there is nothing to protect, so
 * an ordinary load does not churn the reference.
 *
 * Exported for its own unit tests, like the merge helpers above. Two arms of
 * this contract cannot be reached through today's producer, which empties a
 * slice completely whenever it degrades, so no answer of its ever carries a
 * row in a degraded slice: "kept, not unioned" and "taken as-is when nothing
 * is held" both need one that does. Fanning the load out to every child did
 * NOT unlock them, and could not have: a slice is degraded per (child, slice)
 * pair, so siblings never share a verdict however many of them there are. What
 * would unlock them is a producer that answers PARTIALLY within one slice, such
 * as a per-page failure inside a paginated fetch. The unit tests pin both arms
 * anyway, because that producer is not the contract.
 */
export function carryOverIncomplete<T extends { id: string; childId: string }>(
  merged: T[],
  previous: T[],
  // `ReadonlyMap`/`ReadonlySet`, not `Map`/`Set`: the store's own `type Set`
  // alias (the zustand setter, above) shadows the global one for every TYPE
  // position in this file.
  degradedSlices: ReadonlyMap<string, ReadonlySet<LoadSlice>>,
  sliceOf: (record: T) => LoadSlice,
): T[] {
  if (degradedSlices.size === 0) return merged;
  const sliceKey = (r: T) => `${r.childId} ${sliceOf(r)}`;
  const degraded = (r: T) => degradedSlices.get(r.childId)?.has(sliceOf(r)) === true;
  // The (child, slice) pairs that are degraded AND populated on this device. A
  // degraded slice missing from here is one there is nothing to protect in.
  const held = new Set<string>();
  for (const r of previous) if (degraded(r)) held.add(sliceKey(r));
  if (held.size === 0) return merged;
  const frozen = (r: T) => degraded(r) && held.has(sliceKey(r));
  const out = merged.filter((r) => !frozen(r));
  const seen = new Set(out.map((r) => r.id));
  for (const r of previous) {
    if (!frozen(r) || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Apply a successful `loadFromServer` result over the local view of the same
 * data, as ONE `set()`: reconcile children by `serverId` so local ids survive
 * (see `reconcileChildren`), remap incoming child references into local id
 * space (`remapChildIds`), merge back everything the server cannot know about
 * (queued + held-back entries, unsynced measurements, on-device treatments),
 * resolve the selected child, and null-guard the timers answer.
 *
 * This is THE post-fetch apply step: `refresh()` runs it on every warm
 * reload, `hydrate()` reaches it through the background `refresh()` it fires,
 * and `connect()` runs it so a reconnect after a session expiry cannot
 * replace local-id children with server-shaped ones, which used to strand
 * every queued entry whose `childId` only the local list could resolve
 * (`childServerIdFor` missed forever), and dropped local-only running timers
 * and unsynced measurements the same wholesale way. With no local data at all
 * (a fresh connect) every merge input is empty and this degrades to taking
 * the server load as-is, which is exactly what a first connect should do.
 *
 * `local` is the caller's not-yet-reconciled local side: in-memory state for
 * a warm `refresh()`, in-memory or entity-store state for `connect()` (memory
 * is empty after a post-expiry cold start). Both callers gather it after their
 * fetch rather than from a snapshot taken before it, for the reason `local.q`
 * (the write queue) spells out: a record written while the request was in
 * flight is in neither the answer nor a pre-fetch snapshot, so applying the
 * answer over such a snapshot loses it. "After the fetch" is the rule, not "at
 * the instant of the apply": `connect` still has several storage awaits to go
 * when it reads, and `refresh` deliberately reads `local.timers` from on-device
 * storage BEFORE its fetch, so a widget start/stop reconciles even when the
 * server is unreachable (see `refresh`). `local.childrenBefore` is the one
 * input that is deliberately pre-fetch, and only `refresh` has one: it is what
 * tells a mid-flight child write apart from a server-side change (see
 * `reconcileChildren`). `extra` carries the caller's own connection-lifecycle
 * keys, merged into the same `set()` so subscribers see one atomic update.
 */
function applyServerLoad(
  set: Set,
  data: LoadResult,
  local: {
    children: Child[];
    entries: Entry[];
    measurements: Measurement[];
    treatments: Treatment[];
    selectedChildId: string;
    timers: Timer[];
    lastFeed: Record<string, LastFeed>;
    q: Entry[];
    /** The caller's child list as it was when the fetch went out, when that
     *  differs from `children` above. Only `refresh` has one: it is the only
     *  caller that snapshots before fetching. See `reconcileChildren`. */
    childrenBefore?: Child[];
    /** The same, for measurements, and for the same reason: it is what tells a
     *  record created while the request was in flight apart from one deleted
     *  server-side. See `mergeUnsynced`. */
    measurementsBefore?: Measurement[];
  },
  extra: Partial<AppState> = {},
): void {
  // Children are reconciled by `serverId`, not merged: a child already known
  // to the server keeps its local id (entries/measurements reference it), and
  // a child created offline (serverId == null) is kept under its local id
  // too. A child written while the fetch was in flight keeps its local record
  // whole, since this answer predates that write. See `reconcileChildren`.
  const reconciledChildren = reconcileChildren(data.children, local.children, local.childrenBefore);
  // Incoming entries/measurements/timers carry the SERVER's child id; rewrite
  // it to the local id now that reconciliation has produced the authoritative
  // mapping. See `remapChildIds`.
  const remappedEntries = remapChildIds(data.entries, reconciledChildren);
  const remappedMeasurements = remapChildIds(data.measurements, reconciledChildren);
  // The record slices this load emptied rather than answered for (see
  // `LoadResult.incompleteSlices`); `applied` is the rest of the load, which
  // the spread below lands in state. Destructured apart because that metadata
  // is not an `AppState` key and must not ride the spread into the store.
  const { incompleteSlices, ...applied } = data;
  // Each of the three record merges below keeps the device's own rows for a
  // degraded slice instead of taking the floor the load returned.
  const degradedSlices = degradedSlicesByChild(incompleteSlices, reconciledChildren);
  // Keep the caller's current selection if it's still visible, checked
  // against the RECONCILED list (not just the server's) so a local child kept
  // visible by reconcileChildren above doesn't get silently deselected;
  // otherwise fall back to the server's first child, resolved into local id
  // space (see `resolveSelectedChildId`).
  const selectedChildId = reconciledChildren.some((c) => c.id === local.selectedChildId)
    ? local.selectedChildId
    : resolveSelectedChildId(reconciledChildren, data.selectedChildId);
  set({
    ...extra,
    ...applied,
    children: reconciledChildren,
    // Measurements created offline are pushed by `flushUnsynced`; until that
    // flush lands, merging the local unsynced ones back in is what keeps a
    // wholesale reload from dropping them from view (and from the entity
    // store, via the persistence subscription). Entries are deliberately
    // excluded from that merge (see
    // `mergeUnsynced`'s doc comment): the queue merge below is entries' only
    // source, further merged by `mergeHeldBackEntries` for an expecting
    // child's held-back entries.
    measurements: carryOverIncomplete(
      mergeUnsynced(remappedMeasurements, local.measurements, local.measurementsBefore),
      local.measurements,
      degradedSlices,
      (m) => m.kind,
    ),
    entries: carryOverIncomplete(
      mergeHeldBackEntries(mergeQueuedEntries(remappedEntries, local.q), local.entries, reconciledChildren),
      // What this device holds is state PLUS the write queue, which callers
      // read after the fetch: an entry logged while the request was in flight
      // is in neither the state snapshot nor a floor of an answer, and dropping
      // it here would be the very loss this guard exists to prevent.
      [...local.q, ...local.entries],
      degradedSlices,
      (e) => e.type,
    ),
    treatments: carryOverIncomplete(
      mergeTreatments(data.treatments, local.treatments, reconciledChildren),
      local.treatments,
      degradedSlices,
      () => 'treatment',
    ),
    selectedChildId,
    // A null `timers` is "the fetch failed, unknown" (see
    // `LoadResult.timers`), not "none running": keep the on-device copy
    // untouched instead of reconciling against an answer we never got, which
    // would drop every running synced timer as stopped elsewhere. This
    // explicit key must stay AFTER the `...data` spread above, so the null
    // never reaches state. Timers are remapped only when non-null (there is
    // nothing to remap in the null case).
    timers:
      data.timers == null
        ? local.timers
        : reconcileTimers(local.timers, remapChildIds(data.timers, reconciledChildren)),
    // Another key that must stay AFTER the `...data` spread, for a different
    // reason than `timers`: the answer is right but PARTIAL. It names only the
    // children that have ever been fed, so spreading it wholesale would drop the
    // prefill of every child who has not, and of any child whose feeding slice
    // degraded. See `mergeLastFeed`, which also puts the incoming keys into
    // local id space.
    lastFeed: mergeLastFeed(local.lastFeed, data.lastFeed, reconciledChildren),
  });
}

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
  // The timer's own owner, with no fallback to the selection: every creation
  // path stamps one, and pushing an unowned timer under whoever is selected
  // would put the misattribution on the SERVER, where undoing it costs another
  // round trip.
  const child = s.children.find((c) => c.id === timer.childId);
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

/**
 * The three CHILD-scoped seeds a feeding draft opens on: what this child was
 * last fed, and which breast comes next.
 *
 * One function so `openSheet`, `openTimerEdit` and a re-aim cannot arrive at
 * different answers for the same child. `method` is the alternated side, which
 * is why the last feed's own method is not simply echoed back.
 */
function feedingSeeds(
  s: Pick<AppState, 'entries' | 'lastFeed' | 'legacyLastFeed'>,
  childId: string | undefined,
): { feedType: FeedType; method: FeedMethod; startSide: 'left' | 'right' } {
  const last = lastFeedForChild(s.lastFeed, childId, s.legacyLastFeed);
  return {
    feedType: last.feedType || 'breast',
    method: last.method === 'left' ? 'right' : last.method === 'right' ? 'left' : last.method || 'left',
    startSide: nextStartSide(entriesForChild(s.entries, childId)),
  };
}

/**
 * The draft the sheet should hold once it has been re-aimed at `ids`, or null
 * when nothing needs to move.
 *
 * Two activities carry CHILD-scoped seeds: a bath's suggested wash, from that
 * child's own rhythm and bath history, and a feeding's type, method and start
 * side, from what that child was last fed. Re-aiming the sheet changes whose
 * history applies, so the suggestions have to follow, the same way the
 * time-entry anchor chips do. Leaving them behind offers Mira's suggestion as
 * Ivo's and the sheet SAVES it, which is the hazard `LastFeed` describes; a
 * breastfed twin and a bottle-fed one have genuinely different right answers.
 * (A sleep draft's nap flag looks similar and is not: the nap window is
 * global.)
 *
 * "Recompute the derived surfaces, leave the user's own choices alone" cuts both
 * ways, hence four guards. The `*Edited` flags mean the parent has already
 * picked, and a suggestion must never overrule a decision; they are per field,
 * so choosing a feed type does not freeze the method and the side on the
 * previous child. An EDIT holds the RECORD's own values, not suggestions, so
 * re-aiming an edit moves the record without rewriting what it says happened. A
 * TIMER-EDIT holds the timer's, which are choices made when the timer was
 * started and carry no edited flag of their own; the picker hides itself there
 * (`canRetarget` in LogSheet), and this is the same rule held in the store. And
 * a multi-target draft has no single history to read, so whatever the draft
 * already holds stands: nothing is recomputed, rather than recomputed to a
 * default.
 */
/** Point the open sheet at `ids`, carrying any child-scoped seed along with it.
 *  The one write path for the target, so `setSheetChildren` and
 *  `toggleSheetChild` cannot re-aim on different terms. */
function aimSheetAt(get: Get, set: Set, ids: string[]): void {
  const te = reseedTargetScopedDraft(get(), ids);
  set(te ? { sheetChildIds: ids, te } : { sheetChildIds: ids });
}

function reseedTargetScopedDraft(s: AppStore, ids: string[]): TimeEntryState | null {
  if (s.editingId || s.fromTimerId || ids.length !== 1) return null;
  const childId = ids[0];
  if (s.sheet?.type === 'bath') {
    if (s.te.washEdited) return null;
    const wash = washDueState(
      entriesForChild(s.entries, childId),
      rhythmForChild(s.bathRhythms, childId, s.legacyRhythm),
      s.now,
    ).nextKind;
    return wash === s.te.wash ? null : { ...s.te, wash };
  }
  if (s.sheet?.type === 'feeding') {
    const seeds = feedingSeeds(s, childId);
    const next: TimeEntryState = { ...s.te };
    if (!s.te.feedTypeEdited) next.feedType = seeds.feedType;
    if (!s.te.methodEdited) next.method = seeds.method;
    if (!s.te.startSideEdited) next.startSide = seeds.startSide;
    if (next.feedType === s.te.feedType && next.method === s.te.method && next.startSide === s.te.startSide) {
      return null;
    }
    // The same stale-amount hazard `setTE` guards, reached by another door: the
    // field means millilitres on one side of `feedAmountIsVolume` and an intake
    // level on the other, and this re-seed can move the draft across that line.
    // An intake of 3 is not 3 ml, so drop it rather than let it be saved,
    // converted or snapped to the volume grid as the wrong kind of number.
    if (feedAmountIsVolume(s.te.feedType, s.te.method) !== feedAmountIsVolume(next.feedType, next.method)) {
      next.amount = undefined;
    }
    return next;
  }
  return null;
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

/**
 * The write queue's twin of `scheduleUnsyncedTimerFlush` above, and it exists
 * for the same reason.
 *
 * `commitWrite` makes a rejected push DURABLE (`enqueueEntry`), which the
 * comment on the timer chain counted as entries already having "a fallback".
 * Durable is not delivered: nothing DRAINS the queue except hydrate, refresh,
 * and the offline/network transitions. So a write the server refused at the
 * moment it was made sat on the queue, with the History row marked "waiting to
 * upload", until the user happened to pull to refresh.
 *
 * Stopping a timer is where that bites hardest: the entry's `end` is exactly
 * `Date.now()`, and the stop fires a second write (the timer DELETE) alongside
 * it, so the first attempt is the one most likely to be refused and the same
 * payload then succeeds seconds later.
 *
 * Bounded on the same terms as the timer chain: after the last delay the
 * ordinary paths take over, so a server that stays broken cannot keep a chain
 * spinning for the life of the process, and the next write refreshes the budget.
 */
const QUEUE_RETRY_DELAYS_MS = [2000, 8000, 30000];
let queueRetryAttempt = 0;
let queueRetryHandle: ReturnType<typeof setTimeout> | undefined;

function scheduleQueueFlush(get: Get): void {
  if (queueRetryHandle || queueRetryAttempt >= QUEUE_RETRY_DELAYS_MS.length) return;
  const delay = QUEUE_RETRY_DELAYS_MS[queueRetryAttempt];
  queueRetryAttempt += 1;
  queueRetryHandle = setTimeout(() => {
    queueRetryHandle = undefined;
    const s = get();
    // Offline or no longer on a server: `setNetworkOnline`/`setOffline` already
    // flush on the way back up, so stand down rather than spend attempts here.
    if (!s.connection || s.connection.mode !== 'server' || s.offline) {
      queueRetryAttempt = 0;
      return;
    }
    if (s.queueCount === 0) {
      queueRetryAttempt = 0;
      return;
    }
    // `flushQueue` swallows its own per-entry failures and resolves either way,
    // so the re-arm decision is the queue count, not a rejection.
    void s.flushQueue().finally(() => {
      if (get().queueCount > 0) scheduleQueueFlush(get);
      else queueRetryAttempt = 0;
    });
  }, delay);
}

/** Drop any scheduled queue retry. Tests only, same reason as the timer twin. */
export function resetQueueRetryForTests(): void {
  if (queueRetryHandle) clearTimeout(queueRetryHandle);
  queueRetryHandle = undefined;
  queueRetryAttempt = 0;
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
  bathRhythms: {},
  legacyRhythm: BATH_RHYTHM_DEFAULT,
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
  sheetChildIds: [],
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
  lastFeed: {},
  legacyLastFeed: LAST_FEED_DEFAULT,
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
  setBathRhythm: (childId, patch) => {
    // Clamp before storing so a bad value can never reach persistence, and so
    // the number shown in Settings is the one the rhythm actually uses. The
    // child's current rhythm is the fallback, so a patch touching one axis
    // cannot reset the other.
    const s = get();
    const current = rhythmForChild(s.bathRhythms, childId, s.legacyRhythm);
    const next = clampBathRhythm({ ...current, ...patch }, current);
    const map = { ...s.bathRhythms, [childId]: next };
    set({ bathRhythms: map });
    void saveBathRhythms(map);
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
    // The retired per-app rhythm pref, read once to derive the fallback for a
    // child with nothing of their own. `!= null`, not a truthy guard: it is a
    // number and a truthy check would discard a legitimately stored 1.
    set({ legacyRhythm: legacyBathRhythm(prefs.smallWashesPerBig ?? undefined) });
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
    set({ bathRhythms: await loadBathRhythms() });
    // Treatments are user data that survives disconnect, so load the on-device copy
    // unconditionally here, exactly like timers below. In server mode this is
    // the offline cache the freshly-loaded server list merges on top of (see
    // `mergeTreatments`); in local mode it is the only copy.
    set({ treatments: await loadTreatments() });
    // Running timers are local-only (the server has no matching record), so
    // restore them from on-device storage regardless of how the rest of the
    // state is loaded below. `stampTimerOwners` then gives an owner to any that
    // predate `childId` stamping, per branch rather than here: the child list
    // and the selection it needs only exist once the entity store has been read,
    // which each branch below does for itself.
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
      // No entity store is read on this branch, so there is no roster and no
      // selection: an ownerless timer stays ownerless until a later hydrate has
      // something to attribute it to.
      set({ hydrating: false, ...queueMirror(q), timers: savedTimers });
      // Collect the photo copies nothing points at any more. Off the critical
      // path: hydrate's contract is "the UI can render".
      void sweepChildPhotos(get().children);
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
        lastFeed: e?.lastFeed ?? {},
        legacyLastFeed: e?.legacyLastFeed ?? LAST_FEED_DEFAULT,
        timers: stampTimerOwners(savedTimers, e?.children ?? [], e?.selectedChildId ?? ''),
        ...queueMirror(q),
      });
      // Collect the photo copies nothing points at any more. Off the critical
      // path: hydrate's contract is "the UI can render".
      void sweepChildPhotos(get().children);
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
      lastFeed: saved?.lastFeed ?? {},
      legacyLastFeed: saved?.legacyLastFeed ?? LAST_FEED_DEFAULT,
      timers: stampTimerOwners(savedTimers, saved?.children ?? [], saved?.selectedChildId ?? ''),
      ...queueMirror(q),
    });
    // refresh() IS the fetch-reconcile-merge-flush pipeline, so reuse it
    // rather than duplicating its body here: its 401/403 branch clears the
    // connection and sets the 'Session expired' connectError (routing reacts
    // a moment after the UI appears, the same UX a warm-session 401 already
    // has), its unreachable branch sets `offline: true`, and its
    // `timers: null` guard keeps running timers when only the timers fetch
    // failed. It reads `s.children`/`s.selectedChildId` to nominate the
    // preferred child, which the set() above just populated from the entity
    // store, so the persisted selection survives the load; keep that ordering.
    // It no longer steers WHICH children are fetched (they all are), so this is
    // now about the selection alone. Deliberately not awaited: hydrate's
    // contract is now "the UI can render", not "the server has answered".
    void get().refresh();
    // Collect the photo copies nothing points at any more. Off the critical
    // path: hydrate's contract is "the UI can render".
    void sweepChildPhotos(get().children);
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
      // Every child's records come back, not just the selected one's (see
      // `loadFromServer`). The id passed here no longer steers the fetch: it is
      // only what the answer nominates as its `selectedChildId`, and it is null
      // for a child that was never pushed, which keeps the old children[0]
      // fallback. `applyServerLoad` prefers the caller's own selection over it
      // anyway whenever that child is still visible.
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
      // The whole reconcile-and-merge is `applyServerLoad` (shared with
      // `connect`); this warm reload's local side is in-memory state. The
      // held-back entries the merge re-adds are already in `cur.entries`: this
      // is a warm reload, not a cold restart, so nothing reads the entity
      // store here.
      //
      // Read at APPLY time, not from the pre-fetch `s` above, for the same
      // reason the queue is read after the fetch: everything written while
      // the request was in flight is missing from that snapshot, and applying
      // the answer over it silently undoes the write. Returning from the OS
      // image picker is exactly this window (it backgrounds the app, and
      // AppState 'active' fires this refresh), which is how "updating a
      // child's photo does nothing" happened. There is no await between here
      // and the `set()` inside, so this IS the state the update lands on.
      // Nothing doubles as a result: every helper that receives one of these
      // `local.*` lists skips a record whose id the merged list already has
      // (`mergeUnsynced`, `mergeHeldBackEntries`, `carryOverIncomplete`).
      // `mergeQueuedEntries` does no de-duplication at all, but it is handed
      // `q`, not state, and its own doc explains why none is needed there.
      const cur = get();
      applyServerLoad(
        set,
        data,
        {
          children: cur.children,
          // What the child list held when the fetch went out: the difference
          // is the mid-flight write to preserve (see `reconcileChildren`).
          childrenBefore: s.children,
          entries: cur.entries,
          measurements: cur.measurements,
          // The same snapshot, for the same reason. A measurement saved during
          // this request whose push stamped a `serverId` before the apply is in
          // neither the answer nor the unsynced set, so without this it is
          // dropped outright (see `mergeUnsynced`).
          measurementsBefore: s.measurements,
          treatments: cur.treatments,
          selectedChildId: cur.selectedChildId,
          timers: localTimers,
          lastFeed: cur.lastFeed,
          q,
        },
        { connected: true, offline: false, networkOnline: true },
      );
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
      // Reconcile the server load with whatever this device already holds
      // instead of taking `...data` wholesale. The case that bites: a session
      // expiry (refresh's 401 branch) clears the connection but not the local
      // data, and the user reconnects through this action. The wholesale
      // spread re-keyed every child to its server-derived id, the persistence
      // subscription then wrote that server-shaped list over the entity
      // store, and a queued entry referencing an adopt-origin LOCAL child id
      // could never resolve again (`childServerIdFor` missed forever), so it
      // sat in the queue failing on every flush. Local-only running timers
      // and unsynced measurements were dropped the same way.
      //
      // Cross-server gate: the reconcile matches by `serverId`, and numeric
      // ids from DIFFERENT servers collide (child 501 exists on every
      // server), so merging is only safe when the local data came from the
      // server being connected to. The origin label lives with the DATA
      // (stamped below, and by adopt/enterLocal; only clearEntities removes
      // it), so it survives the 401 gap that clears the connection. On a
      // mismatch, or on an install that predates the label, the local side is
      // treated as empty and `applyServerLoad` degrades to the wholesale
      // behavior; the stamp below then self-heals a missing label, so the
      // NEXT expiry-reconnect merges. refresh() needs no such gate: it only
      // runs under a live connection, and the entities can only belong to a
      // different server than the connection across that 401 gap, which
      // forces the user back through here.
      //
      // The local side is gathered like `hydrate` gathers it: in-memory state
      // when populated (a warm-session expiry leaves it in place), else the
      // durable entity store (a cold start after the expiry parks the app on
      // the reconnect screen with memory empty). On a genuinely fresh connect
      // every merge input is empty either way.
      const s = get();
      const sameOrigin = (await loadEntityOrigin()) === normalizeServerUrl(serverUrl);
      const saved = sameOrigin && s.children.length === 0 ? await loadEntities() : null;
      const local = !sameOrigin
        ? { children: [], entries: [], measurements: [], selectedChildId: '', lastFeed: {} }
        : s.children.length > 0
          ? {
              children: s.children,
              entries: s.entries,
              measurements: s.measurements,
              selectedChildId: s.selectedChildId,
              lastFeed: s.lastFeed,
            }
          : {
              children: saved?.children ?? [],
              entries: backfillHeldBack(saved?.entries ?? [], saved?.children ?? []),
              measurements: saved?.measurements ?? [],
              selectedChildId: saved?.selectedChildId ?? '',
              lastFeed: saved?.lastFeed ?? {},
            };
      // Read AFTER the fetch, mirroring `refresh`: an entry queued while the
      // request was in flight is included. The queue is deliberately NOT
      // origin-gated: a cross-origin queued entry cannot flush anyway (its
      // childId resolves no serverId in the wholesale-loaded list), staying
      // visible in the queue view instead, and refresh() merges the queue
      // file back ungated a moment later regardless. Timers come from
      // on-device storage, their source of truth; the persistence subscribe
      // keeps it current, so this also covers a timer running in local mode
      // across the switch (the in-memory list `applyServerLoad`'s null-guard
      // used to keep). Treatments are in memory unconditionally (`hydrate`
      // loads them before any branch).
      const q = await loadQueue();
      const localTimers = await loadTimers();
      applyServerLoad(
        set,
        data,
        {
          ...local,
          treatments: sameOrigin ? s.treatments : [],
          // Another origin's timers must not reconcile against this server's
          // either (the same serverId collision as children), so the local
          // list is empty on a mismatch too, EXCEPT when the timers fetch
          // failed (null): keeping the current timers on a missing ANSWER is
          // about the fetch, not about id spaces, and is exactly what the
          // wholesale path always did.
          timers: sameOrigin || data.timers == null ? localTimers : [],
          q,
        },
        {
          connection: conn,
          connected: true,
          connecting: false,
          savedServers,
          // The pre-map feeding fallback travels with the entities it belongs
          // to. This is the only place it can reach state on a cold start
          // parked at the reconnect screen: `hydrate`'s no-connection branch
          // reads no entity store. Skipped when the read found none, so a
          // fallback `hydrate` did manage to set is never reset to the default.
          ...(saved?.legacyLastFeed ? { legacyLastFeed: saved.legacyLastFeed } : {}),
          // a newly-connected server's profile + tags haven't been fetched yet
          profile: null,
          profileLoaded: false,
          profileError: false,
          profileLoading: false,
          tags: [],
          tagsLoaded: false,
          tagsLoading: false,
        },
      );
      void saveConnection(conn);
      // A cross-origin connect took the local side as empty (see the gate
      // above), so the children the load just installed are the server's and
      // the previous ones are gone with their ids. Every pending record is
      // keyed by one of those ids: nothing will ever consume it, and
      // `sweepChildPhotos` reads one as a reason to keep its file forever.
      // Drop them and collect what that frees, the pairing `disconnect` uses.
      // Sequenced, not two `void`s: a sweep that read the map first would keep
      // exactly the files the wipe just orphaned.
      if (!sameOrigin) void clearPendingPhotos().then(() => sweepChildPhotos(get().children));
      // The entity store's contents (about to be written by the persistence
      // subscription) now belong to this server: re-stamp the origin label
      // the gate above reads.
      void saveEntityOrigin(normalizeServerUrl(serverUrl));
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
    // The just-uploaded (and below, reconciled) entities belong to this
    // server now: stamp the origin label so a post-expiry reconnect through
    // connect() is allowed to reconcile them. See `loadEntityOrigin`.
    void saveEntityOrigin(normalizeServerUrl(serverUrl));
    void persistServers(savedServers);
    // Snapshotted BEFORE the fetch, and the only reads here that are: they are
    // what tells a record written during the GET apart from one the server
    // changed. Everything else below is read after it, deliberately (see the
    // next comment).
    const childrenBefore = get().children;
    const measurementsBefore = get().measurements;
    const data = await loadFromServer(conn);
    // The pre-existing local children/entries/measurements, which the set()
    // below replaces with the server's list. Read AFTER the fetch, like
    // `connect` and `refresh`: a record written while the request was in
    // flight is in neither the answer nor a pre-fetch snapshot, so merging
    // against a snapshot drops it (`treatments`, `timers` and `lastFeed` below
    // have always been read here for the same reason).
    //
    // The pre-fetch snapshots above are passed to `reconcileChildren` and
    // `mergeUnsynced` below, so this now protects a write made DURING the GET
    // exactly as `refresh` does: an edit to a synced child keeps the edit, and
    // a create whose serverId was stamped mid-GET is kept rather than dropped.
    //
    // This window was once written off as unreachable, on the grounds that
    // adopt runs behind a modal sheet with every control disabled while it
    // works. That was wrong, and it is recorded here so the same conclusion is
    // not drawn again: `BottomSheet`'s scrim is a plain
    // `Pressable onPress={onClose}` with no `busy` gate, and `AdoptSheet` wires
    // it straight to `closeAdopt`, so a tap outside dismisses the sheet
    // mid-flight. This function keeps awaiting its GET regardless, and the user
    // is back on a fully interactive app with the child editor one tap away.
    const localChildren = get().children;
    const localEntries = get().entries;
    const localMeasurements = get().measurements;
    const localSelectedChildId = get().selectedChildId;
    // Reconcile rather than taking the server list wholesale: the children
    // just uploaded above kept their local ids (only `serverId` was stamped),
    // and entries/measurements still reference those local ids. Taking
    // `data.children` as-is would swap in server ids and orphan them. See
    // `reconcileChildren`. An expecting child is deliberately never uploaded
    // (see `stillUnsynced` above), so it's absent from `data.children` too;
    // `reconcileChildren` keeps it under its local id the same way it keeps
    // any other never-pushed child.
    const reconciledChildren = reconcileChildren(data.children, localChildren, childrenBefore);
    // Incoming entries/measurements/timers carry the SERVER's child id;
    // rewrite it to the local id now that reconciliation has produced the
    // authoritative mapping. See `remapChildIds` (mirrors `hydrate`/`refresh`).
    const remappedEntries = remapChildIds(data.entries, reconciledChildren);
    const remappedMeasurements = remapChildIds(data.measurements, reconciledChildren);
    // The expecting child's measurements are held back the same way its
    // record is: they never reach the server (uploadUnsynced skips them, no
    // server child to attach them to), so merge the local copy back in,
    // mirroring hydrate()/refresh()'s general mergeUnsynced treatment.
    const mergedMeasurements = mergeUnsynced(remappedMeasurements, localMeasurements, measurementsBefore);
    // Its entries are held back too. Use the same expecting-child merge that
    // refresh()/hydrate() use (mergeHeldBackEntries) rather than a blanket
    // serverId==null filter: an expecting child's entries can never reach the
    // server (uploadUnsynced skips them: no server child to attach them to),
    // so this can never duplicate one that already flushed.
    const mergedEntries = mergeHeldBackEntries(remappedEntries, localEntries, reconciledChildren);
    // The partial-load guard, at adopt's own hand-rolled copy of the merge: a
    // slice the reload emptied rather than answered for keeps the records this
    // device already holds, or one degraded request deletes the history this
    // adopt has just uploaded. See `degradedSlicesByChild`. Nothing to fold in
    // from the write queue here: adopt pushes the unsynced records itself and
    // reads no queue. `applied` is the load minus that metadata, which is not
    // an `AppState` key and must not ride the spread below into the store.
    const { incompleteSlices, ...applied } = data;
    const degradedSlices = degradedSlicesByChild(incompleteSlices, reconciledChildren);
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
      ...applied,
      children: reconciledChildren,
      entries: carryOverIncomplete(mergedEntries, localEntries, degradedSlices, (e) => e.type),
      measurements: carryOverIncomplete(mergedMeasurements, localMeasurements, degradedSlices, (m) => m.kind),
      treatments: carryOverIncomplete(
        mergeTreatments(data.treatments, get().treatments, reconciledChildren),
        get().treatments,
        degradedSlices,
        () => 'treatment',
      ),
      // A null `timers` is "the fetch failed, unknown" (see
      // `LoadResult.timers`) and must never land in state through the
      // `...data` spread above: keep the in-memory timers as they are. A
      // non-null answer is remapped and taken wholesale, as before.
      timers: data.timers == null ? get().timers : remapChildIds(data.timers, reconciledChildren),
      // Explicit and AFTER the spread for the same reason as in
      // `applyServerLoad`: the server's answer names only the children that have
      // ever been fed, so taking it wholesale would drop the prefill of every
      // child who has not.
      lastFeed: mergeLastFeed(get().lastFeed, data.lastFeed, reconciledChildren),
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
      lastFeed: e?.lastFeed ?? {},
      legacyLastFeed: e?.legacyLastFeed ?? LAST_FEED_DEFAULT,
      profile: null,
      profileLoaded: false,
      profileError: false,
      profileLoading: false,
      tags: [],
      tagsLoaded: false,
      tagsLoading: false,
    });
    void saveConnection(conn);
    // Local-mode data accumulates in the entity store from here: label it so
    // a later server connect cannot merge it by serverId. See `loadEntityOrigin`.
    void saveEntityOrigin('local');
    // The child list was just replaced, so a pending record keyed by a child
    // that is no longer here belongs to nobody. Reachable by a 401 session
    // expiry followed by choosing local mode. Nothing would ever consume such a
    // record, and `sweepChildPhotos` reads one as a reason to keep its file
    // forever, so drop them and collect what that frees. Sequenced, not two
    // `void`s: a sweep that read the map first would keep exactly the files the
    // wipe just orphaned.
    //
    // Swept against the children this mode DOES have, unlike `disconnect`'s
    // empty keep set: in local mode a child's `picture` is the durable copy
    // itself, and there is no server URL to fall back on. This is also what
    // eventually collects the file of a server-backed child deleted in local
    // mode, whose record `deleteChild` deliberately keeps (see the note there
    // on a delete a later refresh could undo).
    void clearPendingPhotos().then(() => sweepChildPhotos(get().children));
  },
  disconnect: () => {
    void clearConnection();
    void clearQueue();
    void clearEntities();
    void clearPendingOps();
    void clearPendingPhotos();
    void sweepPhotoFiles([]);
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
        let serverId: number | undefined;
        try {
          serverId = await pushEntryToServer(conn, entry, childServerId);
        } catch {
          failed++;
          continue;
        }
        // Tell the in-memory record what the server just called it. This path
        // used to discard the id, which left the entry `serverId == null` while
        // the server held a copy, and off the queue as well a moment later.
        // `detachEntry` reads exactly that field to decide whether a delete
        // needs a server DELETE, so deleting such a row removed it locally
        // only and the next refresh brought it straight back. Everything else
        // that pushes an entry (`commitWrite`, `flushUnsynced`) already stamps;
        // this was the gap.
        //
        // Functional `set` so it merges into the CURRENT list rather than a
        // pre-await snapshot: a save landing mid-flush must not be dropped.
        // An entry that has since gone (deleted during the push) simply isn't
        // matched, which leaves the pre-existing narrow race as it was.
        if (serverId != null) {
          set((st) => ({
            entries: st.entries.map((e) => (e.id === entry.id ? { ...e, serverId } : e)),
          }));
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
        // What the settle below needs, decided inside the try/catch and read
        // after it. The three outcomes are deliberately different:
        //
        // - success: compare-and-clear against `consumedPhoto`, the record this
        //   pass actually sent, so a photo re-picked DURING the round trip is
        //   left for its own push instead of being cleared and its file deleted
        //   unread.
        // - terminal 404: clear unconditionally. The child is gone server-side
        //   and the op goes with it, so no push will ever carry a record for
        //   this child again, and one left behind strands its file forever
        //   (the launch sweep keeps every file a record names).
        // - retryable failure: neither. The `continue` in the catch skips all
        //   of this, so the record and the file wait for the next flush.
        let consumedPhoto: PendingPhoto | undefined;
        let childGone = false;
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
            // The photo recorded alongside this op, if any. Reopened from the
            // document directory, which is why it is still there: the file the
            // picker handed back lived in Android's evictable cache.
            const { change, consumed } = await pendingPhotoChange(op.payload.id);
            consumedPhoto = consumed;
            const res = await updateChildOnServer(conn, payload, change);
            // A replayed rename moves the slug server-side, and the child
            // endpoints are keyed by it, so re-stamp it here the same way
            // saveChild's online edit does. Otherwise the next delete goes out
            // with a stale slug, 404s, and the child comes back. The picture is
            // stamped in the same pass: until now this child's `picture` has
            // been a device-local file path that only this device can read.
            const slug = res?.slug;
            if (slug || change.kind !== 'none') {
              set((st) => ({
                children: st.children.map((c) => {
                  if (c.id !== op.payload.id) return c;
                  const next = slug ? { ...c, slug } : c;
                  if (change.kind === 'none') return next;
                  // On a remove, `null` IS the answer and must be kept; on a
                  // set it means the server stored nothing, and taking it would
                  // throw away the only copy the device still has. Same rule as
                  // saveChild's online edit.
                  const picture = change.kind === 'remove' ? (res?.picture ?? null) : (res?.picture ?? c.picture);
                  return { ...next, picture };
                }),
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
          childGone = true;
        }
        // Settle this child's pending photo, on the terms set out at the top of
        // the loop. Nothing to do on a success that consumed no record.
        if (op.op === 'update' && op.entity === 'child') {
          if (childGone) await settlePendingPhoto(op.payload.id);
          else if (consumedPhoto) await settlePendingPhoto(op.payload.id, consumedPhoto);
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
            if (!u || u.serverId == null) return c;
            // The uploader stamps `picture` only for a child whose push
            // actually uploaded a photo, so diff against the PRE-upload
            // snapshot `s` to tell that apart from the copy it always returns.
            // Same technique `syncedCount` above uses.
            const before = s.children.find((r) => r.id === c.id);
            const changed = before != null && u.picture !== before.picture;
            return changed ? { ...c, serverId: u.serverId, picture: u.picture } : { ...c, serverId: u.serverId };
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
        // Owner only, like `mirrorTimerCreate`: a timer `hydrate` could not
        // attribute is skipped rather than created under the selected child.
        const child = st2.children.find((c) => c.id === timer.childId);
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
  commitWrite: (entry) => get().commitWrites([entry]),
  commitWrites: (entries) => {
    const s = get();
    // Entries bound for the offline queue are collected and written ONCE at the
    // end, rather than one un-awaited `enqueueEntry` each. See `enqueueEntries`
    // for the load-modify-save race that makes the difference between the two a
    // lost entry rather than an extra write.
    const queued: Entry[] = [];
    for (const entry of entries) {
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
      if (!conn || conn.mode !== 'server') continue; // local: nothing to push
      // Leave a withheld entry purely local (in `entries` / the entity store,
      // like local mode) rather than queueing it. Queueing it would let it
      // flush silently through `flushQueue`, which never stamps a local
      // `serverId` on an entry: the only path that does is `flushUnsynced`'s
      // held-back push once `confirmBirth` gives the child one (see
      // `isHeldBackEntry`), and mixing the two would risk pushing the same
      // entry to the server twice.
      if (child?.expected) continue;
      if (s.offline) {
        queued.push(entry);
        continue;
      }
      const childServerId = childServerIdFor(s.children, entry.childId);
      if (childServerId == null) {
        // The child is not on the server yet, so this entry cannot be either.
        // Queue it: the reconnect flush pushes it once the child exists.
        console.warn('[entries] no server id for child, queued:', entry.type, entry.childId);
        queued.push(entry);
      } else {
        // A genuine new write: give the retry chain a fresh budget, so a save
        // made an hour after some earlier failure isn't stuck with a spent one.
        // Mirrors `mirrorTimerCreate`.
        queueRetryAttempt = 0;
        void pushEntryToServer(conn, entry, childServerId)
          .then((serverId) => {
            if (serverId == null) {
              console.warn('[entries] push returned no id, left unsynced:', entry.type, entry.id);
              return;
            }
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
          .catch((e) => {
            // Was a bare swallow, which left no trace of WHY an entry ended up
            // on the queue instead of the server. Mirrors the timer create
            // path's `[timers] create failed` log.
            console.warn('[entries] push failed, queued:', entry.type, e?.status, e?.message);
            return enqueueEntry(entry).then((q) => {
              set(queueMirror(q));
              // Queued is not delivered: without this the entry waits for the
              // next refresh/foreground/reconnect. See `scheduleQueueFlush`.
              scheduleQueueFlush(get);
            });
          });
      }
    }
    // One load/save cycle and one `queueMirror` update for the whole batch. The
    // length guard is about the READ: `enqueueEntries` would write nothing for
    // an empty list but still load the queue and re-mirror it, on every ordinary
    // online push.
    if (queued.length > 0) void enqueueEntries(queued).then((q) => set(queueMirror(q)));
  },

  // ---- child switcher ----
  // Purely local, in BOTH modes, and deliberately so. This used to fire a
  // refresh in server mode, because `entries`/`measurements` then held only the
  // one child the last fetch asked for and the sibling we just switched to would
  // otherwise show an empty History, Growth and status strip. Since 0.15.0 a
  // load fetches every child (see `loadFromServer`), so their records are
  // already resident and a switch has nothing to wait for: refetching here would
  // cost 13 requests per child on every tap of the switcher, to redraw what is
  // already on screen. Freshness comes from the foreground refresh and
  // pull-to-refresh, as it does everywhere else.
  //
  // `insightsEntries` is the exception that still clears: it is a 90-day deep
  // history fetched per child on demand, not part of the load, so it is genuinely
  // stale for the child being switched to. `loadInsights` refills it lazily.
  selectChild: (id) => {
    set({
      selectedChildId: id,
      showChildSwitcher: false,
      insightsLoaded: false,
      insightsEntries: [],
      insightsError: false,
    });
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
      // A photo change is uploaded by this save only when there is a server to
      // send it to, right now, AND a server row to send it to: `updateChild`
      // returns before doing anything when `serverId == null`, so editing a
      // child the server has never seen is a no-op even with a full
      // connection. Every other case defers to a later push, and every deferred
      // case records the photo so that push can carry it.
      //
      // `photoDropped` now means only that the photo could not be made durable
      // (web, or a copy that failed): a cache URI would be persisted, drawn as
      // the avatar, and then point at nothing once Android reclaimed the file.
      // That is the one case still worth warning about. Local mode has no
      // server to owe anything to.
      const conn = s.connection;
      const uploadsNow = conn?.mode === 'server' && !s.offline && existing.serverId != null;
      const deferred = conn?.mode === 'server' && change.kind !== 'none' && !uploadsNow;
      const durable = change.kind === 'remove' || (change.kind === 'set' && change.photo.durable);
      const photoDropped = deferred && !durable;
      const child: Child = {
        ...existing,
        first: fields.first,
        last: fields.last,
        birth: fields.birth,
        gender: fields.gender,
        picture: change.kind === 'none' || photoDropped ? existing.picture : pending,
      };
      const genderChanged = existing.gender !== child.gender;
      set((st) => ({
        children: st.children.map((c) => (c.id === child.id ? child : c)),
        childSheet: false,
        editingChildId: null,
      }));
      // A removal is always durable (there is no file to persist), so
      // `photoDropped` can only be true here for a 'set': the "photo not
      // removed" message a drop-it removal used to earn is unreachable now
      // that a removal is recorded and applied instead of dropped.
      get().showToast(photoDropped ? 'Updated · photo not saved' : 'Updated');
      if (deferred && durable) void recordPendingPhoto(child.id, change, existing.serverId != null);
      if (conn && conn.mode === 'server' && !s.offline) {
        // Gender lives in its own `gender`-tagged note, not on the child record,
        // so it is a separate write. Fired only on an actual change: it costs a
        // read before its write, and a plain rename should not pay for that.
        if (genderChanged && child.serverId != null) {
          void setChildGenderOnServer(conn, child.serverId, child.gender, Date.now()).catch(() => {});
        }
        // Whatever this child still owed the server BEFORE this PATCH went out.
        // Read only when this save uploads the photo itself, which is the case
        // where an older record is superseded the moment the server answers.
        // Left there, it names a photo this child no longer owes: an earlier
        // offline edit's op can survive a retryable failure, and the next flush
        // would then hand that op the stale record, re-upload the superseded
        // file, and stamp its URL back over the one saved here.
        //
        // Cleared by VALUE on success (see `settlePendingPhoto`), never
        // unconditionally: if the connection dropped mid-PATCH and the user
        // recorded a newer photo, that record is the one thing carrying it.
        //
        // Nothing is RECORDED on this path, deliberately. An online edit is
        // queued nowhere, so a record written when the PATCH fails would have
        // no op to consume it, and the launch sweep would protect its file
        // forever.
        const staleRecord =
          uploadsNow && change.kind !== 'none' ? loadPendingPhotos().then((m) => m[child.id]) : null;
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
                if (change.kind === 'none') return { ...c, slug };
                // Swap the ephemeral local file URI for the durable server URL.
                // On a remove, `null` IS the answer and must be kept; on a set it
                // means the server stored nothing, and taking it would throw away
                // the only copy of the photo the device still has.
                const picture = change.kind === 'remove' ? res.picture : (res.picture ?? c.picture);
                return { ...c, slug, picture };
              }),
            }));
            // The server has this photo now, so the older record it supersedes
            // can go (see `staleRecord`). Its own chain rather than an awaited
            // step, so a settle that somehow throws cannot reach the catch
            // below and report a save that in fact landed as a failure.
            if (staleRecord) {
              void staleRecord
                .then((stale) => (stale ? settlePendingPhoto(child.id, stale) : undefined))
                .catch(() => {});
            }
          })
          .catch(() => {
            // An online edit is queued nowhere (only the offline branch below
            // records a pending op), so a failure here is lost work the next
            // refresh will quietly undo. Say so rather than leaving the
            // optimistic "Updated" standing, as deleteChild does on its own
            // failure.
            get().showToast(`Could not save ${child.first}`);
          });
      } else if (conn && conn.mode === 'server' && s.offline && child.serverId != null) {
        // Already on the server, editing while offline: record the update so
        // it replays on reconnect instead of being silently overwritten by the
        // next refresh(). A not-yet-synced local (serverId == null) needs no
        // op — its create is still pending.
        void addPendingOp({ op: 'update', entity: 'child', payload: child });
      }
      return;
    }
    // Creating: assign a local id + a tint no sibling is wearing (by the palette,
    // not by list position, which a deletion would make collide), optimistically
    // add it, and auto-select it (mirrors saveMeasurement's
    // optimistic-local-then-push pattern).
    const localId = 'child' + Date.now();
    const conn = s.connection;
    // The create twin of the edit branch. A create uploads its photo on its own
    // POST only when online AND not expecting: an expected child holds a DUE
    // date the server cannot accept as a birth_date, so it is held back until
    // `confirmBirth` and its photo has to wait with it. Everything deferred is
    // recorded below so the eventual push can carry it, and `photoDropped`
    // again means only "could not be made durable".
    const photoDropped = change.kind === 'set' && conn?.mode === 'server' && !change.photo.durable && (s.offline || !!fields.expected);
    const deferredPhoto =
      change.kind === 'set' && conn?.mode === 'server' && change.photo.durable && (s.offline || !!fields.expected);
    const child: Child = {
      id: localId,
      first: fields.first,
      last: fields.last,
      birth: fields.birth,
      expected: fields.expected,
      gender: fields.gender,
      color: nextChildColor(s.children),
      picture: change.kind === 'set' && !photoDropped ? change.photo.uri : null,
    };
    set((st) => ({
      children: [...st.children, child],
      selectedChildId: localId,
      childSheet: false,
      editingChildId: null,
      showChildSwitcher: false,
      insightsLoaded: false,
      insightsEntries: [],
      insightsError: false,
    }));
    get().showToast(photoDropped ? 'Saved · photo not saved' : 'Saved');
    // `false`: this child has no server row yet, so a removal has nothing to
    // tell the server (see `recordPendingPhoto`). Only a set reaches here.
    if (deferredPhoto) void recordPendingPhoto(localId, change, false);
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
        .catch(() => {
          // The child itself is not lost: it stays local with no serverId, and
          // the next flush pushes it. A photo picked in the same save IS lost
          // though, because nothing recorded it: this save was online and not
          // expecting, so it carried the photo on the POST rather than
          // deferring it, and the flush's `pushChild` finds no record to send.
          // So this cannot pass silently under the "Saved" above.
          get().showToast(`Could not save ${child.first}`);
        });
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
      void (async () => {
        // An expecting child is held back from the server, so a photo picked
        // for it has been waiting in `pendingPhotos` since it was created, even
        // if the app was online the whole time. This push is its first chance.
        const { change, consumed } = await pendingPhotoChange(id);
        const res = await pushChildToServer(conn, bornChild, change);
        if (!res || res.id == null) return;
        // Compare-and-clear: a photo re-picked while this POST was in flight is
        // a record this push never carried, and dropping it would delete the
        // newer file unread. See `settlePendingPhoto`.
        if (consumed) await settlePendingPhoto(id, consumed);
        // Stamp the server id, the slug and the server's picture URL, exactly
        // as saveChild's create push does (see the note there on why the local
        // `id` is left alone and why the slug matters).
        set((st) => ({
          children: st.children.map((c) =>
            c.id === id ? { ...c, serverId: res.id, slug: res.slug ?? c.slug, picture: res.picture ?? c.picture } : c,
          ),
        }));
      })().catch(() => {});
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
    // the deleted child's running timers: a server-backed one would come back on
    // the next refresh, but one started offline (serverId == null) lives nowhere
    // else and would be lost for good.
    const priorIndex = s.children.findIndex((c) => c.id === id);
    const purgedEntries = s.entries.filter((e) => e.childId === id);
    const purgedMeasurements = s.measurements.filter((m) => m.childId === id);
    const purgedTimers = s.timers.filter((t) => t.childId === id);
    const purgedTreatments = s.treatments.filter((c) => c.childId === id);
    // Purge the deleted child's records. Every child's data lives in state in
    // BOTH modes now (since 0.15.0 a server load fetches them all, see
    // `loadFromServer`), so this drops the orphans wherever they came from, and
    // the persistence subscription carries the same removal to disk
    // (saveEntries / saveMeasurements / saveTreatments all fire on the new array
    // refs). It used to be a no-op for a non-selected child in server mode,
    // because only the selected child's records were loaded, which left that
    // child's rows in the entity store with no child to own them.
    //
    // `lastFeed` and `bathRhythms` are deliberately NOT purged. Both are keyed
    // by child id rather than being lists of records, both are tiny, and both
    // are re-seeded from the child's own history if that id is ever reused; the
    // two are consistent with each other and neither can strand a visible row.
    const patch: Partial<AppState> = {
      children: nextChildren,
      entries: s.entries.filter((e) => e.childId !== id),
      measurements: s.measurements.filter((m) => m.childId !== id),
      // Treatments were the one record list this missed. They persist through
      // their own store (`saveTreatments`), so leaving them behind kept a
      // deleted child's medication regimens on disk forever, and
      // `treatmentReminders` would keep scheduling doses for a child the app no
      // longer has.
      treatments: s.treatments.filter((c) => c.childId !== id),
      // The deleted child's running timers, and only those. Ungated on the
      // selection on purpose, and it fixes a bug in both directions: this used
      // to wipe EVERY timer when the deleted child happened to be selected
      // (stopping a sibling's nap for no reason), and to wipe NONE when they
      // were not (leaving that child's timers running forever, owned by nobody,
      // with no surface left to stop them from). `!==` keeps a still-unstamped
      // timer, deliberately: `undefined` is not evidence it was this child's.
      timers: s.timers.filter((t) => t.childId !== id),
      childSheet: false,
      editingChildId: null,
      showChildSwitcher: false,
    };
    if (s.selectedChildId === id) {
      // Deleting the selected child: re-point selection (mirrors refresh's
      // fallback) and reset insights (as selectChild does). The timer purge
      // above is NOT part of this branch; ownership decides it, not selection.
      patch.selectedChildId = nextChildren[0]?.id ?? '';
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
          const treatmentIds = new Set(st.treatments.map((c) => c.id));
          return {
            children,
            entries: [...purgedEntries.filter((e) => !entryIds.has(e.id)), ...st.entries],
            measurements: [...purgedMeasurements.filter((m) => !measurementIds.has(m.id)), ...st.measurements],
            timers: [...purgedTimers.filter((t) => !timerIds.has(t.id)), ...st.timers],
            // Restored with the rest: the purge above is what made this
            // necessary. A treatment lives only on this device until it syncs,
            // so a failed delete that put the child back but not their regimens
            // would lose them for good.
            treatments: [...purgedTreatments.filter((c) => !treatmentIds.has(c.id)), ...st.treatments],
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
    // Only when the child is really gone: either the server confirmed the
    // delete (the catch above returns, so reaching here means it stuck), or
    // there was no server row to delete in the first place. A server-backed
    // child deleted while OFFLINE is neither: the DELETE never went out, the
    // next refresh brings the child back, and discarding its pending photo
    // here would be the one deletion nothing can undo.
    if (!serverBacked || doServerDelete) void settlePendingPhoto(id);
    get().showToast(`${child.first} deleted`);
    // Reconcile after the DELETE this action just sent, which Baby Buddy
    // cascades server-side over the child's whole history.
    //
    // This is no longer about filling an empty screen. It existed because a load
    // fetched only the selected child, so the survivor this re-point lands on had
    // no records in memory and sat empty until a pull-to-refresh; since 0.15.0
    // every child's records are already resident (see `loadFromServer`) and the
    // survivor draws immediately. What is left is the ordinary reason to re-read
    // after a destructive write, and it stays because a delete is a rare,
    // deliberate action rather than something on a hot path: the same 13N cost
    // that argued the refetch out of `selectChild` (once per tap of the child
    // switcher) is paid here at most once per deleted child.
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
    const s = get();
    // The children this sheet is being aimed at, decided once here and used
    // both for the child-scoped seeds below and for `sheetChildIds` at the
    // bottom, so a seed and the target it was computed for cannot drift.
    const aimedAt = [s.selectedChildId];
    // Whose own history those seeds read: the single target, or nobody when
    // there is no one right answer. The same rule the time-entry anchor chips
    // follow, deliberately shared rather than restated (see `anchorChildId`).
    // A sheet opens on exactly one child today; it can be re-aimed at several
    // afterwards, and the seeds must not pretend otherwise.
    const seedChildId = anchorChildId(aimedAt, s.selectedChildId);
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
      // All three seeds are about THIS child (see `LastFeed` for why that
      // matters). They follow a re-aim from here too, which is why the
      // computation is shared rather than written out twice.
      const seeds = feedingSeeds(s, seedChildId);
      te.feedType = seeds.feedType;
      te.method = seeds.method;
      te.startSide = seeds.startSide;
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
      const now = s.now;
      te.nap = isNapStart(teStart(te, now) ?? now, {
        startMin: s.napWindowStartMin,
        endMin: s.napWindowEndMin,
      });
    }
    if (type === 'bath') {
      // Pre-select the wash that's due from this child's rhythm. Scoped to the
      // sheet's own child: `entries` holds every child's records, so an unscoped
      // read would let a sibling's baths decide this child's next wash.
      // `s.now` rather than `Date.now()`, same reasoning as the sleep branch
      // above: the store clock is the one `save()` will resolve the draft with.
      te.wash = washDueState(
        entriesForChild(s.entries, seedChildId),
        rhythmForChild(s.bathRhythms, seedChildId ?? null, s.legacyRhythm),
        s.now,
      ).nextKind;
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
      // The draft is aimed HERE, at open, not read off the selection at save
      // time: a warm notification tap for a sibling moves the selection with no
      // action on the switcher, and this sheet is a root overlay that survives
      // the navigation. Deep links select first and open second (see
      // app/log/[type].tsx), so the link's child is the one pinned.
      sheetChildIds: aimedAt,
      te: snapDraftAmount(type, te, s.unitSystem),
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
      // An edit opens on whoever the record was about, never on the selection:
      // the edit path PATCHes `child:` along with everything else, so a wrong
      // seed here would move the server row too.
      sheetChildIds: [entry.childId],
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
      // The TIMER's child, not the selection: this sheet is aimed at whoever
      // started it (see `sheetChildIds` below), and the Timers tab lists every
      // child's, so the two routinely disagree. A timer nothing could attribute
      // has no scoped history at all, and borrows nobody's rather than falling
      // back to whoever happens to be selected.
      const seeds = feedingSeeds(s, tm.childId);
      te.feedType = tm.feedType ?? seeds.feedType;
      te.method = tm.method ?? seeds.method;
      te.startSide = tm.startSide ?? seeds.startSide;
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
      // A timer belongs to whoever started it, the rule `stopTimer` follows for
      // the button next to it. An unattributable timer (no owner even after
      // `stampTimerOwners`) seeds nothing, so `save()` keeps its own fallback
      // rather than this sheet inventing an owner for it.
      sheetChildIds: tm.childId ? [tm.childId] : [],
      te: snapDraftAmount(type, te, s.unitSystem),
      editingId: null,
      fromTimerId: timerId,
    });
  },
  setSheetChildren: (ids) => {
    // An empty list is refused rather than stored: `sheetChildIds: []` already
    // means "never seeded, use the old binding", so accepting one here would
    // quietly hand the draft back to the global selection.
    if (ids.length === 0) return;
    aimSheetAt(get, set, ids);
  },
  toggleSheetChild: (id) => {
    const s = get();
    const ids = s.sheetChildIds;
    if (!ids.includes(id)) {
      // Only a child the PICKER could have offered. A target with no chip is one
      // nothing can take back off again, and it would fan out on save with
      // nothing on screen to say so. Unreachable through the UI, which builds
      // its chips from the same rule; this is the state keeping it anyway.
      if (!isEligibleTarget(s.children, id)) return;
      aimSheetAt(get, set, [...ids, id]);
      return;
    }
    // Untoggling the last target would leave the draft ownerless. The picker
    // shows the remaining chip as selected, so this reads as "you cannot
    // deselect everyone" rather than as a dead tap.
    if (ids.length === 1) return;
    aimSheetAt(get, set, ids.filter((x) => x !== id));
  },
  closeSheet: () => set({ sheet: null, sheetChildIds: [], editingId: null, fromTimerId: null }),
  deleteEntry: (id) => {
    const s = get();
    const index = s.entries.findIndex((e) => e.id === id);
    if (index === -1) return;
    const entry = s.entries[index];
    set({
      entries: s.entries.filter((e) => e.id !== id),
      sheet: s.editingId === id ? null : s.sheet,
      sheetChildIds: s.editingId === id ? [] : s.sheetChildIds,
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
      // Same rule `save()` follows: an edit keeps the record with whoever it
      // was about, and re-stamping the selected child would move it on the
      // server too.
      childId: existing?.childId ?? s.selectedChildId,
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
  openTreatmentEditor: (id) => set({ treatmentEditor: { editingId: id ?? null, openedAt: get().now } }),
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
      // The feeding chips are the setter for the three CHILD-scoped feeding
      // seeds, so this is where "the parent chose it" gets recorded. Same job
      // `setWash` does for the bath suggestion, and the flags keep a re-aim from
      // overruling the choice (see `reseedTargetScopedDraft`). Every production
      // caller is a chip tap; a compound patch (tests) marks each key it names.
      if ('feedType' in patch) next.feedTypeEdited = true;
      if ('method' in patch) next.methodEdited = true;
      if ('startSide' in patch) next.startSideEdited = true;
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
  // `washEdited` unlike `setNap` below, because this seed is CHILD-scoped and so
  // gets recomputed when the sheet is re-aimed (see `reseedTargetScopedDraft`).
  // The flag is what keeps that recompute from overruling this choice.
  setWash: (wash) => set((s) => ({ te: { ...s.te, wash, washEdited: true } })),
  // Manual Nap/Night override for the sleep sheet. No companion "user touched
  // this" flag is needed: the nap window is GLOBAL, so no re-aim can change what
  // it suggests; the sheet seeds `te.nap` from it on open and saves whatever
  // `te.nap` holds, so a flip here simply wins.
  setNap: (nap) => set((s) => ({ te: { ...s.te, nap } })),
  toggleTag: (tag) =>
    set((s) => {
      const has = s.te.tags.includes(tag);
      return { te: { ...s.te, tags: has ? s.te.tags.filter((t) => t !== tag) : [...s.te.tags, tag] } };
    }),
  createTag: (name) => {
    const trimmed = name.trim();
    // Reject blanks and the structural tags (bath/bath:quick/bath:full and the
    // legacy bare small/big, breastfeeding left/right, milestone/mk:*), which
    // must never be user-created. No server call: Baby Buddy auto-creates the
    // tag when the entry is POSTed with the name.
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
    const existing = s.editingId ? s.entries.find((e) => e.id === s.editingId) : null;
    // Three cases, in this order.
    //
    // An EDIT keeps the record with whoever it was about. Re-stamping the
    // selected child here would also move it server-side, since the update
    // PATCHes `child:` along with everything else.
    //
    // A timer STOP (the "lasted X" path, `fromTimerId` set) belongs to whoever
    // STARTED the timer, the same rule `stopTimer` follows for the button next
    // to it. This one cannot read `existing`: the entry is brand new, so it is
    // null, and the owner has to come off the timer. The Timers tab deliberately
    // lists every child's timers with no per-child filter, so the timer being
    // stopped need not belong to the selection, and stamping the selection here
    // filed a sibling's nap against the wrong child, server row and all.
    //
    // NOT full parity with `stopTimer`, which additionally walks a born-child
    // chain rather than ever resolving to an `expected` one. Here an unstamped
    // timer still falls through to `s.selectedChildId`, so stopping one via
    // "lasted X" with an expecting child selected still files against them.
    // That is strictly narrower than before (it used to apply to EVERY timer,
    // not just unstamped ones) and is left alone on purpose; closing it means
    // sharing one owner-resolution helper with `stopTimer`.
    //
    // A fresh draft is the selected child's, which is the only case left.
    //
    // All three are now only the FALLBACK: the sheet carries its own target
    // (seeded from exactly these three when it opened, so the rule below is
    // unchanged for every sheet the user never re-aimed), and an explicit pick
    // in the header picker wins over all of it. That is what lets a save file
    // against the child the sheet was opened for even when the global selection
    // moved underneath it, and what makes re-aiming an edit move the record.
    const sourceTimer = s.fromTimerId ? s.timers.find((t) => t.id === s.fromTimerId) : undefined;
    const fallbackChildId = existing?.childId ?? sourceTimer?.childId ?? s.selectedChildId;
    const aimedAt = sheetTargetIds(s.sheetChildIds, fallbackChildId);
    // "Log for both" is CREATE-ONLY and only for the shared-routine activities.
    // An edit moves ONE record and must never mint a sibling copy of it, a timer
    // stop belongs to whoever started that one timer, and the allow-list keeps a
    // duplicated pumping session from double-counting the milk (see
    // `allowsMultipleChildren`). The UI already gates all three; this is the
    // store keeping the rule rather than trusting the picker's.
    const targets = !existing && !sourceTimer && allowsMultipleChildren(type) ? aimedAt : [aimedAt[0]];
    const childId = targets[0];
    // One stamp for the whole save, suffixed per target below.
    const stamp = Date.now();
    const id = existing ? existing.id : `e${stamp}-0`;
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
        wash: te.wash ?? 'quick',
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
      // Spelled out rather than just reusing `targets`: on an edit the two are
      // now equal (see where `targets` is bound), but a timer belongs to whoever
      // the RECORD was about, and a conversion is single-target by construction.
      // Same rule `stopTimer` follows in reverse.
      //
      // One timer PER TARGET on a fresh draft, for the reason a finished save
      // writes one entry each: "still feeding" for both twins is two things
      // happening, and starting a single timer would silently drop one of them
      // after the parent asked for both. Ids carry the same `-<index>` suffix as
      // the entries, and for the same collision reason.
      const timerChildIds = existing ? [existing.childId] : targets;
      const start = ongoingStartMs(te, s.entries, s.editingId, now);
      const timers = timerChildIds.map((cid, i) => buildTimerFromDraft(`t${stamp}-${i}`, type, te, start, cid));
      const index = existing ? s.entries.findIndex((e) => e.id === existing.id) : -1;
      set({
        entries: existing ? s.entries.filter((e) => e.id !== existing.id) : s.entries,
        timers: [...s.timers.filter((tm) => tm.id !== s.fromTimerId), ...timers],
        sheet: null,
        sheetChildIds: [],
        editingId: null,
        fromTimerId: null,
      });
      if (existing) {
        detachEntry(get, set, existing, index, timers[0].id);
        get().showToast('Replaced with a live timer', { label: 'Undo', run: () => get().undoDelete() });
      } else {
        get().showToast(timers.length > 1 ? 'Live timers started' : 'Live timer started');
      }
      for (const tm of timers) mirrorTimerCreate(get, set, tm.id);
      return;
    }

    // One INDEPENDENT record per target child. The siblings are CLONES of the
    // draft carrying their own id and their own owner: every other field is
    // about the activity rather than the child, and the two child-scoped seeds
    // (a bath's `wash`, a feed's start side) are user-editable draft values by
    // the time save runs, so they are shared deliberately rather than recomputed
    // behind the parent's back. No group id and no link field: each entry is
    // separately editable and deletable afterwards.
    //
    // The `-<index>` id suffix is load-bearing. `Date.now()` is millisecond
    // resolution and this pass is synchronous, so N entries written in one save
    // would otherwise carry IDENTICAL ids, and every id-keyed operation would
    // then hit all of them: `removeQueuedEntry` / `updateQueuedEntry`,
    // `deleteEntry`'s findIndex, the post-POST `serverId` stamp (which would put
    // one child's server row onto the sibling's entry), `mergeUnsynced`'s id set
    // and React's list keys. Nothing parses a LOCAL entry id (server ids live in
    // `Entry.serverId`), so the format is free.
    const built: Entry[] = [
      entry,
      ...targets.slice(1).map((cid, i): Entry => ({ ...entry, id: `e${stamp}-${i + 1}`, childId: cid })),
    ];

    const patch: Partial<AppState> = existing
      ? { entries: s.entries.map((e) => (e.id === id ? entry : e)), sheet: null, sheetChildIds: [], editingId: null }
      : {
          entries: [...built, ...s.entries],
          sheet: null,
          sheetChildIds: [],
          fromTimerId: null,
          // stopping a running timer via "lasted X" drops the source timer
          ...(s.fromTimerId ? { timers: s.timers.filter((tm) => tm.id !== s.fromTimerId) } : {}),
        };
    if (type === 'feeding') {
      // ONE draft, written once, and filed against every child it was logged
      // for: "what was this child's last feed like" is now true of each target,
      // and leaving a target's entry behind is exactly the staleness the
      // per-child map exists to close. Merged over the rest of the map, so a
      // child nobody just fed keeps whatever their own last feed was.
      const draft: LastFeed = { feedType: te.feedType ?? 'breast', method: te.method ?? 'left' };
      patch.lastFeed = { ...s.lastFeed };
      for (const cid of targets) patch.lastFeed[cid] = draft;
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
      // One call for the whole save: everything bound for the offline queue is
      // written in ONE load/save cycle there, because N un-awaited single
      // enqueues interleave and drop entries (see `commitWrites`).
      get().commitWrites(built);
      const queued = s.offline && !!s.connection && s.connection.mode === 'server';
      // Naming the children back is the confirmation that the fan-out happened:
      // the entries land under whoever was targeted, so History (which filters
      // by the SELECTED child) shows only one of them.
      const what = built.length > 1 ? `Saved for ${targetChildrenLabel(s.children, targets)}` : 'Saved';
      get().showToast(queued ? `${what} · queued offline` : what);
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
      sheetChildIds: [],
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
    // a timer carries one (every creation path stamps it, and `stampTimerOwners`
    // stamps the ones persisted before that existed). The `?? ...` fallback is
    // the last line of defence for a timer even that migration could not
    // attribute; an expecting child can never be logged against (its `birth` is
    // a due date, not a real one), so it must never resolve to one.
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
