import * as Notifications from 'expo-notifications';

import { REMINDER_CHANNEL_ID } from '@/notifications/content';
import { hasReminderPermission } from '@/notifications/permission';
import { diffScheduled, type ExistingNotification, type ScheduledNotification } from '@/notifications/scheduled';

/** What Android currently holds, narrowed to the fields the diff compares. */
async function readScheduled(): Promise<ExistingNotification[]> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  return pending.map((r) => ({
    identifier: r.identifier,
    title: r.content.title ?? '',
    body: r.content.body ?? '',
  }));
}

/**
 * Reconcile the OS's pending set against the desired one. The OS is the source
 * of truth, NOT an in-memory `prev` like `sync.ts` keeps: these notifications
 * outlive the process, so a fresh `prev = []` on launch would schedule a second
 * copy of everything already pending.
 *
 * Unlike `sync.ts`'s state, which is re-derived from scratch on every launch,
 * a partial reconcile here PERSISTS across launches and nothing retries it. So
 * one failing item must not abort the rest, and nothing may escape as an
 * unhandled rejection (the caller discards this promise with `void`).
 */
export async function applyScheduled(desired: ScheduledNotification[]): Promise<void> {
  try {
    // Silently skip while permission is missing. Everything else keeps working.
    if (!(await hasReminderPermission())) return;
    const { toSchedule, toCancel } = diffScheduled(await readScheduled(), desired);
    for (const id of toCancel) {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch (e) {
        console.warn('[scheduleSync] cancelScheduledNotificationAsync failed:', id, e);
      }
    }
    for (const n of toSchedule) {
      try {
        // Cancel first. `toSchedule` includes ids that are ALREADY pending with
        // stale content (a renamed child), and expo-notifications does not
        // document what scheduling over a live identifier does. Cancelling
        // makes it a replace either way.
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
        await Notifications.scheduleNotificationAsync({
          identifier: n.identifier,
          content: { title: n.title, body: n.body, data: n.data },
          // DATE trigger with an explicit channelId. Inexact by design: we do
          // not claim SCHEDULE_EXACT_ALARM, so Doze may delay delivery, which
          // is fine for every reminder here. See the spec's exact-alarm
          // decision.
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: n.fireAt,
            channelId: REMINDER_CHANNEL_ID,
          },
        });
      } catch (e) {
        console.warn('[scheduleSync] scheduleNotificationAsync failed:', n.identifier, e);
      }
    }
  } catch (e) {
    console.warn('[scheduleSync] applyScheduled failed:', e);
  }
}
