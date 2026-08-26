/** Decides whether a background wake should spend network. Pure, so the whole
 *  policy is testable without a device: the worker gathers the inputs, this
 *  answers yes or no. */

import { parseReminderId, REMINDER_PREFIX } from '@/notifications/scheduled';

/** Sync when a reminder is due within this many minutes. Must EXCEED the expected
 *  gap between wakes or the window is missed entirely: WorkManager's floor is 15
 *  minutes and the OS batches runs, so 30 leaves slack for a late wake. */
export const PREFIRE_WINDOW_MIN = 30;

/** Sync at least this often even with nothing pending. Without a floor, remote
 *  activity could never CREATE a reminder on a device that has none armed to hang
 *  a wake off. */
export const SYNC_FLOOR_H = 4;

export interface BackgroundSyncGate {
  /** Identifiers Android currently holds, ours and everyone else's. */
  pendingIds: readonly string[];
  now: number;
  /** Epoch ms of the last completed background sync; null if never. */
  lastSyncAt: number | null;
  serverMode: boolean;
  hasPermission: boolean;
}

export function shouldBackgroundSync(g: BackgroundSyncGate): boolean {
  // Nothing remote can change what is scheduled, so a sync could only cost
  // battery. Checked first: these are the cheapest facts to be sure of.
  if (!g.hasPermission || !g.serverMode) return false;

  // Never synced: the floor has trivially elapsed.
  if (g.lastSyncAt == null) return true;
  if (g.now - g.lastSyncAt >= SYNC_FLOOR_H * 3_600_000) return true;

  const cutoff = g.now + PREFIRE_WINDOW_MIN * 60_000;
  for (const id of g.pendingIds) {
    // `parseReminderId` assumes a pre-filtered id and does not check the prefix
    // itself; `staleDelivered` guards the same way (scheduled.ts:616).
    if (!id.startsWith(REMINDER_PREFIX)) continue;
    const parsed = parseReminderId(id);
    // Malformed: ignore it. A background task must never throw.
    if (!parsed) continue;
    if (parsed.fireAt <= cutoff) return true;
  }
  return false;
}
