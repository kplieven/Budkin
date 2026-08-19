/**
 * Pure builders for the sleep timer, shared by the store (`stopTimer`) and the
 * headless widget toggle (`toggleNapFromWidget`) so both produce byte-identical
 * timers and entries.
 */

import { ACTIVITY_LABEL } from '@/lib/activities';
import { DEFAULT_NAP_WINDOW, isNapStart, type NapWindow } from '@/store/selectors';
import type { SleepEntry, Timer } from '@/types/models';

/** Stamped with the child it belongs to so a later stop can't misattribute it to
 *  whoever happens to be selected at that point (the widget starts a nap, the app
 *  then switches child, and Stop is tapped from the Timers tab). */
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
 * `nap` falls back to the nap window unless the timer carries an explicit flag.
 * The window is a PARAMETER rather than a store read because this also runs in the
 * headless widget task, which has no store: `napToggle.ts` loads the pref and
 * passes it down.
 *
 * The fallback classifies on `timer.start`, not on `now` (the wake), because Baby
 * Buddy classifies on start only and a wake-time answer would flip as soon as the
 * entry round-tripped through the server.
 */
export function buildSleepEntry(
  timer: Timer,
  now: number,
  childId: string,
  napWindow: NapWindow = DEFAULT_NAP_WINDOW,
): SleepEntry {
  return {
    id: 'e' + now,
    childId,
    tags: timer.tags ?? [],
    type: 'sleep',
    start: timer.start,
    end: now,
    nap: timer.nap ?? isNapStart(timer.start, napWindow),
    notes: timer.notes,
  };
}
