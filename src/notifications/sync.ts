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
    const child = s.children.find((c) => c.id === s.selectedChildId);
    const next = desiredTimerNotifications(s.timers, child?.first ?? '');
    const { toPost, toDismiss } = diffTimerNotifications(prev, next);
    prev = next;
    for (const n of toPost) await postTimerNotification(n);
    for (const id of toDismiss) await dismissTimerNotification(id);
  };
  // Notifications derive only from `timers` and the selected child's name, so
  // gate on those slices: the per-second `now` tick changes nothing here and
  // early-returns — no rebuild, no diff, no notification round-trip.
  useAppStore.subscribe((state, previous) => {
    if (
      state.timers === previous.timers &&
      state.children === previous.children &&
      state.selectedChildId === previous.selectedChildId
    ) {
      return;
    }
    void run(state);
  });
  void run(useAppStore.getState());
}
