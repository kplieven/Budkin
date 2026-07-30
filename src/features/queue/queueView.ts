/**
 * Pure view logic for the offline queue screen (`src/app/settings/queue.tsx`).
 *
 * Kept out of the `.tsx` because `vitest.config.ts` only matches `.test.ts`:
 * anything living in a component file is untestable by convention here.
 * Everything below is a plain function of its arguments, so the screen stays a
 * thin renderer over these.
 *
 * The population is `budkin.queue.v1` (see `src/data/queue.ts`) and nothing
 * else: the created-entry write queue that `flushQueue` pushes. It is NOT
 * `selectPendingCount`, which adds unsynced measurements on top and drives the
 * offline banners. Two different numbers, deliberately, so nothing here may be
 * phrased as if it were that one.
 */

import { groupByDay, type DayGroup } from '@/features/activity/groupByDay';
import { ACTIVITY_LABEL } from '@/lib/activities';
import type { ActivityType, Entry } from '@/types/models';

/** "1 entry" / "4 entries". The unit the whole screen counts in. */
export function entryCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

/**
 * The screen's headline count, named for what the queue actually is: entries
 * created on this device that have not reached the server yet.
 *
 * Says "Waiting to upload" rather than "pending" or "unsynced" so it cannot be
 * read as the offline banner's figure, which counts a wider population.
 */
export function queueSummaryLine(n: number): string {
  return n === 0 ? 'Nothing waiting to upload' : `Waiting to upload: ${entryCountLabel(n)}`;
}

export interface QueueTypeCount {
  type: ActivityType;
  count: number;
  /** ready-to-render "2 Feeding", the activity's own label kept verbatim */
  label: string;
}

/**
 * What is waiting, broken down by activity, biggest group first.
 *
 * Ties keep first-seen (queue) order rather than sorting by name, so a stable
 * `Array.prototype.sort` leaves two equal counts in the order the entries were
 * enqueued. `ACTIVITY_LABEL` is used verbatim and never pluralised: "2 Tummy
 * time" is clumsy but correct, where a naive "+s" would invent "2 Tummy times".
 */
export function queueTypeCounts(queue: Entry[]): QueueTypeCount[] {
  const order: ActivityType[] = [];
  const counts = new Map<ActivityType, number>();
  for (const e of queue) {
    if (!counts.has(e.type)) order.push(e.type);
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  return order
    .map((type) => ({ type, count: counts.get(type) ?? 0, label: `${counts.get(type) ?? 0} ${ACTIVITY_LABEL[type]}` }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The queue as day groups, newest first, reusing the History timeline's own
 * grouping so a queued entry sits under the same Today / Yesterday / date
 * heading it will have once it lands.
 *
 * Grouped by the entry's OWN timestamp, not by when it was enqueued: the queue
 * records no enqueue time (`Entry` has no such field and `budkin.queue.v1` must
 * not be migrated for this screen), and the entry's timestamp is the one the
 * user recognises anyway.
 */
export function groupQueuedByDay(queue: Entry[], now: number): DayGroup<Entry>[] {
  return groupByDay(queue, now);
}

/**
 * Whose entry this is, or null when saying so adds nothing.
 *
 * Null for a single-child household (the answer is never in doubt) and null for
 * a child that is no longer on the device, where a blank or an id would be
 * worse than silence.
 */
export function attributionFor(childId: string, children: { id: string; first: string }[]): string | null {
  if (children.length < 2) return null;
  return children.find((c) => c.id === childId)?.first ?? null;
}

/**
 * Why "Sync now" cannot run right now, or null when it can.
 *
 * Mirrors `flushQueue`'s own guards (`useAppStore.ts`: it returns early unless
 * there is a server connection and `offline` is false) rather than second
 * guessing them, so the button is never enabled for a call that would silently
 * do nothing. `offline` is the store's derived flag, so the dev "Simulate
 * offline" toggle blocks the button exactly as a real outage does, which is the
 * honest reading: nothing can reach the server either way.
 */
export type SyncBlock = 'local' | 'offline' | 'empty';

export function syncBlockedBy(opts: { serverMode: boolean; offline: boolean; count: number }): SyncBlock | null {
  if (!opts.serverMode) return 'local';
  if (opts.offline) return 'offline';
  if (opts.count === 0) return 'empty';
  return null;
}

/** The sentence shown beneath a disabled "Sync now", or null when it is live. */
export function syncBlockedHint(block: SyncBlock | null): string | null {
  switch (block) {
    case 'local':
      return 'Local mode keeps everything on this device, so there is nothing to upload.';
    case 'offline':
      return 'No connection to the server right now. Entries upload on their own once it is back.';
    case 'empty':
      return null;
    default:
      return null;
  }
}

/**
 * What a finished "Sync now" actually achieved, in the queue's own terms:
 * how many entries were waiting before, and how many still are.
 *
 * Counted rather than reported by the flush because nothing records WHY a push
 * failed. `flushQueue` catches a throwing push and puts the entry straight back
 * on the queue with no error, no retry count and no timestamp, so the only
 * truthful thing this screen can say is what moved and what did not. It must
 * never claim success on a flush that quietly re-queued everything.
 *
 * `after > before` is reachable: a write made while the flush was in flight
 * lands on the queue behind it. Reported as a plain count rather than as a
 * failure, because nothing went wrong.
 */
export function syncResultMessage(before: number, after: number): string {
  if (before === 0) return 'Nothing was waiting.';
  if (after === 0) return `Uploaded ${entryCountLabel(before)}.`;
  if (after >= before) return `Nothing uploaded. ${entryCountLabel(after)} still waiting.`;
  return `Uploaded ${before - after} of ${before}. ${entryCountLabel(after)} still waiting.`;
}
