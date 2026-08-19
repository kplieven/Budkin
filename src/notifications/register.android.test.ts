/** The notification tap funnel. WHICH child a tap selects is tested against
 *  `@/lib/deepLink`; what is tested here is the wiring, and specifically the
 *  cold-start deferral onto the store's hydration lifecycle. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Notifications from 'expo-notifications';
import type { Child } from '@/types/models';

// In-memory AsyncStorage so the store's data modules load under node.
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      mem.store.delete(k);
    }),
    getAllKeys: vi.fn(async () => [...mem.store.keys()]),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, mem.store.get(k) ?? null] as const)),
    multiSet: vi.fn(async (pairs: [string, string][]) => {
      for (const [k, v] of pairs) mem.store.set(k, v);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) mem.store.delete(k);
    }),
  },
}));

vi.mock('@/data/secureKv', () => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => {}),
  kvRemove: vi.fn(async () => {}),
}));

vi.mock('@/lib/photoFile', () => ({
  reopenPhotoFile: vi.fn(() => undefined),
  discardPhotoFile: vi.fn(async () => {}),
  sweepPhotoFiles: vi.fn(async () => {}),
}));

// `getLastNotificationResponseAsync` answers null so the cold-start branch adds
// nothing to the warm listener under test.
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(async () => {}),
  addNotificationResponseReceivedListener: vi.fn(),
  getLastNotificationResponseAsync: vi.fn(async () => null),
  AndroidImportance: { LOW: 2, DEFAULT: 3 },
}));

vi.mock('expo-router', () => ({ router: { navigate: vi.fn() } }));

const child = (over: Partial<Child> = {}): Child => ({
  id: 'c1',
  first: 'Rowan',
  last: '',
  birth: new Date(2026, 1, 1).getTime(),
  color: '#208AEF',
  ...over,
});

const roster = [child(), child({ id: 'c2', first: 'Wren' })];

/**
 * A fresh store and a fresh registration of the module under test, imported by
 * its explicit `.android` path (Metro picks that suffix on device, node never
 * would). The mock factories above are shared across every setup() call: vitest
 * does not re-evaluate them per `vi.resetModules()`, so the listener is read off
 * the LAST registration and `router.navigate` is reset here.
 */
async function setup(state: { hydrating: boolean; children: Child[]; selectedChildId: string }) {
  vi.resetModules();
  const notifications = await import('expo-notifications');
  const { router } = await import('expo-router');
  const { useAppStore } = await import('@/store/useAppStore');
  useAppStore.setState(state);
  vi.mocked(router.navigate).mockReset();
  await import('@/notifications/register.android');

  const calls = vi.mocked(notifications.addNotificationResponseReceivedListener).mock.calls;
  const listener = calls.at(-1)![0];
  const tap = (url: string) =>
    listener({ notification: { request: { content: { data: { url } } } } } as unknown as Notifications.NotificationResponse);
  return { useAppStore, router, tap };
}

beforeEach(() => {
  mem.store.clear();
});

describe('notification tap funnel', () => {
  it('selects the named child before it navigates', async () => {
    const { useAppStore, router, tap } = await setup({ hydrating: false, children: roster, selectedChildId: 'c1' });
    // Read at the moment of the navigate: the tab must not flash the previous.
    let selectedWhenNavigated: string | undefined;
    vi.mocked(router.navigate).mockImplementation(() => {
      selectedWhenNavigated = useAppStore.getState().selectedChildId;
    });

    tap('/timers?child=c2');

    expect(selectedWhenNavigated).toBe('c2');
    expect(router.navigate).toHaveBeenCalledWith('/timers?child=c2');
  });

  it('leaves a write-adjacent tap to its own route, and still navigates', async () => {
    const { useAppStore, router, tap } = await setup({ hydrating: false, children: roster, selectedChildId: 'c1' });

    tap('/log/feeding?child=c2');

    expect(useAppStore.getState().selectedChildId).toBe('c1');
    expect(router.navigate).toHaveBeenCalledWith('/log/feeding?child=c2');
  });

  it('defers a cold-start tap until hydration, then selects exactly once', async () => {
    // A tap that launched the app arrives while `hydrate` is still reading
    // AsyncStorage, so the roster is empty and hydration would overwrite it.
    const { useAppStore, router, tap } = await setup({ hydrating: true, children: [], selectedChildId: 'c1' });

    tap('/timers?child=c2');

    expect(useAppStore.getState().selectedChildId).toBe('c1');
    // Navigation is NOT deferred with it: the deferred selection lands on the
    // tab the url already opened.
    expect(router.navigate).toHaveBeenCalledWith('/timers?child=c2');

    useAppStore.setState({ hydrating: false, children: roster });
    expect(useAppStore.getState().selectedChildId).toBe('c2');

    // Exactly once: a subscription that survived would re-apply on any later
    // store write and drag the parent back to the notification's child. The
    // unsubscribe runs BEFORE applying, since applying calls `selectChild`.
    useAppStore.getState().selectChild('c1');
    useAppStore.setState({ children: [...roster] });
    expect(useAppStore.getState().selectedChildId).toBe('c1');
  });

  it('ignores a cold-start tap whose child is gone by the time hydration lands', async () => {
    const { useAppStore, tap } = await setup({ hydrating: true, children: [], selectedChildId: 'c1' });

    tap('/history?child=deleted');
    useAppStore.setState({ hydrating: false, children: roster });

    expect(useAppStore.getState().selectedChildId).toBe('c1');
  });
});
