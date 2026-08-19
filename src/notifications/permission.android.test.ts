import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as Notifications from 'expo-notifications';

// Explicit platform path: Metro picks the `.android.ts` suffix on device, but the
// node test environment never would.
import { hasReminderPermission, requestReminderPermission } from '@/notifications/permission.android';

vi.mock('expo-notifications', () => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requestReminderPermission', () => {
  it('returns true when permission is already granted, without requesting', async () => {
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      granted: true,
      canAskAgain: true,
    } as Notifications.NotificationPermissionsStatus);

    await expect(requestReminderPermission()).resolves.toBe(true);

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests when not granted and canAskAgain is true, returning the request result', async () => {
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      granted: false,
      canAskAgain: true,
    } as Notifications.NotificationPermissionsStatus);
    vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
      granted: true,
      canAskAgain: true,
    } as Notifications.NotificationPermissionsStatus);

    await expect(requestReminderPermission()).resolves.toBe(true);

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  });

  it('returns false without requesting when canAskAgain is false', async () => {
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      granted: false,
      canAskAgain: false,
    } as Notifications.NotificationPermissionsStatus);

    await expect(requestReminderPermission()).resolves.toBe(false);

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  // A rejection here strands setup/baby.tsx's onAddExpected: saveChild and
  // finish() never run and nothing calls setSaving(false), leaving a dead form.
  it('resolves false rather than rejecting when getPermissionsAsync rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(Notifications.getPermissionsAsync).mockRejectedValue(new Error('boom on getPermissionsAsync'));

    await expect(requestReminderPermission()).resolves.toBe(false);

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('resolves false rather than rejecting when requestPermissionsAsync rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      granted: false,
      canAskAgain: true,
    } as Notifications.NotificationPermissionsStatus);
    vi.mocked(Notifications.requestPermissionsAsync).mockRejectedValue(
      new Error('boom on requestPermissionsAsync'),
    );

    await expect(requestReminderPermission()).resolves.toBe(false);

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('hasReminderPermission', () => {
  it('resolves false rather than rejecting when the native call rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(Notifications.getPermissionsAsync).mockRejectedValue(new Error('boom on getPermissionsAsync'));

    await expect(hasReminderPermission()).resolves.toBe(false);

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
