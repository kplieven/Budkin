import * as Notifications from 'expo-notifications';

/** Ask for POST_NOTIFICATIONS (Android 13+). Called ONLY from places with
 *  context for the ask: saving a due date, and the notification settings
 *  screen. The reconciler must never call this, a cold-launch permission
 *  dialog with no explanation is worse than the feature arriving a day later. */
export async function requestReminderPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

export async function hasReminderPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}
