/**
 * Pure view logic for the offline queue screen.
 *
 * The population is `budkin.queue.v1` and nothing else: the created-entry write queue
 * that `flushQueue` pushes. It is NOT `selectPendingCount`, which adds unsynced
 * measurements on top and drives the offline banners. Two different numbers, so nothing
 * here may be phrased as if it were that one.
 */

import { ACTIVITY_LABEL } from '@/lib/activities';
import type { ActivityType, Entry } from '@/types/models';

export function entryCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

export function queueSummaryLine(n: number): string {
  return n === 0 ? 'Nothing waiting to upload' : `Waiting to upload: ${entryCountLabel(n)}`;
}

/**
 * Takes `loaded` because an unread queue counts 0, and the empty copy is an "everything
 * is synced" claim: shown during the read it contradicts the headline above it.
 */
export function queueSummaryHint(loaded: boolean, count: number): string {
  if (!loaded) return 'Checking what is still waiting to upload.';
  if (count === 0) return 'Entries you log while offline wait here until Budkin can reach the server. Nothing is waiting right now.';
  return 'These are saved on this device and go up on their own once the server is reachable. Nothing needs logging again.';
}

export interface QueueTypeCount {
  type: ActivityType;
  count: number;
  label: string;
}

/**
 * What is waiting, broken down by activity, biggest group first. Ties keep queue order.
 * `ACTIVITY_LABEL` is used verbatim and never pluralised: "2 Tummy time" is clumsy but
 * correct, where a naive "+s" would invent "2 Tummy times".
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
 * Null for a single-child household or a child no longer on the device. `childId` is
 * optional because `Timer.childId` is, and an unowned timer says nothing rather than
 * being named after whoever is selected.
 */
export function attributionFor(childId: string | undefined, children: { id: string; first: string }[]): string | null {
  if (children.length < 2) return null;
  return children.find((c) => c.id === childId)?.first ?? null;
}

export type SyncBlock = 'loading' | 'local';

/**
 * Why "Retry" cannot run right now, or null when it can. Deliberately takes neither
 * `offline` nor the queue count: the button re-checks the connection before it flushes,
 * so being offline is the reason to press it, not a reason to grey it out.
 */
export function syncBlockedBy(opts: { loaded: boolean; serverMode: boolean }): SyncBlock | null {
  if (!opts.loaded) return 'loading';
  if (!opts.serverMode) return 'local';
  return null;
}

/** `loading` falls through to null: the read is over before a sentence could be read. */
export function syncBlockedHint(block: SyncBlock | null): string | null {
  switch (block) {
    case 'local':
      return 'Local mode keeps everything on this device, so there is nothing to upload.';
    default:
      return null;
  }
}

/**
 * On mobile `/settings/queue` is a stack route with no offline banner over it, so an
 * offline user would otherwise see a live button, entries piling up, and no stated reason
 * for either. Silent once `answered`, where `syncResultMessage` says the same thing.
 */
export function offlineHint(opts: { offline: boolean; block: SyncBlock | null; answered: boolean }): string | null {
  if (!opts.offline || opts.block === 'local' || opts.answered) return null;
  return 'No connection to the server right now. Retry checks again straight away, and entries upload on their own once the connection is back.';
}

/**
 * What a finished "Retry" achieved.
 *
 * `offline` is read AFTER the retry and is not taken as proof that nothing moved: the
 * flush can empty the queue and the connection go down straight after. So the counts are
 * checked first and an upload is reported whenever `before > after` even while offline.
 *
 * `after > before` gets its own branch. A write landing while the flush is in flight
 * (the Android widget's headless task can do this) grows the queue past where it
 * started, so subtracting two numbers cannot separate what went up from what arrived.
 */
export function syncResultMessage(opts: { offline: boolean; before: number; after: number }): string {
  const { offline, before, after } = opts;
  if (offline) {
    if (before > after) {
      if (after === 0) return `Uploaded ${entryCountLabel(before)}. No connection to the server.`;
      return `Uploaded ${before - after} of ${before}. No connection to the server. ${entryCountLabel(after)} still waiting.`;
    }
    if (after === 0) return 'No connection to the server. Nothing is waiting to upload.';
    return `No connection to the server. ${entryCountLabel(after)} still waiting.`;
  }
  if (before === 0) return 'Connected. Nothing was waiting to upload.';
  if (after === 0) return `Uploaded ${entryCountLabel(before)}.`;
  if (after > before) {
    return `${entryCountLabel(after)} waiting now. More were logged while the sync ran, so what went up cannot be told apart.`;
  }
  if (after === before) return `Nothing uploaded. ${entryCountLabel(after)} still waiting.`;
  return `Uploaded ${before - after} of ${before}. ${entryCountLabel(after)} still waiting.`;
}

export interface QueueRetryDeps {
  read: () => Promise<{ length: number }>;
  refresh: () => Promise<void>;
  flushQueue: () => Promise<void>;
  /** Reads `offline` from the store at the moment it is called, never a captured copy. */
  getOffline: () => boolean;
}

/**
 * One press of Retry. The order is the whole feature:
 *
 * 1. A fresh baseline read, not the last focus read. The Android widget's headless task
 *    enqueues out of process, so the count on screen can already be behind the file.
 * 2. `refresh()` before the flush, and awaited. `flushQueue` returns early while
 *    `offline` is set and only `refresh` can clear it.
 * 3. `flushQueue()` awaited too, not left to the fire-and-forget flush `refresh` starts:
 *    that one would land the closing count mid-upload. The store joins the two
 *    overlapping flushes rather than running both.
 * 4. `getOffline()` last, after both awaits, since the refresh may have just changed it.
 */
export async function runQueueRetry(deps: QueueRetryDeps): Promise<string> {
  const before = (await deps.read()).length;
  try {
    await deps.refresh();
    await deps.flushQueue();
  } catch {
    // The counts either side are the only trustworthy account of what happened, so the
    // caller gets that rather than a rejection.
  }
  const after = (await deps.read()).length;
  return syncResultMessage({ offline: deps.getOffline(), before, after });
}
