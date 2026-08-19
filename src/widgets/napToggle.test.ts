import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadQueue } from '@/data/queue';
import { loadTimers, saveTimers } from '@/data/timers';
import { dismissTimerNotification, postTimerNotification } from '@/notifications/postNotification';
import type { Entry } from '@/types/models';
import { toggleNapFromWidget } from '@/widgets/napToggle';
import { writeWidgetSnapshot, type WidgetSnapshot } from '@/widgets/snapshot';
import { widgetToday } from '@/widgets/today';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();

// In-memory stand-in for the native AsyncStorage module.
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
  entries: [],
  rhythmOriginHour: 12,
  selectedChildId: 'c1',
  canQueueNap: true,
  ...over,
});

// The toggle invokes a render callback at the point the widget should repaint
// rather than returning a snapshot, so record every render and read the last.
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
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const { render, last } = capture();
    await toggleNapFromWidget(5000, render);
    expect(last()?.sleepStart).toBeNull();
    expect(await loadTimers()).toHaveLength(0);
    const q = await loadQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ type: 'sleep', start: 1000, end: 5000, childId: 'c1' });
  });

  it('stop: classifies the queued nap with the persisted nap window', async () => {
    // The widget task has no store, so the nap window has to come off disk.
    mem.store.set('budkin.prefs.v1', JSON.stringify({ napWindowStartMin: 600, napWindowEndMin: 780 }));
    const start = new Date(2026, 0, 15, 9, 0, 0).getTime();
    const end = new Date(2026, 0, 15, 11, 0, 0).getTime();
    await writeWidgetSnapshot(snap({ sleepStart: start }));
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start, saveAs: 'sleep' }]);
    const { render } = capture();
    await toggleNapFromWidget(end, render);
    expect((await loadQueue())[0]).toMatchObject({ type: 'sleep', nap: false });
  });

  it('stop: falls back to the 07:00-19:00 default when no window is persisted', async () => {
    const start = new Date(2026, 0, 15, 9, 0, 0).getTime();
    const end = new Date(2026, 0, 15, 11, 0, 0).getTime();
    await writeWidgetSnapshot(snap({ sleepStart: start }));
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start, saveAs: 'sleep' }]);
    const { render } = capture();
    await toggleNapFromWidget(end, render);
    expect((await loadQueue())[0]).toMatchObject({ type: 'sleep', nap: true });
  });

  it('stop: honours a persisted midnight window boundary rather than treating 0 as unset', async () => {
    // `?? default` not `||`: startMin 0 is midnight, and the default 07:00
    // window would disagree about this 02:00 sleep.
    mem.store.set('budkin.prefs.v1', JSON.stringify({ napWindowStartMin: 0, napWindowEndMin: 360 }));
    const start = new Date(2026, 0, 15, 2, 0, 0).getTime();
    const end = new Date(2026, 0, 15, 4, 0, 0).getTime();
    await writeWidgetSnapshot(snap({ sleepStart: start }));
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start, saveAs: 'sleep' }]);
    const { render } = capture();
    await toggleNapFromWidget(end, render);
    expect((await loadQueue())[0]).toMatchObject({ type: 'sleep', nap: true });
  });

  it('stop in demo mode: clears the timer but queues nothing', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000, canQueueNap: false }));
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
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
      // Named from the timer's own child, so a tap lands on whoever the widget
      // started the nap for even if the app is sitting on a sibling.
      data: { url: '/timers?child=c1', timerId: 't1000' },
    });
  });

  it('stop: dismisses the nap notification by timer id', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
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
    expect(await loadTimers()).toHaveLength(1); // durable by the time we render
  });

  it('stop: renders before dismissing the notification', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const order: string[] = [];
    vi.mocked(dismissTimerNotification).mockImplementation(async () => {
      order.push('dismiss');
    });
    const render = () => {
      order.push('render');
    };
    await toggleNapFromWidget(5000, render);
    expect(order).toEqual(['render', 'dismiss']);
    expect(await loadQueue()).toHaveLength(1); // durably queued before we render
  });

  it('debounce: a second toggle within the window is ignored (no stop, no 0-min entry)', async () => {
    await writeWidgetSnapshot(snap());
    await toggleNapFromWidget(1000, () => {}); // start
    expect(await loadTimers()).toHaveLength(1);

    const { render, last } = capture();
    await toggleNapFromWidget(1200, render); // duplicate delivery 200ms later
    expect(last()?.sleepStart).toBe(1000); // still napping, the stop was swallowed
    expect(await loadTimers()).toHaveLength(1);
    expect(await loadQueue()).toHaveLength(0); // no phantom 0-minute nap logged
  });

  it('debounce: the swallowed tap still re-renders promptly (never feels dead)', async () => {
    await writeWidgetSnapshot(snap());
    await toggleNapFromWidget(1000, () => {}); // start
    const { render, rendered } = capture();
    await toggleNapFromWidget(1200, render); // duplicate
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.sleepStart).toBe(1000); // from the current (napping) snapshot
    expect(postTimerNotification).toHaveBeenCalledTimes(1); // only the real start posted
  });

  it('stop: appends the finished nap to the snapshot records, so the total stays right', async () => {
    // The sleep total is derived from these records at render time, so carrying
    // them forward unchanged would drop the nap out of the figure until the app ran.
    const start = at(2026, 6, 5, 13);
    const end = at(2026, 6, 5, 14);
    await writeWidgetSnapshot(snap({ sleepStart: start }));
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start, saveAs: 'sleep' }]);
    const { render, last } = capture();
    await toggleNapFromWidget(end, render);
    const next = last() as WidgetSnapshot;
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({ type: 'sleep', start, end, childId: 'c1' });
    // still 1h of sleep in the window, now as a logged record instead of a timer
    expect(widgetToday(next, end).sleepMin).toBe(60);
  });

  it('stop: keeps the existing records and re-prunes them to the lookback', async () => {
    const start = at(2026, 6, 5, 13);
    const end = at(2026, 6, 5, 14);
    const keep: Entry = { id: 'd1', childId: 'c1', type: 'diaper', time: at(2026, 6, 5, 12, 30), wet: true, solid: false, color: null, tags: [] };
    const stale: Entry = { id: 'd0', childId: 'c1', type: 'diaper', time: at(2026, 6, 2, 12), wet: true, solid: false, color: null, tags: [] };
    await writeWidgetSnapshot(snap({ sleepStart: start, entries: [stale, keep] }));
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'sleep', name: 'Sleep', start, saveAs: 'sleep' }]);
    const { render, last } = capture();
    await toggleNapFromWidget(end, render);
    const next = last() as WidgetSnapshot;
    expect(next.entries.map((e) => e.id)).toEqual(['d1', `e${end}`]);
  });

  it('stop: finds the timer by saveAs, so a quick timer repointed to sleep stops instead of starting a second one', async () => {
    // `buildWidgetSnapshot` shows this timer as the running nap (same rule), so an
    // activity-keyed lookup here would leave the widget saying "napping" while this
    // tap started a SECOND timer.
    await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
    await saveTimers([{ id: 't1', childId: 'c1', activity: 'feeding', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const { render, last } = capture();
    await toggleNapFromWidget(5000, render);
    expect(last()?.sleepStart).toBeNull();
    expect(await loadTimers()).toHaveLength(0);
    expect(await loadQueue()).toHaveLength(1);
  });

  it("does not stop a sibling's nap; it starts one for the selected child", async () => {
    // Accepted consequence of scoping: a widget shows ONE child, and filing a
    // stopped nap against whoever is selected is exactly the misattribution the
    // scoping removes. A sibling's timer stays stoppable on the Timers tab.
    await writeWidgetSnapshot(snap({ selectedChildId: 'c1' }));
    await saveTimers([{ id: 't1', childId: 'c2', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const { render, last } = capture();
    await toggleNapFromWidget(5000, render);
    expect(last()?.sleepStart).toBe(5000);
    const timers = await loadTimers();
    expect(timers).toHaveLength(2);
    expect(timers[0]).toMatchObject({ id: 't1', childId: 'c2' }); // untouched
    expect(timers[1]).toMatchObject({ childId: 'c1', start: 5000 });
    expect(await loadQueue()).toHaveLength(0); // nothing filed against the wrong child
  });

  it('does not stop a legacy ownerless timer; migrating those is the store\'s job', async () => {
    // `hydrate` stamps an owner onto timers persisted before stamping existed, and
    // this task runs with no store, so a leftover ownerless timer is invisible here
    // until the app next opens. Filing it against whoever the widget shows is a
    // guess, so refusing is the point.
    await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const { render } = capture();
    await toggleNapFromWidget(5000, render);
    const timers = await loadTimers();
    expect(timers).toHaveLength(2);
    expect(timers[0]).toMatchObject({ id: 't1', start: 1000 }); // untouched, not stopped
    expect(timers[0]).not.toHaveProperty('childId'); // and not stamped out here either
    expect(timers[1]).toMatchObject({ childId: 'c1', start: 5000 });
    expect(await loadQueue()).toHaveLength(0);
  });

  it('with no child selected: does nothing, and never accumulates phantom timers', async () => {
    // A fresh install writes a baseline snapshot with an empty selectedChildId
    // before onboarding. The scoped lookup can never match a timer stamped with an
    // empty id, so without the guard each tap would start another timer and leave
    // the widget stuck showing a nap that can never be stopped.
    await writeWidgetSnapshot(snap({ selectedChildId: '' }));
    const { render, last } = capture();
    await toggleNapFromWidget(100000, render);
    await toggleNapFromWidget(200000, render); // well past the debounce window
    await toggleNapFromWidget(300000, render);
    expect(await loadTimers()).toHaveLength(0);
    expect(last()?.sleepStart).toBeNull(); // never claims to be napping
    expect(postTimerNotification).not.toHaveBeenCalled();
    expect(await loadQueue()).toHaveLength(0);
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
