import * as Notifications from 'expo-notifications';

import type { TimerNotification } from '@/notifications/content';

/** Ask for POST_NOTIFICATIONS the first time we actually need to post (Android 13+).
 *  Denied → the feature silently no-ops; timers keep working. */
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
    trigger: null, // immediate; lands on the `timers` default channel (see config plugin)
  });
}

export async function dismissTimerNotification(id: string): Promise<void> {
  await Notifications.dismissNotificationAsync(id);
}
