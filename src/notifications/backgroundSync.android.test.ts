import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as Notifications from 'expo-notifications';

// Explicit platform path: Metro picks the `.android.ts` suffix on device, but the
// node test environment never would.
import { runBackgroundSync } from '@/notifications/backgroundSync.android';
import { loadLastBackgroundSyncAt, saveLastBackgroundSyncAt } from '@/data/backgroundSyncState';
import { loadConnection } from '@/data/storage';
import { hasReminderPermission } from '@/notifications/permission';
import { reconcileAndWait } from '@/notifications/scheduleSync';
import { useAppStore } from '@/store/useAppStore';

vi.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: vi.fn(),
}));

vi.mock('expo-task-manager', () => ({ defineTask: vi.fn() }));

vi.mock('expo-background-task', () => ({
  registerTaskAsync: vi.fn(async () => {}),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));

vi.mock('@/data/backgroundSyncState', () => ({
  loadLastBackgroundSyncAt: vi.fn(),
  saveLastBackgroundSyncAt: vi.fn(async () => {}),
}));

vi.mock('@/data/storage', () => ({ loadConnection: vi.fn() }));

vi.mock('@/notifications/permission', () => ({
  hasReminderPermission: vi.fn(),
  requestReminderPermission: vi.fn(),
}));

vi.mock('@/notifications/scheduleSync', () => ({
  reconcileAndWait: vi.fn(async () => {}),
  reconcileNow: vi.fn(),
  initScheduledReminderSync: vi.fn(),
}));

const hydrate = vi.fn(async () => {});
const refresh = vi.fn(async () => {});
vi.mock('@/store/useAppStore', () => ({
  useAppStore: { getState: vi.fn() },
}));

const NOW = new Date(2026, 7, 26, 14, 0).getTime();
const MIN = 60_000;

/** The default world: server-connected, permitted, one pump reminder due soon.
 *  Resets the two store fns explicitly: `clearAllMocks` clears call records but
 *  leaves queued `*Once` implementations, which would otherwise leak between tests. */
function arrange(over: { hydrating?: boolean; pendingIds?: string[]; lastSyncAt?: number | null } = {}) {
  hydrate.mockReset();
  hydrate.mockResolvedValue(undefined);
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
  vi.mocked(hasReminderPermission).mockResolvedValue(true);
  vi.mocked(loadConnection).mockResolvedValue({
    mode: 'server',
    serverUrl: 'https://example.test',
    token: 't',
  } as never);
  const ids = over.pendingIds ?? [`budkin:pump:global:${NOW + 5 * MIN}`];
  vi.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue(
    ids.map((identifier) => ({ identifier })) as never,
  );
  vi.mocked(loadLastBackgroundSyncAt).mockResolvedValue(
    over.lastSyncAt === undefined ? NOW - 60 * MIN : over.lastSyncAt,
  );
  vi.mocked(useAppStore.getState).mockReturnValue({
    hydrating: over.hydrating ?? false,
    hydrate,
    refresh,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runBackgroundSync', () => {
  it('spends no network when the gate is closed', async () => {
    arrange({ pendingIds: [`budkin:pump:global:${NOW + 300 * MIN}`] });
    await runBackgroundSync(NOW);
    expect(refresh).not.toHaveBeenCalled();
    expect(reconcileAndWait).not.toHaveBeenCalled();
    expect(saveLastBackgroundSyncAt).not.toHaveBeenCalled();
  });

  it('does not hydrate a warm context', async () => {
    arrange({ hydrating: false });
    await runBackgroundSync(NOW);
    expect(hydrate).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('hydrates a cold context before refreshing', async () => {
    arrange({ hydrating: true });
    const order: string[] = [];
    hydrate.mockImplementationOnce(async () => void order.push('hydrate'));
    refresh.mockImplementationOnce(async () => void order.push('refresh'));
    vi.mocked(reconcileAndWait).mockImplementationOnce(async () => void order.push('reconcile'));
    vi.mocked(saveLastBackgroundSyncAt).mockImplementationOnce(async () => void order.push('stamp'));

    await runBackgroundSync(NOW);

    expect(order).toEqual(['hydrate', 'refresh', 'reconcile', 'stamp']);
  });

  it('reads the connection from secure storage, never from the store', async () => {
    // Regression guard: in a cold context `getState().connection` is null, so a
    // store-based check would gate out the exact case this task exists for.
    arrange({ hydrating: true });
    await runBackgroundSync(NOW);
    expect(loadConnection).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('stays closed in local mode', async () => {
    arrange();
    vi.mocked(loadConnection).mockResolvedValue({ mode: 'local' } as never);
    await runBackgroundSync(NOW);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stays closed with no stored connection', async () => {
    arrange();
    vi.mocked(loadConnection).mockResolvedValue(null);
    await runBackgroundSync(NOW);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('still reconciles but does NOT stamp when refresh fails', async () => {
    arrange();
    refresh.mockRejectedValueOnce(new Error('offline'));
    await runBackgroundSync(NOW);
    expect(reconcileAndWait).toHaveBeenCalled();
    expect(saveLastBackgroundSyncAt).not.toHaveBeenCalled();
  });

  it('stamps the sync time on the happy path', async () => {
    arrange();
    await runBackgroundSync(NOW);
    expect(saveLastBackgroundSyncAt).toHaveBeenCalledWith(NOW);
  });

  it('opens on the idle floor with nothing pending', async () => {
    arrange({ pendingIds: [], lastSyncAt: NOW - 5 * 3_600_000 });
    await runBackgroundSync(NOW);
    expect(refresh).toHaveBeenCalled();
  });
});
