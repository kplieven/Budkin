// No background reminder reconcile off Android. Signature kept in parity with the
// `.android.ts` so a caller cannot compile here and then fail to on Android.
// Keeping expo-background-task out of this file is what keeps it out of the web
// bundle: web has no scheduled reminders to go stale in the first place.
export async function initBackgroundSync(): Promise<void> {}
