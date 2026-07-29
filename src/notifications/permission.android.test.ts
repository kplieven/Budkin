import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as Notifications from 'expo-notifications';

// Imported by its explicit platform path: `.android.ts` files are normally
// selected by Metro's platform resolution and never load under the node test
// environment through the platform-agnostic specifier.
import { hasReminderPermission, requestReminderPermission } from '@/notifications/permission.android';

// The module's only native surface. Every export it calls is mocked so the
// real .android.ts module can be imported directly under node.
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

  // Regression test for the finding: a native-module failure here used to
  // reject, which meant saveChild and finish() never ran in setup/baby.tsx's
  // onAddExpected, and setSaving(false) is called nowhere in that file. The
  // user was left on a dead form with the baby never saved.
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
