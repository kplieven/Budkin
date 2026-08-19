// No notifications off Android; the platform-resolved `.android.ts` does the real work.
import type { TimerNotification } from '@/notifications/content';

export async function postTimerNotification(_n: TimerNotification): Promise<void> {}
export async function dismissTimerNotification(_id: string): Promise<void> {}
