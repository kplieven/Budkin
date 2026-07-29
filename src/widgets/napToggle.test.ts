import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadQueue } from '@/data/queue';
import { loadTimers, saveTimers } from '@/data/timers';
import { dismissTimerNotification, postTimerNotification } from '@/notifications/postNotification';
import { toggleNapFromWidget } from '@/widgets/napToggle';
import { writeWidgetSnapshot, type WidgetSnapshot } from '@/widgets/snapshot';

// In-memory stand-in for the native AsyncStorage module (same pattern as timers.test.ts).
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

vi.mock('@/notifications/postNotification', () => ({
  postTimerNotification: vi.fn(async () => {}),
  dismissTimerNotification: vi.fn(async () => {}),
}));

const snap = (over: Partial<WidgetSnapshot> = {}): WidgetSnapshot => ({
  childName: 'Ada',
  birth: null,
  expected: false,
  lastFeedStart: null,
  nextSide: 'left',
  lastDiaper: null,
  lastDiaperSolid: false,
  sleepStart: null,
  sleepTodayMin: 0,
  feedsToday: 0,
  diapersToday: 0,
  selectedChildId: 'c1',
  canQueueNap: true,
  ...over,
});

// Capture what the toggle renders. The toggle no longer returns the snapshot — it
// invokes a render callback at the point the widget should repaint, so we record
// every rendered snapshot and read the last one.
function capture() {
  const rendered: (WidgetSnapshot | null)[] = [];
  const render = (s: WidgetSnapshot | null) => {
    rendered.push(s);
  };
  return { render, rendered, last: () => rendered[rendered.length - 1] };
}

beforeEach(() => {
  mem.store.clear();
  vi.clearAllMocks();
});

describe('toggleNapFromWidget', () => {
  it('renders null when there is no snapshot yet', async () => {
    const { render, rendered } = capture();
    await toggleNapFromWidget(1000, render);
    expect(rendered).toEqual([null]);
  });

  it('start: creates a sleep timer and sets sleepStart, queues nothing', async () => {
    await writeWidgetSnapshot(snap());
    const { render, last } = capture();
    await toggleNapFromWidget(1000, render);
    expect(last()?.sleepStart).toBe(1000);
    const timers = await loadTimers();
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({ activity: 'sleep', start: 1000, childId: 'c1' });
    expect(await loadQueue()).toHaveLength(0);
  });

  it('stop: queues the nap, clears the timer, clears sleepStart', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const { render, last } = capture();
    await toggleNapFromWidget(5000, render);
    expect(last()?.sleepStart).toBeNull();
    expect(await loadTimers()).toHaveLength(0);
    const q = await loadQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ type: 'sleep', start: 1000, end: 5000, childId: 'c1' });
  });

  it('stop: classifies the queued nap with the persisted nap window', async () => {
    // The widget task has no store, so the window has to come off disk. Naps
    // here run 10:00 to 13:00, and this sleep started at 09:00.
    mem.store.set('budkin.prefs.v1', JSON.stringify({ napWindowStartMin: 600, napWindowEndMin: 780 }));
    const start = new Date(2026, 0, 15, 9, 0, 0).getTime();
    const end = new Date(2026, 0, 15, 11, 0, 0).getTime();
    await writeWidgetSnapshot(snap({ sleepStart: start }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start, saveAs: 'sleep' }]);
    const { render } = capture();
    await toggleNapFromWidget(end, render);
    expect((await loadQueue())[0]).toMatchObject({ type: 'sleep', nap: false });
  });

  it('stop: falls back to the 07:00-19:00 default when no window is persisted', async () => {
    const start = new Date(2026, 0, 15, 9, 0, 0).getTime();
    const end = new Date(2026, 0, 15, 11, 0, 0).getTime();
    await writeWidgetSnapshot(snap({ sleepStart: start }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start, saveAs: 'sleep' }]);
    const { render } = capture();
    await toggleNapFromWidget(end, render);
    expect((await loadQueue())[0]).toMatchObject({ type: 'sleep', nap: true });
  });

  it('stop: honours a persisted midnight window boundary rather than treating 0 as unset', async () => {
    // `?? default` not `||`: startMin 0 is midnight. Naps run 00:00 to 06:00,
    // so a 02:00 sleep is a nap and the default 07:00 window would disagree.
    mem.store.set('budkin.prefs.v1', JSON.stringify({ napWindowStartMin: 0, napWindowEndMin: 360 }));
    const start = new Date(2026, 0, 15, 2, 0, 0).getTime();
    const end = new Date(2026, 0, 15, 4, 0, 0).getTime();
    await writeWidgetSnapshot(snap({ sleepStart: start }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start, saveAs: 'sleep' }]);
    const { render } = capture();
    await toggleNapFromWidget(end, render);
    expect((await loadQueue())[0]).toMatchObject({ type: 'sleep', nap: true });
  });

  it('stop in demo mode: clears the timer but queues nothing', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000, canQueueNap: false }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const { render, last } = capture();
    await toggleNapFromWidget(5000, render);
    expect(last()?.sleepStart).toBeNull();
    expect(await loadTimers()).toHaveLength(0);
    expect(await loadQueue()).toHaveLength(0);
  });

  it('start: posts a sticky notification for the new nap', async () => {
    await writeWidgetSnapshot(snap({ childName: 'Ada' }));
    const { render } = capture();
    await toggleNapFromWidget(1000, render);
    expect(postTimerNotification).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postTimerNotification).mock.calls[0][0]).toMatchObject({
      title: 'Ada · Sleep',
      data: { url: '/timers', timerId: 't1000' },
    });
  });

  it('stop: dismisses the nap notification by timer id', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const { render } = capture();
    await toggleNapFromWidget(5000, render);
    expect(dismissTimerNotification).toHaveBeenCalledWith('t1');
  });

  it('start: renders before posting the notification (tap feedback beats the native round-trip)', async () => {
    await writeWidgetSnapshot(snap());
    const order: string[] = [];
    vi.mocked(postTimerNotification).mockImplementation(async () => {
      order.push('notify');
    });
    const render = () => {
      order.push('render');
    };
    await toggleNapFromWidget(1000, render);
    expect(order).toEqual(['render', 'notify']);
    // and the state mutation is durable by the time we render
    expect(await loadTimers()).toHaveLength(1);
  });

  it('stop: renders before dismissing the notification', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const order: string[] = [];
    vi.mocked(dismissTimerNotification).mockImplementation(async () => {
      order.push('dismiss');
    });
    const render = () => {
      order.push('render');
    };
    await toggleNapFromWidget(5000, render);
    expect(order).toEqual(['render', 'dismiss']);
    // the finished nap is durably queued before we render
    expect(await loadQueue()).toHaveLength(1);
  });

  it('debounce: a second toggle within the window is ignored (no stop, no 0-min entry)', async () => {
    await writeWidgetSnapshot(snap());
    await toggleNapFromWidget(1000, () => {}); // start
    expect(await loadTimers()).toHaveLength(1);

    const { render, last } = capture();
    await toggleNapFromWidget(1200, render); // duplicate delivery 200ms later
    expect(last()?.sleepStart).toBe(1000); // still napping — the stop was swallowed
    expect(await loadTimers()).toHaveLength(1); // timer untouched
    expect(await loadQueue()).toHaveLength(0); // no phantom 0-minute nap logged
  });

  it('debounce: the swallowed tap still re-renders promptly (never feels dead)', async () => {
    await writeWidgetSnapshot(snap());
    await toggleNapFromWidget(1000, () => {}); // start
    const { render, rendered } = capture();
    await toggleNapFromWidget(1200, render); // duplicate
    expect(rendered).toHaveLength(1); // it repainted the widget
    expect(rendered[0]?.sleepStart).toBe(1000); // from the current (napping) snapshot
    expect(postTimerNotification).toHaveBeenCalledTimes(1); // only the real start posted
  });

  it('debounce: a stop is accepted once the window has passed', async () => {
    await writeWidgetSnapshot(snap());
    await toggleNapFromWidget(1000, () => {}); // start
    const { render, last } = capture();
    await toggleNapFromWidget(1000 + 1500, render); // exactly at the window edge
    expect(last()?.sleepStart).toBeNull();
    expect(await loadTimers()).toHaveLength(0);
    expect(await loadQueue()).toHaveLength(1); // the real nap is still logged
  });
});
