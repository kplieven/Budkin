import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

// Explicit platform path: Metro picks the `.android.ts` suffix on device, but the
// node test environment never would.
import {
  BACKGROUND_SYNC_TASK,
  initBackgroundSync,
  runBackgroundSync,
} from '@/notifications/backgroundSync.android';
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

/** Captured at IMPORT time, before any `clearAllMocks` can wipe the record and before
 *  any test calls `initBackgroundSync`. `defineTask` must run as a module side effect:
 *  after a cold start the headless JS context loads this module and WorkManager needs
 *  the task already defined, so deferring it into `initBackgroundSync` makes the whole
 *  feature silently never run. */
const defineTaskCallsAtImport = vi.mocked(TaskManager.defineTask).mock.calls.slice();

const NOW = new Date(2026, 7, 26, 14, 0).getTime();
const MIN = 60_000;

/** The live store snapshot the worker reads. Mutable, because the worker re-reads
 *  `getState()` after the awaited refresh to learn whether it succeeded. */
let storeState: { hydrating: boolean; offline: boolean; hydrate: typeof hydrate; refresh: typeof refresh };

/** The default world: server-connected, permitted, one pump reminder due soon.
 *  Resets the two store fns explicitly: `clearAllMocks` clears call records but
 *  leaves queued `*Once` implementations, which would otherwise leak between tests. */
function arrange(
  over: { hydrating?: boolean; offline?: boolean; pendingIds?: string[]; lastSyncAt?: number | null } = {},
) {
  hydrate.mockReset();
  hydrate.mockResolvedValue(undefined);
  refresh.mockReset();
  // The real `refresh()` never throws: it records failure by setting `offline`, and
  // clears it on the success path via `applyServerLoad({ offline: false })`.
  refresh.mockImplementation(async () => {
    storeState.offline = false;
  });
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
  storeState = {
    hydrating: over.hydrating ?? false,
    offline: over.offline ?? false,
    hydrate,
    refresh,
  };
  vi.mocked(useAppStore.getState).mockImplementation(() => storeState as never);
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

  // The worker must take the PULL half of refresh() and never the PUSH half. This
  // context is torn down the moment the task promise resolves, and `flushQueue` drops an
  // entry from the durable queue only AFTER the server accepts it — a teardown between
  // those two steps re-pushes the entry next wake and duplicates it on the user's server.
  it('refreshes WITHOUT pushing, so a torn-down context cannot duplicate a queued entry', async () => {
    arrange();
    await runBackgroundSync(NOW);
    expect(refresh).toHaveBeenCalledWith({ push: false });
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
    // The REAL failure mode: `refresh()` swallows the error and sets `offline: true`
    // rather than rejecting, so a try/catch around it would never fire and the stamp
    // would always happen — leaving an unreachable server to sit out the whole 4h floor.
    arrange();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    refresh.mockImplementation(async () => {
      storeState.offline = true;
    });

    await runBackgroundSync(NOW);

    expect(reconcileAndWait).toHaveBeenCalled();
    expect(saveLastBackgroundSyncAt).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stamps when a refresh CLEARS an offline flag it inherited', async () => {
    // `offline` can already be true when the worker wakes. The flag is only a
    // success signal because a successful refresh clears it, so read it after.
    arrange({ offline: true });
    await runBackgroundSync(NOW);
    expect(saveLastBackgroundSyncAt).toHaveBeenCalledWith(NOW);
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

// Every value here is load-bearing and silently fatal if wrong: a changed task id or a
// deferred `defineTask` makes WorkManager wake a task nobody defined, and an interval
// below WorkManager's floor is rejected outright. None of it shows up in a behaviour
// test of `runBackgroundSync`, so it is pinned literally.
describe('registration contract', () => {
  it('uses the exact task identifier WorkManager was registered with', () => {
    expect(BACKGROUND_SYNC_TASK).toBe('budkin-background-reminder-sync');
  });

  it('defines the task at module import, not inside initBackgroundSync', () => {
    expect(defineTaskCallsAtImport).toHaveLength(1);
    expect(defineTaskCallsAtImport[0][0]).toBe('budkin-background-reminder-sync');
  });

  it('registers with a 15-minute minimum interval', async () => {
    await initBackgroundSync();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith('budkin-background-reminder-sync', {
      minimumInterval: 15,
    });
  });

  it('swallows a registerTaskAsync failure rather than crashing startup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(BackgroundTask.registerTaskAsync).mockRejectedValueOnce(new Error('nope'));
    await expect(initBackgroundSync()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  describe('the registered callback', () => {
    /** Invoked through a helper rather than destructured at collection time: if
     *  `defineTask` were moved out of module scope these would fail as a plain
     *  assertion instead of taking the whole file down with a collection error. */
    function task(): Promise<unknown> {
      const call = defineTaskCallsAtImport[0];
      if (!call) throw new Error('defineTask was not called at module import');
      return (call[1] as () => Promise<unknown>)();
    }

    it('reports Success on the happy path', async () => {
      arrange({ pendingIds: [] });
      await expect(task()).resolves.toBe(BackgroundTask.BackgroundTaskResult.Success);
    });

    it('reports Success — never Failed — even when the body throws', async () => {
      // `Failed` earns WorkManager backoff we do not want, and there is nothing to
      // retry that the next wake will not cover.
      arrange();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(hasReminderPermission).mockRejectedValueOnce(new Error('native boom'));

      await expect(task()).resolves.toBe(BackgroundTask.BackgroundTaskResult.Success);

      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
