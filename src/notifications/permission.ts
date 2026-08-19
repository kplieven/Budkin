// No notification permission model off Android. Honours the .android.ts contract
// (never rejects) trivially.
export async function requestReminderPermission(): Promise<boolean> {
  return false;
}

export async function hasReminderPermission(): Promise<boolean> {
  return false;
}
