/**
 * Copy for the confirm step in front of Settings' "Reconnect / change server"
 * row (`src/app/settings/index.tsx`).
 *
 * `disconnect()` clears the connection, the entity cache, the write queue and
 * the offline op-log in one call (see `useAppStore.ts`). The cache comes back
 * from the server on the next connect; the queue and the op-log exist nowhere
 * else, so whatever they hold at that moment is destroyed for good. The row
 * used to call `disconnect()` straight from the press, one tap, no questions:
 * this module is the questions. Kept in a `.ts` for the usual reason:
 * `vitest.config.ts` only matches `.test.ts`, so anything living in a component
 * file is untestable by convention here.
 *
 * The confirm opens on EVERY press, not only when something is queued: signing
 * out and wiping the device copy is worth a look even with nothing to lose,
 * and a confirm that sometimes fires and sometimes does not reads as flaky
 * rather than protective. What varies is the loss line: it appears only when
 * something really would be destroyed, and then with the exact counts, because
 * a warning that cries wolf on an empty queue teaches the user to stop
 * reading it.
 */

import { entryCountLabel } from '@/features/queue/queueView';

/**
 * The sentence that is true of every disconnect, losses or none.
 *
 * "Anything already uploaded stays on the server" earns its place: without it,
 * "removes its data from this device" reads like the whole history is being
 * destroyed, when the device copy of synced data is exactly the part that is
 * refetchable. The loss claim itself lives only in {@link disconnectLossLine},
 * so this line must never say "lost" (the test pins that).
 */
export const DISCONNECT_BASE_LINE =
  'This signs you out of this server and removes its data from this device. Anything already uploaded stays on the server.';

/**
 * "1 change" / "2 changes": the offline op-log counted in its own unit.
 * Sibling of `entryCountLabel`, which owns the write queue's unit. "Change"
 * and not "edit" because the op-log holds deletes as well as updates (see
 * `PendingOp` in `src/data/pendingOps.ts`), and it is the word the offline
 * banner already uses for work waiting to sync.
 */
export function changeCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'change' : 'changes'}`;
}

/**
 * The sentence naming exactly what this disconnect destroys, or null when it
 * destroys nothing.
 *
 * `queueCount` is the store's live mirror of the write queue (entries created
 * on this device that have not reached the server). `pendingOpsCount` is the
 * length of `loadPendingOps()` read when the confirm opens: the op-log has no
 * mirror in state, and an AsyncStorage read at open is fresh enough for a
 * dialog the user still has to read.
 *
 * The two populations are counted under two nouns ("entries" / "changes")
 * rather than one merged number because they are different things: the queue
 * holds new entries, the op-log holds edits and deletes to records the server
 * already has. One merged count would also contradict the "N entries waiting
 * to upload" figure the Settings queue row shows directly above this confirm.
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
