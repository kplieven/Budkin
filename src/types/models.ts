/**
 * Domain models for Baby Buddy. These mirror the activity shapes used by the
 * design and map onto the Baby Buddy REST API resources.
 *
 * Internally we keep timestamps as epoch-millisecond numbers (what the UI
 * works with); the API layer converts to/from ISO 8601 strings.
 */

import type { WashKind } from '@/lib/wash';

export type ActivityType = 'feeding' | 'sleep' | 'diaper' | 'pumping' | 'tummy' | 'bath' | 'temperature' | 'medication' | 'note' | 'milestone';

export type FeedType = 'breast' | 'formula' | 'fortified' | 'solid';
export type FeedMethod = 'left' | 'right' | 'both' | 'bottle' | 'parent' | 'self';
export type DiaperColor = 'black' | 'brown' | 'green' | 'yellow';

/**
 * A child's gender. Optional everywhere: absent means "not recorded", which is
 * why there is no "unspecified" member — nothing has to be chosen.
 */
export type ChildGender = 'girl' | 'boy';

export interface Child {
  id: string;
  /** server numeric id; present once created on / loaded from a server */
  serverId?: number;
  first: string;
  last: string;
  /** the child's gender, when recorded. Baby Buddy's own `Child` model has no
   *  gender field, so this syncs as a `gender`-tagged note against the child
   *  (see `genderToNoteBody` in src/api/client.ts) rather than on the child
   *  record itself. */
  gender?: ChildGender;
  /** birth date, epoch ms */
  birth: number;
  /** true while the baby is not yet born; `birth` then holds the DUE date */
  expected?: boolean;
  /** avatar tint color (hex) */
  color: string;
  /** API slug, when connected to a real server */
  slug?: string;
  /** remote photo URL, when present */
  picture?: string | null;
}

/** A child as the SERVER describes it. Identical to `Child` minus `color`,
 *  because Baby Buddy has no color field: the tint is assigned and persisted
 *  on device (see `nextChildColor` and the store's `reconcileChildren`), and
 *  leaving it off this type is what stops a fabricated one from travelling in
 *  and overwriting the real one on every refresh. */
export type ServerChild = Omit<Child, 'color'>;

/** A photo the user picked in the child sheet, normalized off the image-picker
 *  asset so the store / API layer never import expo-image-picker types.
 *  `file` is only populated on web (the raw File the picker exposes) and lets
 *  the upload builder skip a redundant fetch. */
export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
  file?: Blob;
}

/** What to do with a child's photo on save. */
export type PhotoChange =
  | { kind: 'none' }
  | { kind: 'set'; photo: PickedPhoto }
  | { kind: 'remove' };

interface EntryBase {
  id: string;
  /** server numeric id; present once created on / loaded from a server */
  serverId?: number;
  childId: string;
  tags: string[];
  /**
   * True when this entry was written against a child that had no `serverId`
   * at write time (an expecting child, whose `birth` holds a due date the
   * server can never accept as a birth_date, see `Child.expected`), so the
   * entry was never offered to the server and never queued for the ordinary
   * retry path (see `commitWrite` in the store).
   *
   * Stamped exactly once, in `commitWrite`, and NEVER recomputed afterward.
   * Earlier code tried to INFER this fact later instead of recording it,
   * from `serverId == null` plus a timestamp comparison, or by re-checking
   * `expected` at some later point, and every one of those proxies quietly
   * expired at a different transition (birth confirmed, entry pushed, due
   * date passed), silently dropping real records. Reading a stored fact has
   * no such expiry.
   *
   * Cleared back to `false` once the entry is actually pushed and a real
   * `serverId` is stamped (see `flushUnsynced`), at which point it is
   * redundant.
   *
   * Absent (`undefined`) on any entry written by a version of the app that
   * predates this field. See the store's migration backfill
   * (`backfillHeldBack`) for how those are recovered on upgrade.
   */
  heldBack?: boolean;
}

export interface FeedingEntry extends EntryBase {
  type: 'feeding';
  start: number;
  end: number | null;
  feedType: FeedType;
  method: FeedMethod;
  amount: number | null;
  /** free-text notes (Baby Buddy `notes` field) */
  notes?: string;
}

export interface SleepEntry extends EntryBase {
  type: 'sleep';
  start: number;
  end: number | null;
  nap: boolean;
  /** free-text notes (Baby Buddy `notes` field) */
  notes?: string;
}

export interface DiaperEntry extends EntryBase {
  type: 'diaper';
  time: number;
  wet: boolean;
  solid: boolean;
  color: DiaperColor | null;
  amount?: number | null;
  /** free-text notes (Baby Buddy `notes` field) */
  notes?: string;
}

export interface PumpingEntry extends EntryBase {
  type: 'pumping';
  start: number;
  end: number | null;
  amount: number | null;
  method?: FeedMethod;
  /** free-text notes (Baby Buddy `notes` field) */
  notes?: string;
}

export interface TummyEntry extends EntryBase {
  type: 'tummy';
  start: number;
  end: number | null;
  milestone?: string;
  /** free-text notes (Baby Buddy `notes` field) */
  notes?: string;
}

/**
 * A bath (Baby Buddy has no bath resource, so it rides on `/api/notes/` behind
 * a `bath` tag). Point event, no duration. `wash` distinguishes the frequent
 * quick wash from the periodic full bath.
 */
export interface BathEntry extends EntryBase {
  type: 'bath';
  time: number;
  wash: WashKind;
}

/**
 * A body-temperature reading (Baby Buddy `/api/temperature/`). Point event — a
 * single `time` carrying a numeric reading (°C) plus optional notes, like a
 * diaper change. Not timer-eligible.
 */
export interface TemperatureEntry extends EntryBase {
  type: 'temperature';
  time: number;
  /** the reading (°C) */
  value: number;
  /** free-text notes (Baby Buddy `notes` field) */
  notes?: string;
}

/**
 * A dose of medication (Baby Buddy `/api/medication/`). Point event — a single
 * `time` carrying the medication `name` (required) plus an optional amount:
 * `dosage` (a plain number) and `dosageUnit` (free-text, e.g. "mg" or "mL" — NOT
 * a units.ts metric/imperial quantity, so it is never converted or relabelled).
 * `nextDoseIntervalSec` mirrors Baby Buddy's `next_dose_interval` duration; it is
 * left unset here and populated by the reminder feature. Not timer-eligible.
 */
export interface MedicationEntry extends EntryBase {
  type: 'medication';
  time: number;
  /** the medication name (required) */
  name: string;
  /** the amount given (a plain number, paired with `dosageUnit`) */
  dosage?: number;
  /** free-text dosage unit (e.g. "mg", "mL", "drops"); never unit-converted */
  dosageUnit?: string;
  /** Baby Buddy `next_dose_interval` as whole seconds; unset until a reminder is set */
  nextDoseIntervalSec?: number;
  /** free-text notes (Baby Buddy `notes` field) */
  notes?: string;
}

/**
 * A general free-text note (Baby Buddy `/api/notes/`). Point event — a single
 * `time` whose PRIMARY content is the `text` body. Shares the `/api/notes/`
 * endpoint with baths (which ride on a `bath` tag); a general note carries no
 * structural tag. Kept a DISTINCT type from `BathEntry`: notes surface only in
 * the dedicated Notes tab, never in the activity timeline. `text` is the note
 * body — NOT the secondary per-entry `notes` annotation on other activities.
 */
export interface NoteEntry extends EntryBase {
  type: 'note';
  time: number;
  /** the note body (Baby Buddy `note` field) */
  text: string;
}

/**
 * A reached developmental milestone (e.g. "first steps"). Baby Buddy has no
 * milestone resource, so like a bath this is stored as a tagged Note: a
 * `milestone` marker tag plus an `mk:<key>` tag naming which one. Point event.
 * Surfaces only in the Growth & Development milestone checklist, never in the
 * History timeline or the Notes tab. `key` is the catalog key; `text` is a
 * display-title snapshot; `note` is the parent's optional free-text line.
 */
export interface MilestoneEntry extends EntryBase {
  type: 'milestone';
  key: string;
  time: number;
  text: string;
  note?: string;
}

export type Entry =
  | FeedingEntry
  | SleepEntry
  | DiaperEntry
  | PumpingEntry
  | TummyEntry
  | BathEntry
  | TemperatureEntry
  | MedicationEntry
  | NoteEntry
  | MilestoneEntry;

/** Activities that are point-in-time (single timestamp) vs interval (start/end). */
export const POINT_ACTIVITIES: ActivityType[] = ['diaper', 'bath', 'temperature', 'medication', 'note'];

export function entryTimestamp(e: Entry): number {
  return e.type === 'diaper' || e.type === 'bath' || e.type === 'temperature' || e.type === 'medication' || e.type === 'note' || e.type === 'milestone'
    ? e.time
    : (e.end ?? e.start);
}

export interface Timer {
  id: string;
  /** server numeric id; present once the timer is mirrored to a server */
  serverId?: number;
  /** local child id this timer belongs to: whoever started it, and nobody else.
   *  Every creation path stamps one and `hydrate` stamps the ones persisted
   *  before that existed (`stampTimerOwners`), so an absent value means "not
   *  attributable", never "the selected child" — the read sites stopped adopting
   *  (see `timerBelongsTo`). Stays OPTIONAL because `budkin.pendingOps.v1` and
   *  `budkin.timers.v1` hold whole `Timer` payloads that are cast, never
   *  validated, so requiring it would only be a lie about what is on disk. */
  childId?: string;
  /** the activity this timer was started as */
  activity: ActivityType;
  name: string;
  /** start, epoch ms */
  start: number;
  /** the activity it will be saved as (user can change) */
  saveAs: ActivityType;

  /**
   * Metadata saved via editing the running timer (see `saveTimerDetails` in
   * the store) while it keeps ticking. When present, `stopTimer` builds the
   * entry from these instead of its generic per-activity defaults, and
   * re-opening the editor (`openTimerEdit`) prefills from these. Field names
   * mirror `TimeEntryState` / `Entry` — no new vocabulary.
   */
  feedType?: FeedType;
  method?: FeedMethod;
  /** for breastfeeding "both": which side it started on */
  startSide?: 'left' | 'right';
  amount?: number;
  nap?: boolean;
  milestone?: string;
  notes?: string;
  tags?: string[];
}

/**
 * A Baby Buddy tag (`/api/tags/`). Tags are referenced by NAME on entries
 * (`EntryBase.tags` is a `string[]`); this shape is only the selectable list the
 * picker reads, carrying the server-provided display `color` and `lastUsed`.
 * Baby Buddy auto-creates a tag when an entry is POSTed with a new name, so
 * there is no create endpoint — a brand-new tag just rides along on the entry.
 */
export interface Tag {
  name: string;
  /** server-provided display color (hex), when set */
  color?: string;
  /** last time this tag was used, epoch ms */
  lastUsed?: number;
}

export type MeasurementKind = 'weight' | 'height' | 'head' | 'bmi';

/** A point-in-time growth measurement (value + date). */
export interface Measurement {
  id: string;
  serverId?: number;
  childId: string;
  kind: MeasurementKind;
  value: number;
  /** measurement date, epoch ms (local midnight) */
  date: number;
  notes?: string;
}

/**
 * One child's bath rhythm: how often each kind of wash is due, in whole days.
 * `0` means that kind is off and never comes due, which is how the rhythm
 * survives the child growing up (a newborn has no full baths at all, a school-age
 * child has no scheduled quick washes).
 *
 * Per child rather than global because a 4-month-old and a 3-year-old sit at
 * opposite ends of that progression. Persisted by `src/data/bathRhythm.ts`.
 */
export interface BathRhythm {
  fullEveryDays: number;
  quickEveryDays: number;
}

/** The four coarse times of day a fixed-schedule treatment can be dosed at. */
export type TreatmentTimeOfDay = 'morning' | 'noon' | 'evening' | 'night';

/** How a treatment repeats: at fixed times of day, or every N hours. */
export type TreatmentScheduleMode = 'timesOfDay' | 'everyHours';

/**
 * A medication regimen ("treatment"): a per-child TEMPLATE the user fills a
 * medication dose from.
 *
 * Baby Buddy has no regimen resource (only individual doses via
 * `MedicationEntry`), so a treatment syncs as a `treatment`-tagged Note, the same
 * tagged-note channel baths and milestones ride on. See `treatmentToNoteBody` in
 * src/api/client.ts for the encoding. In local mode it lives only in
 * src/data/treatments.ts, which doubles as the offline cache when connected.
 *
 * A dose logged from a treatment is an ordinary `MedicationEntry` that syncs like any
 * other, and carries no reference back to the treatment it came from: Baby Buddy has
 * no field for one, so the app attributes doses to treatments BY NAME (see
 * `treatmentDueState` in src/store/selectors.ts).
 */
export interface Treatment {
  id: string;
  /** server numeric id of the backing `treatment`-tagged note; present once created
   *  on / loaded from a server, absent for a treatment made in local mode or offline */
  serverId?: number;
  /** the child this treatment belongs to (the selected child at creation) */
  childId: string;
  /** medication name (required) */
  name: string;
  /** schedule mode: fixed times of day OR a repeating hourly interval */
  scheduleMode: TreatmentScheduleMode;
  /** when `scheduleMode` is 'timesOfDay': the subset of times chosen */
  timesOfDay?: TreatmentTimeOfDay[];
  /** when `scheduleMode` is 'everyHours': the interval in whole hours. A dose
   *  logged from an interval treatment stamps `next_dose_interval` = everyHours*3600. */
  everyHours?: number;
  /** dose amount (a plain number, paired with `dosageUnit`) */
  dosage?: number;
  /** free-text dosage unit (e.g. "mg", "mL"); never unit-converted */
  dosageUnit?: string;
  /** start date, epoch ms at local midnight */
  fromDate: number;
  /** end date, epoch ms at local midnight; undefined = open-ended */
  toDate?: number;
  /** free-text notes */
  notes?: string;
  /** what the treatment is for (free text, optional) */
  condition?: string;
  /** false = paused: the treatment drops out of the log picker but is kept */
  active: boolean;
}

/**
 * The connected user's Baby Buddy account + general settings, as read from
 * `/api/profile/`. All fields optional — the server shape varies and some
 * instances omit fields (or the whole `settings` sub-object). Read-only:
 * there is no edit UI for these.
 */
export interface Profile {
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  language?: string;
  timezone?: string;
  /** dashboard auto-refresh rate string as returned by the server (e.g. "00:01:00"), or null */
  dashboardRefreshRate?: string | null;
}
