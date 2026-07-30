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

/**
 * The sentence under the headline count.
 *
 * Takes `loaded` because an unread queue counts 0, and the empty copy is an
 * "everything is synced" claim: shown during the read it contradicts the
 * headline directly above it, on every visit, to a user who came here precisely
 * because things are not synced.
 *
 * Deliberately does NOT send the user to History. `commitWrite` queues any
 * `Entry`, and a queued `note` shows only in the Notes tab while a queued
 * `milestone` shows only in the Growth checklist (see `src/types/models.ts`), so
 * "they already show in History" is false for two of the ten types this screen
 * lists. Where the copy has to say something reassuring, it says the thing that
 * is true of all ten: they are saved, and nothing needs logging again.
 */
export function queueSummaryHint(loaded: boolean, count: number): string {
  if (!loaded) return 'Checking what is still waiting to upload.';
  if (count === 0) return 'Entries you log while offline wait here until Budkin can reach the server. Nothing is waiting right now.';
  return 'These are saved on this device and go up on their own once the server is reachable. Nothing needs logging again.';
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
 *
 * `loading` comes FIRST and is why `loaded` is a parameter at all: an unread
 * queue counts 0, so without it every visit would show a greyed button for the
 * length of an AsyncStorage round trip and then enable it, for no reason the
 * user can see.
 */
export type SyncBlock = 'loading' | 'local' | 'offline' | 'empty';

export function syncBlockedBy(opts: {
  loaded: boolean;
  serverMode: boolean;
  offline: boolean;
  count: number;
}): SyncBlock | null {
  if (!opts.loaded) return 'loading';
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
    // Nothing to explain in either of the remaining cases: an empty queue is
    // already spelled out by the card above, and a read in flight is over
    // before a sentence about it could be read.
    case 'loading':
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
 * `after > before` gets its OWN branch and must not fall in with the failure
 * case. A write landing on the queue while the flush is in flight (the Android
 * widget's headless task can do exactly this) grows the queue past where it
 * started, so a flush that uploaded every entry it had can still end with more
 * waiting than it began with. Reported as a count, with the reason, because
 * subtracting two numbers cannot separate what went up from what arrived.
 */
export function syncResultMessage(before: number, after: number): string {
  if (before === 0) return 'Nothing was waiting.';
  if (after === 0) return `Uploaded ${entryCountLabel(before)}.`;
  if (after > before) {
    return `${entryCountLabel(after)} waiting now. More were logged while the sync ran, so what went up cannot be told apart.`;
  }
  if (after === before) return `Nothing uploaded. ${entryCountLabel(after)} still waiting.`;
  return `Uploaded ${before - after} of ${before}. ${entryCountLabel(after)} still waiting.`;
}
