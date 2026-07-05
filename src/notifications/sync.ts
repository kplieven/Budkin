/**
 * Keeps the Android notification tray in sync with running timers — the exact
 * twin of `widgets/sync.ts`. On every store change, rebuild the desired
 * notification set from `state.timers`, diff it against what was last posted, and
 * post/dismiss the delta. No-ops cleanly off Android (the post module is a stub).
 */

import { desiredTimerNotifications, diffTimerNotifications, type TimerNotification } from '@/notifications/content';
import { dismissTimerNotification, postTimerNotification } from '@/notifications/postNotification';
import { useAppStore } from '@/store/useAppStore';

let prev: TimerNotification[] = [];
let started = false;

export function initTimerNotificationSync(): void {
  if (started) return;
  started = true;
  const run = async () => {
    const s = useAppStore.getState();
    const child = s.children.find((c) => c.id === s.selectedChildId);
    const next = desiredTimerNotifications(s.timers, child?.first ?? '');
    const { toPost, toDismiss } = diffTimerNotifications(prev, next);
    prev = next;
    for (const n of toPost) await postTimerNotification(n);
    for (const id of toDismiss) await dismissTimerNotification(id);
  };
  useAppStore.subscribe(run);
  void run();
}
