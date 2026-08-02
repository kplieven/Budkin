/**
 * Pure view logic for the offline queue screen (`src/app/settings/queue.tsx`).
 *
 * Kept out of the `.tsx` because `vitest.config.ts` only matches `.test.ts`:
 * anything living in a component file is untestable by convention here.
 * Everything below is a function of its arguments alone, `runQueueRetry`
 * included: it takes the store calls a Retry press needs as arguments rather
 * than reaching for the store, so the screen stays a thin renderer (and a thin
 * presser) over these.
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
 *
 * `childId` is optional, which an `Entry`'s never is, because the running-timer
 * cards share this rule through `src/features/timers/timerAttribution.ts` and
 * `Timer.childId` IS optional. An unowned timer falls in with the unknown child
 * above and says nothing, rather than being named after whoever is selected.
 */
export function attributionFor(childId: string | undefined, children: { id: string; first: string }[]): string | null {
  if (children.length < 2) return null;
  return children.find((c) => c.id === childId)?.first ?? null;
}

/**
 * Why "Retry" cannot run right now, or null when it can.
 *
 * Deliberately does NOT mirror `flushQueue`'s guards, and takes neither
 * `offline` nor the queue count. The button re-checks the connection before it
 * flushes (`refresh()` in the store), so `offline` is the reason to press it,
 * not a reason to grey it out: this is the same affordance as the offline
 * banner's own retry, and a user sent here from that banner would otherwise
 * arrive at a dead button. An empty queue blocks nothing either, for the same
 * reason: with nothing waiting there is still a connection worth re-checking,
 * which is now the button's first job. What the connection is doing is said
 * beside the live button instead, by `offlineHint` below.
 *
 * What is left is the pair no retry can get out of. `local` has no server to
 * reach at all. `loading` comes FIRST and is why `loaded` is a parameter: for
 * the length of an AsyncStorage read the screen does not yet know what it is
 * looking at, and a result line landing under a card still headed "Reading the
 * queue" answers a question it has not finished asking.
 */
export type SyncBlock = 'loading' | 'local';

export function syncBlockedBy(opts: { loaded: boolean; serverMode: boolean }): SyncBlock | null {
  if (!opts.loaded) return 'loading';
  if (!opts.serverMode) return 'local';
  return null;
}

/**
 * The sentence shown beneath a disabled "Retry", or null when it is live.
 *
 * Only `local` has anything to say. A read in flight is over before a sentence
 * about it could be read, so `loading` falls through to the same null as a live
 * button.
 */
export function syncBlockedHint(block: SyncBlock | null): string | null {
  switch (block) {
    case 'local':
      return 'Local mode keeps everything on this device, so there is nothing to upload.';
    default:
      return null;
  }
}

/**
 * The line that says the connection is down, beside a Retry that stays live.
 *
 * Not a block and not a `SyncBlock`: the press is precisely what re-checks the
 * connection, so greying the button out was the bug. But the screen still has to
 * SAY so. On mobile `/settings/queue` is a stack route with no offline banner
 * over it, so an offline user who has not pressed anything yet would otherwise
 * see a live button, entries piling up, and no stated reason for either.
 *
 * Silent in local mode, where `syncBlockedHint` owns this slot and the missing
 * server, not the network, is the whole story. Silent too once a press has been
 * `answered`: every offline `syncResultMessage` opens with the same "No
 * connection to the server", and the result is both fresher and about something
 * the user actually asked. Speaks during `loading` because the connection is
 * known independently of the AsyncStorage read, and holding it back would only
 * make it appear a beat late.
 */
export function offlineHint(opts: { offline: boolean; block: SyncBlock | null; answered: boolean }): string | null {
  if (!opts.offline || opts.block === 'local' || opts.answered) return null;
  return 'No connection to the server right now. Retry checks again straight away, and entries upload on their own once the connection is back.';
}

/**
 * What a finished "Retry" actually achieved: whether the server can be reached,
 * and what that did to the queue (how many entries were waiting before, how many
 * still are).
 *
 * `offline` is the store's flag read AFTER the retry, so it reports the state the
 * re-check left behind rather than the one the press started from. Where nothing
 * moved it is the whole story and names the connection: `flushQueue` returns
 * early on exactly that flag, so "Nothing uploaded" would read as a failed upload
 * of entries that were never attempted.
 *
 * It is NOT taken as proof that nothing moved. The flag describes the end of the
 * window, not all of it: the flush can empty the queue and the connection go down
 * straight after (the NetInfo listener, a server that stops answering). So the
 * counts are checked first, and an upload is reported whenever `before > after`
 * even while offline. Reading the flag alone hid three finished uploads behind
 * "Nothing is waiting to upload.", which reads as a retry that achieved nothing.
 *
 * The counts are counted rather than reported by the flush because nothing
 * records WHY a push failed. `flushQueue` catches a throwing push and puts the
 * entry straight back on the queue with no error, no retry count and no
 * timestamp, so the only truthful thing this screen can say is what moved and
 * what did not. It must never claim success on a flush that quietly re-queued
 * everything.
 *
 * `after > before` gets its OWN branch and must not fall in with the failure
 * case. A write landing on the queue while the flush is in flight (the Android
 * widget's headless task can do exactly this) grows the queue past where it
 * started, so a flush that uploaded every entry it had can still end with more
 * waiting than it began with. Reported as a count, with the reason, because
 * subtracting two numbers cannot separate what went up from what arrived.
 */
export function syncResultMessage(opts: { offline: boolean; before: number; after: number }): string {
  const { offline, before, after } = opts;
  if (offline) {
    // Something did go up, and then the connection went. Lead with the upload:
    // it is the part the user cannot see anywhere else.
    if (before > after) {
      if (after === 0) return `Uploaded ${entryCountLabel(before)}. No connection to the server.`;
      return `Uploaded ${before - after} of ${before}. No connection to the server. ${entryCountLabel(after)} still waiting.`;
    }
    if (after === 0) return 'No connection to the server. Nothing is waiting to upload.';
    return `No connection to the server. ${entryCountLabel(after)} still waiting.`;
  }
  // Reached the server with nothing queued: the connection IS the result, and
  // it is the only thing the press can have been asking about.
  if (before === 0) return 'Connected. Nothing was waiting to upload.';
  if (after === 0) return `Uploaded ${entryCountLabel(before)}.`;
  if (after > before) {
    return `${entryCountLabel(after)} waiting now. More were logged while the sync ran, so what went up cannot be told apart.`;
  }
  if (after === before) return `Nothing uploaded. ${entryCountLabel(after)} still waiting.`;
  return `Uploaded ${before - after} of ${before}. ${entryCountLabel(after)} still waiting.`;
}

/** What a Retry press needs from the store and the queue file. */
export interface QueueRetryDeps {
  /** Re-reads the queue and hands it back. Only its length is used here. */
  read: () => Promise<{ length: number }>;
  /** `useAppStore`'s `refresh`: the one call this button can make that clears `offline`. */
  refresh: () => Promise<void>;
  /** `useAppStore`'s `flushQueue`. */
  flushQueue: () => Promise<void>;
  /** Reads `offline` from the store at the moment it is called, never a captured copy. */
  getOffline: () => boolean;
}

/**
 * One press of Retry, start to finish: what the screen shows when it is done.
 *
 * Lives here rather than in the `.tsx` because the ORDER is the whole feature and
 * `vitest.config.ts` only matches `.test.ts`. Collaborators are injected for the
 * same reason.
 *
 * The order, and why each step is where it is:
 *
 * 1. A FRESH baseline read, not the last focus read. The Android widget's
 *    headless task enqueues out of process, so the count on screen can already be
 *    behind the file, and a stale baseline turns a partly successful flush into a
 *    reported failure.
 * 2. `refresh()` BEFORE the flush, and awaited. `flushQueue` returns early while
 *    `offline` is set, and of the calls this button can make only `refresh` can
 *    clear it, so a flush that does not wait for the re-check is a no-op for the
 *    very user this button exists for: the one who arrived from the offline
 *    banner with no connection.
 * 3. `flushQueue()` awaited too, and not left to the flush `refresh` fires
 *    itself: that one is deliberately fire-and-forget, so the count below would
 *    land mid-upload and report a successful sync as "Nothing uploaded. N still
 *    waiting." (The store joins the two overlapping flushes rather than running
 *    both, see `flushQueueInFlight` in `useAppStore.ts`.)
 * 4. `getOffline()` LAST, after both awaits and the closing count. The flag the
 *    press started from is exactly the one the refresh may have just changed.
 *
 * Both awaits are wrapped: `flushQueue` catches its own per-entry failures and
 * `refresh` catches an unreachable server, so nothing is expected to escape
 * either, but if something does, the counts either side are still the only
 * trustworthy account of what happened and the caller should get that rather than
 * a rejection.
 */
export async function runQueueRetry(deps: QueueRetryDeps): Promise<string> {
  const before = (await deps.read()).length;
  try {
    await deps.refresh();
    await deps.flushQueue();
  } catch {
    // Deliberately swallowed: see above. The counts tell the story.
  }
  const after = (await deps.read()).length;
  return syncResultMessage({ offline: deps.getOffline(), before, after });
}
