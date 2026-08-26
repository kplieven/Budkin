/** Periodic background reconcile of the OS's pending reminder set.
 *
 *  expo-background-task offers PERIODIC scheduling only (15-minute floor, batched
 *  by WorkManager), so "sync just before a reminder fires" is built as a cheap
 *  gate inside a periodic worker: it wakes often and almost always returns
 *  without touching the network. See
 *  docs/superpowers/specs/2026-08-26-background-reminder-reconcile-design.md */

import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { loadLastBackgroundSyncAt, saveLastBackgroundSyncAt } from '@/data/backgroundSyncState';
import { loadConnection } from '@/data/storage';
import { shouldBackgroundSync } from '@/notifications/backgroundGate';
import { hasReminderPermission } from '@/notifications/permission';
import { reconcileAndWait } from '@/notifications/scheduleSync';
import { useAppStore } from '@/store/useAppStore';

export const BACKGROUND_SYNC_TASK = 'budkin-background-reminder-sync';

/** Minutes. WorkManager's floor. Asking for less does not get less. */
const MINIMUM_INTERVAL_MIN = 15;

/** The task body. Exported because a `defineTask` callback is otherwise
 *  unreachable from a test. Takes `now` rather than reading the clock so the
 *  gate's boundaries can be exercised deterministically. */
export async function runBackgroundSync(now: number): Promise<void> {
  // Gather every gate input first, then decide once. All four are local: a native
  // permission query, one SecureStore read, one notification-manager IPC call and
  // one AsyncStorage read. No network happens before the gate opens.
  const hasPermission = await hasReminderPermission();
  // Secure storage, NOT the store: in a cold headless context nothing has
  // hydrated, so `getState().connection` is null and a store-based check would
  // gate out the exact case this task exists for.
  const conn = await loadConnection();
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const lastSyncAt = await loadLastBackgroundSyncAt();

  const open = shouldBackgroundSync({
    pendingIds: pending.map((r) => r.identifier),
    now,
    lastSyncAt,
    serverMode: conn?.mode === 'server',
    hasPermission,
  });
  if (!open) return;

  // Cold context: `hydrating` initialises true and only ever goes false inside
  // `hydrate()`, making it a reliable signal. Warm, the store is already
  // populated and `initScheduledReminderSync`'s subscriber is live.
  if (useAppStore.getState().hydrating) await useAppStore.getState().hydrate();

  // A failed refresh must not abort the reconcile: local data may still have
  // moved since the last one, and skipping the stamp below is what makes an
  // unreachable server retry at the next wake instead of waiting out the floor.
  // "Failed" here means the ordinary case — an unreachable server, a 401 — which
  // `refresh()` reports through state rather than by throwing, so the reconcile
  // below still runs. An EXOTIC throw (only `loadTimers()` rejecting, or
  // `clearConnection()` rejecting inside refresh's own catch) does skip it; the
  // task-level catch then warns, returns Success and leaves the stamp unwritten,
  // so the gate stays open and the next wake retries within ~15 minutes.
  //
  // The success signal is `offline`, NOT a try/catch. `refresh()` swallows every
  // failure and never rethrows — a 401/403 clears the connection, anything else sets
  // `offline: true` — so a catch here can only be dead code that reports success on
  // every wake. The success path applies the server load with `offline: false`, so
  // reading the flag AFTER the awaited refresh separates the two, including when it
  // was already true on entry: a successful refresh clears it.
  //
  // Awaited, and this is the whole point of `refresh()` joining an in-flight one
  // rather than bailing: `hydrate()` above starts a refresh it does not await.
  //
  // `push: false` — the PULL half only. This context is torn down the moment the task
  // promise resolves, and `flushQueue` drops an entry from the durable queue only AFTER
  // the server accepts it, so a teardown between those two steps re-pushes the entry on
  // the next wake and duplicates it on the server. Reconciling reminders needs no write:
  // `applyServerLoad` merges the queue file back into `entries`, so a still-queued row is
  // visible to `desiredScheduled` regardless. The foreground still flushes as it always did.
  await useAppStore.getState().refresh({ push: false });
  const refreshed = !useAppStore.getState().offline;
  if (!refreshed) console.warn('[backgroundSync] refresh left the store offline; not stamping');

  // Awaited, not fired and forgotten: this context is torn down the moment the
  // task's promise resolves, and a partial reconcile persists across launches.
  await reconcileAndWait();

  if (refreshed) await saveLastBackgroundSyncAt(now);
}

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    await runBackgroundSync(Date.now());
  } catch (e) {
    // Always Success, never Failed: `Failed` earns WorkManager backoff we do not
    // want, and there is nothing to retry that the next wake will not cover.
    console.warn('[backgroundSync] task failed:', e);
  }
  return BackgroundTask.BackgroundTaskResult.Success;
});

/** Registered unconditionally at startup rather than reactively on connection
 *  mode: a no-op wake is essentially free and the gate already returns instantly
 *  in local mode, so a store subscription would be complexity for nothing.
 *  Re-registering is safe — it updates the existing configuration. */
export async function initBackgroundSync(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: MINIMUM_INTERVAL_MIN,
    });
  } catch (e) {
    console.warn('[backgroundSync] registerTaskAsync failed:', e);
  }
}
