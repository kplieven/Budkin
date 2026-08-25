/** Domain models mapping onto the Baby Buddy REST API resources. Timestamps are epoch
 *  milliseconds here; the API layer converts to and from ISO 8601 strings. */

import type { WashKind } from '@/lib/wash';

export type ActivityType = 'feeding' | 'sleep' | 'diaper' | 'pumping' | 'tummy' | 'bath' | 'temperature' | 'medication' | 'note' | 'milestone';

export type FeedType = 'breast' | 'formula' | 'fortified' | 'solid';
export type FeedMethod = 'left' | 'right' | 'both' | 'bottle' | 'parent' | 'self';
export type DiaperColor = 'black' | 'brown' | 'green' | 'yellow';

/** What the next feeding draft opens on. Local only, a seed rather than a record, and
 *  held per child: one shared value meant that with twins the sheet opened on the OTHER
 *  twin's habits. The sheet SAVES it, so an unscoped read misfiles one child's as
 *  another's. */
export interface LastFeed {
  feedType: FeedType;
  method: FeedMethod;
}

/** Optional everywhere: absent means "not recorded", hence no "unspecified" member. */
export type ChildGender = 'girl' | 'boy';

export interface Child {
  id: string;
  /** server numeric id; present once created on / loaded from a server */
  serverId?: number;
  first: string;
  last: string;
  /** Baby Buddy's own `Child` model has no gender field, so this syncs as a
   *  `gender`-tagged note against the child rather than on the child record. */
  gender?: ChildGender;
  /** birth date, epoch ms */
  birth: number;
  /** true while the baby is not yet born; `birth` then holds the DUE date */
  expected?: boolean;
  color: string;
  /** API slug, when connected to a real server */
  slug?: string;
  picture?: string | null;
}

/** Identical to `Child` minus the `color` tint: Baby Buddy has no color field, and
 *  leaving it off this type stops a fabricated one overwriting the real one. */
export type ServerChild = Omit<Child, 'color'>;

/** Kept structural so no module needs the native type. Native bundles run expo/fetch, not
 *  React Native's fetch, and its multipart encoder only reads a string, a `Blob`, or an
 *  object exposing `bytes()`: RN's `{ uri, name, type }` descriptor throws there. */
export interface UploadableFile {
  bytes(): Promise<Uint8Array>;
  readonly name: string;
  readonly type: string;
}

/** Normalized off the image-picker asset so the store and API layer never import
 *  expo-image-picker types. `file` is web only; `nativeFile` is what native uploads. */
export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
  file?: Blob;
  nativeFile?: UploadableFile;
  /** True when `uri` points at a copy in the document directory rather than the picker's
   *  own cache, so it survives a reboot. A recorded fact, never inferred from the URI
   *  prefix. False on web, and whenever the copy failed. */
  durable: boolean;
}

export type PhotoChange =
  | { kind: 'none' }
  | { kind: 'set'; photo: PickedPhoto }
  | { kind: 'remove' };

interface EntryBase {
  id: string;
  serverId?: number;
  childId: string;
  tags: string[];
  /**
   * True when this entry was written against a child that had no `serverId` at write
   * time (an expecting child, whose `birth` holds a due date the server can never accept
   * as a birth_date), so it was never offered to the server nor queued for retry.
   * Stamped once, in `commitWrite`, and NEVER recomputed: every proxy for it (`serverId
   * == null` plus a timestamp, re-checking `expected`) expires at a different transition
   * and silently drops real records. Cleared once the entry is pushed.
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
  notes?: string;
}

export interface SleepEntry extends EntryBase {
  type: 'sleep';
  start: number;
  end: number | null;
  nap: boolean;
  notes?: string;
}

export interface DiaperEntry extends EntryBase {
  type: 'diaper';
  time: number;
  wet: boolean;
  solid: boolean;
  color: DiaperColor | null;
  amount?: number | null;
  notes?: string;
}

export interface PumpingEntry extends EntryBase {
  type: 'pumping';
  start: number;
  end: number | null;
  amount: number | null;
  method?: FeedMethod;
  notes?: string;
}

export interface TummyEntry extends EntryBase {
  type: 'tummy';
  start: number;
  end: number | null;
  milestone?: string;
  notes?: string;
}

/** Baby Buddy has no bath resource, so it rides on `/api/notes/` behind a `bath` tag.
 *  Point event, no duration. */
export interface BathEntry extends EntryBase {
  type: 'bath';
  time: number;
  wash: WashKind;
}

/** A body-temperature reading (Baby Buddy `/api/temperature/`). Not timer-eligible. */
export interface TemperatureEntry extends EntryBase {
  type: 'temperature';
  time: number;
  /** the reading (°C) */
  value: number;
  notes?: string;
}

/** A dose of medication (Baby Buddy `/api/medication/`). `dosageUnit` is free text, NOT a
 *  units.ts metric/imperial quantity, so it is never converted or relabelled. */
export interface MedicationEntry extends EntryBase {
  type: 'medication';
  time: number;
  name: string;
  dosage?: number;
  dosageUnit?: string;
  /** Baby Buddy `next_dose_interval` as whole seconds; unset until a reminder is set */
  nextDoseIntervalSec?: number;
  notes?: string;
}

/** Shares `/api/notes/` with baths, which ride on a `bath` tag; a general note carries no
 *  structural tag. Kept DISTINCT from `BathEntry`: notes surface only in Notes. */
export interface NoteEntry extends EntryBase {
  type: 'note';
  time: number;
  /** the note body (Baby Buddy `note` field) */
  text: string;
}

/** Baby Buddy has no milestone resource, so like a bath this is a tagged Note: a
 *  `milestone` marker tag plus an `mk:<key>` tag naming which one. */
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
  serverId?: number;
  /** Whoever started the timer, and nobody else. Every creation path stamps one and
   *  `hydrate` stamps the older ones, so absent means "not attributable", never "the
   *  selected child". OPTIONAL because the persisted stores cast payloads unvalidated. */
  childId?: string;
  activity: ActivityType;
  name: string;
  /** start, epoch ms */
  start: number;
  /** what it will be saved as; `activity` stays whatever it was started as */
  saveAs: ActivityType;

  /** Saved by editing the running timer while it ticks: when present, `stopTimer` builds
   *  the entry from these instead of its generic per-activity defaults. */
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

/** Tags are referenced by NAME on entries; this is only the picker's selectable list.
 *  Baby Buddy auto-creates a tag on POST with a new name, so there is no create
 *  endpoint. */
export interface Tag {
  name: string;
  color?: string;
  /** last time this tag was used, epoch ms */
  lastUsed?: number;
}

export type MeasurementKind = 'weight' | 'height' | 'head' | 'bmi';

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

/** How often each kind of wash is due, in whole days. `0` means that kind is off and
 *  never comes due, which is how one rhythm survives the child growing up. */
export interface BathRhythm {
  fullEveryDays: number;
  quickEveryDays: number;
}

export type TreatmentTimeOfDay = 'morning' | 'noon' | 'evening' | 'night';

export type TreatmentScheduleMode = 'timesOfDay' | 'everyHours' | 'sporadic';

/** A medication regimen: a per-child TEMPLATE a dose is filled from. Baby Buddy has no
 *  regimen resource, so it syncs as a `treatment`-tagged Note, the channel baths and
 *  milestones ride on. A dose carries no reference back, so it is attributed BY NAME. */
export interface Treatment {
  id: string;
  /** server id of the backing `treatment`-tagged note; absent when made offline */
  serverId?: number;
  childId: string;
  name: string;
  scheduleMode: TreatmentScheduleMode;
  timesOfDay?: TreatmentTimeOfDay[];
  /** For `everyHours`, the recurring interval: due once this many hours have passed
   *  since the last dose. For `sporadic`, the SAME field instead means the minimum gap
   *  before another dose is safe - a floor, not a schedule, so a sporadic treatment is
   *  never "due". A dose logged from an interval treatment stamps
   *  `next_dose_interval` = everyHours*3600; a sporadic one does not. */
  everyHours?: number;
  /** a plain number, paired with `dosageUnit` */
  dosage?: number;
  /** free text (e.g. "mg", "mL"); never unit-converted */
  dosageUnit?: string;
  /** start date, epoch ms at local midnight */
  fromDate: number;
  /** end date, epoch ms at local midnight; undefined = open-ended */
  toDate?: number;
  notes?: string;
  condition?: string;
  /** false = paused: the treatment drops out of the log picker but is kept */
  active: boolean;
}

/** As read from `/api/profile/`. All fields optional: the server shape varies and some
 *  instances omit fields, or the whole `settings` sub-object. Read-only, no edit UI. */
export interface Profile {
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  language?: string;
  timezone?: string;
  /** auto-refresh rate string as the server returns it (e.g. "00:01:00"), or null */
  dashboardRefreshRate?: string | null;
}
