/**
 * Pure view logic for the "still waiting to upload" marker on a timeline row.
 *
 * Kept out of `TimelineEntry.tsx` because `vitest.config.ts` only matches
 * `.test.ts`: anything living in a component file is untestable by convention
 * here (same reason `queueView.ts` sits beside the queue screen).
 *
 * The population is `budkin.queue.v1` (see `src/data/queue.ts`) mirrored into
 * the store as `queuedIds`, and nothing else. Deliberately NOT `pendingOps`
 * (offline edits and deletes, which are not rows waiting to appear) and NOT
 * held-back entries (an expecting child's records are never queued at all, see
 * `commitWrite`).
 *
 * `serverId == null` is NOT the test and must never become one. `flushQueue`
 * pushes each entry and DISCARDS `pushEntryToServer`'s return value, so it
 * never stamps `serverId` back onto the in-memory record; an entry keeps
 * `serverId == null` until the next `refresh()`/`hydrate()` replaces `entries`
 * wholesale. A `serverId`-based marker would keep claiming "queued" on rows
 * that went up minutes ago.
 */

import { isTimer, type TimelineItem } from './groupByDay';

/**
 * The ids to mark, as a Set so a long timeline costs one lookup per row rather
 * than a scan of the queue.
 *
 * Empty unless the connection is a server one. Nothing is ever queued in local
 * mode, but `enterLocal` does not clear the queue file, so a device that used a
 * server before can still carry ids that would otherwise mark ordinary local
 * records as waiting for an upload that will never happen.
 *
 * Build this ONCE per render (a `useMemo` over the raw `queuedIds` array), never
 * inside a `useAppStore` selector: a selector returning a fresh Set makes
 * zustand v5 see a perpetually-changed snapshot and loop forever.
 */
export function queuedIdSet(queuedIds: readonly string[], serverMode: boolean): Set<string> {
  return serverMode ? new Set(queuedIds) : new Set();
}

/** Whether one timeline row is still sitting in the write queue. A running
 *  timer never is: timers live in their own array with their own id space and
 *  `flushQueue` only ever pushes entries, so a matching id could only be a
 *  coincidence. */
export function isItemQueued(item: TimelineItem, queued: ReadonlySet<string>): boolean {
  return !isTimer(item) && queued.has(item.id);
}

/**
 * The accessible name of a timeline row. Lives here rather than inline in the
 * component so the queued state cannot be drawn without also being announced.
 *
 * `elapsed` is pre-formatted by the caller with `fmtDur` ("1h 18m") rather than
 * the pill's column-constrained `fmtAgoShort` ("1h18m"), which reads badly
 * aloud. The queued clause goes LAST, after the elapsed time, so the sentence
 * stays "what this row is, then what is still true of it".
 *
 * "Waiting to upload" is the offline queue screen's own wording (see
 * `queueView.ts`), so the two surfaces name the same state the same way.
 */
export function timelineRowLabel(opts: {
  activity: string;
  ongoing: boolean;
  timer: boolean;
  elapsed: string;
  queued: boolean;
}): string {
  const base = opts.ongoing
    ? `Edit running ${opts.activity}${opts.timer ? ' timer' : ''}, ${opts.elapsed} so far`
    : `Edit ${opts.activity}`;
  return opts.queued ? `${base}, waiting to upload` : base;
}
