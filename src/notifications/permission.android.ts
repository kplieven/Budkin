import * as Notifications from 'expo-notifications';

/** Ask for POST_NOTIFICATIONS (Android 13+), only from places with context for
 *  the ask. The reconciler must never call this: a cold-launch permission dialog
 *  with no explanation is worse than the feature arriving a day later.
 *
 *  Both exports NEVER reject. `setup/baby.tsx` awaits the request BEFORE
 *  `saveChild` and never clears its saving flag, so a throw would strand the user
 *  on a dead form with the baby never saved. */
export async function requestReminderPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch (e) {
    console.warn('[permission] requestReminderPermission failed:', e);
    return false;
  }
}

export async function hasReminderPermission(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch (e) {
    console.warn('[permission] hasReminderPermission failed:', e);
    return false;
  }
}
