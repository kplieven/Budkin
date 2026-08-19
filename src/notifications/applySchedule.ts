// No scheduled reminders off Android. Signature kept in parity with the
// `.android.ts` so a caller cannot compile here and then fail to on Android.
import type { ScheduleInput, ScheduledNotification } from '@/notifications/scheduled';

export async function applyScheduled(
  _desired: ScheduledNotification[],
  _input: ScheduleInput,
  _now: number,
): Promise<void> {}
