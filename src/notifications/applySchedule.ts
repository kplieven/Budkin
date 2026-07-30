// No scheduled reminders off Android, the platform-resolved `.android.ts` does
// the real work. Signature kept in parity with it, including the `input` and
// `now` the delivered-notification sweep needs, so a caller cannot compile here
// and then fail to on Android.
import type { ScheduleInput, ScheduledNotification } from '@/notifications/scheduled';

export async function applyScheduled(
  _desired: ScheduledNotification[],
  _input: ScheduleInput,
  _now: number,
): Promise<void> {}
