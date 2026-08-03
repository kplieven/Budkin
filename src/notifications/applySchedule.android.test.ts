import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as Notifications from 'expo-notifications';
import type { Notification, NotificationRequest } from 'expo-notifications';

// Imported by its explicit platform path: `.android.ts` files are normally
// selected by Metro's platform resolution and never load under the node test
// environment through the platform-agnostic specifier.
import { applyScheduled } from '@/notifications/applySchedule.android';
import { REMINDER_CHANNEL_ID, TIMER_CHANNEL_ID } from '@/notifications/content';
import { hasReminderPermission, requestReminderPermission } from '@/notifications/permission';
import type { ScheduleInput, ScheduledNotification } from '@/notifications/scheduled';
import type { Timer } from '@/types/models';

// The reconciler's only native surface. Every export it calls is mocked so
// the real .android.ts module can be imported directly under node. `vi.mock`
// calls are hoisted above these imports by vitest, so evaluation order here
// does not matter.
vi.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(),
  dismissNotificationAsync: vi.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

vi.mock('@/notifications/permission', () => ({
  hasReminderPermission: vi.fn(),
  requestReminderPermission: vi.fn(),
}));

const NOW = new Date(2026, 9, 31, 10, 30).getTime();

function pending(identifier: string, title: string, body: string): NotificationRequest {
  return {
    identifier,
    content: { title, body } as unknown as NotificationRequest['content'],
    trigger: null as unknown as NotificationRequest['trigger'],
  };
}

/** One banner sitting in the tray, as `getPresentedNotificationsAsync` reports it. */
function delivered(identifier: string): Notification {
  return { date: NOW, request: pending(identifier, '', '') } as Notification;
}

function wanted(overrides: Partial<ScheduledNotification> = {}): ScheduledNotification {
  return {
    identifier: 'budkin:due:c1:day:5000',
    kind: 'due',
    title: 'Test title',
    body: 'Test body',
    fireAt: 5000,
    data: { url: '/' },
    ...overrides,
  };
}

/** The store projection the dismissal pass asks its staleness questions against.
 *  Empty by default, so nothing is stale unless a test makes it so. */
function scheduleInput(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    children: [],
    timers: [],
    prefs: {
      dueDateReminders: true,
      staleTimerReminders: true,
      ageMilestones: true,
      pumpingReminders: false,
      pumpingIntervalMin: 180,
      pumpingEnabledAt: null,
      napSuggestions: true,
      treatmentReminders: false,
      treatmentRemindersEnabledAt: null,
      milestoneCatchUp: false,
    },
    lastPumpAt: null,
    lastSleepEndByChild: {},
    asleepChildIds: {},
    selectedChildId: 'c1',
    treatments: [],
    treatmentDoses: {},
    reachedMilestoneKeysByChild: {},
    answeredMilestoneKeysByChild: {},
    ...overrides,
  };
}

const sleepTimer = (childId: string): Timer => ({
  id: 't1',
  childId,
  activity: 'sleep',
  name: 'Sleep',
  start: NOW - 60_000,
  saveAs: 'sleep',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasReminderPermission).mockResolvedValue(true);
  vi.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([]);
  vi.mocked(Notifications.cancelScheduledNotificationAsync).mockResolvedValue(undefined);
  vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('id');
  vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([]);
  vi.mocked(Notifications.dismissNotificationAsync).mockResolvedValue(undefined);
});

describe('permission short-circuit', () => {
  it('reads, cancels and schedules nothing when permission is missing, and never requests it', async () => {
    vi.mocked(hasReminderPermission).mockResolvedValue(false);

    await applyScheduled([wanted()], scheduleInput(), NOW);

    expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(requestReminderPermission).not.toHaveBeenCalled();
  });

  it('does not read or touch the notification tray when permission is missing', async () => {
    vi.mocked(hasReminderPermission).mockResolvedValue(false);

    await applyScheduled([wanted()], scheduleInput({ asleepChildIds: { c1: true } }), NOW);

    expect(Notifications.getPresentedNotificationsAsync).not.toHaveBeenCalled();
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('cancel before schedule', () => {
  it('cancels a stale pending item before scheduling its replacement', async () => {
    const id = 'budkin:due:c1:day:5000';
    vi.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
      pending(id, 'Stale title', 'Stale body'),
    ]);
    const order: string[] = [];
    vi.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation(async (i) => {
      order.push(`cancel:${i}`);
    });
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (req) => {
      order.push(`schedule:${req.identifier}`);
      return req.identifier ?? id;
    });

    await applyScheduled([wanted({ identifier: id, title: 'New title' })], scheduleInput(), NOW);

    expect(order).toEqual([`cancel:${id}`, `schedule:${id}`]);
  });
});

describe('reconcile against the pending set', () => {
  it('cancels items no longer desired and schedules items not yet pending', async () => {
    const staleId = 'budkin:due:c1:day:1000';
    const newId = 'budkin:due:c2:day:2000';
    vi.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
      pending(staleId, 'Gone', 'Gone'),
    ]);

    await applyScheduled([wanted({ identifier: newId, fireAt: 2000 })], scheduleInput(), NOW);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(staleId);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ identifier: staleId }),
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: newId }),
    );
  });

  it('never cancels an identifier without the budkin prefix, even when it is absent from the desired set', async () => {
    // A timer notification's bare uuid, not ours to touch.
    const timerId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    vi.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
      pending(timerId, 'Timer running', ''),
    ]);

    await applyScheduled([], scheduleInput(), NOW);

    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('error resilience', () => {
  it('continues past a rejected cancel and still resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const idA = 'budkin:due:c1:day:1000';
    const idB = 'budkin:due:c2:day:2000';
    vi.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
      pending(idA, 'A', 'A'),
      pending(idB, 'B', 'B'),
    ]);
    vi.mocked(Notifications.cancelScheduledNotificationAsync)
      .mockRejectedValueOnce(new Error('boom on cancel'))
      .mockResolvedValue(undefined);

    await expect(applyScheduled([], scheduleInput(), NOW)).resolves.toBeUndefined();

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(idA);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(idB);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('continues past a rejected schedule and still resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const idA = 'budkin:due:c1:day:1000';
    const idB = 'budkin:due:c2:day:2000';
    vi.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('boom on schedule'));

    await expect(
      applyScheduled(
        [wanted({ identifier: idA, fireAt: 1000 }), wanted({ identifier: idB, fireAt: 2000 })],
        scheduleInput(),
        NOW,
      ),
    ).resolves.toBeUndefined();

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(idA);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(idB);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ identifier: idA }));
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ identifier: idB }));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('resolves without rejecting when hasReminderPermission itself rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(hasReminderPermission).mockRejectedValue(new Error('boom on permission check'));

    await expect(applyScheduled([wanted()], scheduleInput(), NOW)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('dismissing delivered reminders', () => {
  const napId = `budkin:nap:c1:${NOW - 15 * 60_000}`;

  it('dismisses a nap nudge whose child has since fallen asleep', async () => {
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([delivered(napId)]);

    await applyScheduled([], scheduleInput({ timers: [sleepTimer('c1')] }), NOW);

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(napId);
  });

  it('leaves a nudge that just fired and is still true, the child being awake', async () => {
    // The trap this pass exists to avoid. `desired` is empty here because a
    // reminder leaves the desired set the instant it fires, so a diff-driven
    // dismissal would clear this banner the moment the parent received it.
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([delivered(napId)]);

    await applyScheduled([], scheduleInput(), NOW);

    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it('never dismisses a delivered identifier without the budkin prefix', async () => {
    // A timer notification's bare uuid, posted by a different subsystem.
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      delivered('3fa85f64-5717-4562-b3fc-2c963f66afa6'),
    ]);

    await applyScheduled([], scheduleInput({ timers: [sleepTimer('c1')] }), NOW);

    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it('sweeps the tray only after cancelling and scheduling, so a tray failure cannot cost a reminder', async () => {
    const staleId = 'budkin:due:c1:day:1000';
    vi.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
      pending(staleId, 'Gone', 'Gone'),
    ]);
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([delivered(napId)]);
    const order: string[] = [];
    vi.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation(async () => {
      order.push('cancel');
    });
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (req) => {
      order.push('schedule');
      return req.identifier ?? '';
    });
    vi.mocked(Notifications.dismissNotificationAsync).mockImplementation(async () => {
      order.push('dismiss');
    });

    await applyScheduled([wanted()], scheduleInput({ timers: [sleepTimer('c1')] }), NOW);

    expect(order).toEqual(['cancel', 'cancel', 'schedule', 'dismiss']);
  });

  it('continues past a rejected dismiss and still resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const otherNapId = `budkin:nap:c2:${NOW - 15 * 60_000}`;
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      delivered(napId),
      delivered(otherNapId),
    ]);
    vi.mocked(Notifications.dismissNotificationAsync)
      .mockRejectedValueOnce(new Error('boom on dismiss'))
      .mockResolvedValue(undefined);

    await expect(
      applyScheduled([], scheduleInput({ asleepChildIds: { c1: true, c2: true } }), NOW),
    ).resolves.toBeUndefined();

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(napId);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(otherNapId);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still cancels and schedules when reading the tray rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockRejectedValue(new Error('boom on read'));

    await expect(applyScheduled([wanted()], scheduleInput(), NOW)).resolves.toBeUndefined();

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'budkin:due:c1:day:5000' }),
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('DATE trigger shape', () => {
  it('schedules with a DATE trigger carrying the fire time and the reminders channel', async () => {
    const item = wanted({ identifier: 'budkin:due:c1:day:5000', fireAt: 5000 });

    await applyScheduled([item], scheduleInput(), NOW);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: item.identifier,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: 5000,
          channelId: REMINDER_CHANNEL_ID,
        },
      }),
    );
    // Sanity: the reminders channel is not the timers channel, so a channel-id
    // typo that happened to still be a real channel would not slip past this.
    expect(REMINDER_CHANNEL_ID).not.toBe(TIMER_CHANNEL_ID);
  });
});
