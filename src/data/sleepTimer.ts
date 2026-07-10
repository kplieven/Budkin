/**
 * Pure builders for the sleep timer, shared by the store (`stopTimer`) and the
 * headless widget toggle (`toggleNapFromWidget`) so both produce byte-identical
 * timers and entries. No I/O — trivially testable.
 */

import { ACTIVITY_LABEL } from '@/lib/activities';
import type { SleepEntry, Timer } from '@/types/models';

/** A fresh running sleep timer starting at `now` (epoch ms). */
export function startSleepTimer(now: number): Timer {
  return {
    id: 't' + now,
    activity: 'sleep',
    name: ACTIVITY_LABEL.sleep,
    start: now,
    saveAs: 'sleep',
  };
}

/**
 * Build the finished nap entry for a stopped sleep timer. Mirrors the sleep
 * branch of the store's `stopTimer`: `nap` defaults from the hour of day unless
 * the timer carries an explicit flag; tags carry through.
 */
export function buildSleepEntry(timer: Timer, now: number, childId: string): SleepEntry {
  const hr = new Date(now).getHours();
  return {
    id: 'e' + now,
    childId,
    tags: timer.tags ?? [],
    type: 'sleep',
    start: timer.start,
    end: now,
    nap: timer.nap ?? (hr >= 7 && hr < 19),
    notes: timer.notes,
  };
}
