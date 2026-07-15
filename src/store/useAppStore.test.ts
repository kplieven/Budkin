import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeQueuedEntries, mergeUnsynced, useAppStore, visibleTags } from '@/store/useAppStore';
import { isActive, selectPendingCount, teDurationMin, teEnd, teStart } from '@/store/selectors';
import { ApiError } from '@/api/client';
import { DEMO_TAGS } from '@/data/seed';
import { loadConnection, saveConnection } from '@/data/storage';
import {
  loadFromServer,
  loadInsightsHistory,
  loadProfileFromServer,
  loadTagsFromServer,
  serverHasData,
  updateChildOnServer,
} from '@/data/repository';
import { matchServerChild, uploadUnsynced } from '@/data/sync';
import { savePrefs } from '@/data/prefs';
import { saveTimers } from '@/data/timers';
import {
  clearEntities,
  loadEntities,
  saveChildren,
} from '@/data/entityStore';
import { clearPendingOps } from '@/data/pendingOps';
import { clearAdoptTarget, loadAdoptTarget, saveAdoptTarget } from '@/data/adoptTarget';
import { fmtClock } from '@/lib/format';
import type { Child, Entry, Measurement, MilestoneEntry, Profile, Tag, Timer } from '@/types/models';

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
  pendingOps: [] as unknown[],
  adoptTarget: null as string | null,
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

// The durable entity store (children/entries/measurements/selectedChild/lastFeed).
// Defaults to "nothing persisted yet" (null); individual tests override via
// mockResolvedValueOnce to simulate a restart with saved data.
vi.mock('@/data/entityStore', () => ({
  loadEntities: vi.fn(async () => null),
  saveChildren: vi.fn(async () => {}),
  saveEntries: vi.fn(async () => {}),
  saveMeasurements: vi.fn(async () => {}),
  saveSelectedChildId: vi.fn(async () => {}),
  saveLastFeed: vi.fn(async () => {}),
  clearEntities: vi.fn(async () => {}),
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
  serverHasData: vi.fn(async () => false),
}));

// `@/data/sync`'s real uploader/matcher (Unit J's primitives, from an earlier
// unit on this branch). Default `uploadUnsynced` is a pure passthrough (no
// stamping) so it's a no-op for every OTHER test in this file that
// incidentally triggers `flushUnsynced` via connect/hydrate/refresh/etc (the
// default seeded child has no serverId, so `flushUnsynced`'s `hasUnsynced`
// check is true almost everywhere) — only the `adopt`/`flushUnsynced`
// describe blocks below override this to actually stamp serverIds.
vi.mock('@/data/sync', () => ({
  uploadUnsynced: vi.fn(async (state: { children: unknown[]; entries: unknown[]; measurements: unknown[] }) => ({
    children: state.children,
    entries: state.entries,
    measurements: state.measurements,
  })),
  matchServerChild: vi.fn(() => null),
}));

// The offline op-log (Unit D). Tests assert against `h.pendingOps` directly
// (mirroring how `h.pushed`/`h.updated`/etc. track the repository mocks above)
// rather than asserting on the mock functions themselves.
vi.mock('@/data/pendingOps', () => ({
  addPendingOp: vi.fn(async (op: unknown) => {
    h.pendingOps.push(op);
    return h.pendingOps;
  }),
  loadPendingOps: vi.fn(async () => h.pendingOps),
  savePendingOps: vi.fn(async (ops: unknown[]) => {
    h.pendingOps = ops;
  }),
  clearPendingOps: vi.fn(async () => {
    h.pendingOps = [];
  }),
}));

// The persisted adopt target (Finding 2): backs the server-switch reset in
// `adopt` so it survives an app kill between an abandoned `partial` adoption
// and a later retry/switch — mirrors the AsyncStorage-backed mocks above.
vi.mock('@/data/adoptTarget', () => ({
  loadAdoptTarget: vi.fn(async () => h.adoptTarget),
  saveAdoptTarget: vi.fn(async (url: string) => {
    h.adoptTarget = url;
  }),
  clearAdoptTarget: vi.fn(async () => {
    h.adoptTarget = null;
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
  h.pendingOps = [];
  h.adoptTarget = null;
  h.pushFails = false;
  h.profile = { username: 'alex', timezone: 'UTC', language: 'en', dashboardRefreshRate: undefined };
  h.profileFails = false;
  h.tags = [{ name: 'Fussy', color: '#f80' }, { name: 'Sleepy' }];
  h.tagsFails = false;
  h.prefs = {};
  vi.mocked(loadProfileFromServer).mockClear();
  vi.mocked(loadTagsFromServer).mockClear();
  vi.mocked(savePrefs).mockClear();
  vi.mocked(loadEntities).mockClear();
  vi.mocked(loadEntities).mockResolvedValue(null);
  vi.mocked(saveChildren).mockClear();
  vi.mocked(clearEntities).mockClear();
  vi.mocked(clearPendingOps).mockClear();
  vi.mocked(loadAdoptTarget).mockClear();
  vi.mocked(saveAdoptTarget).mockClear();
  vi.mocked(clearAdoptTarget).mockClear();
  useAppStore.setState({
    connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
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
    milestoneSheet: null,
    showChildSwitcher: false,
    childSheet: false,
    editingChildId: null,
    adoptSheet: false,
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

describe('flushPendingOps', () => {
  const child: Child = { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW, color: '#fff' };
  const measurement: Measurement = { id: 'weight-1', serverId: 1, childId: 'c1', kind: 'weight', value: 6, date: NOW };
  const entry: Entry = {
    id: 'feeding-1',
    serverId: 1,
    childId: 'c1',
    type: 'feeding',
    start: NOW - 30 * M,
    end: NOW - 10 * M,
    feedType: 'breast',
    method: 'left',
    amount: null,
    tags: [],
  };

  it('replays an update/child op to updateChildOnServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'update', entity: 'child', payload: child }];
    await s().flushPendingOps();
    expect(h.childUpdated).toEqual([child]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('replays an update/measurement op to updateMeasurementOnServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'update', entity: 'measurement', payload: measurement }];
    await s().flushPendingOps();
    expect(h.measUpdated).toEqual([measurement]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('replays an update/entry op to updateEntryOnServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'update', entity: 'entry', payload: entry }];
    await s().flushPendingOps();
    expect(h.updated).toEqual([entry]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('replays a delete/measurement op to deleteMeasurementFromServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'delete', entity: 'measurement', kind: 'weight', serverId: 1 }];
    await s().flushPendingOps();
    expect(h.measDeleted).toEqual([{ kind: 'weight', id: 1 }]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('replays a delete/entry op to deleteEntryFromServer and clears it on success', async () => {
    h.pendingOps = [{ op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 }];
    await s().flushPendingOps();
    expect(h.deleted).toEqual([{ type: 'feeding', id: 1 }]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('retains an op that fails to replay, leaving successful ones cleared', async () => {
    vi.mocked(updateChildOnServer).mockRejectedValueOnce(new Error('net'));
    h.pendingOps = [
      { op: 'update', entity: 'child', payload: child },
      { op: 'update', entity: 'measurement', payload: measurement },
    ];
    await s().flushPendingOps();
    expect(h.measUpdated).toEqual([measurement]); // the other op still replayed
    expect(h.pendingOps).toEqual([{ op: 'update', entity: 'child', payload: child }]); // failed op retained
  });

  it('is a no-op while offline', async () => {
    useAppStore.setState({ offline: true });
    h.pendingOps = [{ op: 'delete', entity: 'measurement', kind: 'weight', serverId: 1 }];
    await s().flushPendingOps();
    expect(h.measDeleted).toHaveLength(0);
    expect(h.pendingOps).toHaveLength(1);
  });

  it('is a no-op in demo mode', async () => {
    useAppStore.setState({ connection: { mode: 'local' } });
    h.pendingOps = [{ op: 'delete', entity: 'measurement', kind: 'weight', serverId: 1 }];
    await s().flushPendingOps();
    expect(h.measDeleted).toHaveLength(0);
    expect(h.pendingOps).toHaveLength(1);
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

describe('timer childId attribution', () => {
  it('stamps childId on a quick-started timer and commits the stop to that child', () => {
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [
        { id: 'c1', first: 'A', last: '', birth: 0, color: '#fff' },
        { id: 'c2', first: 'B', last: '', birth: 0, color: '#fff' },
      ],
      selectedChildId: 'c1',
      timers: [],
      entries: [],
    });
    s().startQuickTimer();
    const timer = s().timers[0];
    expect(timer.childId).toBe('c1');

    // switch child, then stop: the entry must go to the timer's child
    useAppStore.setState({ selectedChildId: 'c2' });
    s().stopTimer(timer.id);
    expect(s().entries[0].childId).toBe('c1');
  });
});

describe('timer persistence across restarts', () => {
  const savedTimer = (id: string): Timer => ({ id, activity: 'sleep', name: 'Sleep', start: NOW - 5 * M, saveAs: 'sleep' });

  it('restores persisted timers on hydrate (real connection)', async () => {
    const saved = [savedTimer('t9')];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    await s().hydrate();
    expect(s().timers).toEqual(saved);
  });

  it('restores persisted timers when the server is unreachable at launch', async () => {
    const saved = [savedTimer('t8')];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await s().hydrate();
    expect(s().offline).toBe(true);
    expect(s().timers).toEqual(saved);
  });

  it('prefers persisted timers over the demo seed', async () => {
    const saved = [savedTimer('tD')];
    h.timers = saved;
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
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

describe('mergeUnsynced', () => {
  const mkChild = (id: string, serverId?: number): Child => ({
    id,
    serverId,
    first: 'A',
    last: '',
    birth: NOW,
    color: '#fff',
  });

  it('prepends a serverId==null local not present in the server list', () => {
    const merged = mergeUnsynced([mkChild('s1', 1)], [mkChild('local1')]);
    expect(merged.map((c) => c.id)).toEqual(['local1', 's1']);
  });

  it('excludes a local that has a serverId', () => {
    const merged = mergeUnsynced([mkChild('s1', 1)], [mkChild('local1', 2)]);
    expect(merged.map((c) => c.id)).toEqual(['s1']);
  });

  it('excludes a local whose id is already in the server list (belt-and-suspenders)', () => {
    const merged = mergeUnsynced([mkChild('dup', 1)], [mkChild('dup')]);
    expect(merged.map((c) => c.id)).toEqual(['dup']);
  });

  it('returns just the server list when nothing is unsynced', () => {
    expect(mergeUnsynced([mkChild('s1', 1)], [])).toEqual([mkChild('s1', 1)]);
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
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
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
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadFromServer).mockRejectedValueOnce(new Error('network'));
    await s().hydrate();
    expect(s().offline).toBe(true);
    expect(s().entries).toEqual([queuedEntry('e2')]);
    expect(s().queueCount).toBe(1);
  });

  it('does not duplicate the entry after it flushes and a later refresh returns the server copy', async () => {
    h.q = [queuedEntry('e3')];
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
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

describe('offline-created children/measurements survive a cold hydrate (server mode)', () => {
  const mira = { id: 'c1', first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' };

  it('recovers a persisted serverId==null child from loadEntities when the server reload omits it', async () => {
    const localChild: Child = { id: 'localY', first: 'Persisted', last: 'Local', birth: NOW, color: '#abc' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [localChild],
      entries: [],
      measurements: [],
      selectedChildId: 'localY',
      lastFeed: { feedType: 'breast', method: 'left' },
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    await s().hydrate();
    expect(s().children.map((c) => c.id)).toEqual(['localY', 'c1']);
  });

  it('recovers a persisted serverId==null measurement from loadEntities when the server reload omits it', async () => {
    const localMeasurement: Measurement = { id: 'localN', childId: 'c1', kind: 'height', value: 60, date: NOW };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [mira],
      entries: [],
      measurements: [localMeasurement],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    await s().hydrate();
    expect(s().measurements.map((m) => m.id)).toEqual(['localN']);
  });

  // Scope guard: entries must keep using the queue-only merge
  // (mergeQueuedEntries), NOT mergeUnsynced — a serverId==null entry that was
  // persisted but never queued (e.g. it already flushed) must NOT reappear via
  // loadEntities, or a flushed entry would show up twice (brief's scope note).
  it('does NOT merge a persisted serverId==null entry that is not in the queue', async () => {
    const persistedEntry: Entry = {
      id: 'persisted-e',
      childId: 'c1',
      type: 'diaper',
      time: NOW,
      wet: true,
      solid: false,
      color: null,
      tags: [],
    };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [],
      entries: [persistedEntry],
      measurements: [],
      selectedChildId: '',
      lastFeed: { feedType: 'breast', method: 'left' },
    });
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [mira],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    await s().hydrate();
    expect(s().entries.map((e) => e.id)).not.toContain('persisted-e');
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

  it('offline edit of a synced entry records an update pending op instead of pushing', async () => {
    seedFeeding();
    useAppStore.setState({ offline: true });
    s().openEdit('feeding-1');
    s().setTE({ method: 'right' });
    s().save();
    await flush();
    expect(h.updated).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toHaveLength(1);
    expect(h.pendingOps[0]).toMatchObject({ op: 'update', entity: 'entry' });
    expect((h.pendingOps[0] as { payload: Entry }).payload.id).toBe('feeding-1');
  });

  it('online edit of a synced entry does NOT record a pending op', async () => {
    seedFeeding();
    s().openEdit('feeding-1');
    s().setTE({ method: 'right' });
    s().save();
    await flush();
    expect(h.updated).toHaveLength(1);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('offline delete of a synced entry records a delete pending op and still removes locally', async () => {
    seedFeeding();
    useAppStore.setState({ offline: true });
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0); // still removed locally
    await flush();
    expect(h.deleted).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toEqual([{ op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 }]);
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

  it('undoDelete cancels the queued offline pending-delete op so it does not replay on reconnect', async () => {
    seedFeeding();
    useAppStore.setState({ offline: true });
    s().deleteEntry('feeding-1');
    expect(s().entries).toHaveLength(0);
    await flush();
    expect(h.pendingOps).toEqual([{ op: 'delete', entity: 'entry', entryType: 'feeding', serverId: 1 }]);

    s().undoDelete();
    expect(s().entries).toHaveLength(1);
    await flush();
    // The queued delete op must be removed, or a later flushPendingOps would
    // delete the just-restored entry from the server anyway.
    expect(h.pendingOps).toHaveLength(0);
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

  it('offline edit of a synced measurement records an update pending op instead of pushing', async () => {
    useAppStore.setState({
      offline: true,
      measurements: [{ id: 'weight-1', serverId: 1, childId: 'c1', kind: 'weight', value: 5.0, date: NOW }],
    });
    s().openEditMeasurement('weight-1');
    s().saveMeasurement(6.0, NOW);
    await flush();
    expect(h.measUpdated).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toHaveLength(1);
    expect(h.pendingOps[0]).toMatchObject({ op: 'update', entity: 'measurement' });
    expect((h.pendingOps[0] as { payload: Measurement }).payload.id).toBe('weight-1');
  });

  it('offline delete of a synced measurement records a delete pending op and still removes locally', async () => {
    useAppStore.setState({
      offline: true,
      measurements: [{ id: 'weight-1', serverId: 1, childId: 'c1', kind: 'weight', value: 5.0, date: NOW }],
    });
    s().deleteMeasurement('weight-1');
    expect(s().measurements).toHaveLength(0); // still removed locally
    await flush();
    expect(h.measDeleted).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toEqual([{ op: 'delete', entity: 'measurement', kind: 'weight', serverId: 1 }]);
  });
});

describe('milestone sheet', () => {
  it('openMilestone opens the sheet in log mode for a catalog key', () => {
    s().openMilestone('lifts-head');
    expect(s().milestoneSheet).toEqual({ mode: 'log', key: 'lifts-head' });
  });

  it('openEditMilestone opens the sheet in edit mode for a logged milestone entry', () => {
    useAppStore.setState({
      entries: [{ id: 'm1', childId: 'c1', type: 'milestone', key: 'lifts-head', time: NOW, text: 'Lifts head', tags: [] }],
    });
    s().openEditMilestone('m1');
    expect(s().milestoneSheet).toEqual({ mode: 'edit', id: 'm1' });
  });

  it('openEditMilestone ignores a missing or non-milestone entry', () => {
    s().openEditMilestone('nope');
    expect(s().milestoneSheet).toBeNull();
  });

  it('closeMilestoneSheet clears the sheet', () => {
    s().openMilestone('lifts-head');
    s().closeMilestoneSheet();
    expect(s().milestoneSheet).toBeNull();
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
    // serverId is stamped too (like entries/measurements) so server-child ops
    // (update / delete / sync) recognise it before the next refresh.
    expect(s().children[1].serverId).toBe(777);
  });

  it('a child created online can immediately be deleted on the server (no resurrection)', async () => {
    // Regression: saveChild must stamp serverId on create, else deleteChild
    // (which gates the server DELETE on serverId != null) would only remove the
    // child locally and it would reappear on the next refresh.
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW });
    await flush();
    const created = s().children[1];
    expect(created.serverId).toBe(777);

    h.childDeleted = [];
    s().deleteChild(created.id);
    expect(h.childDeleted).toEqual([777]); // server DELETE fired with the stamped serverId
    expect(s().children.find((c) => c.id === created.id)).toBeUndefined();
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

  it('offline edit of a synced child records an update pending op instead of pushing', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
    });
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });

    expect(s().children[0].last).toBe('Updated'); // still applied locally
    await flush();
    expect(h.childUpdated).toHaveLength(0); // no direct server call while offline
    expect(h.pendingOps).toHaveLength(1);
    expect(h.pendingOps[0]).toMatchObject({ op: 'update', entity: 'child' });
    expect((h.pendingOps[0] as { payload: Child }).payload.id).toBe('c1');
  });

  it('online edit of a synced child does NOT record a pending op', async () => {
    useAppStore.setState({
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
    });
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });
    await flush();
    expect(h.childUpdated).toHaveLength(1);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('offline edit of a NOT-yet-synced child (no serverId) records no pending op (its create is still pending)', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'localOnly', first: 'Mira', last: 'O', birth: NOW - 90 * 86400000, color: '#fff' }],
    });
    s().openEditChild('localOnly');
    s().saveChild({ first: 'Mira', last: 'Updated', birth: NOW - 100 * 86400000 });
    await flush();
    expect(h.pendingOps).toHaveLength(0);
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
    useAppStore.setState({ connection: { mode: 'local' } });
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
  // A server-backed child in the new model carries a numeric `serverId` (the
  // stable local `id` is server-independent). Mirror that: `serverId = Number(id)`.
  const serverChild = (id: string, first: string) => ({
    id,
    serverId: Number(id),
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
    // the seeded child 'c1' has no serverId => local-only
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

  it('local mode: deletes in memory only, no server call', async () => {
    useAppStore.setState({
      connection: { mode: 'local' },
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

describe('adopt sheet open/close (mirrors openAddChild/closeChildSheet)', () => {
  it('openAdopt opens the sheet', () => {
    expect(s().adoptSheet).toBe(false);
    s().openAdopt();
    expect(s().adoptSheet).toBe(true);
  });

  it('closeAdopt closes the sheet', () => {
    s().openAdopt();
    expect(s().adoptSheet).toBe(true);
    s().closeAdopt();
    expect(s().adoptSheet).toBe(false);
  });
});

describe('local mode: durable entityStore (empty start, no fake seed)', () => {
  it('enterLocal sets connection to local mode, connects, and persists it — without seeding fake children', async () => {
    useAppStore.setState({ connection: null, connected: false, children: [], entries: [] });
    vi.mocked(loadEntities).mockResolvedValueOnce(null);
    await s().enterLocal();
    expect(s().connection).toEqual({ mode: 'local' });
    expect(s().connected).toBe(true);
    expect(s().children).toEqual([]); // no demo seed
    expect(s().entries).toEqual([]);
    expect(saveConnection).toHaveBeenCalledWith({ mode: 'local' });
  });

  it('enterLocal loads persisted entities when a prior local session left some', async () => {
    const savedChild = { id: 'p1', first: 'Persisted', last: '', birth: NOW, color: '#000' };
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [savedChild],
      entries: [],
      measurements: [],
      selectedChildId: 'p1',
      lastFeed: { feedType: 'formula', method: 'bottle' },
    });
    await s().enterLocal();
    expect(s().children).toEqual([savedChild]); // restored, not the demo seed
    expect(s().selectedChildId).toBe('p1');
    expect(s().lastFeed).toEqual({ feedType: 'formula', method: 'bottle' });
  });

  it('local hydrate loads persisted entities instead of seeding fake ones', async () => {
    const savedChild = { id: 'h1', first: 'Hydrated', last: '', birth: NOW, color: '#000' };
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [savedChild],
      entries: [],
      measurements: [],
      selectedChildId: 'h1',
      lastFeed: { feedType: 'breast', method: 'left' },
    });
    await s().hydrate();
    expect(s().connected).toBe(true);
    expect(s().children).toEqual([savedChild]);
    expect(s().selectedChildId).toBe('h1');
  });

  it('local hydrate starts empty when nothing was ever persisted', async () => {
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    vi.mocked(loadEntities).mockResolvedValueOnce(null);
    await s().hydrate();
    expect(s().children).toEqual([]);
    expect(s().entries).toEqual([]);
    expect(s().measurements).toEqual([]);
    expect(s().selectedChildId).toBe('');
  });

  it('the entity subscribe persists children on change (mirrors the timers subscribe)', () => {
    vi.mocked(saveChildren).mockClear();
    useAppStore.setState((st) => ({ children: [...st.children, { id: 'newc', first: 'New', last: '', birth: NOW, color: '#111' }] }));
    expect(saveChildren).toHaveBeenCalledWith(s().children);
  });

  it('disconnect clears the durable entity store', () => {
    s().disconnect();
    expect(clearEntities).toHaveBeenCalled();
  });

  // Finding 1 (merge blocker): without this, offline edit/delete ops queued
  // against one server's serverIds would survive a disconnect and replay
  // against whatever record holds those numeric ids on the NEXT server.
  it('disconnect clears pendingOps so a stale op cannot replay against a different server', () => {
    s().disconnect();
    expect(clearPendingOps).toHaveBeenCalled();
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
    useAppStore.setState({ connection: { mode: 'local' }, offline: false });
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
    useAppStore.setState({ connection: { mode: 'server', serverUrl: 'http://x', token: 't2' } });
    await s().loadProfile();
    expect(loadProfileFromServer).toHaveBeenCalled();
    expect(s().profileLoaded).toBe(true);
  });

  it('keeps selectedChildId pointing at an offline-created child still visible after refresh (regression)', async () => {
    // Bug: refresh() used to check the server's child list only, so an
    // offline-created child (kept visible via mergeUnsynced) that's currently
    // selected would get silently deselected back to the server's first child.
    const localChild: Child = { id: 'localZ', first: 'Off', last: 'line', birth: NOW, color: '#abc' };
    useAppStore.setState({ children: [...s().children, localChild], selectedChildId: 'localZ' });
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    await s().refresh();
    expect(s().selectedChildId).toBe('localZ'); // not reset to the server's first child
    expect(s().children.map((c) => c.id)).toContain('localZ');
  });

  it('keeps an in-memory serverId==null child (created offline) across a refresh whose server data omits it', async () => {
    const localChild: Child = { id: 'localX', first: 'Off', last: 'line', birth: NOW, color: '#abc' };
    useAppStore.setState({ children: [...s().children, localChild] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    await s().refresh();
    expect(s().children.map((c) => c.id)).toEqual(['localX', 'c1']);
  });

  it('keeps an in-memory serverId==null measurement (created offline) across a refresh whose server data omits it', async () => {
    const localMeasurement: Measurement = { id: 'localM', childId: 'c1', kind: 'weight', value: 4.2, date: NOW };
    useAppStore.setState({ measurements: [localMeasurement] });
    vi.mocked(loadFromServer).mockResolvedValueOnce({
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      entries: [],
      timers: [],
      selectedChildId: 'c1',
      lastFeed: { feedType: 'breast', method: 'left' },
      measurements: [],
    });
    await s().refresh();
    expect(s().measurements.map((m) => m.id)).toEqual(['localM']);
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
  it('saves a solid diaper amount (Medium = 2)', () => {
    s().openSheet('diaper');
    s().setTE({ solid: true, amount: 2 });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'diaper' }>;
    expect(e.amount).toBe(2);
  });

  it('drops the amount when the diaper is not solid (wet only)', () => {
    s().openSheet('diaper');
    s().setTE({ wet: true, solid: false, amount: 2 });
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'diaper' }>;
    expect(e.amount).toBeNull();
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
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'server', serverUrl: 'http://x', token: 't' });
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
      connection: { mode: 'local' } as any,
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
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockResolvedValueOnce([
      { id: 'r1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any,
    ]);
    await useAppStore.getState().loadInsights();
    expect(loadInsightsHistory).toHaveBeenCalledWith(
      { mode: 'server', serverUrl: 'x', token: 'y' },
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
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
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
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
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
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    useAppStore.setState({ themeMode: 'dark' });
    await s().hydrate();
    expect(s().themeMode).toBe('light');
  });
});

describe('unit-system persistence', () => {
  it('setUnitSystem updates state and persists via savePrefs', () => {
    useAppStore.setState({ unitSystem: 'metric' });
    s().setUnitSystem('imperial');
    expect(s().unitSystem).toBe('imperial');
    expect(savePrefs).toHaveBeenCalledWith({ unitSystem: 'imperial' });
  });

  it('toggleUnitSystem flips metric <-> imperial and persists each direction', () => {
    useAppStore.setState({ unitSystem: 'metric' });
    s().toggleUnitSystem();
    expect(s().unitSystem).toBe('imperial');
    expect(savePrefs).toHaveBeenCalledWith({ unitSystem: 'imperial' });
    s().toggleUnitSystem();
    expect(s().unitSystem).toBe('metric');
    expect(savePrefs).toHaveBeenCalledWith({ unitSystem: 'metric' });
  });

  it('hydrate applies a persisted unitSystem', async () => {
    h.prefs = { unitSystem: 'imperial' };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ unitSystem: 'metric' });
    await s().hydrate();
    expect(s().unitSystem).toBe('imperial');
  });

  it('hydrate leaves unitSystem at its default when nothing was persisted', async () => {
    h.prefs = {};
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ unitSystem: 'metric' });
    await s().hydrate();
    expect(s().unitSystem).toBe('metric');
  });
});

describe('loadProfile (lazy fetch of read-only Baby Buddy server settings)', () => {
  it('demo mode: profile stays null, marked loaded, no fetch', async () => {
    useAppStore.setState({ connection: { mode: 'local' } });
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

  it('drops a stale result if the session changed while /api/profile/ was in flight', async () => {
    let resolve!: (v: Profile | null) => void;
    vi.mocked(loadProfileFromServer).mockImplementationOnce(
      () => new Promise<Profile | null>((r) => { resolve = r; }),
    );
    const p = s().loadProfile();
    // session switches to a different server mid-fetch (as a reset would)
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'https://b', token: 'b' },
      profile: null,
      profileLoaded: false,
    });
    resolve({ username: 'server-a-user' });
    await p;
    // server A's profile must NOT repopulate server B's settings
    expect(s().profile).toBeNull();
    expect(s().profileLoaded).toBe(false);
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

  it('local mode: seeds the fallback tag list without hitting the server', async () => {
    useAppStore.setState({ connection: { mode: 'local' } });
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
      connection: { mode: 'server', serverUrl: 'https://b', token: 'b' },
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

describe('adopt (push a local-mode user\'s data up to a Baby Buddy server)', () => {
  beforeEach(() => {
    useAppStore.setState({ connection: { mode: 'local' }, connected: true });
    vi.mocked(serverHasData).mockClear();
    vi.mocked(uploadUnsynced).mockClear();
    vi.mocked(matchServerChild).mockClear();
    vi.mocked(loadFromServer).mockClear();
    vi.mocked(saveConnection).mockClear();
    vi.mocked(serverHasData).mockResolvedValue(false);
    vi.mocked(matchServerChild).mockReturnValue(null);
    // Full-success stamping default for this block: any serverId==null record
    // gets stamped, mirroring uploadUnsynced's real "everything pushed"
    // outcome. Individual tests override with mockImplementationOnce for the
    // partial-upload / server-switch scenarios.
    vi.mocked(uploadUnsynced).mockImplementation(async (state) => ({
      children: state.children.map((c) => (c.serverId == null ? { ...c, serverId: 501 } : c)),
      entries: state.entries.map((e) => (e.serverId == null ? { ...e, serverId: 601 } : e)),
      measurements: state.measurements.map((m) => (m.serverId == null ? { ...m, serverId: 701 } : m)),
    }));
  });

  it('against an empty server: uploads the local data and switches to server mode', async () => {
    const localChild: Child = { id: 'localA', first: 'Ann', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'done' });
    expect(serverHasData).toHaveBeenCalledWith({ mode: 'server', serverUrl: 'https://new.lan', token: 'tok' });
    const uploaded = vi.mocked(uploadUnsynced).mock.calls[0][0];
    expect(uploaded.children).toEqual([localChild]); // the not-yet-synced local child was uploaded
    expect(s().connection).toEqual({ mode: 'server', serverUrl: 'https://new.lan', token: 'tok' });
    expect(s().connected).toBe(true);
    expect(loadFromServer).toHaveBeenCalledWith({ mode: 'server', serverUrl: 'https://new.lan', token: 'tok' });
    expect(saveConnection).toHaveBeenCalledWith({ mode: 'server', serverUrl: 'https://new.lan', token: 'tok' });
    // Full success clears the persisted adopt target (Finding 2) — a later
    // adopt against a different server has nothing stale to reset.
    expect(clearAdoptTarget).toHaveBeenCalled();
  });

  it('on success, upserts the adopted server into savedServers (so it appears in the reconnect list)', async () => {
    useAppStore.setState({ savedServers: [] });
    h.servers = [];

    const result = await s().adopt('https://adopted.lan', 'tok');

    expect(result).toEqual({ status: 'done' });
    expect(s().savedServers.map((x) => x.serverUrl)).toContain('https://adopted.lan');
    expect(h.servers).toHaveLength(1); // persisted, mirroring connect()
  });

  it('does NOT upsert savedServers on a guard/partial/error outcome (only on done)', async () => {
    useAppStore.setState({ savedServers: [] });
    h.servers = [];
    vi.mocked(serverHasData).mockResolvedValueOnce(true);

    const result = await s().adopt('https://guarded.lan', 'tok');

    expect(result).toEqual({ status: 'guard' });
    expect(s().savedServers).toEqual([]);
    expect(h.servers).toEqual([]);
  });

  it('against a non-empty server without override: guards instead of uploading, stays local', async () => {
    vi.mocked(serverHasData).mockResolvedValueOnce(true);

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'guard' });
    expect(uploadUnsynced).not.toHaveBeenCalled();
    expect(s().connection).toEqual({ mode: 'local' });
    expect(s().connected).toBe(true);
  });

  it('non-empty WITH uploadAnyway: dedups against a matching server child, then uploads', async () => {
    const localChild: Child = { id: 'localB', first: 'Ben', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });
    vi.mocked(serverHasData).mockResolvedValueOnce(true);
    const serverChild: Child = { id: '900', serverId: 900, first: 'Ben', last: '', birth: NOW, color: '#eee' };
    vi.mocked(loadFromServer)
      .mockResolvedValueOnce({ // the dedup fetch
        children: [serverChild], entries: [], timers: [], selectedChildId: '900',
        lastFeed: { feedType: 'breast', method: 'left' }, measurements: [],
      })
      .mockResolvedValueOnce({ // the post-success reload
        children: [serverChild], entries: [], timers: [], selectedChildId: '900',
        lastFeed: { feedType: 'breast', method: 'left' }, measurements: [],
      });
    vi.mocked(matchServerChild).mockReturnValueOnce(900);

    const result = await s().adopt('https://new.lan', 'tok', { uploadAnyway: true });

    expect(matchServerChild).toHaveBeenCalledWith(localChild, [serverChild]);
    // Attached to the existing server child (not duplicated) BEFORE uploading
    // — uploadUnsynced then sees serverId already set and skips it.
    const uploaded = vi.mocked(uploadUnsynced).mock.calls[0][0];
    expect(uploaded.children.find((c) => c.id === 'localB')?.serverId).toBe(900);
    expect(result).toEqual({ status: 'done' });
  });

  it('when uploadUnsynced leaves a record serverId==null: returns partial, stays local', async () => {
    const localChild: Child = { id: 'localC', first: 'Cara', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children, // unchanged: the push never completed
      entries: state.entries,
      measurements: state.measurements,
    }));

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'partial' });
    expect(s().connection).toEqual({ mode: 'local' });
    expect(s().children.find((c) => c.id === 'localC')?.serverId).toBeUndefined();
  });

  it('when serverHasData throws: returns error, stays local', async () => {
    vi.mocked(serverHasData).mockRejectedValueOnce(new Error('bad token'));

    const result = await s().adopt('https://new.lan', 'tok');

    expect(result).toEqual({ status: 'error', message: 'bad token' });
    expect(s().connection).toEqual({ mode: 'local' });
    expect(uploadUnsynced).not.toHaveBeenCalled();
  });

  it('server-switch reset: adopting a DIFFERENT server clears serverIds stamped by an abandoned adoption (persists across a simulated app restart)', async () => {
    const childA: Child = { id: 'localD', first: 'Dee', last: '', birth: NOW, color: '#fff' };
    const childB: Child = { id: 'localE', first: 'Eve', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [childA, childB] });
    // Server A: only childA's push succeeds -> the overall result is
    // `partial`, so the persisted adopt target stays pointed at server A (an
    // "abandoned" adoption in local mode).
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children.map((c) => (c.id === 'localD' ? { ...c, serverId: 111 } : c)),
      entries: state.entries,
      measurements: state.measurements,
    }));

    const first = await s().adopt('https://server-a.lan', 'tok');
    expect(first).toEqual({ status: 'partial' });
    expect(s().children.find((c) => c.id === 'localD')?.serverId).toBe(111);

    // Simulate the app being killed and relaunched between the abandoned
    // attempt and this retry: the ONLY thing carrying the prior target
    // forward is durable storage (there is no module-memory fallback left),
    // so stub `loadAdoptTarget` directly rather than relying on the previous
    // call's `saveAdoptTarget` having landed in the same in-memory mock.
    vi.mocked(loadAdoptTarget).mockResolvedValueOnce('https://server-a.lan');

    // Adopting a DIFFERENT server must clear the stale serverId from A BEFORE
    // uploading, or childA would be wrongly skipped as "already synced" (to
    // the wrong server).
    await s().adopt('https://server-b.lan', 'tok');
    const secondUpload = vi.mocked(uploadUnsynced).mock.calls[1][0];
    expect(secondUpload.children.every((c) => c.serverId == null)).toBe(true);
  });

  it('server-switch reset fires purely off a persisted target (loadAdoptTarget -> "A"), even with no prior adopt() call in this session', async () => {
    const stamped: Child = { id: 'localZ', serverId: 111, first: 'Zed', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [stamped] });
    vi.mocked(loadAdoptTarget).mockResolvedValueOnce('https://server-a.lan');

    await s().adopt('https://server-b.lan', 'tok');

    const uploaded = vi.mocked(uploadUnsynced).mock.calls[0][0];
    expect(uploaded.children.find((c) => c.id === 'localZ')?.serverId).toBeUndefined();
  });
});

describe('flushUnsynced (reconnect flush of offline-created children/measurements)', () => {
  beforeEach(() => {
    vi.mocked(uploadUnsynced).mockClear();
    vi.mocked(uploadUnsynced).mockImplementation(async (state) => ({
      children: state.children.map((c) => (c.serverId == null ? { ...c, serverId: 501 } : c)),
      entries: state.entries,
      measurements: state.measurements.map((m) => (m.serverId == null ? { ...m, serverId: 701 } : m)),
    }));
  });

  it('stamps a serverId==null child while online in server mode', async () => {
    const localChild: Child = { id: 'localF', first: 'Finn', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });

    await s().flushUnsynced();

    expect(uploadUnsynced).toHaveBeenCalled();
    // entries: [] passed through untouched — this path never touches entries
    // (they still flow through queue.ts's flushQueue).
    expect(vi.mocked(uploadUnsynced).mock.calls[0][0].entries).toEqual([]);
    expect(s().children.find((c) => c.id === 'localF')?.serverId).toBe(501);
  });

  it('stamps a serverId==null measurement', async () => {
    useAppStore.setState({
      children: [{ id: 'c1', serverId: 42, first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      measurements: [{ id: 'localG', childId: 'c1', kind: 'weight', value: 5, date: NOW }],
    });

    await s().flushUnsynced();

    expect(s().measurements.find((m) => m.id === 'localG')?.serverId).toBe(701);
  });

  it('is a no-op while offline', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'localH', first: 'H', last: '', birth: NOW, color: '#fff' }],
    });

    await s().flushUnsynced();

    expect(uploadUnsynced).not.toHaveBeenCalled();
  });

  it('is a no-op in local mode', async () => {
    useAppStore.setState({
      connection: { mode: 'local' },
      children: [{ id: 'localI', first: 'I', last: '', birth: NOW, color: '#fff' }],
    });

    await s().flushUnsynced();

    expect(uploadUnsynced).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is unsynced', async () => {
    useAppStore.setState({
      children: [{ id: 'c1', serverId: 42, first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      measurements: [],
    });

    await s().flushUnsynced();

    expect(uploadUnsynced).not.toHaveBeenCalled();
  });

  // Finding 3: two concurrent reconnect triggers (e.g. setNetworkOnline(true)
  // + a foreground refresh()) both calling flushUnsynced must not both POST
  // the same serverId==null child — that would duplicate it on the server.
  it('guards against overlapping flushes: a second call while one is in flight is a no-op', async () => {
    const localChild: Child = { id: 'localJ', first: 'J', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });
    let resolveUpload!: (v: { children: Child[]; entries: Entry[]; measurements: Measurement[] }) => void;
    vi.mocked(uploadUnsynced).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );

    const first = s().flushUnsynced();
    const second = s().flushUnsynced(); // fires while `first` is still awaiting uploadUnsynced

    expect(uploadUnsynced).toHaveBeenCalledTimes(1);
    resolveUpload({ children: [{ ...localChild, serverId: 501 }], entries: [], measurements: [] });
    await first;
    await second;

    expect(uploadUnsynced).toHaveBeenCalledTimes(1);
    expect(s().children.find((c) => c.id === 'localJ')?.serverId).toBe(501);
  });

  // Finding 3 (functional merge): the wholesale `set({ children: result.children,
  // ... })` off the pre-await snapshot would clobber a create that lands
  // during the await; the functional merge-by-id must preserve it instead.
  it('a create landing during the in-flight upload is not dropped by the functional merge', async () => {
    const localChild: Child = { id: 'localK', first: 'K', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ children: [localChild] });
    let resolveUpload!: (v: { children: Child[]; entries: Entry[]; measurements: Measurement[] }) => void;
    vi.mocked(uploadUnsynced).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );

    const pending = s().flushUnsynced();
    // A concurrent create lands mid-flush (e.g. via saveChild) — simulated
    // directly on state rather than driving the whole saveChild flow.
    const newChild: Child = { id: 'localL', first: 'L', last: '', birth: NOW, color: '#eee' };
    useAppStore.setState((st) => ({ children: [...st.children, newChild] }));

    resolveUpload({ children: [{ ...localChild, serverId: 501 }], entries: [], measurements: [] });
    await pending;

    expect(s().children.find((c) => c.id === 'localL')).toBeDefined();
    expect(s().children.find((c) => c.id === 'localK')?.serverId).toBe(501);
  });

  // End-to-end offline-measurement parity: a measurement created while offline
  // stays local (serverId==null) and syncs on reconnect via flushUnsynced.
  it('an offline-created measurement persists (serverId==null) and gets stamped on reconnect', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'c1', serverId: 42, first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      measurements: [],
    });
    s().openMeasurement('weight');
    s().saveMeasurement(6.2, NOW);
    await flush();
    // Offline: no server push, no serverId — the create is pending on-device.
    expect(h.measPushed).toHaveLength(0);
    const created = s().measurements.find((m) => m.value === 6.2);
    expect(created).toBeDefined();
    expect(created?.serverId).toBeUndefined();

    // Reconnect and flush.
    useAppStore.setState({ offline: false });
    await s().flushUnsynced();

    expect(s().measurements.find((m) => m.value === 6.2)?.serverId).toBe(701);
  });

  it('shows a "Synced 1 item" toast when it stamps a single unsynced measurement', async () => {
    useAppStore.setState({
      children: [{ id: 'c1', serverId: 42, first: 'Mira', last: 'O', birth: NOW, color: '#fff' }],
      measurements: [{ id: 'localG', childId: 'c1', kind: 'weight', value: 5, date: NOW }],
      toast: null,
    });

    await s().flushUnsynced();

    expect(s().toast).toBe('Synced 1 item');
  });

  it('the sync toast counts both children and measurements it stamps (plural)', async () => {
    useAppStore.setState({
      children: [{ id: 'localF', first: 'Finn', last: '', birth: NOW, color: '#fff' }],
      measurements: [{ id: 'localG', childId: 'localF', kind: 'weight', value: 5, date: NOW }],
      toast: null,
    });

    await s().flushUnsynced();

    expect(s().toast).toBe('Synced 2 items');
  });

  it('does not toast when the upload leaves records unsynced (nothing actually stamped)', async () => {
    useAppStore.setState({
      children: [{ id: 'localM', first: 'M', last: '', birth: NOW, color: '#fff' }],
      toast: null,
    });
    // The push never completes: records come back with serverId still null.
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children,
      entries: state.entries,
      measurements: state.measurements,
    }));

    await s().flushUnsynced();

    expect(s().toast).toBeNull();
  });

  it('does not toast on the offline early-return (nothing synced)', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'localN', first: 'N', last: '', birth: NOW, color: '#fff' }],
      toast: null,
    });

    await s().flushUnsynced();

    expect(uploadUnsynced).not.toHaveBeenCalled();
    expect(s().toast).toBeNull();
  });
});

describe('selectPendingCount (offline banner pending count)', () => {
  it('sums queued entries and unsynced (serverId==null) measurements; ignores synced ones', () => {
    useAppStore.setState({
      queueCount: 2,
      measurements: [
        { id: 'm-unsynced', childId: 'c1', kind: 'weight', value: 5, date: NOW },
        { id: 'm-synced', serverId: 9, childId: 'c1', kind: 'height', value: 60, date: NOW },
      ],
    });
    expect(selectPendingCount(s())).toBe(3);
  });

  it('is queueCount alone when no measurement is unsynced', () => {
    useAppStore.setState({ queueCount: 1, measurements: [] });
    expect(selectPendingCount(s())).toBe(1);
  });

  it('counts an offline-created measurement even with an empty entry queue', () => {
    useAppStore.setState({
      queueCount: 0,
      measurements: [{ id: 'm-unsynced', childId: 'c1', kind: 'weight', value: 5, date: NOW }],
    });
    expect(selectPendingCount(s())).toBe(1);
  });
});

describe('milestone store actions', () => {
  it('logMilestone prepends a milestone entry with the catalog title and empty user tags', () => {
    useAppStore.setState({ selectedChildId: '5', entries: [], connection: null });
    useAppStore.getState().logMilestone('first-steps', 1_000_000, 'took three');
    const e = useAppStore.getState().entries[0];
    expect(e.type).toBe('milestone');
    expect(e).toMatchObject({ key: 'first-steps', text: 'First steps', note: 'took three', time: 1_000_000, childId: '5', tags: [] });
  });

  it('editMilestone updates date and note in place', () => {
    const existing: MilestoneEntry = { id: 'e-x', childId: '5', type: 'milestone', key: 'first-word', time: 1, text: 'First word', note: 'a', tags: [] };
    useAppStore.setState({ selectedChildId: '5', entries: [existing], connection: null });
    useAppStore.getState().editMilestone('e-x', 2_000_000, undefined);
    const e = useAppStore.getState().entries.find((x) => x.id === 'e-x');
    expect(e).toMatchObject({ time: 2_000_000, note: undefined });
  });
});
