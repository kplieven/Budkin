/**
 * Pure builders for the sleep timer, shared by the store (`stopTimer`) and the
 * headless widget toggle (`toggleNapFromWidget`) so both produce byte-identical
 * timers and entries. No I/O — trivially testable.
 */

import { ACTIVITY_LABEL } from '@/lib/activities';
import { DEFAULT_NAP_WINDOW, isNapStart, type NapWindow } from '@/store/selectors';
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
 * branch of the store's `stopTimer`: `nap` falls back to the nap window unless
 * the timer carries an explicit flag; tags carry through.
 *
 * The window is a PARAMETER rather than a store read because this also runs in
 * the headless widget task, which has no store. `napToggle.ts` loads the pref
 * itself and passes it down, keeping this function pure.
 *
 * The fallback classifies on `timer.start`, not on `now` (the wake). That is a
 * deliberate change: Baby Buddy classifies on start only, so a wake-time answer
 * would flip as soon as the entry round-tripped through the server.
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
