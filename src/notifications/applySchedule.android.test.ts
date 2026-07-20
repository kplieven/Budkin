import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as Notifications from 'expo-notifications';
import type { NotificationRequest } from 'expo-notifications';

// Imported by its explicit platform path: `.android.ts` files are normally
// selected by Metro's platform resolution and never load under the node test
// environment through the platform-agnostic specifier.
import { applyScheduled } from '@/notifications/applySchedule.android';
import { REMINDER_CHANNEL_ID, TIMER_CHANNEL_ID } from '@/notifications/content';
import { hasReminderPermission, requestReminderPermission } from '@/notifications/permission';
import type { ScheduledNotification } from '@/notifications/scheduled';

// The reconciler's only native surface. Every export it calls is mocked so
// the real .android.ts module can be imported directly under node. `vi.mock`
// calls are hoisted above these imports by vitest, so evaluation order here
// does not matter.
vi.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

vi.mock('@/notifications/permission', () => ({
  hasReminderPermission: vi.fn(),
  requestReminderPermission: vi.fn(),
}));

function pending(identifier: string, title: string, body: string): NotificationRequest {
  return {
    identifier,
    content: { title, body } as unknown as NotificationRequest['content'],
    trigger: null as unknown as NotificationRequest['trigger'],
  };
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasReminderPermission).mockResolvedValue(true);
  vi.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([]);
  vi.mocked(Notifications.cancelScheduledNotificationAsync).mockResolvedValue(undefined);
  vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('id');
});

describe('permission short-circuit', () => {
  it('reads, cancels and schedules nothing when permission is missing, and never requests it', async () => {
    vi.mocked(hasReminderPermission).mockResolvedValue(false);

    await applyScheduled([wanted()]);

    expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(requestReminderPermission).not.toHaveBeenCalled();
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

    await applyScheduled([wanted({ identifier: id, title: 'New title' })]);

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

    await applyScheduled([wanted({ identifier: newId, fireAt: 2000 })]);

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

    await applyScheduled([]);

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

    await expect(applyScheduled([])).resolves.toBeUndefined();

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
      applyScheduled([wanted({ identifier: idA, fireAt: 1000 }), wanted({ identifier: idB, fireAt: 2000 })]),
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

    await expect(applyScheduled([wanted()])).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('DATE trigger shape', () => {
  it('schedules with a DATE trigger carrying the fire time and the reminders channel', async () => {
    const item = wanted({ identifier: 'budkin:due:c1:day:5000', fireAt: 5000 });

    await applyScheduled([item]);

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
