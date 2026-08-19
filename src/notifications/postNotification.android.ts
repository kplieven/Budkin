import * as Notifications from 'expo-notifications';

import { TIMER_CHANNEL_ID, type TimerNotification } from '@/notifications/content';

/** POST_NOTIFICATIONS (Android 13+), asked the first time we need to post. Denied
 *  means the feature silently no-ops; timers keep working. */
async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

export async function postTimerNotification(n: TimerNotification): Promise<void> {
  if (!(await ensurePermission())) return;
  await Notifications.scheduleNotificationAsync({
    identifier: n.identifier,
    content: { title: n.title, body: n.body, data: n.data, sticky: true },
    // Channel-aware trigger: delivers immediately AND binds the notification to
    // our LOW channel. A plain `trigger: null` lands on a noisy default one.
    trigger: { channelId: TIMER_CHANNEL_ID },
  });
}

export async function dismissTimerNotification(id: string): Promise<void> {
  await Notifications.dismissNotificationAsync(id);
}
