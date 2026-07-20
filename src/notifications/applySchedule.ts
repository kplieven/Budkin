// No scheduled reminders off Android, the platform-resolved `.android.ts` does
// the real work.
import type { ScheduledNotification } from '@/notifications/scheduled';

export async function applyScheduled(_desired: ScheduledNotification[]): Promise<void> {}
