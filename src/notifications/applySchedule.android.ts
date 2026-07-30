import * as Notifications from 'expo-notifications';

import { REMINDER_CHANNEL_ID } from '@/notifications/content';
import { hasReminderPermission } from '@/notifications/permission';
import {
  diffScheduled,
  staleDelivered,
  type ExistingNotification,
  type ScheduleInput,
  type ScheduledNotification,
} from '@/notifications/scheduled';

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
 * Sweep reminders that have already been DELIVERED but have since stopped being
 * true out of the notification tray.
 *
 * `applyScheduled`'s cancel loop cannot reach these.
 * `cancelScheduledNotificationAsync` only affects PENDING alarms, and a
 * notification leaves the pending set the moment it fires, so the nudge that
 * fired at 15:00 is still sitting in the shade at 15:02 when the parent starts
 * the nap. `staleDelivered` decides what has gone stale, from the condition each
 * kind reports on rather than from the desired set (see its comment: a
 * just-fired reminder is absent from the desired set by construction, so a
 * diff-driven rule would clear every banner on arrival).
 *
 * Living inside the reconciler rather than at each mutation site is what makes
 * it ride every existing trigger for free: a gated store write, the foreground
 * resume in `_layout.tsx`, launch, and a dose that arrives from another device
 * through `refresh()`. The reverse case needs no symmetric pass either, since
 * nothing can un-deliver a notification.
 */
async function dismissStale(input: ScheduleInput, now: number): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const ids = presented.map((n) => n.request.identifier);
  for (const id of staleDelivered(input, ids, now)) {
    try {
      await Notifications.dismissNotificationAsync(id);
    } catch (e) {
      console.warn('[scheduleSync] dismissNotificationAsync failed:', id, e);
    }
  }
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
export async function applyScheduled(
  desired: ScheduledNotification[],
  input: ScheduleInput,
  now: number,
): Promise<void> {
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
    // LAST, deliberately. A tray that cannot be read is a cosmetic loss; a
    // reminder that never got scheduled is not. Ordering it after both loops
    // means a native failure here (this whole pass rides the outer catch) can
    // only cost the sweep, never the schedule.
    await dismissStale(input, now);
  } catch (e) {
    console.warn('[scheduleSync] applyScheduled failed:', e);
  }
}
