/**
 * Domain models for Baby Buddy. These mirror the activity shapes used by the
 * design and map onto the Baby Buddy REST API resources.
 *
 * Internally we keep timestamps as epoch-millisecond numbers (what the UI
 * works with); the API layer converts to/from ISO 8601 strings.
 */

export type ActivityType = 'feeding' | 'sleep' | 'diaper' | 'pumping' | 'tummy';

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
}

export interface SleepEntry extends EntryBase {
  type: 'sleep';
  start: number;
  end: number | null;
  nap: boolean;
}

export interface DiaperEntry extends EntryBase {
  type: 'diaper';
  time: number;
  wet: boolean;
  solid: boolean;
  color: DiaperColor | null;
  amount?: number | null;
}

export interface PumpingEntry extends EntryBase {
  type: 'pumping';
  start: number;
  end: number | null;
  amount: number | null;
  method?: FeedMethod;
}

export interface TummyEntry extends EntryBase {
  type: 'tummy';
  start: number;
  end: number | null;
  milestone?: string;
}

export type Entry = FeedingEntry | SleepEntry | DiaperEntry | PumpingEntry | TummyEntry;

/** Activities that are point-in-time (single timestamp) vs interval (start/end). */
export const POINT_ACTIVITIES: ActivityType[] = ['diaper'];

export function entryTimestamp(e: Entry): number {
  return e.type === 'diaper' ? e.time : (e.end ?? e.start);
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
