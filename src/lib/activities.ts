/** Static (theme-independent) metadata for the tracked activities. */

import type { ActivityType, FeedMethod, FeedType } from '@/types/models';
import type { TimeEntryShape } from '@/types/timeEntry';

/** `amount` is dual-purpose: millilitres for a bottle or formula feed, a subjective
 *  `INTAKE_LEVELS` value at the breast, which must never be converted or labelled. */
export function feedAmountIsVolume(feedType: FeedType | undefined, method: FeedMethod | undefined): boolean {
  return feedType !== 'breast' || method === 'bottle';
}

/**
 * A three-level qualitative scale stored in an entry's numeric `amount`. One shape, two
 * uses: a solid diaper's size and a breast feed's intake.
 *
 * Baby Buddy's amount fields are plain floats, so any finite number can arrive (both
 * scales began life as a 1 to 10 score). Every `bucket` MUST be the identity on 1, 2 and
 * 3, which is what lets today's levels survive a round-trip while older wider-range
 * values still land somewhere sensible.
 */
export interface LevelSet {
  labels: readonly [string, string, string];
  bucket: (value: number) => 1 | 2 | 3;
}

/** Solid diaper size. */
export const DIAPER_LEVELS: LevelSet = {
  labels: ['Small', 'Medium', 'Large'],
  bucket: (v) => (v <= 1 ? 1 : v === 2 ? 2 : 3),
};

/**
 * Deliberately NON-MONOTONIC: 3 is "A lot" but 4 is "Some". This scale only ever writes
 * 1, 2 or 3, so a value above 3 cannot be a level and can only be a leftover from the old
 * 1 to 10 score. So 1 to 3 map to themselves and 4 and up take the same by-thirds reading
 * the API layer gives an untagged score off the wire. Making it monotonic would mean
 * either mangling today's levels or misreading every old score.
 *
 * An old 2 or 3 is the residual misread: by thirds they were both "A little", here they
 * read as "Some" and "A lot". Those values are genuinely ambiguous, so today's meaning
 * wins.
 */
export const INTAKE_LEVELS: LevelSet = {
  labels: ['A little', 'Some', 'A lot'],
  bucket: (v) => (v < 1.5 ? 1 : v < 2.5 ? 2 : v <= 3 ? 3 : v <= 7 ? 2 : 3),
};

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
  medication: 'Medication',
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
  medication: 'point',
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
  medication: 0,
  note: 0,
  milestone: 0,
};

export const ALL_ACTIVITIES: ActivityType[] = ['feeding', 'sleep', 'diaper', 'pumping', 'tummy', 'bath', 'temperature', 'medication'];

/**
 * Activities a twin household can log for several children in one save, each getting its
 * own entry. An allow-list, so an activity added later has to be argued onto it rather
 * than inheriting the affordance. What is missing is missing on purpose: `pumping` is
 * parent-side, so copying one session onto each child double-counts the milk in every
 * aggregate built on it, and a `temperature`, `medication` dose, `note` or `milestone` is
 * about one child by construction.
 */
export const SHARED_ROUTINE_ACTIVITIES: ActivityType[] = ['feeding', 'sleep', 'diaper', 'bath', 'tummy'];

export function allowsMultipleChildren(type: ActivityType): boolean {
  return SHARED_ROUTINE_ACTIVITIES.includes(type);
}

export const TIMER_SAVE_OPTIONS: ActivityType[] = ['feeding', 'sleep', 'pumping', 'tummy'];

export interface DurationShortcutCopy {
  /** the "log it as just-ended" button */
  doneTitle: string;
  doneSub: string;
  /** the "start a live timer" button */
  liveTitle: string;
  liveSub: string;
}

/** Shown at the top of every interval activity's log sheet. Point activities have none. */
export const DURATION_SHORTCUTS: Partial<Record<ActivityType, DurationShortcutCopy>> = {
  feeding: { doneTitle: 'Just finished', doneSub: 'ended this feed', liveTitle: 'Still feeding', liveSub: 'start a live timer' },
  sleep: { doneTitle: 'Woke up now', doneSub: 'ended this nap', liveTitle: 'Still sleeping', liveSub: 'start a live timer' },
  pumping: { doneTitle: 'Just finished', doneSub: 'ended this session', liveTitle: 'Still pumping', liveSub: 'start a live timer' },
  tummy: { doneTitle: 'Just finished', doneSub: 'ended tummy time', liveTitle: 'Still going', liveSub: 'start a live timer' },
};
