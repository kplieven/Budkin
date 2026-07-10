import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeQueuedEntries, useAppStore, visibleTags } from '@/store/useAppStore';
import { isActive, teDurationMin, teEnd, teStart } from '@/store/selectors';
import { ApiError } from '@/api/client';
import { DEMO_TAGS } from '@/data/seed';
import { loadConnection } from '@/data/storage';
import { loadFromServer, loadInsightsHistory, loadProfileFromServer, loadTagsFromServer } from '@/data/repository';
import { savePrefs } from '@/data/prefs';
import { saveTimers } from '@/data/timers';
import { fmtClock } from '@/lib/format';
import type { Entry, Profile, Tag, Timer } from '@/types/models';

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
  childPushed: [] as unknown[],
  childUpdated: [] as unknown[],
  childDeleted: [] as unknown[],
  childPushChange: [] as unknown[],
  childUpdateChange: [] as unknown[],
  pushFails: false,
  profile: { username: 'alex', timezone: 'UTC', language: 'en', dashboardRefreshRate: undefined } as unknown,
  profileFails: false,
  tags: [{ name: 'Fussy', color: '#f80' }, { name: 'Sleepy' }] as unknown,
  tagsFails: false,
  prefs: {} as Record<string, unknown>,
}));

// Hoisted so the repository mock factory (also hoisted) can reference it.
const SERVER_PIC = vi.hoisted(() => 'https://srv.example/media/child/xyz.jpg');

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

// REQUIRED: `prefs.ts` imports AsyncStorage; without mocking it here the node
// test env pulls in the native AsyncStorage module and the suite breaks —
// mirrors why `@/data/timers` above is fully mocked too.
vi.mock('@/data/prefs', () => ({
  loadPrefs: vi.fn(async () => h.prefs),
  savePrefs: vi.fn(async () => {}),
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
  pushChildToServer: vi.fn(async (_c: unknown, child: unknown, change: any) => {
    h.childPushed.push(child);
    h.childPushChange.push(change);
    return { id: 777, picture: change?.kind === 'set' ? SERVER_PIC : null };
  }),
  updateChildOnServer: vi.fn(async (_c: unknown, child: unknown, change: any) => {
    h.childUpdated.push(child);
    h.childUpdateChange.push(change);
    return change?.kind === 'set' ? SERVER_PIC : null;
  }),
  deleteChildFromServer: vi.fn(async (_c: unknown, id: unknown) => {
    h.childDeleted.push(id);
  }),
  loadInsightsHistory: vi.fn(async () => []),
  loadProfileFromServer: vi.fn(async () => {
    if (h.profileFails) throw new Error('500');
    return h.profile;
  }),
  loadTagsFromServer: vi.fn(async () => {
    if (h.tagsFails) throw new Error('500');
    return h.tags;
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
  h.childPushed = [];
  h.childUpdated = [];
  h.childDeleted = [];
  h.childPushChange = [];
  h.childUpdateChange = [];
  h.pushFails = false;
  h.profile = { username: 'alex', timezone: 'UTC', language: 'en', dashboardRefreshRate: undefined };
  h.profileFails = false;
  h.tags = [{ name: 'Fussy', color: '#f80' }, { name: 'Sleepy' }];
  h.tagsFails = false;
  h.prefs = {};
  vi.mocked(loadProfileFromServer).mockClear();
  vi.mocked(loadTagsFromServer).mockClear();
  vi.mocked(savePrefs).mockClear();
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
    showChildSwitcher: false,
    childSheet: false,
    editingChildId: null,
    te: { shape: 'interval', tags: [] },
    queueCount: 0,
    profile: null,
    profileLoading: false,
    profileError: false,
    profileLoaded: false,
    tags: [],
    tagsLoaded: false,
    tagsLoading: false,
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

describe('bath tracking', () => {
  it('openSheet: point shape, wash defaults to the due kind', () => {
    s().openSheet('bath');
    const te = s().te;
    expect(te.shape).toBe('point');
    expect(te.agoMin).toBe(0);
    expect(te.wash).toBe('small'); // no bath history => small is due
  });
  it('openSheet defaults to big when three recent washes are small', () => {
    useAppStore.setState({
      entries: [
        { id: 'b1', childId: 'c1', type: 'bath', time: NOW - 3 * M, wash: 'small', tags: [] },
        { id: 'b2', childId: 'c1', type: 'bath', time: NOW - 2 * M, wash: 'small', tags: [] },
        { id: 'b3', childId: 'c1', type: 'bath', time: NOW - M, wash: 'small', tags: [] },
      ],
    });
    s().openSheet('bath');
    expect(s().te.wash).toBe('big');
  });
  it('setWash selects the wash size', () => {
    s().openSheet('bath');
    s().setWash('big');
    expect(s().te.wash).toBe('big');
    s().setWash('small');
    expect(s().te.wash).toBe('small');
  });
  it('save builds a point bath entry and pushes it (to the notes endpoint)', async () => {
    s().openSheet('bath');
    s().setWash('big');
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'bath' }>;
    expect(e.type).toBe('bath');
    expect(e.time).toBe(NOW);
    expect(e.wash).toBe('big');
    expect(e.childId).toBe('c1');
    expect(s().sheet).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1);
    expect((h.pushed[0] as Extract<Entry, { type: 'bath' }>).type).toBe('bath');
  });
});

describe('temperature tracking', () => {
  it('openSheet: point shape, seeds a default reading', () => {
    s().openSheet('temperature');
    const te = s().te;
    expect(te.shape).toBe('point');
    expect(te.agoMin).toBe(0);
    expect(te.temperature).toBe(37.0);
  });

  it('save builds a point temperature entry (value + trimmed notes) and pushes it', async () => {
    s().openSheet('temperature');
    s().setTE({ temperature: 38.2, notes: '  slight fever  ' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'temperature' }>;
    expect(e.type).toBe('temperature');
    expect(e.time).toBe(NOW);
    expect(e.value).toBe(38.2);
    expect(e.notes).toBe('slight fever');
    expect(e.childId).toBe('c1');
    expect(s().sheet).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1);
    expect((h.pushed[0] as Extract<Entry, { type: 'temperature' }>).type).toBe('temperature');
  });

  it('save falls back to the default reading when none was entered', () => {
    s().openSheet('temperature');
    s().setTE({ temperature: undefined });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'temperature' }>;
    expect(e.value).toBe(37.0);
  });

  it('openEdit prefills value + notes and treats it as a point event', () => {
    useAppStore.setState({
      entries: [
        { id: 'temperature-1', serverId: 5, childId: 'c1', type: 'temperature', time: NOW - 20 * M, value: 37.8, notes: 'after nap', tags: [] },
      ],
    });
    s().openEdit('temperature-1');
    expect(s().te.shape).toBe('point');
    expect(s().te.temperature).toBe(37.8);
    expect(s().te.notes).toBe('after nap');
    expect(s().te.agoMin).toBe(20);
  });
});

describe('general notes', () => {
  it('openSheet: point shape, empty note body', () => {
    s().openSheet('note');
    const te = s().te;
    expect(te.shape).toBe('point');
    expect(te.agoMin).toBe(0);
    expect(te.noteText).toBe('');
  });

  it('save builds a point note entry (trimmed body) and pushes it', async () => {
    s().openSheet('note');
    s().setTE({ noteText: '  remember the follow-up  ' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'note' }>;
    expect(e.type).toBe('note');
    expect(e.time).toBe(NOW);
    expect(e.text).toBe('remember the follow-up');
    expect(e.childId).toBe('c1');
    expect(s().sheet).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1);
    expect((h.pushed[0] as Extract<Entry, { type: 'note' }>).type).toBe('note');
  });

  it('refuses to save a blank note (whitespace only): no entry, sheet stays open', async () => {
    s().openSheet('note');
    s().setTE({ noteText: '   ' });
    s().save();
    expect(s().entries).toHaveLength(0);
    expect(s().sheet).not.toBeNull(); // still open — nothing created
    await flush();
    expect(h.pushed).toHaveLength(0);
  });

  it('openEdit prefills the note body + tags and treats it as a point event', () => {
    useAppStore.setState({
      entries: [
        { id: 'note-1', serverId: 5, childId: 'c1', type: 'note', time: NOW - 20 * M, text: 'first giggle', tags: ['Milestone'] },
      ],
    });
    s().openEdit('note-1');
    expect(s().te.shape).toBe('point');
    expect(s().te.noteText).toBe('first giggle');
    expect(s().te.tags).toEqual(['Milestone']);
    expect(s().te.agoMin).toBe(20);
    // a note has no secondary per-entry `notes` annotation
    expect(s().te.notes).toBeUndefined();
  });

  it('a note lives in the shared entries array, so delete/undo work like any entry', () => {
    useAppStore.setState({
      entries: [{ id: 'note-2', serverId: 7, childId: 'c1', type: 'note', time: NOW, text: 'x', tags: [] }],
    });
    s().deleteEntry('note-2');
    expect(s().entries).toHaveLength(0);
    s().undoDelete();
    expect(s().entries[0].id).toBe('note-2');
  });

  it('notes are excluded from the activity timeline while activities are kept', () => {
    // The History/rail views group `entries.filter(e => e.type !== 'note')`.
    useAppStore.setState({
      entries: [
        { id: 'note-3', childId: 'c1', type: 'note', time: NOW, text: 'note body', tags: [] },
        { id: 'diaper-1', childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] },
      ],
    });
    const activityEntries = s().entries.filter((e) => e.type !== 'note');
    expect(activityEntries.map((e) => e.type)).toEqual(['diaper']);
    const noteEntries = s().entries.filter((e) => e.type === 'note');
    expect(noteEntries.map((e) => e.id)).toEqual(['note-3']);
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

describe('mergeQueuedEntries', () => {
  const mk = (id: string, serverId?: number): Entry => ({
    id,
    serverId,
    childId: 'c1',
    type: 'diaper',
    time: NOW,
    wet: true,
    solid: false,
    color: null,
    tags: [],
  });

  it('prepends queued entries (newest first) onto the server entries', () => {
    const merged = mergeQueuedEntries([mk('s1', 1)], [mk('q1')]);
    expect(merged.map((e) => e.id)).toEqual(['q1', 's1']);
  });

  it('returns just the server entries when nothing is queued', () => {
    expect(mergeQueuedEntries([mk('s1', 1)], [])).toEqual([mk('s1', 1)]);
  });
});

describe('queued entries survive killing the app', () => {
  const queuedEntry = (id: string): Entry => ({
    id,
    childId: 'c1',
    type: 'diaper',
    time: NOW,
    wet: true,
    solid: false,
    color: null,
    tags: [],
  });
  const mira = { id: 'c1', first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' };

  it('restores a queued entry into `entries` on hydrate when the server is reachable', async () => {
    h.q = [queuedEntry('e1')];
    vi.mocked(loadConnection).mockResolvedValueOnce({ demo: false, serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [mira],
      entries: [
        { id: 'srv-1', serverId: 5, childId: 'c1', type: 'feeding', start: NOW - 60 * M, end: NOW - 40 * M, feedType: 'breast', method: 'left', amount: null, tags: [] },
      ],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    await s().hydrate();
    expect(s().entries.map((e) => e.id)).toEqual(['e1', 'srv-1']);
    expect(s().queueCount).toBe(1); // still counted as queued (flush hasn't run yet)
  });

  it('restores a queued entry into `entries` when the server is unreachable at launch', async () => {
    h.q = [queuedEntry('e2')];
    vi.mocked(loadConnection).mockResolvedValueOnce({ demo: false, serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await s().hydrate();
    expect(s().offline).toBe(true);
    expect(s().entries).toEqual([queuedEntry('e2')]);
    expect(s().queueCount).toBe(1);
  });

  it('does not duplicate the entry after it flushes and a later refresh returns the server copy', async () => {
    h.q = [queuedEntry('e3')];
    vi.mocked(loadConnection).mockResolvedValueOnce({ demo: false, serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    await s().hydrate();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].id).toBe('e3');

    // hydrate's fire-and-forget flushQueue() pushes it and clears the persisted
    // queue, but does NOT touch `entries` (matches existing flushQueue behavior).
    await flush();
    expect(h.q).toHaveLength(0);
    expect(s().entries).toHaveLength(1);

    // the next refresh sees the entry server-side (in server shape/id) — the
    // full `...data` replace in refresh() swaps the local copy for it.
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [mira],
      entries: [{ id: 'diaper-9', serverId: 9, childId: 'c1', type: 'diaper', time: NOW, wet: true, solid: false, color: null, tags: [] }],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    await s().refresh();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].id).toBe('diaper-9');
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

  it('deleteEntry shows an Undo toast and undoDelete restores + re-creates the entry', async () => {
    seedFeeding();
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0);
    expect(s().toast).toBe('Deleted');
    expect(s().toastAction?.label).toBe('Undo');
    await flush();
    expect(h.deleted).toHaveLength(1); // the delete reached the server

    s().undoDelete();
    expect(s().entries).toHaveLength(1);
    expect(s().entries[0].id).toBe('feeding-1');
    expect(s().toast).toBeNull();
    await flush();
    expect(h.pushed).toHaveLength(1); // re-created server-side
  });

  it('undoDelete restores locally without a server round-trip for an offline delete', async () => {
    seedFeeding();
    useAppStore.setState({ offline: true });
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0);
    await flush();
    expect(h.deleted).toHaveLength(0); // offline: the server was never touched

    s().undoDelete();
    expect(s().entries).toHaveLength(1);
    await flush();
    expect(h.pushed).toHaveLength(0); // nothing to re-create
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

describe('children', () => {
  it('saveChild creates, auto-selects, and pushes; patches id + selectedChildId to the server id', async () => {
    s().openAddChild();
    expect(s().childSheet).toBe(true);
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW - 30 * 86400000 });

    expect(s().children).toHaveLength(2);
    const created = s().children[1];
    expect(created.first).toBe('Nova');
    expect(created.last).toBe('O');
    expect(created.birth).toBe(NOW - 30 * 86400000);
    expect(created.id).toMatch(/^child\d+$/);
    expect(s().selectedChildId).toBe(created.id);
    expect(s().childSheet).toBe(false);
    expect(s().editingChildId).toBeNull();
    expect(s().showChildSwitcher).toBe(false);

    await flush();
    expect(h.childPushed).toHaveLength(1);
    // the local id is patched to the server id, and selection follows it
    expect(s().children[1].id).toBe('777');
    expect(s().selectedChildId).toBe('777');
  });

  it('saveChild creating a new child resets the insights cache (auto-select mirrors selectChild)', () => {
    useAppStore.setState({ insightsLoaded: true, insightsEntries: [{ id: 'x' } as any], insightsError: true });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW - 30 * 86400000 });

    const created = s().children[1];
    expect(s().selectedChildId).toBe(created.id);
    expect(s().insightsLoaded).toBe(false);
    expect(s().insightsEntries).toEqual([]);
    expect(s().insightsError).toBe(false);
  });

  it('saveChild while editing updates the existing child in place and calls updateChild', async () => {
    s().openEditChild('c1');
    expect(s().editingChildId).toBe('c1');
    s().saveChild({ first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });

    expect(s().children).toHaveLength(1);
    expect(s().children[0]).toMatchObject({ id: 'c1', first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });
    expect(s().childSheet).toBe(false);
    expect(s().editingChildId).toBeNull();

    await flush();
    expect(h.childUpdated).toHaveLength(1);
    expect(h.childPushed).toHaveLength(0);
  });

  it('saveChild create with a photo sets picture optimistically, then swaps in the server URL', async () => {
    const photo = { uri: 'file:///tmp/pick.jpg', name: 'pick.jpg', type: 'image/jpeg' };
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, photo: { kind: 'set', photo } });

    expect(s().children[1].picture).toBe('file:///tmp/pick.jpg'); // optimistic local URI
    await flush();
    expect(h.childPushChange[0]).toEqual({ kind: 'set', photo });
    expect(s().children[1].picture).toBe(SERVER_PIC); // swapped to durable URL
  });

  it('saveChild edit with a photo swaps the local URI for the server URL', async () => {
    const photo = { uri: 'file:///tmp/e.jpg', name: 'e.jpg', type: 'image/jpeg' };
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: '', birth: NOW, photo: { kind: 'set', photo } });

    expect(s().children[0].picture).toBe('file:///tmp/e.jpg');
    await flush();
    expect(h.childUpdateChange[0]).toEqual({ kind: 'set', photo });
    expect(s().children[0].picture).toBe(SERVER_PIC);
  });

  it('saveChild edit with remove clears the picture and passes a remove change', async () => {
    useAppStore.setState((st) => ({ children: st.children.map((c) => ({ ...c, picture: 'file:///old.jpg' })) }));
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: '', birth: NOW, photo: { kind: 'remove' } });

    expect(s().children[0].picture).toBeNull();
    await flush();
    expect(h.childUpdateChange[0]).toEqual({ kind: 'remove' });
  });

  it('saveChild edit with no photo change leaves the existing picture untouched', async () => {
    useAppStore.setState((st) => ({ children: st.children.map((c) => ({ ...c, picture: 'file:///keep.jpg' })) }));
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: '', birth: NOW });

    expect(s().children[0].picture).toBe('file:///keep.jpg');
    await flush();
    expect(h.childUpdateChange[0]).toEqual({ kind: 'none' });
  });

  it('demo mode: create stays local, no server push', async () => {
    useAppStore.setState({ connection: { demo: true, serverUrl: '', token: '' } });
    s().openAddChild();
    s().saveChild({ first: 'Demo', last: '', birth: NOW });
    expect(s().children).toHaveLength(2);
    await flush();
    expect(h.childPushed).toHaveLength(0);
  });

  it('offline: create stays local, no server push', async () => {
    useAppStore.setState({ offline: true });
    s().openAddChild();
    s().saveChild({ first: 'Offline', last: '', birth: NOW });
    expect(s().children).toHaveLength(2);
    await flush();
    expect(h.childPushed).toHaveLength(0);
  });

  it('closeChildSheet clears both childSheet and editingChildId', () => {
    s().openEditChild('c1');
    s().closeChildSheet();
    expect(s().childSheet).toBe(false);
    expect(s().editingChildId).toBeNull();
  });
});

describe('deleteChild', () => {
  const serverChild = (id: string, first: string) => ({
    id,
    first,
    last: '',
    birth: NOW,
    color: '#fff',
    slug: first.toLowerCase(),
  });
  const feeding = (id: string, childId: string): Entry => ({
    id,
    serverId: 1,
    childId,
    type: 'feeding',
    start: NOW - 20 * M,
    end: NOW,
    feedType: 'breast',
    method: 'left',
    amount: null,
    tags: [],
  });
  const timer: Timer = { id: 't1', activity: 'sleep', name: 'Sleep', start: NOW, saveAs: 'sleep' };

  it('local-only child: deletes in memory only, no server call', async () => {
    // the seeded child id 'c1' is non-numeric => local-only
    s().openEditChild('c1');
    s().deleteChild('c1');
    expect(s().children).toHaveLength(0);
    expect(s().selectedChildId).toBe('');
    expect(s().childSheet).toBe(false);
    expect(s().editingChildId).toBeNull();
    expect(s().toast).toBe('Mira deleted');
    await flush();
    expect(h.childDeleted).toHaveLength(0);
  });

  it('server-backed selected child while online: server delete + purge + re-point', async () => {
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
      entries: [feeding('feeding-1', '5')],
      measurements: [{ id: 'weight-1', serverId: 2, childId: '5', kind: 'weight', value: 5, date: NOW }],
      timers: [timer],
      insightsLoaded: true,
      insightsEntries: [{ id: 'x' } as any],
      insightsError: true,
    });
    s().deleteChild('5');
    expect(s().children.map((c) => c.id)).toEqual(['6']);
    expect(s().selectedChildId).toBe('6'); // re-pointed to the surviving child
    expect(s().entries).toHaveLength(0); // deleted child's entries purged
    expect(s().measurements).toHaveLength(0); // measurements purged
    expect(s().timers).toHaveLength(0); // running timers cleared
    expect(s().insightsLoaded).toBe(false);
    expect(s().insightsEntries).toEqual([]);
    expect(s().insightsError).toBe(false);
    expect(s().childSheet).toBe(false);
    expect(s().showChildSwitcher).toBe(false);
    await flush();
    expect(h.childDeleted).toEqual([5]); // numeric id passed to the server delete
  });

  it('deleting the last remaining child leaves selectedChildId empty', async () => {
    useAppStore.setState({ children: [serverChild('5', 'Mira')], selectedChildId: '5' });
    s().deleteChild('5');
    expect(s().children).toHaveLength(0);
    expect(s().selectedChildId).toBe('');
    await flush();
    expect(h.childDeleted).toEqual([5]);
  });

  it('deleting a non-selected child leaves selection + loaded data intact', async () => {
    useAppStore.setState({
      children: [serverChild('5', 'Mira'), serverChild('6', 'Nova')],
      selectedChildId: '5',
      entries: [feeding('feeding-1', '5')],
      timers: [timer],
    });
    s().deleteChild('6');
    expect(s().children.map((c) => c.id)).toEqual(['5']);
    expect(s().selectedChildId).toBe('5'); // unchanged
    expect(s().entries).toHaveLength(1); // selected child's data untouched
    expect(s().timers).toHaveLength(1); // timers not cleared
    await flush();
    expect(h.childDeleted).toEqual([6]);
  });

  it('demo mode: deletes in memory only, no server call', async () => {
    useAppStore.setState({
      connection: { demo: true, serverUrl: '', token: '' },
      children: [serverChild('5', 'Mira')],
      selectedChildId: '5',
    });
    s().deleteChild('5');
    expect(s().children).toHaveLength(0);
    await flush();
    expect(h.childDeleted).toHaveLength(0);
  });

  it('server-backed child while offline: in-memory only, never an undurable server delete', async () => {
    useAppStore.setState({
      offline: true,
      children: [serverChild('5', 'Mira')],
      selectedChildId: '5',
    });
    s().deleteChild('5');
    expect(s().children).toHaveLength(0);
    await flush();
    expect(h.childDeleted).toHaveLength(0);
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

  it('resets profile state on session expiry (401/403) so a later loadProfile refetches', async () => {
    useAppStore.setState({
      profile: { username: 'alex' },
      profileLoaded: true,
      profileLoading: false,
      profileError: false,
    });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new ApiError(401, 'Invalid token'));
    await s().refresh();
    expect(s().profile).toBeNull();
    expect(s().profileLoaded).toBe(false);
    expect(s().profileError).toBe(false);
    expect(s().profileLoading).toBe(false);

    // A later loadProfile (e.g. after reconnecting) can refetch since
    // profileLoaded no longer blocks it.
    useAppStore.setState({ connection: { demo: false, serverUrl: 'http://x', token: 't2' } });
    await s().loadProfile();
    expect(loadProfileFromServer).toHaveBeenCalled();
    expect(s().profileLoaded).toBe(true);
  });
});

describe('refresh timer reconcile (widget writes timers out-of-band)', () => {
  const sleepTimer: Timer = { id: 't1', activity: 'sleep', name: 'Sleep', start: NOW, saveAs: 'sleep' };

  it('picks up a widget-started timer the in-memory list does not have', async () => {
    useAppStore.setState({ timers: [] });   // app thinks no timers running
    h.timers = [sleepTimer];                // widget wrote storage while app was warm
    await useAppStore.getState().refresh();
    expect(useAppStore.getState().timers).toEqual([sleepTimer]);
  });

  it('drops a timer the widget has stopped (absent from storage)', async () => {
    useAppStore.setState({ timers: [sleepTimer] });  // app still holds the running timer
    h.timers = [];                                   // widget stopped it → storage empty
    await useAppStore.getState().refresh();
    expect(useAppStore.getState().timers).toEqual([]);
  });

  it('reconciles timers from storage even when the server is unreachable', async () => {
    useAppStore.setState({ timers: [sleepTimer] }); // persist mock writes this to storage too
    h.timers = [];                                  // widget stopped it out-of-band
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await useAppStore.getState().refresh();
    expect(useAppStore.getState().offline).toBe(true);
    expect(useAppStore.getState().timers).toEqual([]); // still cleared despite being offline
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

describe('per-entry notes', () => {
  it('save() writes a trimmed notes onto a feeding entry', () => {
    s().openSheet('feeding');
    s().setTE({ notes: '  fussy at the end  ' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.notes).toBe('fussy at the end');
  });

  it('save() omits notes when blank (whitespace trims to undefined)', () => {
    s().openSheet('sleep');
    s().setTE({ notes: '   ' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.notes).toBeUndefined();
  });

  it('save() never puts notes on a bath entry (bath excluded)', () => {
    s().openSheet('bath');
    s().setTE({ notes: 'should be ignored' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'bath' }>;
    expect((e as { notes?: string }).notes).toBeUndefined();
  });

  it('openEdit prefills notes from the entry', () => {
    useAppStore.setState({
      entries: [
        { id: 'tummy-1', serverId: 3, childId: 'c1', type: 'tummy', start: NOW - 20 * M, end: NOW - 5 * M, milestone: 'rolled', notes: 'on the mat', tags: [] },
      ],
    });
    s().openEdit('tummy-1');
    expect(s().te.notes).toBe('on the mat');
  });

  it('edit round-trip: openEdit prefills, edited notes survives save', () => {
    useAppStore.setState({
      entries: [
        { id: 'pumping-1', serverId: 4, childId: 'c1', type: 'pumping', start: NOW - 15 * M, end: NOW, amount: 90, notes: 'left side', tags: [] },
      ],
    });
    s().openEdit('pumping-1');
    expect(s().te.notes).toBe('left side');
    s().setTE({ notes: 'both sides now' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'pumping' }>;
    expect(e.notes).toBe('both sides now');
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

describe('stopTimer(id, endMs?) — ephemeral "Ended earlier…" stop flow', () => {
  const runningTimer = (id: string, startAgoMin: number): Timer => ({
    id,
    activity: 'sleep',
    name: 'Sleep',
    start: NOW - startAgoMin * M,
    saveAs: 'sleep',
  });

  it('without endMs still ends at now (regression)', () => {
    useAppStore.setState({ timers: [runningTimer('t1', 30)] });
    const before = Date.now();
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.end).toBeGreaterThanOrEqual(before);
    expect(e.end).toBeLessThanOrEqual(Date.now());
  });

  it('with endMs logs a sleep entry ending at that time instead of now', () => {
    useAppStore.setState({ timers: [runningTimer('t1', 30)] });
    s().stopTimer('t1', NOW - 5 * M);
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.start).toBe(NOW - 30 * M);
    expect(e.end).toBe(NOW - 5 * M);
  });

  it('with endMs honors the given end for a non-sleep timer too', () => {
    useAppStore.setState({
      timers: [{ id: 't2', activity: 'feeding', name: 'Feeding', start: NOW - 30 * M, saveAs: 'feeding' }],
    });
    s().stopTimer('t2', NOW - 8 * M);
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.start).toBe(NOW - 30 * M);
    expect(e.end).toBe(NOW - 8 * M);
  });

  it('clamps endMs in the future down to now', () => {
    useAppStore.setState({ timers: [runningTimer('t1', 30)] });
    s().stopTimer('t1', Date.now() + 60 * M);
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.end).toBeLessThanOrEqual(Date.now());
  });

  it('clamps endMs before start up to start (no negative-duration entry)', () => {
    useAppStore.setState({ timers: [runningTimer('t1', 5)] }); // start NOW - 5m
    s().stopTimer('t1', NOW - 20 * M);
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.end).toBeGreaterThanOrEqual(e.start);
    expect(e.end).toBe(NOW - 5 * M); // clamped up to start
  });

  it('mentions the back-dated end in the toast when endMs is supplied', () => {
    useAppStore.setState({ timers: [runningTimer('t1', 30)] });
    s().stopTimer('t1', NOW - 5 * M);
    expect(s().toast).toBe('Saved as sleep · ended ' + fmtClock(NOW - 5 * M));
  });

  it('omits the back-dated wording when ending at now', () => {
    useAppStore.setState({ timers: [runningTimer('t1', 30)] });
    s().stopTimer('t1');
    expect(s().toast).toBe('Saved as sleep');
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

  it('with lasted+end active, nudging start moves only start and re-derives lasted', () => {
    s().openSheet('feeding');
    s().setLasted(20); // active {lasted, end@now}, start derived (= now-20)
    s().setStartedAt(NOW - 50 * M); // nudge start earlier — must overrule lasted
    expect(teStart(s().te, NOW)).toBe(NOW - 50 * M); // start moved
    expect(teEnd(s().te, NOW)).toBe(NOW); // end stayed put (frozen)
    expect(teDurationMin(s().te, NOW)).toBe(50); // duration recomputed as end − start
    expect(s().te.order?.[2]).toBe('lasted'); // lasted deselected → derived
    expect(isActive(s().te.order, 'lasted')).toBe(false);
  });

  it('with lasted+start active, nudging end moves only end and re-derives lasted', () => {
    s().openSheet('feeding');
    s().setStartedAt(NOW - 60 * M); // pin start (freezes end, lasted → derived)
    s().setLasted(30); // active {lasted, start}, end derived (= now-30)
    s().setEndedAbs(NOW - 5 * M); // nudge end later — must overrule lasted
    expect(teEnd(s().te, NOW)).toBe(NOW - 5 * M); // end moved
    expect(teStart(s().te, NOW)).toBe(NOW - 60 * M); // start stayed put (frozen)
    expect(teDurationMin(s().te, NOW)).toBe(55); // duration recomputed
    expect(s().te.order?.[2]).toBe('lasted'); // lasted deselected → derived
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

  it('carries a note typed while editing a running timer through saveTimerDetails → reopen → stopTimer', () => {
    useAppStore.setState({ timers: [feedingTimer('t1')] });
    s().openTimerEdit('t1');
    s().setTE({ notes: '  spit up a little  ' });
    s().saveTimerDetails();
    // persisted on the still-running timer (trimmed), not lost
    expect(s().timers[0].notes).toBe('spit up a little');
    // reopening the editor shows it again
    s().openTimerEdit('t1');
    expect(s().te.notes).toBe('spit up a little');
    // and it survives the final stop into the entry
    s().saveTimerDetails();
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.notes).toBe('spit up a little');
  });

  it('carries a note through a sleep timer stop (buildSleepEntry path)', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 30 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    s().setTE({ notes: 'down easy' });
    s().saveTimerDetails();
    s().stopTimer('t1');
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.type).toBe('sleep');
    expect(e.notes).toBe('down easy');
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

  it('setTimerLasted keeps the fixed start and derives the end (start + X)', () => {
    useAppStore.setState({ timers: [feedingTimer('t9')] }); // start NOW - 12m
    s().openTimerEdit('t9');
    s().setTimerLasted(45); // "oh, it lasted about 45 min"
    expect(s().te.ongoing).toBe(false); // marked finished
    expect(s().te.startAbs).toBe(NOW - 12 * M); // start NOT rewritten
    expect(s().te.durationMin).toBe(45);
    expect(s().te.order?.[2]).toBe('end'); // end is the derived point
  });

  it('nudging the end after setTimerLasted moves only the end; the real start stays fixed', () => {
    useAppStore.setState({ timers: [feedingTimer('t9c')] }); // real start NOW - 12m
    s().openTimerEdit('t9c');
    s().setTimerLasted(45); // active {lasted, start}, end derived (= start + 45)
    s().setEndedAbs(NOW - 2 * M); // fine-tune the end — must overrule the lasted estimate
    expect(teStart(s().te, NOW)).toBe(NOW - 12 * M); // real elapsed start untouched
    expect(teEnd(s().te, NOW)).toBe(NOW - 2 * M); // only the end moved
    expect(teDurationMin(s().te, NOW)).toBe(10); // duration re-derives (end − start)
    expect(s().te.order?.[2]).toBe('lasted'); // lasted deselected
  });

  it('Save with a chosen length stops the timer into a fixed-start entry', () => {
    useAppStore.setState({ timers: [feedingTimer('t9b')] }); // start NOW - 12m
    s().openTimerEdit('t9b');
    s().setTE({ amount: 60, method: 'both', startSide: 'right' });
    s().setTimerLasted(45);
    s().save();
    expect(s().timers).toHaveLength(0); // timer stopped
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.type).toBe('feeding');
    expect(e.start).toBe(NOW - 12 * M); // fixed start preserved
    expect(e.end).toBe(NOW - 12 * M + 45 * M); // end = start + 45m
    expect(e.amount).toBe(60);
    expect(e.method).toBe('both');
    expect(e.tags).toContain('right'); // "both" folds the starting side into a tag
    expect(s().sheet).toBeNull();
  });

  it('"Still running" after a length keeps the timer live on save', () => {
    useAppStore.setState({ timers: [feedingTimer('t9c')] }); // start NOW - 12m
    s().openTimerEdit('t9c');
    s().setTimerLasted(30); // considered stopping...
    s().setOngoing(); // ...then tapped "Still running" to keep it going
    expect(s().te.ongoing).toBe(true);
    s().save();
    expect(s().timers).toHaveLength(1); // still running, not stopped
    expect(s().entries).toHaveLength(0);
    expect(s().timers[0].start).toBe(NOW - 12 * M);
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

describe('insights slice', () => {
  it('loadInsights in demo mode fills insightsEntries from local entries scoped to the child', async () => {
    useAppStore.setState({
      connection: { demo: true, serverUrl: '', token: '' } as any,
      selectedChildId: 'c1',
      entries: [
        { id: 's1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any,
        { id: 's2', type: 'sleep', childId: 'c2', start: 3, end: 4, nap: false, tags: [] } as any,
      ],
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    await useAppStore.getState().loadInsights();
    const s = useAppStore.getState();
    expect(s.insightsLoaded).toBe(true);
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['s1']); // c2's entry excluded
  });

  it('selectChild resets the insights cache', () => {
    useAppStore.setState({ insightsLoaded: true, insightsEntries: [{ id: 'x' } as any], insightsError: true });
    useAppStore.getState().selectChild('c2');
    expect(useAppStore.getState().insightsLoaded).toBe(false);
    expect(useAppStore.getState().insightsEntries).toEqual([]);
    expect(useAppStore.getState().insightsError).toBe(false);
  });

  it('loadInsights in non-demo mode fetches deep history from the server', async () => {
    useAppStore.setState({
      connection: { demo: false, serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockResolvedValueOnce([
      { id: 'r1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any,
    ]);
    await useAppStore.getState().loadInsights();
    expect(loadInsightsHistory).toHaveBeenCalledWith(
      { demo: false, serverUrl: 'x', token: 'y' },
      'c1',
      expect.any(Number),
    );
    const s = useAppStore.getState();
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['r1']);
    expect(s.insightsLoaded).toBe(true);
  });

  it('discards an in-flight fetch when the child switches mid-load and reloads for the new child', async () => {
    vi.mocked(loadInsightsHistory).mockClear();
    useAppStore.setState({
      connection: { demo: false, serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    // First call: a manually-controlled deferred so we can switch children
    // while the 90-day fetch is still in flight.
    let resolveC1!: (v: Entry[]) => void;
    vi.mocked(loadInsightsHistory).mockImplementationOnce(
      () => new Promise<Entry[]>((r) => { resolveC1 = r; }),
    );
    const inFlight = useAppStore.getState().loadInsights(); // c1 fetch starts
    useAppStore.getState().selectChild('c2'); // switch lands mid-flight
    resolveC1([{ id: 'a1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any]);
    await inFlight;
    await flush(); // let the re-triggered c2 load settle (default mock resolves [])

    const st = useAppStore.getState();
    // c1's stale entries must NOT be stored under c2...
    expect(st.insightsEntries.map((e) => e.id)).not.toContain('a1');
    // ...and a fresh load for c2 must have been kicked off.
    expect(loadInsightsHistory).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadInsightsHistory).mock.calls[1][1]).toBe('c2');
    expect(st.insightsEntries).toEqual([]); // c2's (empty) result
    expect(st.insightsLoaded).toBe(true);
    expect(st.insightsLoading).toBe(false);
  });

  it('loadInsights surfaces an error and recovers on retry', async () => {
    useAppStore.setState({
      connection: { demo: false, serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockRejectedValueOnce(new Error('network'));
    await useAppStore.getState().loadInsights();
    expect(useAppStore.getState().insightsError).toBe(true);
    expect(useAppStore.getState().insightsLoading).toBe(false);
    expect(useAppStore.getState().insightsLoaded).toBe(false);

    // Retry: the CenteredState error view resets insightsLoading before
    // calling loadInsights again — mirror that here.
    vi.mocked(loadInsightsHistory).mockResolvedValueOnce([
      { id: 'r2', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any,
    ]);
    useAppStore.setState({ insightsLoading: false });
    await useAppStore.getState().loadInsights();
    expect(useAppStore.getState().insightsLoaded).toBe(true);
    expect(useAppStore.getState().insightsError).toBe(false);
  });
});

describe('theme persistence', () => {
  it('toggleTheme persists the new mode via savePrefs', () => {
    useAppStore.setState({ themeMode: 'dark' });
    s().toggleTheme();
    expect(s().themeMode).toBe('light');
    expect(savePrefs).toHaveBeenCalledWith({ themeMode: 'light' });
  });

  it('toggling back to dark persists dark too', () => {
    useAppStore.setState({ themeMode: 'light' });
    s().toggleTheme();
    expect(s().themeMode).toBe('dark');
    expect(savePrefs).toHaveBeenCalledWith({ themeMode: 'dark' });
  });

  it('hydrate applies a persisted themeMode', async () => {
    h.prefs = { themeMode: 'light' };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ themeMode: 'dark' });
    await s().hydrate();
    expect(s().themeMode).toBe('light');
  });

  it('hydrate leaves themeMode alone when nothing was persisted', async () => {
    h.prefs = {};
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ themeMode: 'dark' });
    await s().hydrate();
    expect(s().themeMode).toBe('dark');
  });

  it('hydrate applies a persisted theme for a demo connection too', async () => {
    h.prefs = { themeMode: 'light' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ demo: true, serverUrl: '', token: '' });
    useAppStore.setState({ themeMode: 'dark' });
    await s().hydrate();
    expect(s().themeMode).toBe('light');
  });
});

describe('loadProfile (lazy fetch of read-only Baby Buddy server settings)', () => {
  it('demo mode: profile stays null, marked loaded, no fetch', async () => {
    useAppStore.setState({ connection: { demo: true, serverUrl: '', token: '' } });
    await s().loadProfile();
    expect(s().profile).toBeNull();
    expect(s().profileLoaded).toBe(true);
    expect(s().profileLoading).toBe(false);
    expect(loadProfileFromServer).not.toHaveBeenCalled();
  });

  it('success: fetches and stores the profile', async () => {
    h.profile = { username: 'alex', timezone: 'UTC', language: 'en' } as Profile;
    await s().loadProfile();
    expect(s().profile).toEqual(h.profile);
    expect(s().profileLoaded).toBe(true);
    expect(s().profileLoading).toBe(false);
    expect(s().profileError).toBe(false);
    expect(loadProfileFromServer).toHaveBeenCalledWith(s().connection);
  });

  it('error: sets profileError and clears loading, logs the status, without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.profileFails = true;
    await expect(s().loadProfile()).resolves.toBeUndefined();
    expect(s().profileError).toBe(true);
    expect(s().profileLoading).toBe(false);
    expect(s().profileLoaded).toBe(false);
    expect(warn).toHaveBeenCalled(); // diagnostic log fired for the failed /api/profile/
    warn.mockRestore();
  });

  it('laziness: a second call no-ops once loaded', async () => {
    await s().loadProfile();
    expect(vi.mocked(loadProfileFromServer)).toHaveBeenCalledTimes(1);
    await s().loadProfile();
    expect(vi.mocked(loadProfileFromServer)).toHaveBeenCalledTimes(1);
  });

  it('laziness: a second call no-ops while already loading', async () => {
    let resolve!: (v: Profile | null) => void;
    vi.mocked(loadProfileFromServer).mockImplementationOnce(
      () => new Promise<Profile | null>((r) => { resolve = r; }),
    );
    const first = s().loadProfile();
    const second = s().loadProfile(); // fires while the first is still in flight
    resolve({ username: 'alex' });
    await Promise.all([first, second]);
    expect(vi.mocked(loadProfileFromServer)).toHaveBeenCalledTimes(1);
  });

  it('no connection: no-ops without fetching', async () => {
    useAppStore.setState({ connection: null });
    await s().loadProfile();
    expect(s().profileLoaded).toBe(false);
    expect(loadProfileFromServer).not.toHaveBeenCalled();
  });

  it('disconnect clears the profile state', async () => {
    await s().loadProfile();
    expect(s().profileLoaded).toBe(true);
    s().disconnect();
    expect(s().profile).toBeNull();
    expect(s().profileLoaded).toBe(false);
    expect(s().profileError).toBe(false);
  });

  it('connect resets profile state so a newly-connected server refetches', async () => {
    await s().loadProfile();
    expect(s().profileLoaded).toBe(true);
    await s().connect('https://new.lan', 'tok2');
    expect(s().profileLoaded).toBe(false);
    expect(s().profile).toBeNull();
    expect(s().profileError).toBe(false);
  });
});

describe('loadTags (lazy, cached server tag list for the picker)', () => {
  it('success: fetches, stores the tag list, and marks loaded', async () => {
    h.tags = [{ name: 'Fussy', color: '#f80' }, { name: 'Sleepy' }];
    await s().loadTags();
    expect(s().tags).toEqual(h.tags);
    expect(s().tagsLoaded).toBe(true);
    expect(s().tagsLoading).toBe(false);
    expect(loadTagsFromServer).toHaveBeenCalledWith(s().connection);
  });

  it('laziness: a second call no-ops once loaded', async () => {
    await s().loadTags();
    expect(vi.mocked(loadTagsFromServer)).toHaveBeenCalledTimes(1);
    await s().loadTags();
    expect(vi.mocked(loadTagsFromServer)).toHaveBeenCalledTimes(1);
  });

  it('laziness: a second call no-ops while already loading', async () => {
    let resolve!: (v: Tag[]) => void;
    vi.mocked(loadTagsFromServer).mockImplementationOnce(
      () => new Promise<Tag[]>((r) => { resolve = r; }),
    );
    const first = s().loadTags();
    const second = s().loadTags();
    resolve([{ name: 'Fussy' }]);
    await Promise.all([first, second]);
    expect(vi.mocked(loadTagsFromServer)).toHaveBeenCalledTimes(1);
  });

  it('demo mode: seeds the fallback tag list without hitting the server', async () => {
    useAppStore.setState({ connection: { demo: true, serverUrl: '', token: '' } });
    await s().loadTags();
    expect(s().tags).toEqual(DEMO_TAGS);
    expect(s().tags.map((t) => t.name)).toEqual(['Left side', 'Cluster', 'Spit-up', 'Fussy', 'Sleepy']);
    expect(s().tagsLoaded).toBe(true);
    expect(loadTagsFromServer).not.toHaveBeenCalled();
  });

  it('no connection: no-ops without fetching', async () => {
    useAppStore.setState({ connection: null });
    await s().loadTags();
    expect(s().tagsLoaded).toBe(false);
    expect(loadTagsFromServer).not.toHaveBeenCalled();
  });

  it('error: tolerates staleness — keeps existing tags, clears loading, stays unloaded for retry', async () => {
    useAppStore.setState({ tags: [{ name: 'Cached' }] });
    h.tagsFails = true;
    await expect(s().loadTags()).resolves.toBeUndefined();
    expect(s().tags).toEqual([{ name: 'Cached' }]); // not wiped
    expect(s().tagsLoading).toBe(false);
    expect(s().tagsLoaded).toBe(false); // can retry on the next open
  });

  it('drops a stale result if the session changed while /api/tags/ was in flight', async () => {
    let resolve!: (v: Tag[]) => void;
    vi.mocked(loadTagsFromServer).mockImplementationOnce(
      () => new Promise<Tag[]>((r) => { resolve = r; }),
    );
    const p = s().loadTags();
    // session switches to a different server mid-fetch (as a reset would)
    useAppStore.setState({
      connection: { demo: false, serverUrl: 'https://b', token: 'b' },
      tags: [],
      tagsLoaded: false,
    });
    resolve([{ name: 'ServerA-only' }]);
    await p;
    // server A's tags must NOT repopulate server B's picker
    expect(s().tags).toEqual([]);
    expect(s().tagsLoaded).toBe(false);
  });
});

describe('createTag (free-form tag creation)', () => {
  it('trims a new name and selects it onto the working entry', () => {
    s().openSheet('feeding');
    s().createTag('  Growth spurt  ');
    expect(s().te.tags).toContain('Growth spurt');
  });

  it('rejects a blank / whitespace-only name', () => {
    s().openSheet('feeding');
    s().createTag('   ');
    s().createTag('');
    expect(s().te.tags).toEqual([]);
  });

  it('rejects the structural HIDDEN_TAGS so they can never be created', () => {
    s().openSheet('feeding');
    for (const t of ['bath', 'small', 'big', 'left', 'right']) s().createTag(t);
    expect(s().te.tags).toEqual([]);
  });

  it('does not duplicate an already-selected tag', () => {
    s().openSheet('feeding');
    s().createTag('Fussy');
    s().createTag('Fussy');
    expect(s().te.tags.filter((t) => t === 'Fussy')).toHaveLength(1);
  });

  it('a created tag rides onto the saved entry.tags', () => {
    s().openSheet('feeding');
    s().createTag('Teething');
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.tags).toContain('Teething');
  });
});

describe('visibleTags (union of server + selected, minus structural)', () => {
  const server: Tag[] = [
    { name: 'Fussy', color: '#f80' },
    { name: 'Sleepy', color: '#08f' },
    { name: 'left' }, // a structural marker that leaked into the server list
  ];

  it('unions server tags with entry-only tags and drops HIDDEN_TAGS', () => {
    const out = visibleTags(server, ['Cluster', 'right']);
    expect(out.map((t) => t.name)).toEqual(['Fussy', 'Sleepy', 'Cluster']);
    // structural 'left' (server) and 'right' (selected) never surface
    expect(out.map((t) => t.name)).not.toContain('left');
    expect(out.map((t) => t.name)).not.toContain('right');
  });

  it('carries the server color through and leaves entry-only tags colorless', () => {
    const out = visibleTags(server, ['Cluster']);
    expect(out.find((t) => t.name === 'Fussy')?.color).toBe('#f80');
    expect(out.find((t) => t.name === 'Cluster')?.color).toBeUndefined();
  });

  it('does not duplicate a selected tag that is already a server tag', () => {
    const out = visibleTags(server, ['Fussy']);
    expect(out.filter((t) => t.name === 'Fussy')).toHaveLength(1);
  });

  it('a breastfeeding "both" entry folds left/right into tags, but they never show as chips', () => {
    s().openSheet('feeding');
    s().setTE({ feedType: 'breast', method: 'both', startSide: 'left' });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'feeding' }>;
    expect(e.tags).toContain('left'); // structural side marker survives on the entry
    const chips = visibleTags(server, e.tags).map((t) => t.name);
    expect(chips).not.toContain('left');
    expect(chips).not.toContain('right');
  });
});
