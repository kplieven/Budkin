/** Keeps the Android notification tray in sync with running timers. No-ops off
 *  Android, where the post module is a stub. */

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
  // Gated on the only two slices a title derives from: the per-second `now` tick
  // would otherwise cost a rebuild and a native round trip for nothing.
  useAppStore.subscribe((state, previous) => {
    if (state.timers === previous.timers && state.children === previous.children) {
      return;
    }
    void run(state);
  });
  void run(useAppStore.getState());
}
