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
  const run = async (s: ReturnType<typeof useAppStore.getState>) => {
    const next = desiredTimerNotifications(s.timers, s.children);
    const { toPost, toDismiss } = diffTimerNotifications(prev, next);
    prev = next;
    for (const n of toPost) await postTimerNotification(n);
    for (const id of toDismiss) await dismissTimerNotification(id);
  };
  // Notifications derive only from `timers` and the child roster (each timer is
  // titled with its own child), so gate on those two slices: the per-second `now`
  // tick changes nothing here and early-returns — no rebuild, no diff, no
  // notification round-trip. The selected child is deliberately NOT in the gate:
  // it no longer feeds a title, so switching child rebuilds nothing.
  useAppStore.subscribe((state, previous) => {
    if (state.timers === previous.timers && state.children === previous.children) {
      return;
    }
    void run(state);
  });
  void run(useAppStore.getState());
}
