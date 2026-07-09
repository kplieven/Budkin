import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory AsyncStorage so the store's data modules (timers/queue/servers) load
// under the node test environment.
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

// `@/data/secureKv` pulls in expo-secure-store (a native module, transitively
// react-native) via both `@/data/storage` and `@/data/servers`; stub it so the
// store module can be imported under node.
vi.mock('@/data/secureKv', () => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => {}),
  kvRemove: vi.fn(async () => {}),
}));

vi.mock('@/widgets/pushWidgetUpdate', () => ({ pushWidgetUpdate: vi.fn(async () => {}) }));

// Keep the real snapshot builder but spy on it, and stub the AsyncStorage write.
vi.mock('@/widgets/snapshot', async (importActual) => {
  const actual = await importActual<typeof import('@/widgets/snapshot')>();
  return {
    ...actual,
    buildWidgetSnapshot: vi.fn(actual.buildWidgetSnapshot),
    writeWidgetSnapshot: vi.fn(async () => {}),
  };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

// Fresh store + sync module per test (the sync module carries `started`/`lastKey`
// singleton state, so it must be reset between scenarios).
async function setup() {
  vi.resetModules();
  const { buildWidgetSnapshot } = await import('@/widgets/snapshot');
  const { pushWidgetUpdate } = await import('@/widgets/pushWidgetUpdate');
  const { useAppStore } = await import('@/store/useAppStore');
  const { initWidgetSync } = await import('@/widgets/sync');
  initWidgetSync();
  await flush(); // let the initial baseline snapshot settle
  return { build: vi.mocked(buildWidgetSnapshot), push: vi.mocked(pushWidgetUpdate), useAppStore };
}

beforeEach(() => {
  mem.store.clear();
});

describe('initWidgetSync gating', () => {
  it('does no snapshot rebuild or widget push on a bare tick', async () => {
    const { build, push, useAppStore } = await setup();
    const builds = build.mock.calls.length;
    const pushes = push.mock.calls.length;

    useAppStore.setState({ now: useAppStore.getState().now + 1000 });
    await flush();

    expect(build.mock.calls.length).toBe(builds);
    expect(push.mock.calls.length).toBe(pushes);
  });

  it('rebuilds and pushes when timer data changes', async () => {
    const { build, push, useAppStore } = await setup();
    const builds = build.mock.calls.length;
    const pushes = push.mock.calls.length;

    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }],
    });
    await flush();

    expect(build.mock.calls.length).toBe(builds + 1);
    expect(push.mock.calls.length).toBe(pushes + 1);
  });
});
