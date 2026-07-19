/**
 * Pure builders for the sleep timer, shared by the store (`stopTimer`) and the
 * headless widget toggle (`toggleNapFromWidget`) so both produce byte-identical
 * timers and entries. No I/O — trivially testable.
 */

import { ACTIVITY_LABEL } from '@/lib/activities';
import type { SleepEntry, Timer } from '@/types/models';

/** A fresh running sleep timer starting at `now` (epoch ms), stamped with the
 *  child it belongs to so a later stop can't misattribute it to whoever
 *  happens to be selected at that point (e.g. the widget starts a nap, the
 *  app then switches the selected child, and Stop is tapped from the Timers
 *  tab). */
export function startSleepTimer(now: number, childId: string): Timer {
  return {
    id: 't' + now,
    activity: 'sleep',
    name: ACTIVITY_LABEL.sleep,
    start: now,
    saveAs: 'sleep',
    childId,
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
