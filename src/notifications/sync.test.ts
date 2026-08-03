import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  },
}));

// `@/data/secureKv` pulls in expo-secure-store (native, transitively
// react-native) via storage/servers; stub it so the store module imports under node.
vi.mock('@/data/secureKv', () => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => {}),
  kvRemove: vi.fn(async () => {}),
}));

// `@/lib/photoFile` pulls in expo-file-system and react-native's Platform,
// both native; stub it so the store module (saveChild's deferred-photo path)
// imports under node.
vi.mock('@/lib/photoFile', () => ({
  reopenPhotoFile: vi.fn(() => undefined),
  discardPhotoFile: vi.fn(async () => {}),
  sweepPhotoFiles: vi.fn(async () => {}),
}));

vi.mock('@/notifications/postNotification', () => ({
  postTimerNotification: vi.fn(async () => {}),
  dismissTimerNotification: vi.fn(async () => {}),
}));

// Keep the real reconcile logic but spy on the desired-set builder.
vi.mock('@/notifications/content', async (importActual) => {
  const actual = await importActual<typeof import('@/notifications/content')>();
  return {
    ...actual,
    desiredTimerNotifications: vi.fn(actual.desiredTimerNotifications),
  };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  vi.resetModules();
  const { desiredTimerNotifications } = await import('@/notifications/content');
  const { postTimerNotification } = await import('@/notifications/postNotification');
  const { useAppStore } = await import('@/store/useAppStore');
  const { initTimerNotificationSync } = await import('@/notifications/sync');
  initTimerNotificationSync();
  await flush();
  return {
    desired: vi.mocked(desiredTimerNotifications),
    post: vi.mocked(postTimerNotification),
    useAppStore,
  };
}

beforeEach(() => {
  mem.store.clear();
});

describe('initTimerNotificationSync gating', () => {
  it('does no notification rebuild on a bare tick', async () => {
    const { desired, post, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    const posts = post.mock.calls.length;

    useAppStore.setState({ now: useAppStore.getState().now + 1000 });
    await flush();

    expect(desired.mock.calls.length).toBe(builds);
    expect(post.mock.calls.length).toBe(posts);
  });

  it('rebuilds and posts when timer data changes', async () => {
    const { desired, post, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    const posts = post.mock.calls.length;

    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }],
    });
    await flush();

    expect(desired.mock.calls.length).toBe(builds + 1);
    expect(post.mock.calls.length).toBe(posts + 1);
  });

  it('reposts nothing when the selected child changes', async () => {
    const { post, useAppStore } = await setup();
    useAppStore.setState({
      children: [
        { id: 'c1', first: 'Ellie', last: '', birth: 0, color: '#208AEF' },
        { id: 'c2', first: 'Wren', last: '', birth: 0, color: '#EF6D3A' },
      ],
      selectedChildId: 'c1',
      timers: [{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }],
    });
    await flush();
    const posts = post.mock.calls.length;

    useAppStore.setState({ selectedChildId: 'c2' });
    await flush();

    expect(post.mock.calls.length).toBe(posts);
  });
});
