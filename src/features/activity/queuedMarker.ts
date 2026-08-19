/**
 * Pure view logic for the "still waiting to upload" marker on a timeline row.
 *
 * The population is `budkin.queue.v1` mirrored into the store as `queuedIds`, and nothing
 * else. Not `pendingOps` (offline edits and deletes, which are not rows waiting to
 * appear) and not held-back entries (an expecting child's records are never queued).
 *
 * `serverId == null` is NOT the test and must never become one. "Unsynced" and "waiting
 * on the write queue" are different questions: a held-back entry has no `serverId` and is
 * never queued, and `flushUnsynced` pushes records the queue never sees.
 */

import { isTimer, type TimelineItem } from './groupByDay';

/**
 * Empty in local mode: `enterLocal` does not clear the queue file, so a device that used
 * a server before still carries ids that would mark local records as waiting.
 *
 * Build this once per render, never inside a `useAppStore` selector: a selector returning
 * a fresh Set makes zustand v5 see a perpetually-changed snapshot and loop forever.
 */
export function queuedIdSet(queuedIds: readonly string[], serverMode: boolean): Set<string> {
  return serverMode ? new Set(queuedIds) : new Set();
}

/**
 * A running timer never is: timers live in their own array with their own id space and
 * `flushQueue` only ever pushes entries, so a matching id could only be a coincidence.
 */
export function isItemQueued(item: TimelineItem, queued: ReadonlySet<string>): boolean {
  return !isTimer(item) && queued.has(item.id);
}

/**
 * The accessible name of a timeline row. Lives here rather than inline in the component
 * so the queued state cannot be drawn without also being announced.
 *
 * `elapsed` is pre-formatted with `fmtDur` ("1h 18m") rather than the pill's
 * column-constrained `fmtAgoShort` ("1h18m"), which reads badly aloud. `child` is the
 * spoken suffix from `childAttribution`, never a bare name assembled here, so the chip
 * History draws and the words a screen reader hears cannot name different children.
 */
export function timelineRowLabel(opts: {
  activity: string;
  ongoing: boolean;
  timer: boolean;
  elapsed: string;
  queued: boolean;
  child?: string;
}): string {
  const who = opts.child ?? '';
  const base = opts.ongoing
    ? `Edit running ${opts.activity}${opts.timer ? ' timer' : ''}${who}, ${opts.elapsed} so far`
    : `Edit ${opts.activity}${who}`;
  return opts.queued ? `${base}, waiting to upload` : base;
}
