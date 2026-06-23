/** Static (theme-independent) metadata for the five tracked activities. */

import type { ActivityType } from '@/types/models';
import type { TimeEntryShape } from '@/types/timeEntry';

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  feeding: 'Feeding',
  sleep: 'Sleep',
  diaper: 'Diaper',
  pumping: 'Pumping',
  tummy: 'Tummy time',
};

export const ACTIVITY_SHAPE: Record<ActivityType, TimeEntryShape> = {
  feeding: 'interval',
  sleep: 'interval',
  diaper: 'point',
  pumping: 'interval',
  tummy: 'interval',
};

/** Default typical duration (minutes) pre-selected when opening an interval sheet. */
export const DEFAULT_DURATION_MIN: Record<ActivityType, number> = {
  feeding: 18,
  sleep: 90,
  pumping: 15,
  tummy: 18,
  diaper: 0,
};

export const ALL_ACTIVITIES: ActivityType[] = ['feeding', 'sleep', 'diaper', 'pumping', 'tummy'];

/** Activities a timer can be saved as. */
export const TIMER_SAVE_OPTIONS: ActivityType[] = ['feeding', 'sleep', 'pumping', 'tummy'];
