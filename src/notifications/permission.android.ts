import * as Notifications from 'expo-notifications';

/** Ask for POST_NOTIFICATIONS (Android 13+). Called ONLY from places with
 *  context for the ask: saving a due date, and the notification settings
 *  screen. The reconciler must never call this, a cold-launch permission
 *  dialog with no explanation is worse than the feature arriving a day later.
 *
 *  Both exports NEVER reject: any error from the native calls is caught,
 *  logged and reported as `false`. This module has a call site
 *  (`setup/baby.tsx`'s `onAddExpected`) that awaits the request BEFORE
 *  `saveChild`, by design, so a later grant can still reach the reconciler.
 *  If that await rejected, `saveChild` and `finish()` would never run and
 *  `setSaving(false)` is called nowhere in that file, so the user would be
 *  stranded on a dead form with the baby never saved. A denial must still
 *  save the child; a thrown exception must not be worse than a denial. */
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
