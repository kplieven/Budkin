import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '@/store/useAppStore';
import { teEnd, teStart } from '@/store/selectors';
import { ApiError } from '@/api/client';
import { loadConnection } from '@/data/storage';
import { loadFromServer } from '@/data/repository';
import { saveTimers } from '@/data/timers';
import type { Entry, Timer } from '@/types/models';

// Shared mock state (hoisted so the vi.mock factories can close over it).
const h = vi.hoisted(() => ({
  q: [] as unknown[],
  timers: [] as unknown[],
  servers: [] as unknown[],
  pushed: [] as unknown[],
  updated: [] as unknown[],
  deleted: [] as unknown[],
  measPushed: [] as unknown[],
  measUpdated: [] as unknown[],
  measDeleted: [] as unknown[],
  pushFails: false,
}));

vi.mock('@/data/storage', () => ({
  saveConnection: vi.fn(async () => {}),
  loadConnection: vi.fn(async () => null),
  clearConnection: vi.fn(async () => {}),
}));

vi.mock('@/data/servers', () => ({
  loadServers: vi.fn(async () => h.servers),
  persistServers: vi.fn(async (list: unknown[]) => {
    h.servers = list;
  }),
  // simple URL-equality stand-ins (the store tests use identical URLs)
  upsertServer: (list: any[], server: any) => {
    const rest = list.filter((s) => s.serverUrl !== server.serverUrl);
    return [server, ...rest].slice(0, 6);
  },
  removeServer: (list: any[], url: string) => list.filter((s) => s.serverUrl !== url),
}));

vi.mock('@/data/queue', () => ({
  loadQueue: vi.fn(async () => h.q),
  saveQueue: vi.fn(async (x: unknown[]) => {
    h.q = x;
  }),
  enqueueEntry: vi.fn(async (e: unknown) => {
    h.q = [...h.q, e];
    return h.q;
  }),
  clearQueue: vi.fn(async () => {
    h.q = [];
  }),
}));

vi.mock('@/data/timers', () => ({
  loadTimers: vi.fn(async () => h.timers),
  saveTimers: vi.fn(async (t: unknown[]) => {
    h.timers = t;
  }),
  clearTimers: vi.fn(async () => {
    h.timers = [];
  }),
}));

vi.mock('@/data/repository', () => ({
  loadFromServer: vi.fn(async () => ({
    children: [],
    entries: [],
    timers: [],
    selectedChildId: '',
    lastFeed: { feedType: 'breast', method: 'left' },
    measurements: [],
  })),
  pushEntryToServer: vi.fn(async (_conn: unknown, e: unknown) => {
    if (h.pushFails) throw new Error('net');
    h.pushed.push(e);
    return 999;
  }),
  updateEntryOnServer: vi.fn(async (_c: unknown, e: unknown) => {
    h.updated.push(e);
  }),
  deleteEntryFromServer: vi.fn(async (_c: unknown, type: unknown, id: unknown) => {
    h.deleted.push({ type, id });
  }),
  pushMeasurementToServer: vi.fn(async (_c: unknown, m: unknown) => {
    h.measPushed.push(m);
    return 888;
  }),
  updateMeasurementOnServer: vi.fn(async (_c: unknown, m: unknown) => {
    h.measUpdated.push(m);
  }),
  deleteMeasurementFromServer: vi.fn(async (_c: unknown, kind: unknown, id: unknown) => {
    h.measDeleted.push({ kind, id });
  }),
}));

const NOW = 1_700_000_000_000;
const M = 60000;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  h.q = [];
  h.timers = [];
  h.servers = [];
  h.pushed = [];
  h.updated = [];
  h.deleted = [];
  h.measPushed = [];
  h.measUpdated = [];
  h.measDeleted = [];
  h.pushFails = false;
  useAppStore.setState({
    connection: { demo: false, serverUrl: 'http://x', token: 't' },
    connected: true,
    offline: false,
    networkOnline: true,
    simulateOffline: false,
    now: NOW,
    selectedChildId: 'c1',
    children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
    entries: [],
    timers: [],
    measurements: [],
    lastFeed: { feedType: 'breast', method: 'left' },
    sheet: null,
    editingId: null,
    fromTimerId: null,
    measurementSheet: null,
    editingMeasurementId: null,
    te: { shape: 'interval', tags: [] },
    queueCount: 0,
    toast: null,
    savedServers: [],
  });
});

const s = () => useAppStore.getState();

describe('openSheet defaults', () => {
  it('feeding: interval, alternates breast side, 18m default', () => {
    s().openSheet('feeding');
    const te = s().te;
    expect(te.shape).toBe('interval');
    expect(te.durationMin).toBe(18);
    expect(te.endAgoMin).toBe(0);
    expect(te.ongoing).toBe(false);
    expect(te.feedType).toBe('breast');
    expect(te.method).toBe('right'); // opposite of lastFeed.method = 'left'
  });
  it('diaper: point shape, wet default', () => {
    s().openSheet('diaper');
    const te = s().te;
    expect(te.shape).toBe('point');
    expect(te.agoMin).toBe(0);
    expect(te.wet).toBe(true);
    expect(te.solid).toBe(false);
    expect(te.color).toBe('yellow');
  });
  it('pumping: amount 90, both, 15m', () => {
    s().openSheet('pumping');
    expect(s().te.amount).toBe(90);
    expect(s().te.method).toBe('both');
    expect(s().te.durationMin).toBe(15);
  });
});

describe('save', () => {
  it('feeding builds a correct entry and pushes online', async () => {
    s().openSheet('feeding');
    s().setLasted(20);
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.type).toBe('feeding');
    expect(e.end).toBe(NOW);
    expect(e.start).toBe(NOW - 20 * M);
    expect(e.feedType).toBe('breast');
    expect(e.method).toBe('right');
    expect(e.amount).toBeNull(); // breast + not bottle => null
    expect(s().lastFeed).toEqual({ feedType: 'breast', method: 'right' });
    expect(s().sheet).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1);
  });

  it('diaper builds a point entry', () => {
    s().openSheet('diaper');
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'diaper' }>;
    expect(e.type).toBe('diaper');
    expect(e.time).toBe(NOW);
    expect(e.wet).toBe(true);
    expect(e.solid).toBe(false);
    expect(e.color).toBeNull();
  });

  it('live interval creates a timer, not an entry', () => {
    s().openSheet('sleep');
    s().setOngoing();
    s().save();
    expect(s().timers).toHaveLength(1);
    expect(s().entries).toHaveLength(0);
    expect(s().timers[0].saveAs).toBe('sleep');
  });

  it('offline save enqueues instead of pushing', async () => {
    useAppStore.setState({ offline: true });
    s().openSheet('feeding');
    s().save();
    await flush();
    expect(h.q).toHaveLength(1);
    expect(s().queueCount).toBe(1);
    expect(h.pushed).toHaveLength(0);
  });
});

describe('flushQueue', () => {
  it('pushes queued entries and clears on success', async () => {
    h.q = [{ id: 'x', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }];
    await s().flushQueue();
    expect(h.pushed).toHaveLength(1);
    expect(h.q).toHaveLength(0);
    expect(s().queueCount).toBe(0);
  });

  it('keeps entries that fail to push', async () => {
    h.pushFails = true;
    h.q = [{ id: 'x', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }];
    await s().flushQueue();
    expect(h.q).toHaveLength(1);
    expect(s().queueCount).toBe(1);
  });
});

describe('stopTimer', () => {
  it('converts a timer into an entry', async () => {
    useAppStore.setState({ timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep' }] });
    s().stopTimer('t1');
    expect(s().timers).toHaveLength(0);
    expect(s().entries[0].type).toBe('sleep');
    await flush();
    expect(h.pushed).toHaveLength(1);
  });
});

describe('timer persistence across restarts', () => {
  const savedTimer = (id: string): Timer => ({ id, activity: 'sleep', name: 'Sleep', start: NOW - 5 * M, saveAs: 'sleep' });

  it('restores persisted timers on hydrate (real connection)', async () => {
    const saved = [savedTimer('t9')];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ demo: false, serverUrl: 'http://x', token: 't' });
    await s().hydrate();
    expect(s().timers).toEqual(saved);
  });

  it('restores persisted timers when the server is unreachable at launch', async () => {
    const saved = [savedTimer('t8')];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ demo: false, serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await s().hydrate();
    expect(s().offline).toBe(true);
    expect(s().timers).toEqual(saved);
  });

  it('prefers persisted timers over the demo seed', async () => {
    const saved = [savedTimer('tD')];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ demo: true, serverUrl: '', token: '' });
    await s().hydrate();
    expect(s().timers).toEqual(saved);
  });

  it('persists timers when a quick timer is started', async () => {
    h.timers = [];
    vi.mocked(saveTimers).mockClear();
    s().startQuickTimer();
    expect(saveTimers).toHaveBeenCalled();
    expect(h.timers).toHaveLength(1);
  });

  it('persists the now-empty list on disconnect', () => {
    useAppStore.setState({ timers: [savedTimer('t1')] });
    vi.mocked(saveTimers).mockClear();
    s().disconnect();
    expect(saveTimers).toHaveBeenLastCalledWith([]);
    expect(h.timers).toEqual([]);
  });
});

describe('new timers are added to the bottom of the list', () => {
  const existing = (id: string): Timer => ({ id, activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep' });

  it('startQuickTimer appends the new timer after existing ones', () => {
    useAppStore.setState({ timers: [existing('t-old')] });
    s().startQuickTimer();
    expect(s().timers).toHaveLength(2);
    expect(s().timers[0].id).toBe('t-old'); // existing timer stays on top
    expect(s().timers[1].id).not.toBe('t-old'); // new timer is last
  });

  it('a live-interval save appends the running timer after existing ones', () => {
    useAppStore.setState({ timers: [existing('t-old')] });
    s().openSheet('feeding');
    s().setOngoing();
    s().save();
    expect(s().timers).toHaveLength(2);
    expect(s().timers[0].id).toBe('t-old');
    expect(s().timers[1].saveAs).toBe('feeding'); // newest at the bottom
  });
});

describe('edit / delete entry', () => {
  const seedFeeding = () =>
    useAppStore.setState({
      entries: [
        { id: 'feeding-1', serverId: 1, childId: 'c1', type: 'feeding', start: NOW - 30 * M, end: NOW - 10 * M, feedType: 'breast', method: 'left', amount: null, tags: [] },
      ],
    });

  it('openEdit anchors absolute time; save updates in place + pushes update', async () => {
    seedFeeding();
    s().openEdit('feeding-1');
    expect(s().editingId).toBe('feeding-1');
    expect(s().te.endAbs).toBe(NOW - 10 * M);
    expect(s().te.durationMin).toBe(20);
    s().setTE({ method: 'right' });
    s().save();
    expect(s().entries).toHaveLength(1);
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.id).toBe('feeding-1');
    expect(e.method).toBe('right');
    expect(e.start).toBe(NOW - 30 * M);
    expect(e.end).toBe(NOW - 10 * M); // absolute time preserved (no drift)
    expect(s().editingId).toBeNull();
    await flush();
    expect(h.updated).toHaveLength(1);
  });

  it('tapping an Ended chip switches end off the edit anchor', () => {
    seedFeeding();
    s().openEdit('feeding-1');
    expect(s().te.endAbs).toBe(NOW - 10 * M);
    s().setEnded(0);
    expect(s().te.endAbs).toBeUndefined();
    expect(s().te.endAgoMin).toBe(0);
  });

  it('deleteEntry removes locally and deletes on server', async () => {
    seedFeeding();
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0);
    await flush();
    expect(h.deleted).toHaveLength(1);
  });
});

describe('measurements', () => {
  it('saveMeasurement creates and pushes', async () => {
    s().openMeasurement('weight');
    s().saveMeasurement(5.5, NOW);
    expect(s().measurements).toHaveLength(1);
    expect(s().measurements[0].kind).toBe('weight');
    expect(s().measurements[0].value).toBe(5.5);
    await flush();
    expect(h.measPushed).toHaveLength(1);
  });

  it('edit + delete a measurement', async () => {
    useAppStore.setState({
      measurements: [{ id: 'weight-1', serverId: 1, childId: 'c1', kind: 'weight', value: 5.0, date: NOW }],
    });
    s().openEditMeasurement('weight-1');
    s().saveMeasurement(6.0, NOW);
    expect(s().measurements[0].value).toBe(6.0);
    await flush();
    expect(h.measUpdated).toHaveLength(1);

    s().deleteMeasurement('weight-1');
    expect(s().measurements).toHaveLength(0);
    await flush();
    expect(h.measDeleted).toHaveLength(1);
  });
});

describe('connectivity', () => {
  it('losing the network forces offline; regaining clears it', () => {
    s().setNetworkOnline(false);
    expect(s().offline).toBe(true);
    s().setNetworkOnline(true);
    expect(s().offline).toBe(false);
  });

  it('simulate-offline overrides even when the network is up', () => {
    s().setNetworkOnline(true);
    s().toggleOffline();
    expect(s().offline).toBe(true);
    expect(s().simulateOffline).toBe(true);
    s().toggleOffline();
    expect(s().offline).toBe(false);
  });
});

describe('refresh / reconnect', () => {
  it('clears a stuck offline flag when the server is reachable again', async () => {
    useAppStore.setState({ offline: true, networkOnline: true });
    await s().refresh();
    expect(s().offline).toBe(false);
    expect(s().networkOnline).toBe(true);
  });

  it('marks offline when the server is unreachable', async () => {
    useAppStore.setState({ offline: false });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await s().refresh();
    expect(s().offline).toBe(true);
  });

  it('preserves local running timers across a refresh (server has none)', async () => {
    const timer: Timer = { id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 5 * M, saveAs: 'sleep' };
    useAppStore.setState({ timers: [timer], offline: true });
    await s().refresh();
    expect(s().timers).toEqual([timer]);
  });

  it('keeps the selected child when it still exists after refresh', async () => {
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [
        { id: 'c0', first: 'A', last: '', birth: NOW, color: '#fff' },
        { id: 'c1', first: 'Mira', last: 'O', birth: NOW, color: '#fff' },
      ],
      entries: [],
      timers: [],
      selectedChildId: 'c0',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    useAppStore.setState({ selectedChildId: 'c1' });
    await s().refresh();
    expect(s().selectedChildId).toBe('c1'); // not reset to the server's first child
  });

  it('flushes queued writes after reconnecting', async () => {
    h.q = [{ id: 'x', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }];
    useAppStore.setState({ offline: true, queueCount: 1 });
    await s().refresh();
    await flush();
    expect(h.pushed).toHaveLength(1);
    expect(s().queueCount).toBe(0);
  });

  it('does not clear a manual simulate-offline override', async () => {
    vi.mocked(loadFromServer).mockClear();
    useAppStore.setState({ simulateOffline: true, offline: true });
    await s().refresh();
    expect(s().offline).toBe(true);
    expect(loadFromServer).not.toHaveBeenCalled();
  });

  it('is a no-op in demo mode', async () => {
    vi.mocked(loadFromServer).mockClear();
    useAppStore.setState({ connection: { demo: true, serverUrl: '', token: '' }, offline: false });
    await s().refresh();
    expect(loadFromServer).not.toHaveBeenCalled();
    expect(s().offline).toBe(false);
  });

  it('clears the connection when the token has expired (401/403)', async () => {
    vi.mocked(loadFromServer).mockRejectedValueOnce(new ApiError(401, 'Invalid token'));
    await s().refresh();
    expect(s().connection).toBeNull();
    expect(s().connected).toBe(false);
    expect(s().connectError).toBeTruthy();
  });
});

describe('feeding extras', () => {
  it('breastfeed "both" records the start side as a tag + 1-10 intake in amount', () => {
    s().openSheet('feeding');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'right', amount: 6 });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.method).toBe('both');
    expect(e.tags).toContain('right');
    expect(e.amount).toBe(6);
  });
});

describe('diaper amount', () => {
  it('saves an optional amount', () => {
    s().openSheet('diaper');
    s().setTE({ amount: 3 });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'diaper' }>;
    expect(e.amount).toBe(3);
  });
});

describe('adjustTimerStart', () => {
  it('shifts a timer start earlier', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 10 * M, saveAs: 'sleep' }],
    });
    s().adjustTimerStart('t1', -5);
    expect(s().timers[0].start).toBe(NOW - 15 * M);
  });
});

describe('setTimerStart', () => {
  it('sets an exact start, clamped to now', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 10 * M, saveAs: 'sleep' }],
    });
    s().setTimerStart('t1', NOW - 37 * M);
    expect(s().timers[0].start).toBe(NOW - 37 * M);
    s().setTimerStart('t1', Date.now() + 60 * M); // future → clamped
    expect(s().timers[0].start).toBeLessThanOrEqual(Date.now());
  });
});

describe('time-entry: keep last two selected', () => {
  it('pinning Start derives Lasted (start+end both set)', () => {
    s().openSheet('feeding'); // active {end, lasted}, derived start
    s().setStartedAt(NOW - 40 * M); // now active {start, end}, derived lasted
    expect(s().te.order?.[2]).toBe('lasted');
    expect(teStart(s().te, NOW)).toBe(NOW - 40 * M);
    expect(teEnd(s().te, NOW)).toBe(NOW);
  });

  it('setEndedAbs pins an exact end and clears the relative pick', () => {
    s().openSheet('feeding'); // end=now (agoMin 0), lasted=default, start derived
    s().setEndedAbs(NOW - 13 * M);
    expect(s().te.endAbs).toBe(NOW - 13 * M);
    expect(s().te.endAgoMin).toBeUndefined();
    expect(teEnd(s().te, NOW)).toBe(NOW - 13 * M);
  });

  it('with start+end both pinned, re-pinning one endpoint keeps the other fixed', () => {
    s().openSheet('feeding');
    s().setStartedAt(NOW - 40 * M);
    s().setEndedAbs(NOW - 10 * M); // active {end, start}, derived lasted = 30
    s().setStartedAt(NOW - 47 * M); // fine-tune start; end must not move
    expect(teEnd(s().te, NOW)).toBe(NOW - 10 * M);
    expect(teStart(s().te, NOW)).toBe(NOW - 47 * M);
    expect(s().te.order?.[2]).toBe('lasted'); // lasted re-derives (37 min)
  });

  it('an Ended chip after setEndedAbs clears the absolute pin', () => {
    s().openSheet('feeding');
    s().setEndedAbs(NOW - 13 * M);
    s().setEnded(15);
    expect(s().te.endAbs).toBeUndefined();
    expect(teEnd(s().te, NOW)).toBe(NOW - 15 * M);
  });
});

describe('edit a running timer', () => {
  it('openTimerEdit prefills from the timer and shows the ongoing editing view', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    expect(s().sheet?.type).toBe('sleep');
    expect(s().fromTimerId).toBe('t1');
    expect(s().te.startAbs).toBe(NOW - 40 * M);
    // the timer is running, so TimeEntry must render its ongoing view (editable
    // start + live "now" end), not dead end/lasted pills
    expect(s().te.ongoing).toBe(true);
  });

  it('pressing the sheet\'s save button (save()) on a timer-edit keeps the timer running instead of stopping it', () => {
    // Regression guard for the original bug: editing a running timer used to
    // route through save()'s normal "consume into an entry" path because
    // openTimerEdit sets ongoing:false. save() must now detect fromTimerId
    // and delegate to saveTimerDetails instead.
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    s().save();
    expect(s().timers).toHaveLength(1); // still running, not consumed
    expect(s().entries).toHaveLength(0); // no entry created
    expect(s().sheet).toBeNull();
    expect(s().fromTimerId).toBeNull();
  });

  it('closing the timer-edit sheet keeps the timer running', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'feeding', name: 'Feeding', start: NOW - 10 * M, saveAs: 'feeding' }],
    });
    s().openTimerEdit('t1');
    s().closeSheet();
    expect(s().sheet).toBeNull();
    expect(s().timers).toHaveLength(1);
    expect(s().fromTimerId).toBeNull();
  });
});

describe('saveTimerDetails: persisting edits to a running timer', () => {
  const feedingTimer = (id: string): Timer => ({
    id,
    activity: 'feeding',
    name: 'Feeding',
    start: NOW - 12 * M,
    saveAs: 'feeding',
  });

  it('writes amount + side onto the Timer and keeps it running (not converted to an entry)', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'right', amount: 45 });
    s().saveTimerDetails();
    expect(s().timers).toHaveLength(1);
    expect(s().entries).toHaveLength(0);
    const tm = s().timers[0];
    expect(tm.amount).toBe(45);
    expect(tm.startSide).toBe('right');
    expect(tm.method).toBe('both');
    expect(s().sheet).toBeNull();
    expect(s().fromTimerId).toBeNull();
  });

  it('persists via the store subscribe (AsyncStorage-backed)', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    vi.mocked(saveTimers).mockClear();
    s().openTimerEdit('t1');
    s().setTE({ amount: 45 });
    s().saveTimerDetails();
    expect(saveTimers).toHaveBeenCalled();
  });

  it('reopening the editor shows the previously saved details', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'right', amount: 45 });
    s().saveTimerDetails();
    s().openTimerEdit('t1');
    expect(s().te.amount).toBe(45);
    expect(s().te.startSide).toBe('right');
    expect(s().te.method).toBe('both');
    expect(s().te.feedType).toBe('breast');
  });

  it('stopTimer uses the saved amount/side instead of hard-coded defaults', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ feedType: 'formula', method: 'bottle', amount: 120 });
    s().saveTimerDetails();
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.feedType).toBe('formula');
    expect(e.method).toBe('bottle');
    expect(e.amount).toBe(120);
  });

  it('stopTimer folds a saved breastfeeding "both" startSide into the tags, like a normal save', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'left' });
    s().saveTimerDetails();
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.tags).toContain('left');
  });

  it('a timer with no saved metadata still stops with the existing default behavior (regression guard)', () => {
    useAppStore.setState({ timers: [feedingTimer('t2')] });
    s().stopTimer('t2');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.feedType).toBe('breast');
    expect(e.method).toBe('left');
    expect(e.amount).toBeNull();
    expect(e.tags).toEqual([]);
  });

  it('sleep: saved nap flag survives reopen and stopTimer (regression guard for the no-metadata default too)', () => {
    useAppStore.setState({
      timers: [{ id: 't3', activity: 'sleep', name: 'Sleep', start: NOW - 5 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t3');
    s().setTE({ nap: false });
    s().saveTimerDetails();
    s().openTimerEdit('t3');
    expect(s().te.nap).toBe(false);
    s().stopTimer('t3');
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.nap).toBe(false);
  });

  it('pumping: saved amount/method survive reopen and stopTimer', () => {
    useAppStore.setState({
      timers: [{ id: 't4', activity: 'pumping', name: 'Pumping', start: NOW - 5 * M, saveAs: 'pumping' }],
    });
    s().openTimerEdit('t4');
    s().setTE({ amount: 150, method: 'left' });
    s().saveTimerDetails();
    s().openTimerEdit('t4');
    expect(s().te.amount).toBe(150);
    expect(s().te.method).toBe('left');
    s().stopTimer('t4');
    const e = s().entries[0] as Extract<Entry, { type: 'pumping' }>;
    expect(e.amount).toBe(150);
    expect(e.method).toBe('left');
  });

  it('tummy: persists the milestone it claims to save (no false "Details saved" for a no-op)', () => {
    useAppStore.setState({
      timers: [{ id: 't5', activity: 'tummy', name: 'Tummy time', start: NOW - 5 * M, saveAs: 'tummy' }],
    });
    s().openTimerEdit('t5');
    s().setTE({ milestone: 'lifted head' });
    s().saveTimerDetails();
    expect(s().timers).toHaveLength(1); // still running
    expect(s().entries).toHaveLength(0);
    // the toast asserts a save happened — so something must actually be persisted
    expect(s().timers[0].milestone).toBe('lifted head');
    expect(s().toast).toBe('Details saved');
    s().openTimerEdit('t5'); // reopen reflects it
    expect(s().te.milestone).toBe('lifted head');
    s().stopTimer('t5');
    const e = s().entries[0] as Extract<Entry, { type: 'tummy' }>;
    expect(e.milestone).toBe('lifted head');
  });

  it('persists an edited start time onto the running timer', () => {
    useAppStore.setState({ timers: [feedingTimer('t6')] }); // start NOW - 12m
    s().openTimerEdit('t6');
    s().setStartedAt(NOW - 40 * M); // user re-anchors the start earlier
    s().saveTimerDetails();
    expect(s().timers).toHaveLength(1);
    expect(s().timers[0].start).toBe(NOW - 40 * M);
    s().openTimerEdit('t6'); // reopen reflects the new start
    expect(s().te.startAbs).toBe(NOW - 40 * M);
  });

  it('tapping "Now" while editing a running timer resets and persists its start (ongoing stays true)', () => {
    useAppStore.setState({ timers: [feedingTimer('t6b')] }); // start NOW - 12m
    s().openTimerEdit('t6b');
    s().setStartedAt(NOW, 'now'); // user taps the "Now" chip
    expect(s().te.startAnchor).toBe('now');
    expect(s().te.ongoing).toBe(true); // setStartedAt must not disturb ongoing
    s().saveTimerDetails();
    expect(s().timers).toHaveLength(1); // still running, not stopped
    expect(s().timers[0].start).toBe(NOW);
  });

  it('leaves the start unchanged when it was not edited', () => {
    useAppStore.setState({ timers: [feedingTimer('t7')] }); // start NOW - 12m
    s().openTimerEdit('t7');
    s().setTE({ amount: 30 });
    s().saveTimerDetails();
    expect(s().timers[0].start).toBe(NOW - 12 * M);
  });

  it('tapping Lasted before Save details does NOT corrupt the running timer start', () => {
    useAppStore.setState({ timers: [feedingTimer('t9')] }); // start NOW - 12m
    s().openTimerEdit('t9');
    s().setTE({ amount: 60, method: 'both', startSide: 'right' });
    // setLasted reorders so `start` becomes derived (end − duration ≈ now − 30m)
    // and flips ongoing:false — the trap the guard defends against.
    s().setLasted(30);
    expect(s().te.ongoing).toBe(false); // sanity: we're in the dangerous state
    s().saveTimerDetails();
    expect(s().timers).toHaveLength(1); // still running
    expect(s().timers[0].start).toBe(NOW - 12 * M); // NOT rewritten to now − 30m
    // details still persist even though the start is (correctly) left alone
    expect(s().timers[0].amount).toBe(60);
    expect(s().timers[0].startSide).toBe('right');
    expect(s().timers[0].method).toBe('both');
  });

  it('persists tags edited on a running timer and folds them into the stopped entry', () => {
    useAppStore.setState({ timers: [feedingTimer('t8')] });
    s().openTimerEdit('t8');
    s().toggleTag('Cluster');
    s().saveTimerDetails();
    expect(s().timers[0].tags).toEqual(['Cluster']);
    s().openTimerEdit('t8');
    expect(s().te.tags).toEqual(['Cluster']);
    s().stopTimer('t8');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.tags).toContain('Cluster');
  });
});

describe('saved servers', () => {
  it('connect adds the connected server to the retry list', async () => {
    useAppStore.setState({ savedServers: [], connected: false });
    await s().connect('https://a.lan', 'tok');
    expect(s().savedServers.map((x) => x.serverUrl)).toContain('https://a.lan');
    expect(h.servers).toHaveLength(1); // persisted
  });

  it('forgetServer removes a server, persists, and toasts', () => {
    useAppStore.setState({
      savedServers: [
        { serverUrl: 'https://a.lan', token: 't', lastUsedAt: 1 },
        { serverUrl: 'https://b.lan', token: 't', lastUsedAt: 2 },
      ],
    });
    s().forgetServer('https://a.lan');
    expect(s().savedServers.map((x) => x.serverUrl)).toEqual(['https://b.lan']);
    expect(h.servers).toEqual([{ serverUrl: 'https://b.lan', token: 't', lastUsedAt: 2 }]);
    expect(s().toast).toBe('Removed');
  });

  it('hydrate loads saved servers and migrates the active connection', async () => {
    h.servers = [];
    vi.mocked(loadConnection).mockResolvedValueOnce({ demo: false, serverUrl: 'http://x', token: 't' });
    await s().hydrate();
    expect(s().savedServers.map((x) => x.serverUrl)).toContain('http://x');
    expect(h.servers.map((x: any) => x.serverUrl)).toContain('http://x');
  });

  it('a failed connect does not save the server', async () => {
    useAppStore.setState({ savedServers: [], connected: false });
    h.servers = [];
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('net'));
    await s().connect('https://bad.lan', 'tok');
    expect(s().connectError).toBeTruthy();
    expect(s().savedServers).toEqual([]);
    expect(h.servers).toEqual([]); // persistServers never called
  });
});
