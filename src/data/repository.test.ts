import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client';
import { entryTimestamp, type ActivityType, type MeasurementKind, type Timer } from '@/types/models';

import {
  deleteTimerFromServer,
  loadFromServer,
  loadInsightsHistory,
  loadProfileFromServer,
  pushTimerToServer,
  serverHasData,
  updateTimerOnServer,
} from './repository';

const DAY = 86400000;

// Mock the client so no network is touched.
const listSleep = vi.fn();
const listFeedings = vi.fn();
const listChanges = vi.fn();
const getProfile = vi.fn();
const listChildren = vi.fn();
const listPumping = vi.fn(async () => []);
const listTummy = vi.fn(async () => []);
const listTemperature = vi.fn(async () => []);
const listMedication = vi.fn(async () => []);
const listChildNotes = vi.fn(async () => ({ baths: [], milestones: [], notes: [] }));
const listChildTreatments = vi.fn(async () => [] as any[]);
const listGenders = vi.fn(async () => new Map<number, string>());
const setChildGender = vi.fn(async () => undefined);
const listMeasurements = vi.fn(async () => []);
const listTimers = vi.fn(async () => [] as any[]);
const createTimer = vi.fn(async () => 11);
const updateTimer = vi.fn(async () => undefined);
const deleteTimer = vi.fn(async () => undefined);
// Only the client class is stubbed; `ApiError` stays the real one, because
// `loadFromServer` now reads its `status` to tell a 404 (an ANSWER: this server
// has no such endpoint) from any other failure (an absent answer).
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  BabybuddyClient: vi.fn().mockImplementation(() => ({
    listSleep,
    listFeedings,
    listChanges,
    getProfile,
    listChildren,
    listPumping,
    listTummy,
    listTemperature,
    listMedication,
    listChildNotes,
    listChildTreatments,
    listGenders,
    setChildGender,
    listMeasurements,
    listTimers,
    createTimer,
    updateTimer,
    deleteTimer,
  })),
  normalizeServerUrl: (s: string) => s,
}));

const sleepEntry = (start: number) => ({ id: `s-${start}`, type: 'sleep', childId: 'c1', start, end: start + 3600000, nap: false, tags: [] });

describe('loadInsightsHistory', () => {
  it('pages until entries fall before the cutoff and trims them', async () => {
    const now = Date.now();
    // page 1 = 100 recent, page 2 = 100 that cross the cutoff
    listSleep.mockReset();
    listSleep
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => sleepEntry(now - i * 3600000)))
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => sleepEntry(now - (100 + i) * DAY)));
    listFeedings.mockResolvedValue([]);
    listChanges.mockResolvedValue([]);

    const out = await loadInsightsHistory({ mode: 'server', serverUrl: 'x', token: 'y' }, 'c1', now - 90 * DAY);
    expect(out.every((e) => entryTimestamp(e) >= now - 90 * DAY)).toBe(true);
    expect(listSleep).toHaveBeenCalledWith('c1', 100, 0);
    expect(listSleep).toHaveBeenCalledWith('c1', 100, 100);
  });

  it('returns [] in demo mode without calling the client', async () => {
    listSleep.mockClear();
    const out = await loadInsightsHistory({ mode: 'local' }, 'c1', 0);
    expect(out).toEqual([]);
    expect(listSleep).not.toHaveBeenCalled();
  });
});

describe('loadProfileFromServer', () => {
  it('returns null in demo mode without calling the client', async () => {
    getProfile.mockClear();
    const out = await loadProfileFromServer({ mode: 'local' });
    expect(out).toBeNull();
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('fetches the profile from the client for a real connection', async () => {
    getProfile.mockReset().mockResolvedValueOnce({ username: 'alex', timezone: 'UTC' });
    const out = await loadProfileFromServer({ mode: 'server', serverUrl: 'x', token: 'y' });
    expect(out).toEqual({ username: 'alex', timezone: 'UTC' });
    expect(getProfile).toHaveBeenCalled();
  });

  it('propagates a client error (caller decides how to degrade)', async () => {
    getProfile.mockReset().mockRejectedValueOnce(new Error('500'));
    await expect(loadProfileFromServer({ mode: 'server', serverUrl: 'x', token: 'y' })).rejects.toThrow('500');
  });
});

describe('loadFromServer child selection', () => {
  const conn = { mode: 'server', serverUrl: 'x', token: 'y' } as const;
  const serverChildren = [
    { id: '7', serverId: 7, first: 'Mira', last: '', birth: 0, color: '#fff' },
    { id: '9', serverId: 9, first: 'Theo', last: '', birth: 0, color: '#fff' },
  ];

  const resetLists = () => {
    listFeedings.mockReset().mockResolvedValue([]);
    listSleep.mockReset().mockResolvedValue([]);
    listChanges.mockReset().mockResolvedValue([]);
    listMedication.mockReset().mockResolvedValue([]);
    listTimers.mockReset().mockResolvedValue([]);
  };

  it('fetches the preferred child rather than the first one', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();

    const result = await loadFromServer(conn, 9);

    expect(result.selectedChildId).toBe('9');
    expect(listFeedings).toHaveBeenCalledWith('9');
    expect(listSleep).toHaveBeenCalledWith('9');
    expect(listChanges).toHaveBeenCalledWith('9');
  });

  it('falls back to the first child when no preferred id is given', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();

    const result = await loadFromServer(conn);

    expect(result.selectedChildId).toBe('7');
    expect(listFeedings).toHaveBeenCalledWith('7');
  });

  it('falls back to the first child when the preferred id is not on the server', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();

    // 42 was deleted server-side, or belongs to an expecting child never pushed.
    const result = await loadFromServer(conn, 42);

    expect(result.selectedChildId).toBe('7');
    expect(listFeedings).toHaveBeenCalledWith('7');
  });

  it('fans out to listMedication and merges its rows into entries', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();
    listMedication.mockResolvedValueOnce([
      { id: 'medication-3', serverId: 3, childId: '9', type: 'medication', time: 1000, name: 'Paracetamol', dosage: 2.5, dosageUnit: 'mL', tags: [] },
    ] as any);

    const result = await loadFromServer(conn, 9);

    expect(listMedication).toHaveBeenCalledWith('9');
    expect(result.entries).toContainEqual(expect.objectContaining({ type: 'medication', name: 'Paracetamol' }));
  });

  it('fetches measurements for the preferred child too', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();
    listMeasurements.mockClear();

    await loadFromServer(conn, 9);

    for (const kind of ['weight', 'height', 'head', 'bmi']) {
      expect(listMeasurements).toHaveBeenCalledWith(kind, '9');
    }
  });
});

describe('loadFromServer incompleteSlices (partial-load signal)', () => {
  const conn = { mode: 'server', serverUrl: 'x', token: 'y' } as const;
  const serverChildren = [{ id: '7', serverId: 7, first: 'Mira', last: '', birth: 0, color: '#fff' }];

  // Every per-type list call degrades to [] on failure, so each one has to be
  // put back to a known-good answer before a test fails exactly one of them.
  const answerEverything = () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    listFeedings.mockReset().mockResolvedValue([]);
    listSleep.mockReset().mockResolvedValue([]);
    listChanges.mockReset().mockResolvedValue([]);
    listPumping.mockReset().mockResolvedValue([]);
    listTummy.mockReset().mockResolvedValue([]);
    listChildNotes.mockReset().mockResolvedValue({ baths: [], milestones: [], notes: [] });
    listTemperature.mockReset().mockResolvedValue([]);
    listMedication.mockReset().mockResolvedValue([]);
    listChildTreatments.mockReset().mockResolvedValue([]);
    listMeasurements.mockReset().mockResolvedValue([]);
    listTimers.mockReset().mockResolvedValue([]);
  };

  it('names nothing when every per-type request answered', async () => {
    answerEverything();

    const result = await loadFromServer(conn);

    expect(result.incompleteSlices).toEqual({});
  });

  it('names the slices one failed request emptied, while the rest still loads', async () => {
    answerEverything();
    // The live repro: one timed-out /api/notes/ takes every note, bath and
    // milestone out of `entries` with nothing in the answer saying so. ONE
    // request, so all three of its slices are floors.
    listChildNotes.mockRejectedValueOnce(new Error('timeout'));
    listFeedings.mockResolvedValueOnce([
      { id: 'f-1', type: 'feeding', childId: '7', start: 1000, end: 2000, feedType: 'breast', method: 'left', tags: [] },
    ] as any);

    const result = await loadFromServer(conn);

    expect(result.incompleteSlices).toEqual({ '7': ['bath', 'milestone', 'note'] });
    expect(result.entries).toContainEqual(expect.objectContaining({ type: 'feeding' }));
  });

  it('names only the failing measurement kind, not the three that answered', async () => {
    answerEverything();
    // weight is fetched first (see `kinds` in loadFromServer).
    listMeasurements.mockReset().mockRejectedValueOnce(new Error('500')).mockResolvedValue([]);

    const result = await loadFromServer(conn);

    expect(result.incompleteSlices).toEqual({ '7': ['weight'] });
  });

  it('does NOT count a 404: an endpoint this server does not have is an ANSWER', async () => {
    // /api/medication/ postdates several Baby Buddy releases, so an older
    // instance 404s on it forever. Counting that as a degrade would freeze the
    // slice on every load for good, which is the one outcome carry-over exists
    // to avoid.
    answerEverything();
    listMedication.mockRejectedValueOnce(new ApiError(404, 'Not found'));

    const result = await loadFromServer(conn);

    expect(result.incompleteSlices).toEqual({});
  });

  it('does count a 500 from the same endpoint (a failure, not a missing feature)', async () => {
    answerEverything();
    listMedication.mockRejectedValueOnce(new ApiError(500, 'Server Error'));

    const result = await loadFromServer(conn);

    expect(result.incompleteSlices).toEqual({ '7': ['medication'] });
  });

  // Fail-closed coverage. `orEmpty` is the only thing that reports a failed
  // fetch, and an unreported failure is read as a real answer, so its rows are
  // DELETED rather than preserved (see `LoadResult.incompleteSlices`). Every
  // slice in the vocabulary therefore has to be reachable from a fetch that
  // routes through it. These two are `Record<Union, true>`, so adding an
  // activity type or a measurement kind fails to TYPECHECK here until it is
  // listed, and then fails the test below until some fetch reports it.
  const ALL_ACTIVITIES: Record<ActivityType, true> = {
    feeding: true,
    sleep: true,
    diaper: true,
    pumping: true,
    tummy: true,
    bath: true,
    milestone: true,
    note: true,
    temperature: true,
    medication: true,
  };
  const ALL_MEASUREMENT_KINDS: Record<MeasurementKind, true> = { weight: true, height: true, head: true, bmi: true };

  it('every activity type and measurement kind is covered by a fetch that reports its own failure', async () => {
    answerEverything();
    // Every per-type fetch fails at once. Named one by one on purpose: this
    // list IS the set of fetches whose failures have to be reported, so a new
    // fetch added without a line here surfaces as a slice nobody covers.
    listFeedings.mockRejectedValueOnce(new Error('down'));
    listSleep.mockRejectedValueOnce(new Error('down'));
    listChanges.mockRejectedValueOnce(new Error('down'));
    listPumping.mockRejectedValueOnce(new Error('down'));
    listTummy.mockRejectedValueOnce(new Error('down'));
    listChildNotes.mockRejectedValueOnce(new Error('down'));
    listTemperature.mockRejectedValueOnce(new Error('down'));
    listMedication.mockRejectedValueOnce(new Error('down'));
    listChildTreatments.mockRejectedValueOnce(new Error('down'));
    for (const kind of Object.keys(ALL_MEASUREMENT_KINDS)) listMeasurements.mockRejectedValueOnce(new Error(`down: ${kind}`));
    // Account-wide, and deliberately uncounted: it belongs to no child's slice.
    listGenders.mockRejectedValueOnce(new Error('down'));

    const result = await loadFromServer(conn);

    expect([...(result.incompleteSlices?.['7'] ?? [])].sort()).toEqual(
      [...Object.keys(ALL_ACTIVITIES), ...Object.keys(ALL_MEASUREMENT_KINDS), 'treatment'].sort(),
    );
  });

  it('names nothing when the account has no children to fetch', async () => {
    answerEverything();
    listChildren.mockReset().mockResolvedValueOnce([]);

    const result = await loadFromServer(conn);

    expect(result.incompleteSlices).toEqual({});
  });
});

describe('serverHasData', () => {
  it('returns true when the server already has at least one child', async () => {
    listChildren.mockReset().mockResolvedValueOnce([{ id: '1', first: 'Ada', last: 'Lovelace', birth: 0, color: '#fff' }]);
    const out = await serverHasData({ mode: 'server', serverUrl: 'x', token: 'y' });
    expect(out).toBe(true);
  });

  it('returns false when the server has no children (fresh instance)', async () => {
    listChildren.mockReset().mockResolvedValueOnce([]);
    const out = await serverHasData({ mode: 'server', serverUrl: 'x', token: 'y' });
    expect(out).toBe(false);
  });

  it('returns false in local mode without calling the client', async () => {
    listChildren.mockClear();
    const out = await serverHasData({ mode: 'local' });
    expect(out).toBe(false);
    expect(listChildren).not.toHaveBeenCalled();
  });
});

describe('timers', () => {
  const conn = { mode: 'server', serverUrl: 'x', token: 'y' } as const;
  const feedingTimer: Timer = {
    id: 't1',
    activity: 'feeding',
    name: 'Feeding',
    start: 1000,
    saveAs: 'feeding',
    feedType: 'formula',
    method: 'bottle',
    amount: 90,
  };

  it('loadFromServer reconstructs timers and maps the child FK to a local id', async () => {
    listChildren.mockReset().mockResolvedValueOnce([{ id: '2', serverId: 2, first: 'A', last: '', birth: 0, color: '#fff' }]);
    listFeedings.mockResolvedValue([]);
    listSleep.mockResolvedValue([]);
    listChanges.mockResolvedValue([]);
    listTimers.mockReset().mockResolvedValueOnce([{ id: 4, child: 2, name: 'Sleep · v1 · nap', start: 1000 }]);

    const result = await loadFromServer(conn);

    expect(result.timers).toEqual([
      expect.objectContaining({ serverId: 4, childId: '2', saveAs: 'sleep', nap: true, start: 1000 }),
    ]);
  });

  it('loadFromServer skips a timer whose child is not among the local children', async () => {
    listChildren.mockReset().mockResolvedValueOnce([{ id: '2', serverId: 2, first: 'A', last: '', birth: 0, color: '#fff' }]);
    listTimers.mockReset().mockResolvedValueOnce([{ id: 4, child: 99, name: 'Sleep · v1', start: 1000 }]);
    const result = await loadFromServer(conn);
    expect(result.timers).toEqual([]);
  });

  it('loadFromServer yields timers: null (unknown) when listTimers throws, while the rest still loads', async () => {
    listChildren.mockReset().mockResolvedValueOnce([{ id: '2', serverId: 2, first: 'A', last: '', birth: 0, color: '#fff' }]);
    listFeedings.mockReset().mockResolvedValueOnce([
      { id: 'f-1', type: 'feeding', childId: '2', start: 1000, end: 2000, feedType: 'breast', method: 'left', tags: [] },
    ]);
    listTimers.mockReset().mockRejectedValueOnce(new Error('boom'));

    const result = await loadFromServer(conn);

    // null ("fetch failed, unknown"), NOT [] ("known none"): a consumer that
    // reconciled [] here would treat every local serverId-carrying timer as
    // stopped elsewhere and drop it over one transient endpoint failure.
    expect(result.timers).toBeNull();
    expect(result.children).toHaveLength(1);
    expect(result.entries).toContainEqual(expect.objectContaining({ type: 'feeding' }));
  });

  it('pushTimerToServer creates a timer with the encoded name and returns its id', async () => {
    createTimer.mockClear().mockResolvedValueOnce(11);
    const id = await pushTimerToServer(conn, feedingTimer, 2);
    expect(id).toBe(11);
    expect(createTimer).toHaveBeenCalledWith(2, 1000, 'Feeding · v1 · ft:formula · m:bottle · amt:90');
  });

  it('pushTimerToServer is a no-op in local mode', async () => {
    createTimer.mockClear();
    const id = await pushTimerToServer({ mode: 'local' }, feedingTimer, 2);
    expect(id).toBeUndefined();
    expect(createTimer).not.toHaveBeenCalled();
  });

  it('updateTimerOnServer PATCHes only when the timer has a serverId', async () => {
    updateTimer.mockClear();
    await updateTimerOnServer(conn, feedingTimer); // no serverId
    expect(updateTimer).not.toHaveBeenCalled();
    await updateTimerOnServer(conn, { ...feedingTimer, serverId: 7 });
    expect(updateTimer).toHaveBeenCalledWith(7, 'Feeding · v1 · ft:formula · m:bottle · amt:90', 1000);
  });

  it('deleteTimerFromServer deletes by server id (no-op in local mode)', async () => {
    deleteTimer.mockClear();
    await deleteTimerFromServer({ mode: 'local' }, 7);
    expect(deleteTimer).not.toHaveBeenCalled();
    await deleteTimerFromServer(conn, 7);
    expect(deleteTimer).toHaveBeenCalledWith(7);
  });
});
