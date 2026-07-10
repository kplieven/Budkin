/** Static (theme-independent) metadata for the five tracked activities. */

import type { ActivityType } from '@/types/models';
import type { TimeEntryShape } from '@/types/timeEntry';

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  feeding: 'Feeding',
  sleep: 'Sleep',
  diaper: 'Diaper',
  pumping: 'Pumping',
  tummy: 'Tummy time',
  bath: 'Bath',
  temperature: 'Temperature',
  note: 'Note',
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
