/** Static (theme-independent) metadata for the five tracked activities. */

import type { ActivityType, FeedMethod, FeedType } from '@/types/models';
import type { TimeEntryShape } from '@/types/timeEntry';

/**
 * Does a feeding's `amount` hold a VOLUME, or a dimensionless intake level?
 *
 * The field is dual-purpose. A bottle or formula feed measures millilitres, so
 * it gets the ml/fl oz stepper and converts with the units preference. A feed
 * taken at the breast records a subjective intake level instead (1, 2 or 3, see
 * `INTAKE_LEVELS`), which has no unit and must never be converted or labelled.
 *
 * Both the log sheet (picking which control to show) and the history detail
 * line (picking how to format) must agree on this, so they share one predicate
 * rather than each carrying a copy that could drift.
 */
export function feedAmountIsVolume(feedType: FeedType | undefined, method: FeedMethod | undefined): boolean {
  return feedType !== 'breast' || method === 'bottle';
}

/**
 * A three-level qualitative scale stored in an entry's numeric `amount` as 1, 2
 * or 3. One shape, two uses: a solid diaper's size and a breast feed's intake.
 *
 * `bucket` maps a stored number onto one of the three levels. It exists because
 * the field has held other things over time (both scales began life as a 1 to
 * 10 score) and because Baby Buddy's own amount fields are plain floats, so any
 * finite number can arrive. Every bucket MUST be the identity on 1, 2 and 3:
 * that is what lets today's levels survive a round-trip while older wider-range
 * values still land somewhere sensible instead of nowhere.
 */
export interface LevelSet {
  labels: readonly [string, string, string];
  bucket: (value: number) => 1 | 2 | 3;
}

/** Solid diaper size. Unchanged from the original 3-level diaper control. */
export const DIAPER_LEVELS: LevelSet = {
  labels: ['Small', 'Medium', 'Large'],
  bucket: (v) => (v <= 1 ? 1 : v === 2 ? 2 : 3),
};

/**
 * How much the baby took at the breast.
 *
 * The bucket is deliberately NON-MONOTONIC: 3 is "A lot" but 4 is "Some". That
 * reads oddly until you know what the two ranges mean. This scale only ever
 * writes 1, 2 or 3, so a value above 3 cannot be a level and can only be a
 * leftover from the old 1 to 10 score. The two ranges are therefore different
 * kinds of number and are read differently: 1 to 3 are levels and map to
 * themselves, while 4 and up are old scores and take the same "by thirds"
 * reading the API layer gives an untagged score off the wire (4-7 some, 8-10 a
 * lot). Making it monotonic would mean either mangling today's levels or
 * misreading every old score, and both are worse than looking odd.
 *
 * That leaves an old 2 or 3 as the only residual misread: by thirds they were
 * both "A little", here they read as "Some" and "A lot". Those two values are
 * genuinely ambiguous (a stored 3 is both a valid level and a valid old score)
 * and nothing in the data can separate them, so today's meaning wins. Old
 * scores that reached a server are converted once, on read (see `client.ts`),
 * and arrive here already reduced to a level.
 */
export const INTAKE_LEVELS: LevelSet = {
  labels: ['A little', 'Some', 'A lot'],
  bucket: (v) => (v < 1.5 ? 1 : v < 2.5 ? 2 : v <= 3 ? 3 : v <= 7 ? 2 : 3),
};

/** The word for a stored intake `amount`, e.g. 3 -> "A lot". */
export function intakeLevelLabel(amount: number): string {
  return INTAKE_LEVELS.labels[INTAKE_LEVELS.bucket(amount) - 1];
}

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  feeding: 'Feeding',
  sleep: 'Sleep',
  diaper: 'Diaper',
  pumping: 'Pumping',
  tummy: 'Tummy time',
  bath: 'Bath',
  temperature: 'Temperature',
  note: 'Note',
  milestone: 'Milestone',
};

export const ACTIVITY_SHAPE: Record<ActivityType, TimeEntryShape> = {
  feeding: 'interval',
  sleep: 'interval',
  diaper: 'point',
  pumping: 'interval',
  tummy: 'interval',
  bath: 'point',
  temperature: 'point',
  note: 'point',
  milestone: 'point',
};

/** Default typical duration (minutes) pre-selected when opening an interval sheet. */
export const DEFAULT_DURATION_MIN: Record<ActivityType, number> = {
  feeding: 18,
  sleep: 90,
  pumping: 15,
  tummy: 18,
  diaper: 0,
  bath: 0,
  temperature: 0,
  note: 0,
  milestone: 0,
};

export const ALL_ACTIVITIES: ActivityType[] = ['feeding', 'sleep', 'diaper', 'pumping', 'tummy', 'bath', 'temperature'];

/** Activities a timer can be saved as. */
export const TIMER_SAVE_OPTIONS: ActivityType[] = ['feeding', 'sleep', 'pumping', 'tummy'];

export interface DurationShortcutCopy {
  /** the "log it as just-ended" button */
  doneTitle: string;
  doneSub: string;
  /** the "start a live timer" button */
  liveTitle: string;
  liveSub: string;
}

/** Copy for the two shortcut buttons shown at the top of every interval
 *  activity's log sheet. Point activities (diaper) have none. */
export const DURATION_SHORTCUTS: Partial<Record<ActivityType, DurationShortcutCopy>> = {
  feeding: { doneTitle: 'Just finished', doneSub: 'ended this feed', liveTitle: 'Still feeding', liveSub: 'start a live timer' },
  sleep: { doneTitle: 'Woke up now', doneSub: 'ended this nap', liveTitle: 'Still sleeping', liveSub: 'start a live timer' },
  pumping: { doneTitle: 'Just finished', doneSub: 'ended this session', liveTitle: 'Still pumping', liveSub: 'start a live timer' },
  tummy: { doneTitle: 'Just finished', doneSub: 'ended tummy time', liveTitle: 'Still going', liveSub: 'start a live timer' },
};
