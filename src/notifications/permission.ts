// No notification permission model off Android. Shares the .android.ts
// contract (never rejects) trivially: there is no native call here to fail.
export async function requestReminderPermission(): Promise<boolean> {
  return false;
}

export async function hasReminderPermission(): Promise<boolean> {
  return false;
}
