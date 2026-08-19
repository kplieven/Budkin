/**
 * Copy for the confirm step in front of Settings' "Reconnect / change server" row.
 *
 * `disconnect()` clears the connection, the entity cache, the write queue and the offline
 * op-log in one call. The cache comes back from the server on the next connect; the queue
 * and the op-log exist nowhere else, so whatever they hold is destroyed for good.
 *
 * The confirm opens on every press, not only when something is queued, because a confirm
 * that sometimes fires reads as flaky rather than protective. What varies is the loss
 * line, which appears only when something really would be destroyed.
 */

import { entryCountLabel } from '@/features/queue/queueView';

/**
 * "Anything already uploaded stays on the server" earns its place: without it, "removes
 * its data from this device" reads like the whole history is being destroyed, when the
 * device copy of synced data is exactly the refetchable part. The loss claim lives only
 * in {@link disconnectLossLine}, so this line must never say "lost" (a test pins that).
 */
export const DISCONNECT_BASE_LINE =
  'This signs you out of this server and removes its data from this device. Anything already uploaded stays on the server.';

/**
 * "Change" and not "edit" because the op-log holds deletes as well as updates, and it is
 * the word the offline banner already uses for work waiting to sync.
 */
export function changeCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'change' : 'changes'}`;
}

/**
 * `queueCount` is the store's live mirror of the write queue. `pendingOpsCount` is the
 * length of `loadPendingOps()` read when the confirm opens: the op-log has no mirror in
 * state, and an AsyncStorage read at open is fresh enough for a dialog.
 *
 * Two nouns rather than one merged number because they are different things: the queue
 * holds new entries, the op-log holds edits and deletes to records the server already
 * has. A merged count would also contradict the figure shown directly above.
 */
export function disconnectLossLine(queueCount: number, pendingOpsCount: number): string | null {
  if (queueCount <= 0 && pendingOpsCount <= 0) return null;
  const what =
    queueCount > 0 && pendingOpsCount > 0
      ? `${entryCountLabel(queueCount)} and ${changeCountLabel(pendingOpsCount)}`
      : queueCount > 0
        ? entryCountLabel(queueCount)
        : changeCountLabel(pendingOpsCount);
  return `${what} waiting to upload will be permanently lost.`;
}
