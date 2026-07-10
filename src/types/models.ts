/**
 * Domain models for Baby Buddy. These mirror the activity shapes used by the
 * design and map onto the Baby Buddy REST API resources.
 *
 * Internally we keep timestamps as epoch-millisecond numbers (what the UI
 * works with); the API layer converts to/from ISO 8601 strings.
 */

export type ActivityType = 'feeding' | 'sleep' | 'diaper' | 'pumping' | 'tummy' | 'bath' | 'temperature';

export type FeedType = 'breast' | 'formula' | 'fortified' | 'solid';
export type FeedMethod = 'left' | 'right' | 'both' | 'bottle' | 'parent' | 'self';
export type DiaperColor = 'black' | 'brown' | 'green' | 'yellow';

export interface Child {
  id: string;
  first: string;
  last: string;
  /** birth date, epoch ms */
  birth: number;
  /** avatar tint color (hex) */
  color: string;
  /** API slug, when connected to a real server */
  slug?: string;
  /** remote photo URL, when present */
  picture?: string | null;
}

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
 * A bath (small/big wash). Baby Buddy has no bath resource, so these are stored
 * server-side as tagged Notes (see the API client). Point event — a single time,
 * no duration. `wash` distinguishes the daily "small wash" from the periodic
 * "big wash".
 */
export interface BathEntry extends EntryBase {
  type: 'bath';
  time: number;
  wash: 'small' | 'big';
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

export type Entry =
  | FeedingEntry
  | SleepEntry
  | DiaperEntry
  | PumpingEntry
  | TummyEntry
  | BathEntry
  | TemperatureEntry;

/** Activities that are point-in-time (single timestamp) vs interval (start/end). */
export const POINT_ACTIVITIES: ActivityType[] = ['diaper', 'bath', 'temperature'];

export function entryTimestamp(e: Entry): number {
  return e.type === 'diaper' || e.type === 'bath' || e.type === 'temperature'
    ? e.time
    : (e.end ?? e.start);
}

export interface Timer {
  id: string;
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
