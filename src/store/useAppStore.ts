/** Global app state (Zustand): connection, prefs, ticking `now`, entities, the working
 *  time-entry (`te`), sheets, and the save / timer logic. */

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
  connection: Connection | null;
  connected: boolean;
  connecting: boolean;
  connectError: string | null;
  hydrating: boolean;
  queueCount: number;
  /** LOCAL ids of the entries on the offline write queue, so History can mark a row as
   *  still waiting to upload. The queue is the only truthful source: `flushQueue` pushes
   *  without stamping `serverId` back onto the in-memory record. Known drift: the Android
   *  nap widget enqueues from another process, so this goes stale until the next hydrate.
   *  Never derive it inside a selector. */
  queuedIds: string[];
  savedServers: SavedServer[];

  themeMode: ThemeMode;
  /** Display lens only: stored values stay canonical metric. */
  unitSystem: UnitSystem;
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
  milestoneCatchUp: boolean;
  showGrowthReference: boolean;
  /** Local only: Baby Buddy has no notion of wash cadence. */
  bathRhythms: Record<string, BathRhythm>;
  /** For a child with no stored entry, derived once at hydration from the retired
   *  `smallWashesPerBig` pref. */
  legacyRhythm: BathRhythm;
  setBathRhythm: (childId: string, patch: Partial<BathRhythm>) => void;
  /** The window in which a sleep counts as a NAP, as minutes since local midnight
   *  (default 420/1140). Start inclusive, end exclusive; a start later than the end wraps
   *  midnight. It only seeds NEW entries, so changing it never re-classifies history. */
  napWindowStartMin: number;
  napWindowEndMin: number;
  /** Insights "Rhythm" graph day boundary: the hour (0..23) the 24h window starts at
   *  (default 12 = noon-to-noon). */
  rhythmOriginHour: number;
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
  toastAction: ToastAction | null;
  showChildSwitcher: boolean;
  childSheet: boolean;
  editingChildId: string | null;
  confirmBirthFor: string | null;
  adoptSheet: boolean;
  sheet: { type: ActivityType; confirm?: boolean } | null;
  /** Which children the OPEN log sheet will file against. More than one means "log for
   *  both": `save()` writes one INDEPENDENT entry per id. Deliberately NOT a field on
   *  `sheet`, which is replaced wholesale and never spread, so a target living there
   *  would silently reset when the user tapped Edit in medication confirm mode. EMPTY
   *  means "never seeded", not "nobody": `save()` then applies its own owner fallback. */
  sheetChildIds: string[];
  editingId: string | null;
  /** the running timer being stopped and edited through the log sheet, or null */
  fromTimerId: string | null;
  measurementSheet: { kind: MeasurementKind } | null;
  editingMeasurementId: string | null;
  /** Rendered at the app root like the other sheets, so its overlay anchors to the
   *  viewport, not the page. */
  milestoneSheet: { mode: 'log'; key: string } | { mode: 'edit'; id: string } | null;
  treatmentPicker: { open: boolean } | null;
  /** `editingId` null = creating; null (the field itself) = closed. `openedAt` is
   *  `s.now` at open, so the editor's date seeds keep its render pure. */
  treatmentEditor: { editingId: string | null; openedAt: number } | null;

  selectedChildId: string;
  /** Milestone catch-up prompts already answered, per child id. Any answer adds the key
   *  so the nudge never re-asks. */
  answeredMilestonePrompts: Record<string, string[]>;
  children: Child[];
  entries: Entry[];
  timers: Timer[];
  measurements: Measurement[];
  /** Per-child medication regimens, synced to Baby Buddy as `treatment`-tagged notes.
   *  Survives disconnect, being user data rather than the synced entity store. */
  treatments: Treatment[];
  lastFeed: Record<string, LastFeed>;
  /** Prefill for a child with no entry of their own, taken once at hydration from the
   *  account-wide value a pre-map build left on the same storage key. */
  legacyLastFeed: LastFeed;
  insightsEntries: Entry[];
  insightsLoaded: boolean;
  insightsLoading: boolean;
  insightsError: boolean;
  loadInsights: () => Promise<void>;
  /** Pull-to-refresh: ignores the loaded guard, and on failure neither clears data nor
   *  sets an error, so the current charts stay on screen. */
  reloadInsights: () => Promise<void>;

  /** Read-only Baby Buddy server settings, lazily fetched and cached. */
  profile: Profile | null;
  profileLoading: boolean;
  profileError: boolean;
  profileLoaded: boolean;
  loadProfile: () => Promise<void>;

  tags: Tag[];
  tagsLoading: boolean;
  tagsLoaded: boolean;
  loadTags: () => Promise<void>;

  /** The working time-entry draft the open log sheet edits. */
  te: TimeEntryState;
}

/** `partial` means the upload was interrupted mid-way: the app stays in local mode
 *  with whatever serverIds got stamped, so a retry resumes cleanly. */
export type AdoptResult =
  | { status: 'guard' } // server already has data; awaiting the user's choice
  | { status: 'done' } // uploaded (or the server was empty) + now in server mode
  | { status: 'partial' } // upload interrupted; STILL local mode; retry-able
  | { status: 'error'; message: string };

interface AppActions {
  tick: (now: number) => void;
  toggleTheme: () => void;
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
  setRhythmLayer: (layer: 'sleep' | 'feeds' | 'diapers', on: boolean) => void;
  setGrowthReference: (on: boolean) => void;
  setOffline: (v: boolean) => void;
  toggleOffline: () => void;
  setNetworkOnline: (online: boolean) => void;

  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  connect: (serverUrl: string, token: string) => Promise<void>;
  /** `opts.uploadAnyway` overrides the non-empty-server guard, attaching to matching
   *  server children instead of duplicating them. Safe to call again after a `partial`. */
  adopt: (serverUrl: string, token: string, opts?: { uploadAnyway?: boolean }) => Promise<AdoptResult>;
  enterLocal: () => Promise<void>;
  disconnect: () => void;
  forgetServer: (serverUrl: string) => void;
  flushQueue: () => Promise<void>;
  /** Replay durable offline update/delete ops (the `pendingOps` log) on reconnect. */
  flushPendingOps: () => Promise<void>;
  /** Push offline-created children/measurements up on reconnect. Ordinary entries are
   *  excluded: they flow through flushQueue, and mixing the two would double-push. */
  flushUnsynced: () => Promise<void>;
  commitWrite: (entry: Entry) => void;
  /** `commitWrite` for a whole save at once: everything bound for the queue is handed
   *  over in ONE batched call. */
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
    /** undefined means "not recorded". Synced as a `gender`-tagged note, since Baby
     *  Buddy's Child has no such field. AUTHORITATIVE on edit: passing undefined CLEARS
     *  a recorded gender, so an edit caller must always pass the current value. */
    gender?: ChildGender;
  }) => void;
  /** Clears the expected flag and releases the child for sync. */
  confirmBirth: (id: string, birth: number) => void;
  /** Cascades all their history server-side; NOT undoable. Async because the DELETE has
   *  no replay path, so a failure has to restore the child rather than be swallowed. */
  deleteChild: (id: string) => Promise<void>;

  openAdopt: () => void;
  closeAdopt: () => void;

  openSheet: (type: ActivityType) => void;
  openEdit: (entryId: string) => void;
  openTimerEdit: (timerId: string) => void;
  /** Re-aim the open sheet at these children. Does NOT touch the global selection. An
   *  empty list is ignored, so a draft can never lose its owner. */
  setSheetChildren: (ids: string[]) => void;
  /** Removing the last child is a no-op, for the same reason. */
  toggleSheetChild: (id: string) => void;
  closeSheet: () => void;
  deleteEntry: (id: string) => void;
  undoDelete: () => void;
  /** Stored as a tagged note. Removal reuses deleteEntry(id). */
  logMilestone: (key: string, dateMs: number, note?: string) => void;
  editMilestone: (id: string, dateMs: number, note?: string) => void;
  openMilestone: (key: string) => void;
  openEditMilestone: (id: string) => void;
  closeMilestoneSheet: () => void;
  answerMilestonePrompt: (key: string) => void;

  openMeasurement: (kind: MeasurementKind) => void;
  openEditMeasurement: (id: string) => void;
  closeMeasurementSheet: () => void;
  saveMeasurement: (value: number, date: number, notes?: string) => void;
  deleteMeasurement: (id: string) => void;

  addTreatment: (treatment: Treatment) => void;
  updateTreatment: (treatment: Treatment) => void;
  deleteTreatment: (id: string) => void;
  /** No id = create, an id = edit that treatment. */
  openTreatmentEditor: (id?: string) => void;
  closeTreatmentEditor: () => void;
  openTreatmentPicker: () => void;
  closeTreatmentPicker: () => void;
  openMedicationLog: () => void;
  /** Seed the medication draft from a saved treatment and open the sheet in confirm
   *  mode. No dose is written here; save() commits it once the user confirms. */
  logMedicationFromTreatment: (treatmentId: string) => void;
  expandMedicationLog: () => void;
  setTE: (patch: Partial<TimeEntryState>) => void;
  /** One press of the amount stepper: +1 or -1 step in the user's display units
   *  (10 ml metric, 0.5 fl oz imperial). Stores canonical ml. */
  adjustAmount: (dir: 1 | -1) => void;
  toggleWet: () => void;
  toggleSolid: () => void;
  setWash: (wash: WashKind) => void;
  setNap: (nap: boolean) => void;
  toggleTag: (tag: string) => void;
  createTag: (name: string) => void;
  setEnded: (agoMin: number) => void;
  /** An `anchor` marks which "Ended" chip drove it; omitting it clears that mark. */
  setEndedAbs: (ms: number, anchor?: TimeEntryState['endAnchor']) => void;
  setOngoing: () => void;
  setLasted: (min: number) => void;
  /** Timer-edit "lasted X": pin the duration off the fixed start and mark the entry
   *  finished, so save() stops the timer. */
  setTimerLasted: (min: number) => void;
  setStartedAt: (ms: number, anchor?: 'lastfeed' | 'wake' | 'diaper' | 'now') => void;
  setStartedAgo: (min: number) => void;
  sleepWoke: () => void;
  sleepStillSleeping: () => void;
  save: () => void;

  startQuickTimer: () => void;
  stopTimer: (id: string) => void;
  adjustTimerStart: (id: string, deltaMin: number) => void;
  setTimerStart: (id: string, ms: number) => void;
  discardTimer: (id: string) => void;
  setTimerSaveAs: (id: string, saveAs: ActivityType) => void;
  /** Persist `te`'s metadata onto the running timer named by `fromTimerId`, WITHOUT
   *  stopping it or creating an entry. */
  saveTimerDetails: () => void;

  showToast: (msg: string, action?: ToastAction) => void;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export type AppStore = AppState & AppActions;

/** Merge not-yet-flushed queued entries into freshly-loaded server entries, so an entry
 *  created offline stays visible across an app kill. No de-duplication is needed: server
 *  data never contains a not-yet-flushed queued entry. */
export function mergeQueuedEntries(serverEntries: Entry[], queuedEntries: Entry[]): Entry[] {
  return [...queuedEntries, ...serverEntries];
}

/** The chip set the tag picker renders: server tags first (carrying their display color),
 *  then any selected tag the server doesn't know. Structural markers are dropped from
 *  BOTH sides, though they still round-trip on the entries carrying them. */
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
 * Merge locally-created-but-unsynced records back into a freshly-loaded server list, so
 * an offline create stays visible across a wholesale refresh/hydrate. Children and
 * measurements only, NOT entries: `flushQueue` pushes entries WITHOUT stamping the
 * in-memory record's `serverId`, so merging them here would duplicate one that flushed.
 *
 * `localBefore` is the caller's list as it was when the fetch went OUT, closing a hole
 * `serverId == null` alone cannot: a record created mid-request is in neither side.
 * Keeping every local the answer omits instead would resurrect a record genuinely
 * DELETED server-side. Known gap: an EDIT made in that window is still reverted.
 */
export function mergeUnsynced<T extends { id: string; serverId?: number }>(
  serverList: T[],
  localList: T[],
  localBefore?: T[],
): T[] {
  const serverIds = new Set(serverList.map((r) => r.id));
  // Absent means "no snapshot passed", not an empty one, or every local record would
  // read as created mid-fetch.
  const beforeIds = localBefore && new Set(localBefore.map((r) => r.id));
  const unsynced = localList.filter(
    (r) => !serverIds.has(r.id) && (r.serverId == null || (beforeIds != null && !beforeIds.has(r.id))),
  );
  return [...unsynced, ...serverList];
}

/** The local list is BOTH the offline cache and the only home of treatments created
 *  offline, so a wholesale refresh must not replace it outright. */
export function mergeTreatments(serverTreatments: Treatment[], localTreatments: Treatment[], children: Child[]): Treatment[] {
  return mergeUnsynced(remapChildIds(serverTreatments, children), localTreatments);
}

/** True when `entry` is a WITHHELD record: written against a child that had no
 *  `serverId`, so it was never offered to the server and never queued. Deliberately NOT
 *  inferred from `expected`, `birth` or a timestamp: every such proxy expires at some
 *  transition and silently drops real records. */
function isHeldBackEntry(entry: Entry): boolean {
  return entry.heldBack === true && entry.serverId == null;
}

/** Merge back held-back entries into a freshly-loaded entries list, so a wholesale
 *  refresh/hydrate/adopt doesn't drop them. `children` is only a referential-integrity
 *  guard, not part of the held-back test, so pass it AFTER any child merge has run. */
export function mergeHeldBackEntries(entries: Entry[], localEntries: Entry[], children: Child[]): Entry[] {
  const existingIds = new Set(entries.map((e) => e.id));
  const ownerIds = new Set(children.map((c) => c.id));
  const heldBack = localEntries.filter(
    (e) => !existingIds.has(e.id) && isHeldBackEntry(e) && ownerIds.has(e.childId),
  );
  return [...heldBack, ...entries];
}

/** MIGRATION: backfill `heldBack` on entries persisted before the flag existed. The
 *  criterion (the owner is CURRENTLY `expected`) has no false positives, because
 *  `commitWrite` has never queued an expecting child's entries. One gap is accepted: a
 *  legacy entry whose owner has SINCE been confirmed born is missed. */
function backfillHeldBack(entries: Entry[], children: Child[]): Entry[] {
  const expectingIds = new Set(children.filter((c) => c.expected).map((c) => c.id));
  return entries.map((e) =>
    e.heldBack === undefined && e.serverId == null && expectingIds.has(e.childId) ? { ...e, heldBack: true } : e,
  );
}

/** Field-wise equality over the UNION of both records' keys, so a key
 *  present-but-undefined on one side reads equal to an absent one. Deliberately not
 *  reference equality: a map() that rebuilds every child without changing a value is not
 *  an edit, and calling it one would discard a real server-side change. */
function sameChild(a: Child, b: Child | undefined): boolean {
  if (b === undefined) return false;
  if (a === b) return true;
  // `keyof Child` is asserted at the index rather than on the set: the store's own
  // `type Set` alias shadows the global one in every TYPE position in this file.
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k as keyof Child] !== b[k as keyof Child]) return false;
  }
  return true;
}

/** Reconcile a server child list onto the local one WITHOUT changing any local `id`. The
 *  server's values win, with two exceptions: the local `id` survives, because entries and
 *  measurements reference it, and the local `color` survives, because Baby Buddy has no
 *  color field at all.
 *
 *  `localBefore` is the caller's PRE-FETCH snapshot. Anything that differs from it was
 *  written while the fetch was in flight, so the answer predates it and such a child
 *  keeps its WHOLE local record, `slug` included: the fresh slug arrives on the PATCH
 *  response rather than this GET, so taking the answer's would overwrite a completed
 *  re-stamp with the name it replaced, exactly the stale key that 404s the next rename or
 *  delete. A child REMOVED locally mid-fetch comes back under its LOCAL id and tint, so a
 *  queued entry written against it can still resolve its owner. */
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
  // Matched by local `id`: `serverId` is exactly one of the things a mid-flight push
  // stamps, so it cannot be the key here.
  const beforeById = new Map(localBefore.map((c) => [c.id, c]));
  const writtenMidFetch = (c: Child) => !sameChild(c, beforeById.get(c.id));
  // The mirror case: removed locally mid-fetch and still in the answer. Re-added below
  // under its OLD local id, which a queued entry may still carry.
  const localIds = new Set(localChildren.map((c) => c.id));
  const removedMidFetch = new Map<number, Child>();
  for (const c of localBefore) {
    if (c.serverId != null && serverIds.has(c.serverId) && !localIds.has(c.id)) removedMidFetch.set(c.serverId, c);
  }
  // Every child whose tint is already settled, gathered UP FRONT rather than filled as
  // the map runs: that is what makes the result independent of the server's ordering.
  const assigned: Child[] = [
    ...localChildren.filter((c) => c.serverId == null || serverIds.has(c.serverId) || writtenMidFetch(c)),
    ...removedMidFetch.values(),
  ];
  const reconciled = serverChildren.map((sc) => {
    const local = sc.serverId != null ? localByServerId.get(sc.serverId) : undefined;
    if (local) return writtenMidFetch(local) ? local : { ...sc, id: local.id, color: local.color };
    const removed = sc.serverId != null ? removedMidFetch.get(sc.serverId) : undefined;
    if (removed) return { ...sc, id: removed.id, color: removed.color };
    // Only a genuinely new child needs a tint, and only it joins `assigned`: counting
    // an already-listed match twice would skew `nextChildColor`'s least-used fallback.
    const child: Child = { ...sc, color: nextChildColor(assigned) };
    assigned.push(child);
    return child;
  });
  const reconciledIds = new Set(reconciled.map((c) => c.id));
  // Locals the server list did not account for: never pushed, or written mid-fetch.
  const kept = localChildren.filter(
    (c) => !reconciledIds.has(c.id) && (c.serverId == null || writtenMidFetch(c)),
  );
  return [...kept, ...reconciled];
}

/** Translate incoming records' `childId` from the server's child id to the LOCAL id of
 *  the child that owns it. Must run AFTER `reconcileChildren`, on its output: that is
 *  the only place the authoritative local id for a since-synced child is known. An
 *  unresolvable record keeps its `childId` rather than moving to the wrong owner. */
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

/** Give an owner to timers persisted before every creation path stamped one: the
 *  SELECTED child, and only when born, mirroring `stopTimer`'s refusal to log against an
 *  `expected` child. Deliberately does NOT touch queued timer-update payloads, which
 *  `removePendingOp` matches by `JSON.stringify`. */
function stampTimerOwners(timers: Timer[], children: Child[], selectedChildId: string): Timer[] {
  if (!timers.some((t) => t.childId == null)) return timers;
  const selected = children.find((c) => c.id === selectedChildId);
  if (!selected || selected.expected) return timers;
  return timers.map((t) => (t.childId == null ? { ...t, childId: selected.id } : t));
}

/** Lay a server-loaded feeding prefill over the local one, translating its keys out of
 *  the SERVER's child id space. Merged, never replaced: the load answers only for
 *  children that have ever been fed. */
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

/** The server id of the child a record belongs to, or null when that child has never been
 *  pushed. Such a record MUST NOT be sent: the server rejects it and the retry queue
 *  replays it verbatim forever. */
function childServerIdFor(children: Child[], childId: string): number | null {
  return children.find((c) => c.id === childId)?.serverId ?? null;
}

// 90-day insights history for a child: local rows in local mode, the server history
// otherwise (empty for a child that has never been pushed).
async function fetchInsightsEntries(s: AppState, childId: string): Promise<Entry[]> {
  const conn = s.connection!;
  if (conn.mode === 'local') return s.entries.filter((e) => e.childId === childId);
  const childServerId = childServerIdFor(s.children, childId);
  return childServerId == null
    ? []
    : loadInsightsHistory(conn, String(childServerId), s.now - 90 * 86400000);
}

/** Resolve `loadFromServer`'s `selectedChildId` (a SERVER-space id) into the RECONCILED
 *  local id space by matching `serverId`, never by comparing to local ids directly. */
function resolveSelectedChildId(reconciledChildren: Child[], serverSelectedChildId: string): string {
  return (
    reconciledChildren.find((c) => String(c.serverId) === serverSelectedChildId)?.id ??
    reconciledChildren[0]?.id ??
    ''
  );
}

/** Build uploadUnsynced's push-fn deps bound to a server connection, for `adopt` and
 *  `flushUnsynced`, the only two callers that push local-only records up. */
function buildUploadDeps(conn: Connection): UploadDeps {
  return {
    // A child pushed here may owe the server a photo. The record is settled only on a
    // push that landed, and only if it is still the record this push consumed. The
    // picture comes back only when one was uploaded, so a `null` from a photoless POST
    // can never blank a local file path.
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

/** Record what a child owes the server, for a save that will not upload the photo itself.
 *  Called only when the change is durable: a cache URI recorded here would name a file
 *  Android can reclaim before the reconnect. A removal always REPLACES whatever was
 *  recorded, or picking a photo offline and then removing it would leave a stale `set`.
 *  The file a record replaces is discarded here, so re-picking ten times offline does not
 *  hold ten files. */
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

/** The PhotoChange a deferred push should carry for this child, reopened from the
 *  recorded path, plus the RECORD it was read from. The record travels with the change
 *  because every consumer awaits a round trip before settling, and the settle has to tell
 *  the record it consumed from one written during that trip. A recorded `set` whose file
 *  has gone missing answers `{kind:'none'}`: no retry can bring the file back. */
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

/** Finished with this child's pending photo: drop the record and the file. Called only
 *  where the answer is final, never on a retryable failure. Pass the record the caller
 *  CONSUMED: a re-pick during the round trip writes a new one, and clearing
 *  unconditionally would delete a photo that was never uploaded. */
async function settlePendingPhoto(childId: string, consumed?: PendingPhoto): Promise<void> {
  const gone = consumed ? await clearPendingPhotoIf(childId, consumed) : await clearPendingPhoto(childId);
  if (gone?.kind === 'set') await discardPhotoFile(gone.uri);
}

/** Delete every stored photo file nothing points at any more: the orphans no single call
 *  site can collect, such as a sheet cancelled after picking. */
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

/** A server load's degraded slices in LOCAL child id space: which of each child's record
 *  slices came back as a FLOOR rather than an answer, because their fetch failed. Those
 *  rows must be kept rather than replaced, as a null `timers` keeps the on-device ones. */
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

/** Keep the rows this device already holds for a child's DEGRADED slices rather than
 *  letting the load's empty answer through, or one timed-out request empties that slice
 *  and the persistence subscription deletes the month chunks. Deliberately NOT unioned
 *  with what the load did return: a union would keep a record deleted in Baby Buddy's own
 *  UI alive for as long as the slice kept degrading. */
export function carryOverIncomplete<T extends { id: string; childId: string }>(
  merged: T[],
  previous: T[],
  // `ReadonlyMap`/`ReadonlySet`, not `Map`/`Set`: the store's own `type Set` alias (the
  // zustand setter, above) shadows the global one for every TYPE position in this file.
  degradedSlices: ReadonlyMap<string, ReadonlySet<LoadSlice>>,
  sliceOf: (record: T) => LoadSlice,
): T[] {
  if (degradedSlices.size === 0) return merged;
  const sliceKey = (r: T) => `${r.childId} ${sliceOf(r)}`;
  const degraded = (r: T) => degradedSlices.get(r.childId)?.has(sliceOf(r)) === true;
  // The (child, slice) pairs that are degraded AND populated on this device.
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
 * Apply a successful `loadFromServer` result over the local view of the same data, as
 * ONE `set()`. Shared by `refresh()`, `hydrate()` and `connect()`, so a reconnect after a
 * session expiry cannot replace local-id children with server-shaped ones and strand
 * every queued entry whose `childId` only the local list could resolve.
 *
 * Callers gather `local` AFTER their fetch, never from a pre-fetch snapshot: a record
 * written mid-request is in neither the answer nor that snapshot. Two exceptions are
 * deliberate: `refresh` reads `local.timers` BEFORE its fetch so a widget start/stop
 * reconciles even when the server is unreachable, and the `*Before` snapshots are
 * pre-fetch because they tell a mid-flight write apart from a server-side change.
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
    /** Pre-fetch snapshots, which only `refresh` has: what tells a record created
     *  mid-request apart from one deleted server-side. */
    childrenBefore?: Child[];
    measurementsBefore?: Measurement[];
  },
  extra: Partial<AppState> = {},
): void {
  const reconciledChildren = reconcileChildren(data.children, local.children, local.childrenBefore);
  // Incoming records carry the SERVER's child id; rewrite it to the local id now that
  // reconciliation has produced the authoritative mapping.
  const remappedEntries = remapChildIds(data.entries, reconciledChildren);
  const remappedMeasurements = remapChildIds(data.measurements, reconciledChildren);
  // `incompleteSlices` is not an `AppState` key and must not ride the spread below.
  const { incompleteSlices, ...applied } = data;
  const degradedSlices = degradedSlicesByChild(incompleteSlices, reconciledChildren);
  // Checked against the RECONCILED list, not just the server's, so a local child kept
  // visible by reconcileChildren above doesn't get silently deselected.
  const selectedChildId = reconciledChildren.some((c) => c.id === local.selectedChildId)
    ? local.selectedChildId
    : resolveSelectedChildId(reconciledChildren, data.selectedChildId);
  set({
    ...extra,
    ...applied,
    children: reconciledChildren,
    // Merging the local unsynced measurements back in keeps a wholesale reload from
    // dropping them before `flushUnsynced` pushes them. Entries are excluded from that
    // merge: the queue merge below is their only source.
    measurements: carryOverIncomplete(
      mergeUnsynced(remappedMeasurements, local.measurements, local.measurementsBefore),
      local.measurements,
      degradedSlices,
      (m) => m.kind,
    ),
    entries: carryOverIncomplete(
      mergeHeldBackEntries(mergeQueuedEntries(remappedEntries, local.q), local.entries, reconciledChildren),
      // What this device holds is state PLUS the write queue: an entry logged mid-
      // request is in neither the state snapshot nor a floor of an answer.
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
    // A null `timers` is "the fetch failed, unknown", not "none running": reconciling
    // against an answer we never got would drop every running synced timer as stopped
    // elsewhere. Must stay AFTER the `...data` spread, so the null never reaches state.
    timers:
      data.timers == null
        ? local.timers
        : reconcileTimers(local.timers, remapChildIds(data.timers, reconciledChildren)),
    // Also after the spread, for a different reason: the answer is right but PARTIAL.
    // It names only the children that have ever been fed, so spreading it wholesale
    // would drop the prefill of every child who has not.
    lastFeed: mergeLastFeed(local.lastFeed, data.lastFeed, reconciledChildren),
  });
}

/** Mirror a freshly-created local timer to the server. If the timer was stopped or
 *  discarded before the POST resolved, delete the orphan the POST created. */
function mirrorTimerCreate(get: Get, set: Set, timerId: string): void {
  const s = get();
  const conn = s.connection;
  if (!conn || conn.mode !== 'server' || s.offline) return;
  const timer = s.timers.find((t) => t.id === timerId);
  if (!timer) return;
  // A fresh retry budget: a timer started an hour after a failure isn't stuck with a
  // spent one.
  timerRetryAttempt = 0;
  // The timer's own owner, with no fallback to the selection: pushing an unowned timer
  // under whoever is selected would put the misattribution on the SERVER.
  const child = s.children.find((c) => c.id === timer.childId);
  // `flushUnsynced` pushes the child first and the timer straight after.
  if (!child || child.serverId == null) {
    scheduleUnsyncedTimerFlush(get);
    return;
  }
  void pushTimerToServer(conn, timer, child.serverId)
    .then((serverId) => {
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
      console.warn('[timers] create failed, retrying:', e);
      scheduleUnsyncedTimerFlush(get);
    });
}

/** Mirror an edit to an already-synced timer: PATCH online, queue offline. An unsynced
 *  timer needs nothing here; its eventual create encodes the current fields. */
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

/** Where a "still ongoing" interval actually started. On an EDIT the logged entry's own
 *  `start` is the only exact answer: `openEdit` pins the end plus a duration ROUNDED to
 *  whole minutes, so the rounding alone can move a derived start by half a minute. */
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

/** Build a running Timer from the log sheet's draft. `notes` and `tags` stay
 *  device-local: `encodeTimerName` deliberately keeps them out of the server timer's
 *  name, which is a cross-device wire format. */
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

/** Mirror a stop/discard: delete the server timer online, queue it offline. */
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

/** Does this draft's `amount` hold a VOLUME the stepper edits? A feeding's `amount` is
 *  dual-purpose: a breast feed records a dimensionless intake level that must never be
 *  treated as a measurement. */
function draftAmountIsVolume(type: ActivityType, te: TimeEntryState): boolean {
  if (type === 'pumping') return true;
  if (type === 'feeding') return feedAmountIsVolume(te.feedType, te.method);
  return false;
}

/** Snap a draft's volume amount onto the active unit system's step grid. The stepper
 *  shows imperial to one decimal, so a stored value just off a grid point renders
 *  identically to the one below it and the press that closes the gap looks dead. */
function snapDraftAmount(type: ActivityType, te: TimeEntryState, system: UnitSystem): TimeEntryState {
  if (te.amount == null || !draftAmountIsVolume(type, te)) return te;
  return { ...te, amount: snapVolume(te.amount, system) };
}

/** The three CHILD-scoped seeds a feeding draft opens on, in one function so `openSheet`,
 *  `openTimerEdit` and a re-aim cannot disagree. `method` is the ALTERNATED side. */
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

/** Point the open sheet at `ids`, carrying any child-scoped seed along with it. The one
 *  write path for the target, so no caller can re-aim on different terms. */
function aimSheetAt(get: Get, set: Set, ids: string[]): void {
  const te = reseedTargetScopedDraft(get(), ids);
  set(te ? { sheetChildIds: ids, te } : { sheetChildIds: ids });
}

/** The draft the sheet should hold once re-aimed at `ids`, or null when nothing moves. A
 *  bath's suggested wash and a feeding's type/method/start side are CHILD-scoped, so
 *  re-aiming has to recompute them, or the sheet offers one twin's suggestion as the
 *  other's and SAVES it. Four guards keep the user's own choices: the per-field `*Edited`
 *  flags, an EDIT, a TIMER-EDIT, and a multi-target draft. */
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
    // The same stale-amount hazard `setTE` guards, reached by another door: an intake
    // of 3 is not 3 ml, so drop it rather than save the wrong kind of number.
    if (feedAmountIsVolume(s.te.feedType, s.te.method) !== feedAmountIsVolume(next.feedType, next.method)) {
      next.amount = undefined;
    }
    return next;
  }
  return null;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
// The most recently removed entry, held so an "Undo" toast can restore it.
// `didServerDelete` keeps undo from re-creating a record the server never lost, and
// `timerId` names the running timer that replaced it, which undo must discard too.
let lastDeleted: {
  entry: Entry;
  index: number;
  didServerDelete: boolean;
  timerId?: string;
  requeue: boolean;
} | null = null;

/** The two pieces of state that mirror the offline write queue, derived together so no
 *  site can update the count and forget the ids. */
function queueMirror(q: Entry[]): { queueCount: number; queuedIds: string[] } {
  return { queueCount: q.length, queuedIds: q.map((e) => e.id) };
}

/** Take an entry out of circulation everywhere it might still exist, and record what Undo
 *  needs to put it back. The write-queue scrub is the non-obvious half: an entry created
 *  offline sits on the queue file, which `flushQueue` pushes without reading `entries`. */
function detachEntry(get: Get, set: Set, entry: Entry, index: number, timerId?: string): void {
  const s = get();
  const conn = s.connection;
  const didServerDelete = entry.serverId != null && !!conn && conn.mode === 'server' && !s.offline;
  const record = { entry, index, didServerDelete, timerId, requeue: false };
  lastDeleted = record;
  if (didServerDelete) {
    void deleteEntryFromServer(conn, entry.type, entry.serverId as number).catch(() => {});
  } else if (entry.serverId != null && !!conn && conn.mode === 'server' && s.offline) {
    // Already on the server, removed offline: replay on reconnect, or the record
    // resurrects on the next refresh().
    void addPendingOp({ op: 'delete', entity: 'entry', entryType: entry.type, serverId: entry.serverId });
  }
  void removeQueuedEntry(entry.id).then(({ removed, queue }) => {
    if (!removed) return;
    set(queueMirror(queue));
    record.requeue = true;
  });
}

/** Retry schedule for a timer create that didn't land. A create has no queue of its own:
 *  an unsynced record is already durable and `flushUnsynced` reconciles it, but nothing
 *  RUNS that. Bounded, so a broken server cannot keep a chain spinning forever. */
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
    // `setNetworkOnline`/`setOffline` already flush on the way back up.
    if (!s.connection || s.connection.mode !== 'server' || s.offline) {
      timerRetryAttempt = 0;
      return;
    }
    if (!s.timers.some((t) => t.serverId == null)) {
      timerRetryAttempt = 0;
      return;
    }
    // `catch` before `finally`: flushUnsynced does not catch its own uploader, so a bare
    // `.finally()` here would leave the rejection unhandled.
    void s
      .flushUnsynced()
      .catch(() => {})
      .finally(() => {
        if (get().timers.some((t) => t.serverId == null)) scheduleUnsyncedTimerFlush(get);
        else timerRetryAttempt = 0;
      });
  }, delay);
}

/** Drop any scheduled timer retry. Tests only: the handle is module state, so without
 *  this a chain armed by one test fires during a later one. */
export function resetTimerRetryForTests(): void {
  if (timerRetryHandle) clearTimeout(timerRetryHandle);
  timerRetryHandle = undefined;
  timerRetryAttempt = 0;
}

/** The write queue's twin of `scheduleUnsyncedTimerFlush`: `commitWrite` makes a
 *  rejected push durable, but durable is not delivered, and nothing else drains the
 *  queue except hydrate, refresh and the offline/network transitions. */
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
    if (!s.connection || s.connection.mode !== 'server' || s.offline) {
      queueRetryAttempt = 0;
      return;
    }
    if (s.queueCount === 0) {
      queueRetryAttempt = 0;
      return;
    }
    // `flushQueue` swallows its per-entry failures and resolves either way, so the
    // re-arm decision is the queue count rather than a rejection.
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

let refreshInFlight = false;
// Overlapping flushes would both POST the same serverId==null child.
let flushUnsyncedInFlight = false;
// Overlapping flushQueue calls would both read the same stored queue before either saves,
// and POST every entry twice. Holds the PROMISE rather than a boolean so a second caller
// can JOIN the running flush, or Retry reports a successful sync as "Nothing uploaded".
let flushQueueInFlight: Promise<void> | null = null;
// The op-log twin. Foregrounding fires `refresh()` and `setNetworkOnline` within
// milliseconds of each other, so two concurrent runs are the ordinary case.
let flushPendingOpsInFlight: Promise<void> | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
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

  tick: (now) => set({ now }),

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
    // Re-align an open sheet's draft amount onto the new system's grid.
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
    // Switching ON stamps the anchor the reminder grid is built from, so a parent who has
    // never logged a pump still gets reminders. OFF clears it, so re-enabling later does
    // not resume an ancient phase.
    if (key === 'pumpingReminders') {
      const pumpingEnabledAt = value ? Date.now() : null;
      set({ pumpingReminders: value, pumpingEnabledAt });
      void savePrefs({ pumpingReminders: value, pumpingEnabledAt });
      return;
    }
    if (key === 'treatmentReminders') {
      // The same resync lever, except this stamp can only MOVE an existing interval
      // grid and does nothing to a times-of-day treatment.
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
    // The child's current rhythm is the fallback, so a patch touching one axis cannot
    // reset the other.
    const s = get();
    const current = rhythmForChild(s.bathRhythms, childId, s.legacyRhythm);
    const next = clampBathRhythm({ ...current, ...patch }, current);
    const map = { ...s.bathRhythms, [childId]: next };
    set({ bathRhythms: map });
    void saveBathRhythms(map);
  },
  setNapWindow: (startMin, endMin) => {
    // Both endpoints written as a unit: two independent setters would each do a
    // load-then-merge inside savePrefs, and back-to-back edits could drop one.
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

  hydrate: async () => {
    const conn = await loadConnection();
    const q = await loadQueue();
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
    // `!== undefined`: a persisted null is a real value here (the toggle is off).
    if (prefs.treatmentRemindersEnabledAt !== undefined)
      set({ treatmentRemindersEnabledAt: prefs.treatmentRemindersEnabledAt });
    if (prefs.milestoneCatchUp != null) set({ milestoneCatchUp: prefs.milestoneCatchUp });
    set({ legacyRhythm: legacyBathRhythm(prefs.smallWashesPerBig ?? undefined) });
    // `!= null`, not truthy: 0 is midnight, an ordinary boundary a truthy guard drops.
    if (prefs.napWindowStartMin != null) {
      set({ napWindowStartMin: clampMinuteOfDay(prefs.napWindowStartMin, NAP_WINDOW_START_DEFAULT) });
    }
    if (prefs.napWindowEndMin != null) {
      set({ napWindowEndMin: clampMinuteOfDay(prefs.napWindowEndMin, NAP_WINDOW_END_DEFAULT) });
    }
    if (prefs.rhythmOriginHour != null) {
      set({ rhythmOriginHour: clampHourOfDay(prefs.rhythmOriginHour, RHYTHM_ORIGIN_DEFAULT) });
    }
    if (prefs.rhythmShowSleep != null) set({ rhythmShowSleep: prefs.rhythmShowSleep });
    if (prefs.rhythmShowFeeds != null) set({ rhythmShowFeeds: prefs.rhythmShowFeeds });
    if (prefs.rhythmShowDiapers != null) set({ rhythmShowDiapers: prefs.rhythmShowDiapers });
    set({ answeredMilestonePrompts: await loadMilestonePrompts() });
    set({ bathRhythms: await loadBathRhythms() });
    // Loaded unconditionally: treatments are user data that survives disconnect.
    set({ treatments: await loadTreatments() });
    // `stampTimerOwners` runs per branch rather than here: the child list and selection
    // it needs only exist once the entity store is read.
    const savedTimers = await loadTimers();
    let savedServers = await loadServers();
    // Migration for users who connected before the saved-servers list existed.
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
      // No entity store is read here, so there is no roster and no selection: an
      // ownerless timer stays ownerless until a later hydrate.
      set({ hydrating: false, ...queueMirror(q), timers: savedTimers });
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
      void sweepChildPhotos(get().children);
      return;
    }
    // Cache-first: enter the app on the durable entity store IMMEDIATELY and leave the
    // server to a background refresh(). _layout renders nothing while `hydrating`, so
    // awaiting the load means every cold start away from the home LAN, where the address
    // black-holes rather than refuses, sits on the splash until the socket gives up.
    const saved = await loadEntities();
    const localEntries = backfillHeldBack(saved?.entries ?? [], saved?.children ?? []);
    // Stored entries are the base, queue-only entries layered on top, never the queue
    // alone: the persistence subscription writes this list straight back over the entity
    // store, so a queue-only list would permanently lose held-back records.
    const storedIds = new Set(localEntries.map((entry) => entry.id));
    const queueOnly = q.filter((entry) => !storedIds.has(entry.id));
    set({
      connection: conn,
      connected: true,
      hydrating: false,
      // NOT `offline: true`: nothing has failed yet, and the refresh below owns that.
      children: saved?.children ?? [],
      entries: [...queueOnly, ...localEntries],
      measurements: saved?.measurements ?? [],
      // Restore the selection alongside `children`: a present-but-unselected child falls
      // through Home's expecting branch to the activity tiles, and a write against it
      // carries `childId: ''`, which flushQueue can never resolve.
      selectedChildId: saved?.selectedChildId ?? '',
      lastFeed: saved?.lastFeed ?? {},
      legacyLastFeed: saved?.legacyLastFeed ?? LAST_FEED_DEFAULT,
      timers: stampTimerOwners(savedTimers, saved?.children ?? [], saved?.selectedChildId ?? ''),
      ...queueMirror(q),
    });
    // refresh() reads `s.children`/`s.selectedChildId` to nominate the preferred child,
    // which the set() above just populated, so keep that ordering. Not awaited:
    // hydrate's contract is "the UI can render", not "the server has answered".
    void get().refresh();
    void sweepChildPhotos(get().children);
  },
  refresh: async () => {
    const s = get();
    const conn = s.connection;
    if (!conn || conn.mode !== 'server' || s.simulateOffline || refreshInFlight) return;
    refreshInFlight = true;
    // Timers can be mutated out-of-band by the home-screen widget while the app is warm,
    // so re-read the on-device copy. Done up front so a widget-stopped nap reconciles
    // even when the server is unreachable.
    const localTimers = await loadTimers();
    try {
      // Every child's records come back, not just the selected one's. The id passed here
      // does not steer the fetch, it only nominates the answer's `selectedChildId`.
      const data = await loadFromServer(conn, childServerIdFor(s.children, s.selectedChildId));
      // This reload replaces `entries` wholesale, and an entry that has not flushed yet is
      // not in the server data. Read AFTER the fetch so an entry logged mid-request is
      // included; `flushQueue` drops one from the file the moment the server accepts it,
      // so nothing here can duplicate a loaded row.
      const q = await loadQueue();
      // Read at APPLY time, not from the pre-fetch `s`: everything written mid-request is
      // missing from that snapshot, and applying the answer over it silently undoes the
      // write. Returning from the OS image picker is exactly this window, since it
      // backgrounds the app and AppState 'active' fires this refresh.
      const cur = get();
      applyServerLoad(
        set,
        data,
        {
          children: cur.children,
          // Pre-fetch snapshots: the difference is the mid-flight write to preserve, such
          // as a measurement whose push stamped a `serverId` before the apply.
          childrenBefore: s.children,
          entries: cur.entries,
          measurements: cur.measurements,
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
        // Still reconcile local timers so a widget start/stop shows while offline.
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
      // Reconcile rather than taking `...data` wholesale: a session expiry clears the
      // connection but not the local data, and a wholesale spread re-keys every child to
      // its server-derived id, so a queued entry referencing a LOCAL child id can never
      // resolve again and fails on every flush.
      //
      // Cross-server gate: the reconcile matches by `serverId`, and numeric ids from
      // DIFFERENT servers collide (child 501 exists on every server), so merging is only
      // safe when the local data came from this server. The origin label lives with the
      // DATA, so it survives the 401 gap that clears the connection.
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
      // Read AFTER the fetch, mirroring `refresh`. The queue is deliberately NOT
      // origin-gated: a cross-origin queued entry cannot flush anyway.
      const q = await loadQueue();
      const localTimers = await loadTimers();
      applyServerLoad(
        set,
        data,
        {
          ...local,
          treatments: sameOrigin ? s.treatments : [],
          // Another origin's timers must not reconcile against this server's, EXCEPT
          // when the timers fetch failed (null): that is about the fetch, not id space.
          timers: sameOrigin || data.timers == null ? localTimers : [],
          q,
        },
        {
          connection: conn,
          connected: true,
          connecting: false,
          savedServers,
          // The only place the pre-map feeding fallback can reach state on a cold start
          // parked at the reconnect screen, since `hydrate`'s no-connection branch reads
          // no entity store.
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
      // A cross-origin connect took the local side as empty, so every pending photo record
      // names a child id that is gone, and `sweepChildPhotos` reads one as a reason to
      // keep its file forever. Sequenced, not two `void`s: a sweep that read the map first
      // would keep exactly the files the wipe just orphaned.
      if (!sameOrigin) void clearPendingPhotos().then(() => sweepChildPhotos(get().children));
      // Re-stamp the origin label the gate above reads.
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
    // Server-switch reset: a prior abandoned adoption stamped serverIds against a
    // DIFFERENT server, and those ids would make this adoption skip records that were
    // never pushed here. Read from durable storage so the reset survives an app kill.
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

    // Probe first: this also validates the token.
    let hasData: boolean;
    try {
      hasData = await serverHasData(conn);
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : "Couldn't reach the server." };
    }
    if (hasData && !opts?.uploadAnyway) {
      // The UI offers "upload anyway" or "use server data" from here.
      return { status: 'guard' };
    }

    const s = get();
    let state = { children: s.children, entries: s.entries, measurements: s.measurements, treatments: s.treatments };
    if (hasData && opts?.uploadAnyway) {
      // Dedup: attach each unsynced local child to a server child matching by name and
      // birth date, instead of duplicating it.
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
    // Persist stamped serverIds immediately so a partial upload is resumable on retry.
    // `uploadUnsynced` knows nothing about `heldBack`, so clear that here.
    set({
      children: result.children,
      entries: result.entries.map((e) => (e.heldBack && e.serverId != null ? { ...e, heldBack: false } : e)),
      measurements: result.measurements,
      treatments: result.treatments ?? s.treatments,
    });

    // An expected child is deliberately held back, so it never gets a serverId and its
    // records are skipped too. None of that is a failed upload.
    const expectingChildIds = new Set(result.children.filter((c) => c.expected).map((c) => c.id));
    const stillUnsynced =
      result.children.some((c) => c.serverId == null && !c.expected) ||
      result.entries.some((e) => e.serverId == null && !expectingChildIds.has(e.childId)) ||
      result.measurements.some((m) => m.serverId == null && !expectingChildIds.has(m.childId)) ||
      (result.treatments ?? []).some((c) => c.serverId == null && !expectingChildIds.has(c.childId));
    if (stillUnsynced) {
      // Stay in local mode, keeping `adoptTarget` so a retry against the SAME server
      // doesn't wrongly reset the ids just stamped.
      return { status: 'partial' };
    }

    const savedServers = upsertServer(get().savedServers, {
      serverUrl,
      token,
      lastUsedAt: Date.now(),
    });
    set({ connection: conn, connected: true, savedServers });
    void saveConnection(conn);
    // Stamp the origin label so a post-expiry reconnect through connect() is allowed to
    // reconcile these entities.
    void saveEntityOrigin(normalizeServerUrl(serverUrl));
    void persistServers(savedServers);
    // The only pre-fetch reads here: they tell a record written during the GET apart
    // from one the server changed.
    const childrenBefore = get().children;
    const measurementsBefore = get().measurements;
    const data = await loadFromServer(conn);
    // Read AFTER the fetch, like `connect` and `refresh`. That window is real, not
    // theoretical: `BottomSheet`'s scrim has no busy gate, so a tap outside dismisses
    // the adopt sheet mid-flight and leaves the user on a fully interactive app.
    const localChildren = get().children;
    const localEntries = get().entries;
    const localMeasurements = get().measurements;
    const localSelectedChildId = get().selectedChildId;
    // The children just uploaded kept their local ids, and entries/measurements still
    // reference those, so `data.children` as-is would swap in server ids and orphan them.
    const reconciledChildren = reconcileChildren(data.children, localChildren, childrenBefore);
    const remappedEntries = remapChildIds(data.entries, reconciledChildren);
    const remappedMeasurements = remapChildIds(data.measurements, reconciledChildren);
    // An expecting child's records never reach the server, so merge the local copies back
    // in. The held-back merge, not a blanket serverId==null filter, so this can never
    // duplicate an entry that already flushed.
    const mergedMeasurements = mergeUnsynced(remappedMeasurements, localMeasurements, measurementsBefore);
    const mergedEntries = mergeHeldBackEntries(remappedEntries, localEntries, reconciledChildren);
    // The partial-load guard: without it one degraded request deletes the history this
    // adopt just uploaded. `incompleteSlices` is not an `AppState` key and must not ride
    // the spread below into the store.
    const { incompleteSlices, ...applied } = data;
    const degradedSlices = degradedSlicesByChild(incompleteSlices, reconciledChildren);
    // Checked against the RECONCILED list, not just the server's, so an expecting child
    // kept visible above doesn't get silently deselected.
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
      // A null `timers` is "the fetch failed, unknown" and must never land in state
      // through the `...data` spread above.
      timers: data.timers == null ? get().timers : remapChildIds(data.timers, reconciledChildren),
      // AFTER the spread: the answer names only the children that have ever been fed,
      // so taking it wholesale would drop the prefill of every child who has not.
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
    // Label the entity store so a later server connect cannot merge it by serverId.
    void saveEntityOrigin('local');
    // The child list was just replaced, so a pending photo record names a child that is
    // gone, and `sweepChildPhotos` reads one as a reason to keep its file forever.
    // Sequenced, not two `void`s: a sweep that read the map first would keep exactly the
    // files the wipe just orphaned.
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
    // Join the flush already running: two passes over the queue push every entry twice.
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
          // The child's own push hasn't landed yet: keep the entry queued rather than
          // sending a local id the server would reject.
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
        // Stamp the id the server just assigned: `detachEntry` reads exactly this field to
        // decide whether a delete needs a server DELETE, so an unstamped row would be
        // deleted locally only and come back on the next refresh. Functional `set` so a
        // save landing mid-flush is not dropped.
        if (serverId != null) {
          set((st) => ({
            entries: st.entries.map((e) => (e.id === entry.id ? { ...e, serverId } : e)),
          }));
        }
        // Drop it the moment the server has it, one entry at a time. `refresh()` merges
        // the queue file back into `entries`, so "in the file" has to keep meaning "the
        // server does not have this", or a refresh landing mid-flush shows one feed as two
        // rows. `removeQueuedEntry` re-reads the file and drops one id, so an entry
        // enqueued meanwhile by the widget's headless task survives.
        const { queue } = await removeQueuedEntry(entry.id);
        set(queueMirror(queue));
      }
      // Re-read: anything enqueued during the run belongs in the count too.
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
    // Join the flush already running: two passes over the op log replay every op twice.
    if (flushPendingOpsInFlight) return flushPendingOpsInFlight;
    const run = (async () => {
      const s = get();
      const conn = s.connection;
      if (!conn || conn.mode !== 'server' || s.offline) return;
      const ops = await loadPendingOps();
      if (ops.length === 0) return;
      for (const op of ops) {
        // On success, compare-and-clear against the record this pass actually sent, so a
        // photo re-picked mid-round-trip is left for its own push; on a terminal 404 clear
        // unconditionally, since a record left behind strands its file forever.
        let consumedPhoto: PendingPhoto | undefined;
        let childGone = false;
        try {
          if (op.op === 'update' && op.entity === 'child') {
            // Address the child by the slug state holds RIGHT NOW, not the one frozen into
            // the payload at enqueue time. Two offline renames queue two ops both carrying
            // the ORIGINAL slug; replaying the first moves the slug, so the second would
            // 404 forever and the op log would never drain.
            const live = get().children.find((c) => c.id === op.payload.id);
            const payload = live?.slug ? { ...op.payload, slug: live.slug } : op.payload;
            // Reopened from the document directory, which is why it is still there: the
            // file the picker handed back lived in Android's evictable cache.
            const { change, consumed } = await pendingPhotoChange(op.payload.id);
            consumedPhoto = consumed;
            const res = await updateChildOnServer(conn, payload, change);
            // A replayed rename moves the slug server-side, and the child endpoints are
            // keyed by it, so re-stamp it here or the next delete 404s and the child
            // comes back.
            const slug = res?.slug;
            if (slug || change.kind !== 'none') {
              set((st) => ({
                children: st.children.map((c) => {
                  if (c.id !== op.payload.id) return c;
                  const next = slug ? { ...c, slug } : c;
                  if (change.kind === 'none') return next;
                  // On a remove, `null` IS the answer; on a set it means the server
                  // stored nothing, and taking it would discard the only copy left.
                  const picture = change.kind === 'remove' ? (res?.picture ?? null) : (res?.picture ?? c.picture);
                  return { ...next, picture };
                }),
              }));
            }
            // Gender lives in its own `gender`-tagged note, so replay it as a second
            // write, AFTER the slug re-stamp and deliberately NOT caught: a failure
            // re-queues the whole op, and the child PATCH is idempotent.
            if (payload.serverId != null) {
              await setChildGenderOnServer(conn, payload.serverId, payload.gender, Date.now());
            }
          } else if (op.op === 'update' && op.entity === 'measurement') {
            const childServerId = childServerIdFor(s.children, op.payload.childId);
            // Child not on the server: fall through to the catch so the op stays queued.
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
            // The token is dead, so every remaining op would fail the same way. The ops
            // stay on file, and refresh()'s session-expiry handling owns the situation.
            break;
          }
          if (!(e instanceof ApiError && e.status === 404)) {
            // Retryable: leave the op on the file for the next flush.
            continue;
          }
          // 404: the target is already gone. Terminal for updates and deletes alike, so
          // remove the op like a success; otherwise it is replayed on every flush.
          childGone = true;
        }
        if (op.op === 'update' && op.entity === 'child') {
          if (childGone) await settlePendingPhoto(op.payload.id);
          else if (consumedPhoto) await settlePendingPhoto(op.payload.id, consumedPhoto);
        }
        // Drop the op one at a time, by value. Saving a survivors list at the end of the
        // run is last-write-wins: it clobbers ops `addPendingOp` recorded mid-run and,
        // when two runs race, resurrects ones the other already replayed.
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
    // Overlapping flushes would both read the same serverId==null child and both POST
    // it, duplicating it on the server.
    if (flushUnsyncedInFlight) return;
    flushUnsyncedInFlight = true;
    try {
      const s = get();
      const conn = s.connection;
      if (!conn || conn.mode !== 'server' || s.offline) return;
      // Only the held-back subset of entries, those logged against an expecting child,
      // which `commitWrite` keeps off the write queue, so pushing them here cannot race
      // `flushQueue` into double-posting. Every OTHER entry flows through flushQueue.
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
        // Count only records that WERE serverId==null in the pre-upload snapshot and
        // actually came back stamped.
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
        // Merge-by-id against the CURRENT state, not the pre-await snapshot, so a
        // create that landed during the await isn't dropped by a wholesale replace.
        set((st) => ({
          children: st.children.map((c) => {
            const u = result.children.find((r) => r.id === c.id);
            if (!u || u.serverId == null) return c;
            // The uploader stamps `picture` only for a child whose push actually
            // uploaded a photo, so diff against the PRE-upload snapshot to tell that
            // apart from the copy it always returns.
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
            // `heldBack` is redundant once a real serverId exists.
            return u && u.serverId != null ? { ...e, serverId: u.serverId, heldBack: false } : e;
          }),
        }));
        if (syncedCount > 0) {
          get().showToast(`Synced ${syncedCount} ${syncedCount === 1 ? 'item' : 'items'}`);
        }
      }
      // Read the CURRENT state so a child stamped just above is visible.
      const st2 = get();
      for (const timer of st2.timers) {
        if (timer.serverId != null) continue;
        // Owner only: an unattributable timer is skipped rather than created under the
        // selected child.
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
    // Entries bound for the offline queue are collected and written ONCE at the end: N
    // un-awaited `enqueueEntry` calls interleave on one load-modify-save and lose some.
    const queued: Entry[] = [];
    for (const entry of entries) {
      const child = s.children.find((c) => c.id === entry.childId);
      // WITHHELD: the owning child is a due-date placeholder that gets no serverId until
      // `confirmBirth`. Stamped ONCE as a durable fact rather than re-derived later from
      // `expected`, which kept expiring at the next transition. Runs in local mode too,
      // for `adopt()`'s merge.
      if (child?.expected && !entry.heldBack) {
        set((st) => ({
          entries: st.entries.map((e) => (e.id === entry.id ? { ...e, heldBack: true } : e)),
        }));
      }
      const conn = s.connection;
      if (!conn || conn.mode !== 'server') continue; // local: nothing to push
      // Leave a withheld entry purely local rather than queueing it: `flushQueue` never
      // stamps a local `serverId`, so mixing the two paths could push it twice.
      if (child?.expected) continue;
      if (s.offline) {
        queued.push(entry);
        continue;
      }
      const childServerId = childServerIdFor(s.children, entry.childId);
      if (childServerId == null) {
        // The reconnect flush pushes this once the child exists server-side.
        console.warn('[entries] no server id for child, queued:', entry.type, entry.childId);
        queued.push(entry);
      } else {
        // A genuine new write: give the retry chain a fresh budget, so a save made
        // an hour after some earlier failure isn't stuck with a spent one.
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
              // Deleted, or replaced by a running timer, mid-POST: the local record never
              // got the serverId, so nothing else can remove the copy just created.
              void deleteEntryFromServer(conn, entry.type, serverId).catch(() => {});
            }
          })
          .catch((e) => {
            console.warn('[entries] push failed, queued:', entry.type, e?.status, e?.message);
            return enqueueEntry(entry).then((q) => {
              set(queueMirror(q));
              // Queued is not delivered: without this the entry waits for the next
              // refresh/foreground/reconnect.
              scheduleQueueFlush(get);
            });
          });
      }
    }
    // The length guard is about the READ: an empty list would still load the queue and
    // re-mirror it on every ordinary online push.
    if (queued.length > 0) void enqueueEntries(queued).then((q) => set(queueMirror(q)));
  },

  // Purely local, in BOTH modes: a load fetches every child, so refetching here would
  // cost 13 requests per switcher tap to redraw what is on screen. `insightsEntries` is
  // the exception, being a per-child history fetched on demand.
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
      // A photo change is uploaded by this save only with a server AND a server row to
      // send it to; every other case records the photo so a later push can carry it.
      // `photoDropped` means it could not be made durable, which matters because a cache
      // URI would be drawn as the avatar and then point at nothing once Android
      // reclaimed the file.
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
      get().showToast(photoDropped ? 'Updated · photo not saved' : 'Updated');
      if (deferred && durable) void recordPendingPhoto(child.id, change, existing.serverId != null);
      if (conn && conn.mode === 'server' && !s.offline) {
        // Gender lives in its own `gender`-tagged note, so it is a separate write. Fired
        // only on a change: it costs a read before its write.
        if (genderChanged && child.serverId != null) {
          void setChildGenderOnServer(conn, child.serverId, child.gender, Date.now()).catch(() => {});
        }
        // Whatever this child owed the server BEFORE this PATCH. Left there, an earlier
        // offline edit's op would re-upload the superseded file over the one saved here.
        // Cleared by VALUE: a newer photo recorded mid-PATCH must survive.
        const staleRecord =
          uploadsNow && change.kind !== 'none' ? loadPendingPhotos().then((m) => m[child.id]) : null;
        void updateChildOnServer(conn, child, change)
          .then((res) => {
            if (!res) return;
            set((st) => ({
              children: st.children.map((c) => {
                if (c.id !== child.id) return c;
                // Re-stamp the slug: Baby Buddy DERIVES it from the name, so a rename
                // moves it, and holding the old one 404s the next rename or delete.
                const slug = res.slug ?? c.slug;
                if (change.kind === 'none') return { ...c, slug };
                // Swap the ephemeral local file URI for the durable server URL. On a
                // remove, `null` IS the answer; on a set it means the server stored
                // nothing, and taking it would discard the only copy left.
                const picture = change.kind === 'remove' ? res.picture : (res.picture ?? c.picture);
                return { ...c, slug, picture };
              }),
            }));
            // Its own chain rather than an awaited step, so a settle that throws
            // cannot reach the catch below and report a landed save as a failure.
            if (staleRecord) {
              void staleRecord
                .then((stale) => (stale ? settlePendingPhoto(child.id, stale) : undefined))
                .catch(() => {});
            }
          })
          .catch(() => {
            // An online edit is queued nowhere, so a failure here is lost work the next
            // refresh will quietly undo. Say so rather than leave "Updated" standing.
            get().showToast(`Could not save ${child.first}`);
          });
      } else if (conn && conn.mode === 'server' && s.offline && child.serverId != null) {
        // Already on the server, edited offline: replay on reconnect instead of being
        // overwritten by the next refresh(). A not-yet-synced local child needs no op.
        void addPendingOp({ op: 'update', entity: 'child', payload: child });
      }
      return;
    }
    // A tint no sibling is wearing, chosen by the palette rather than by list position,
    // which a deletion would make collide.
    const localId = 'child' + Date.now();
    const conn = s.connection;
    // A create carries its photo on its own POST only when online AND not expecting: an
    // expected child holds a DUE date the server cannot accept as a birth_date, so it
    // waits for `confirmBirth` and its photo waits with it.
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
    // `false`: no server row yet, so a removal has nothing to tell the server.
    if (deferredPhoto) void recordPendingPhoto(localId, change, false);
    if (conn && conn.mode === 'server' && !s.offline && !fields.expected) {
      void pushChildToServer(conn, child, change)
        .then((res) => {
          if (!res || res.id == null) return;
          // The local `id` is deliberately NOT rewritten: entries and measurements
          // reference it. Capturing the slug is what lets this child be renamed or
          // deleted before the next refresh fills it in.
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
          // The child is not lost (the next flush pushes it), but a photo picked in the
          // same save IS: this path carried it on the POST rather than recording it.
          get().showToast(`Could not save ${child.first}`);
        });
    }
  },

  confirmBirth: (id, birth) => {
    const s = get();
    const child = s.children.find((c) => c.id === id);
    if (!child || !child.expected) return;
    // Push the post-birth fields, not the stale due date `child` still carries.
    const bornChild: Child = { ...child, expected: false, birth };
    set({
      children: s.children.map((c) => (c.id === id ? bornChild : c)),
      // The insights cache may hold a stale error from while the child was still
      // expected, when there was nothing to load for it.
      insightsLoaded: false,
      insightsEntries: [],
      insightsError: false,
    });
    get().showToast('Welcome to the world');
    const conn = s.connection;
    // Push now, because the confirmation unlocks logging right away.
    if (conn && conn.mode === 'server' && !s.offline) {
      void (async () => {
        // An expecting child is held back from the server, so a photo picked for it has
        // been waiting in `pendingPhotos` since creation, online or not.
        const { change, consumed } = await pendingPhotoChange(id);
        const res = await pushChildToServer(conn, bornChild, change);
        if (!res || res.id == null) return;
        // Compare-and-clear: a photo re-picked mid-POST is a record this push never
        // carried, and dropping it would delete the newer file unread.
        if (consumed) await settlePendingPhoto(id, consumed);
        // Leave the local `id` alone, as saveChild's create push does.
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
    const serverBacked = child.serverId != null;
    // Server delete only when it can be made durable now. Otherwise the removal is local
    // (the UI blocks an offline server-backed delete, which a refresh would undo).
    const doServerDelete = serverBacked && !!conn && conn.mode === 'server' && !s.offline;

    const nextChildren = s.children.filter((c) => c.id !== id);
    // Captured before the purge, for the failed-delete restore below.
    const priorIndex = s.children.findIndex((c) => c.id === id);
    const purgedEntries = s.entries.filter((e) => e.childId === id);
    const purgedMeasurements = s.measurements.filter((m) => m.childId === id);
    const purgedTimers = s.timers.filter((t) => t.childId === id);
    const purgedTreatments = s.treatments.filter((c) => c.childId === id);
    // `lastFeed` and `bathRhythms` are deliberately NOT purged: both are keyed by child
    // id, both are tiny, and neither can strand a visible row.
    const patch: Partial<AppState> = {
      children: nextChildren,
      entries: s.entries.filter((e) => e.childId !== id),
      measurements: s.measurements.filter((m) => m.childId !== id),
      treatments: s.treatments.filter((c) => c.childId !== id),
      // The deleted child's running timers, and only those: ungated on the selection.
      // `!==` keeps a still-unstamped timer, since `undefined` is not evidence.
      timers: s.timers.filter((t) => t.childId !== id),
      childSheet: false,
      editingChildId: null,
      showChildSwitcher: false,
    };
    if (s.selectedChildId === id) {
      patch.selectedChildId = nextChildren[0]?.id ?? '';
      patch.insightsLoaded = false;
      patch.insightsEntries = [];
      patch.insightsError = false;
    }
    set(patch);
    if (doServerDelete) {
      try {
        // AWAITED, unlike the fire-and-forget pushes elsewhere: there is no `child`
        // PendingOp variant to replay a delete, so a failure has to be undone here and
        // now. It also keeps the refetch below from racing the DELETE.
        await deleteChildFromServer(conn, child);
      } catch {
        // Put the child back, merged into CURRENT state rather than snapping back to the
        // pre-delete snapshot: a write may have landed during the round trip.
        set((st) => {
          // Matched on `serverId` as well as the local id: a refresh landing mid-flight
          // re-adds the child under a SERVER-derived id (`String(serverId)`), so an
          // id-only check would splice a second copy in beside it.
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
            // A treatment lives only on this device until it syncs, so a failed
            // delete that restored the child but not their regimens loses them.
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
    // Only when the child is really gone. A server-backed child deleted while OFFLINE is
    // not: the DELETE never went out, the next refresh brings it back, and discarding
    // its pending photo would be the one deletion nothing can undo.
    if (!serverBacked || doServerDelete) void settlePendingPhoto(id);
    get().showToast(`${child.first} deleted`);
    // Re-read after the DELETE, which Baby Buddy cascades over the child's whole
    // history. Gated on `offline` as well as the mode: `refresh` only bails on the
    // `simulateOffline` override, so an ungated call would fire a doomed fetch.
    const st = get();
    if (patch.selectedChildId && st.connection?.mode === 'server' && !st.offline) void st.refresh();
  },

  // Server mode fetches the child's SERVER-id-keyed 90-day history, which is empty
  // rather than an error for a child never pushed.
  loadInsights: async () => {
    const s = get();
    if (s.insightsLoaded || s.insightsLoading) return;
    if (!s.connection || !s.selectedChildId) return;
    const childId = s.selectedChildId;
    set({ insightsLoading: true, insightsError: false });
    try {
      const entries = await fetchInsightsEntries(s, childId);
      if (get().selectedChildId !== childId) {
        // Child switch landed mid-flight: discard the stale result and reload.
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
    if (s.insightsLoading) return;
    if (!s.connection || !s.selectedChildId) return;
    const childId = s.selectedChildId;
    // Leave the loaded data in place so the charts stay on screen while the fetch runs.
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
      // Keep the existing charts and leave insightsError untouched, so a good
      // screen is not replaced by the error state.
      set({ insightsLoading: false });
    }
  },

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
      // Session changed mid-flight: drop the stale result rather than showing
      // another account's profile.
      if (get().connection !== conn) return;
      set({ profile, profileLoaded: true, profileLoading: false });
    } catch (e) {
      // /api/profile/ can 500 on some instances (a user without a Settings row).
      // Settings omits the Baby Buddy group when there's no profile.
      console.warn('[settings] /api/profile/ failed:', e instanceof ApiError ? `HTTP ${e.status}` : e);
      set({ profileLoading: false, profileError: true });
    }
  },

  // Lazy, fetched on first LogSheet open, cached.
  loadTags: async () => {
    const s = get();
    if (s.tagsLoaded || s.tagsLoading) return;
    const conn = s.connection;
    if (!conn) return;
    if (conn.mode !== 'server') {
      // No server to read /api/tags/ from: seed the fallback so the picker isn't empty.
      set({ tags: DEMO_TAGS, tagsLoaded: true });
      return;
    }
    set({ tagsLoading: true });
    try {
      const tags = await loadTagsFromServer(conn);
      // Session changed mid-flight: drop the stale result rather than showing
      // another account's tags.
      if (get().connection !== conn) return;
      set({ tags, tagsLoaded: true, tagsLoading: false });
    } catch {
      // Keep the cached tags and leave tagsLoaded false so the next open retries.
      // A tag typed meanwhile still saves: Baby Buddy auto-creates it on POST.
      set({ tagsLoading: false });
    }
  },

  openSheet: (type) => {
    const s = get();
    // Decided once, used both for the child-scoped seeds below and for `sheetChildIds`
    // at the bottom, so the two cannot drift.
    const aimedAt = [s.selectedChildId];
    // Whose history the seeds read: the single target, or nobody once a re-aim has left
    // no one right answer.
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
      // Classified on the draft's START, not on `now`, which would misread a long sleep
      // that began on the other side of the window boundary.
      const now = s.now;
      te.nap = isNapStart(teStart(te, now) ?? now, {
        startMin: s.napWindowStartMin,
        endMin: s.napWindowEndMin,
      });
    }
    if (type === 'bath') {
      // Scoped to the sheet's own child: `entries` holds every child's records, so
      // an unscoped read would let a sibling's baths decide this child's next wash.
      te.wash = washDueState(
        entriesForChild(s.entries, seedChildId),
        rhythmForChild(s.bathRhythms, seedChildId ?? null, s.legacyRhythm),
        s.now,
      ).nextKind;
    }
    if (type === 'temperature') {
      te.temperature = 37.0;
    }
    if (type === 'medication') {
      te.medName = '';
    }
    if (type === 'note') {
      te.noteText = '';
    }
    set({
      sheet: { type },
      // Aimed HERE, at open, not read off the selection at save time: a warm notification
      // tap for a sibling moves the selection under a sheet that survives the navigation.
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
    // Free-text notes exist on every activity but bath, note and milestone, whose
    // bodies are structural. Seed it so an edit doesn't silently drop one.
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
      te.absTime = entry.time;
      te.agoMin = Math.max(0, Math.round((now - entry.time) / 60000));
      te.medName = entry.name;
      te.medDosage = entry.dosage;
      te.medUnit = entry.dosageUnit;
      te.medNextDoseIntervalSec = entry.nextDoseIntervalSec;
    } else if (entry.type === 'note') {
      te.absTime = entry.time;
      te.agoMin = Math.max(0, Math.round((now - entry.time) / 60000));
      te.noteText = entry.text;
    } else if (entry.type === 'milestone') {
      // Milestones use their own sheet; this branch only keeps the narrowing total.
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
      // Whoever the record was about, never the selection: the edit path PATCHes
      // `child:`, so a wrong seed would move the server row too.
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
    // ongoing:true shows the live editing view; it never spawns a second timer, because
    // save() short-circuits to saveTimerDetails before its ongoing-creation branch.
    const te: TimeEntryState = {
      shape: 'interval',
      tags: tm.tags ?? [],
      startAbs: tm.start,
      ongoing: true,
      order: ['end', 'start', 'lasted'],
    };
    if (type === 'feeding') {
      // The TIMER's child, not the selection: the Timers tab lists every child's,
      // so the two routinely disagree.
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
      // The timer's own start classifies it, not "now": a nap begun at 13:00 and
      // still running at 19:30 is a nap.
      te.nap = tm.nap ?? isNapStart(tm.start, { startMin: s.napWindowStartMin, endMin: s.napWindowEndMin });
    }
    if (type === 'tummy' && tm.milestone != null) te.milestone = tm.milestone;
    if (tm.notes != null) te.notes = tm.notes;
    set({
      sheet: { type },
      // An unattributable timer seeds nothing, so `save()` applies its own fallback
      // rather than this sheet inventing an owner.
      sheetChildIds: tm.childId ? [tm.childId] : [],
      te: snapDraftAmount(type, te, s.unitSystem),
      editingId: null,
      fromTimerId: timerId,
    });
  },
  setSheetChildren: (ids) => {
    // `sheetChildIds: []` already means "never seeded, use the old binding", so
    // storing an empty list would quietly hand the draft back to the selection.
    if (ids.length === 0) return;
    aimSheetAt(get, set, ids);
  },
  toggleSheetChild: (id) => {
    const s = get();
    const ids = s.sheetChildIds;
    if (!ids.includes(id)) {
      // Only a child the PICKER could have offered: a target with no chip cannot be
      // taken back off, and would fan out on save with nothing on screen to say so.
      if (!isEligibleTarget(s.children, id)) return;
      aimSheetAt(get, set, [...ids, id]);
      return;
    }
    // Untoggling the last target would leave the draft ownerless.
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
    // step, so undo can never leave the user holding both.
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
    // A timer whose create POST hasn't landed has no serverId to delete, but
    // `mirrorTimerCreate` cleans that orphan up once the POST resolves.
    if (timer) mirrorTimerDelete(get, timer);
    // Re-create server-side only if the removal took something away: a real server
    // record, or a place in the not-yet-flushed write queue.
    if (d.didServerDelete || d.requeue) get().commitWrite(d.entry);
    // Cancel any queued pending-delete so it doesn't replay on reconnect and delete the
    // just-restored record out from under the user.
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
    // Same queue rewrite as `save()`'s edit branch: `flushQueue` pushes the file's
    // copy, so the stale pre-edit version would land on reconnect.
    void updateQueuedEntry(entry).then(({ updated, queue }) => {
      if (updated) set(queueMirror(queue));
    });
    get().showToast('Updated');
    if (s.connection && s.connection.mode === 'server' && !s.offline) {
      const childServerId = childServerIdFor(s.children, entry.childId);
      // No server id for the child: the local edit stands until a later flush.
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
      // An edit keeps the record with whoever it was about: re-stamping the selected
      // child would move it server-side too.
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
        // No server id for the child: leave the local edit as-is.
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
      // else: leave serverId unset, flushUnsynced picks the measurement up later.
    } else if (conn && conn.mode === 'server' && s.offline && existing && m.serverId != null) {
      // Already on the server, edited offline: replay on reconnect. A brand-new offline
      // measurement needs no op, its create is still pending.
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

  // Treatments (medication regimens) are offline-first like measurements, and ride
  // on the server as a `treatment`-tagged note.
  addTreatment: (treatment) => {
    const s = get();
    set({ treatments: [treatment, ...s.treatments] });
    const conn = s.connection;
    if (conn && conn.mode === 'server' && !s.offline) {
      const childServerId = childServerIdFor(s.children, treatment.childId);
      // No server id for the child yet: flushUnsynced pushes this once the child lands.
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
    // A treatment created offline needs no pending op: flushUnsynced finds it by
    // serverId == null.
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
    // No active treatment: skip to the manual form rather than open an empty picker.
    const active = activeTreatmentsForChildToday(s.treatments, s.selectedChildId, startOfDay(s.now));
    if (active.length > 0) set({ treatmentPicker: { open: true } });
    else get().openSheet('medication');
  },
  logMedicationFromTreatment: (treatmentId) => {
    const treatment = get().treatments.find((c) => c.id === treatmentId);
    if (!treatment) return;
    if (!treatment.name.trim()) return;
    // Confirm-before-log: no entry is written here, save() commits it once the user
    // confirms. openSheet resets the draft, so seed it afterwards.
    get().openSheet('medication');
    const patch: Partial<TimeEntryState> = {
      medName: treatment.name,
      medDosage: treatment.dosage,
      medUnit: treatment.dosageUnit,
      // Only an interval treatment carries a next-dose interval onto the dose.
      medNextDoseIntervalSec:
        treatment.scheduleMode === 'everyHours' && treatment.everyHours != null ? treatment.everyHours * 3600 : undefined,
    };
    set((s) => ({ treatmentPicker: null, sheet: { type: 'medication', confirm: true }, te: { ...s.te, ...patch } }));
  },
  expandMedicationLog: () => set({ sheet: { type: 'medication' } }),

  setTE: (patch) =>
    set((s) => {
      const next = { ...s.te, ...patch };
      // A feeding's `amount` means millilitres on one side of `feedAmountIsVolume` and
      // an intake level on the other, and changing feed type or method can move the
      // draft across that line. An intake of 3 is not 3 ml, so clear it.
      if (
        s.sheet?.type === 'feeding' &&
        ('feedType' in patch || 'method' in patch) &&
        !('amount' in patch) &&
        feedAmountIsVolume(s.te.feedType, s.te.method) !== feedAmountIsVolume(next.feedType, next.method)
      ) {
        next.amount = undefined;
      }
      // These flags record "the parent chose it", keeping a re-aim from overruling the
      // choice with the new target's child-scoped seeds.
      if ('feedType' in patch) next.feedTypeEdited = true;
      if ('method' in patch) next.methodEdited = true;
      if ('startSide' in patch) next.startSideEdited = true;
      if ('agoMin' in patch) next.absTime = undefined; // point: a relative pick drops the edit anchor
      // A manual time pick deselects the "When" anchor, unless the patch IS that pick.
      if (('agoMin' in patch || 'absTime' in patch) && !('pointAnchor' in patch)) {
        next.pointAnchor = undefined;
      }
      return { te: next };
    }),
  adjustAmount: (dir) =>
    set((s) => ({ te: { ...s.te, amount: stepVolume(s.te.amount ?? 0, dir, s.unitSystem) } })),
  toggleWet: () => set((s) => ({ te: { ...s.te, wet: !s.te.wet } })),
  toggleSolid: () => set((s) => ({ te: { ...s.te, solid: !s.te.solid } })),
  // `washEdited` because this seed is CHILD-scoped and gets recomputed when the
  // sheet is re-aimed. `nap` needs no such flag: the nap window is global.
  setWash: (wash) => set((s) => ({ te: { ...s.te, wash, washEdited: true } })),
  setNap: (nap) => set((s) => ({ te: { ...s.te, nap } })),
  toggleTag: (tag) =>
    set((s) => {
      const has = s.te.tags.includes(tag);
      return { te: { ...s.te, tags: has ? s.te.tags.filter((t) => t !== tag) : [...s.te.tags, tag] } };
    }),
  createTag: (name) => {
    const trimmed = name.trim();
    // Structural tags (bath:*, breastfeeding left/right, mk:*) must never be
    // user-created. No server call: Baby Buddy auto-creates the tag on POST.
    if (!trimmed || isHiddenTag(trimmed)) return;
    set((s) => (s.te.tags.includes(trimmed) ? {} : { te: { ...s.te, tags: [...s.te.tags, trimmed] } }));
  },
  // Interval time-entry: keep the last two of start/end/lasted.
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
  // Going live pins the start, because the end becomes "now" and can no longer anchor
  // it. Editing a logged entry, that pin must be the entry's OWN start, not the draft's
  // derived one, so the sheet shows the instant the timer will carry.
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
  // Unlike setLasted, which pins the end at "now" and lets the start slide back, keep
  // the START fixed and derive the end. ongoing:false makes save() stop the timer.
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
    // Editing a running timer: while still ongoing, keep it running and persist the
    // details onto the Timer. Naming a length flips ongoing:false and falls through.
    if (s.fromTimerId && s.te.ongoing) {
      get().saveTimerDetails();
      return;
    }
    // An empty body is a no-op and leaves the sheet open, so a stray tap can't create a
    // blank. Same gate for a medication's name; amount and unit stay optional.
    if (type === 'note' && !s.te.noteText?.trim()) return;
    if (type === 'medication' && !s.te.medName?.trim()) return;
    const te = s.te;
    const now = s.now;
    const existing = s.editingId ? s.entries.find((e) => e.id === s.editingId) : null;
    // Owner fallback, in this order. An EDIT keeps the record with whoever it was about,
    // since the update PATCHes `child:` and would move it server-side. A timer STOP
    // belongs to whoever STARTED the timer, since the Timers tab lists every child's and
    // stamping the selection filed a sibling's nap against the wrong child. A fresh draft
    // is the selected child's. All three lose to an explicit pick in the picker.
    //
    // KNOWN GAP: no parity with `stopTimer`, which never resolves to an `expected` child.
    // An unstamped timer falls through to `s.selectedChildId` here.
    const sourceTimer = s.fromTimerId ? s.timers.find((t) => t.id === s.fromTimerId) : undefined;
    const fallbackChildId = existing?.childId ?? sourceTimer?.childId ?? s.selectedChildId;
    const aimedAt = sheetTargetIds(s.sheetChildIds, fallbackChildId);
    // "Log for both" is CREATE-ONLY and only for the shared-routine activities: an edit
    // moves ONE record, a timer stop belongs to one timer, and the allow-list keeps a
    // duplicated pumping session from double-counting the milk.
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
      // Point; stored server-side as a tagged note (see the API client).
      entry = {
        id,
        childId,
        type: 'bath',
        time: teEnd(te, now),
        wash: te.wash ?? 'quick',
        tags,
      };
    } else if (type === 'temperature') {
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
      // A real Baby Buddy /api/medication/ resource, not a tagged note.
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
    // The branches above rebuild a fresh object, so an edit must copy `heldBack` across
    // (only `commitWrite` stamps it). Never re-derive it from `child.expected`, the
    // inference this recorded fact replaced.
    entry.heldBack = existing?.heldBack;

    // A live interval is a running timer, never an entry. On an EDIT that means a
    // conversion: the finished entry is deleted, server row and all, and a timer takes
    // its place. Patching it to `end: null` instead is not a timer at all, and the API
    // client pushes such an entry as `end: entry.end ?? entry.start`, a zero-length
    // record the next refresh() copies back over the local one.
    if (te.ongoing && te.shape === 'interval') {
      // A conversion is single-target by construction; a fresh draft gets one timer per
      // target, with the same `-<index>` id suffix the entries carry.
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

    // One INDEPENDENT record per target child, cloned from the draft with its own id and
    // owner. No group id and no link field: each entry stays separately editable.
    //
    // The `-<index>` id suffix is load-bearing. `Date.now()` is millisecond resolution
    // and this pass is synchronous, so N entries in one save would otherwise carry
    // IDENTICAL ids and every id-keyed operation, the post-POST `serverId` stamp
    // included, would hit all of them.
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
      const draft: LastFeed = { feedType: te.feedType ?? 'breast', method: te.method ?? 'left' };
      patch.lastFeed = { ...s.lastFeed };
      for (const cid of targets) patch.lastFeed[cid] = draft;
    }
    set(patch);
    if (existing) {
      get().showToast('Updated');
      // Rewrite the pre-edit copy on the offline write queue too: `flushQueue` pushes
      // whatever the FILE holds without consulting `entries`, so the stale version
      // would POST on reconnect and the next refresh() would revert the edit.
      void updateQueuedEntry(entry).then(({ updated, queue }) => {
        if (updated) set(queueMirror(queue));
      });
      if (s.connection && s.connection.mode === 'server' && !s.offline) {
        const childServerId = childServerIdFor(s.children, entry.childId);
        // No server id for the child: the local edit stands.
        if (childServerId != null) {
          void updateEntryOnServer(s.connection, entry, childServerId).catch(() => {});
        }
      } else if (s.connection && s.connection.mode === 'server' && s.offline && entry.serverId != null) {
        // Already on the server, edited offline: replay on reconnect.
        void addPendingOp({ op: 'update', entity: 'entry', payload: entry });
      }
    } else {
      // Stopping via "lasted X" drops the source timer above; delete its mirror too.
      if (s.fromTimerId) {
        const src = s.timers.find((tm) => tm.id === s.fromTimerId);
        if (src) mirrorTimerDelete(get, src);
      }
      // One call for the whole save: N un-awaited single enqueues interleave on the
      // shared queue file and drop entries.
      get().commitWrites(built);
      const queued = s.offline && !!s.connection && s.connection.mode === 'server';
      // Naming the children back confirms the fan-out happened: History filters by the
      // SELECTED child, so it shows only one of them.
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
    // Only trust the start while the sheet is still ongoing: tapping Ended/Lasted makes
    // `start` a DERIVED value (end minus duration) unrelated to the real elapsed start,
    // and persisting that would corrupt the running timer.
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
      // device-local. The wire format in serverTimers.ts encodes `nap` as a bare presence
      // token, so `nap: false` round-trips as undefined and another device re-derives it
      // from its own nap window. Fixing it means changing a frozen versioned format.
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
    // A running timer belongs to whoever started it, not whoever is selected when Stop
    // is tapped: the Timers tab shows every child's at once. The fallback for an
    // unattributable timer must never resolve to an expecting child, whose `birth` is a
    // due date rather than a real one.
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
      // mirror save()'s breastfeeding "both" startSide-as-tag conversion
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

// Persist running timers so they survive the app being closed.
useAppStore.subscribe((state, prev) => {
  if (state.timers !== prev.timers) void saveTimers(state.timers);
});

// Persistence ONLY: the server mirror is the treatment actions' job. Deliberately
// NOT cleared on disconnect.
useAppStore.subscribe((state, prev) => {
  if (state.treatments !== prev.treatments) void saveTreatments(state.treatments);
});

// Reference-equality checks so each key is written only on an actual change.
useAppStore.subscribe((state, prev) => {
  if (state.children !== prev.children) void saveChildren(state.children);
  if (state.entries !== prev.entries) void saveEntries(state.entries);
  if (state.measurements !== prev.measurements) void saveMeasurements(state.measurements);
  if (state.selectedChildId !== prev.selectedChildId) void saveSelectedChildId(state.selectedChildId);
  if (state.lastFeed !== prev.lastFeed) void saveLastFeed(state.lastFeed);
});
