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

vi.mock('@/notifications/applySchedule', () => ({
  applyScheduled: vi.fn(async () => {}),
}));

// Keep the real reconcile logic but spy on the desired-set builder.
vi.mock('@/notifications/scheduled', async (importActual) => {
  const actual = await importActual<typeof import('@/notifications/scheduled')>();
  return {
    ...actual,
    desiredScheduled: vi.fn(actual.desiredScheduled),
  };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  vi.resetModules();
  const { desiredScheduled } = await import('@/notifications/scheduled');
  const { applyScheduled } = await import('@/notifications/applySchedule');
  const { useAppStore } = await import('@/store/useAppStore');
  const { initScheduledReminderSync } = await import('@/notifications/scheduleSync');
  initScheduledReminderSync();
  await flush();
  return {
    desired: vi.mocked(desiredScheduled),
    apply: vi.mocked(applyScheduled),
    useAppStore,
  };
}

beforeEach(() => {
  mem.store.clear();
});

describe('initScheduledReminderSync gating', () => {
  it('does no rebuild on a bare tick', async () => {
    const { desired, apply, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    const applies = apply.mock.calls.length;

    useAppStore.setState({ now: useAppStore.getState().now + 1000 });
    await flush();

    expect(desired.mock.calls.length).toBe(builds);
    expect(apply.mock.calls.length).toBe(applies);
  });

  it('rebuilds when a gated slice changes (children)', async () => {
    const { desired, apply, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    const applies = apply.mock.calls.length;

    useAppStore.setState({
      children: [{ id: 'c1', first: 'Test', last: 'Kid', birth: Date.now(), color: '#fff' }],
    });
    await flush();

    expect(desired.mock.calls.length).toBe(builds + 1);
    expect(apply.mock.calls.length).toBe(applies + 1);
  });
});

describe('toInput lastPumpAt derivation', () => {
  it('yields null when there are no pumping entries', async () => {
    const { desired } = await setup();

    expect(desired.mock.calls[0][0].lastPumpAt).toBeNull();
  });

  it('prefers end over start for a single pumping entry', async () => {
    const { desired, useAppStore } = await setup();

    useAppStore.setState({
      entries: [
        { id: 'p1', type: 'pumping', childId: 'c1', tags: [], start: 1000, end: 2000, amount: null },
      ],
    });
    await flush();

    const last = desired.mock.calls.at(-1)?.[0];
    expect(last?.lastPumpAt).toBe(2000);
  });

  it('derives lastPumpAt from the most recent pumping entry, ignoring non-pumping entries', async () => {
    const { desired, useAppStore } = await setup();

    useAppStore.setState({
      entries: [
        { id: 'p1', type: 'pumping', childId: 'c1', tags: [], start: 1000, end: 3000, amount: null },
        // No end yet (still running): falls back to start, which here is the most recent.
        { id: 'p2', type: 'pumping', childId: 'c1', tags: [], start: 10000, end: null, amount: null },
        // A far-future feeding entry must NOT be picked up as a pump.
        {
          id: 'f1',
          type: 'feeding',
          childId: 'c1',
          tags: [],
          start: 999999999,
          end: 999999999,
          feedType: 'breast',
          method: 'left',
          amount: null,
        },
      ],
    });
    await flush();

    const last = desired.mock.calls.at(-1)?.[0];
    expect(last?.lastPumpAt).toBe(10000);
  });
});
