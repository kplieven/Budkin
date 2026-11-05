import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client';
import { entryTimestamp, type ActivityType, type MeasurementKind, type Timer } from '@/types/models';

import {
  deleteTimerFromServer,
  loadFromServer as loadFromServerActual,
  loadInsightsHistory,
  loadProfileFromServer,
  pushTimerToServer,
  serverHasData,
  updateTimerOnServer,
} from './repository';
import { recentHistorySince } from '@/lib/historyRange';

const DAY = 86400000;
// Existing fan-out/reconciliation fixtures use epoch timestamps; their cutoff is
// explicit so those tests continue to cover fetch behavior independently of dates.
const loadFromServer = (conn: Parameters<typeof loadFromServerActual>[0], preferred?: number | null) =>
  loadFromServerActual(conn, preferred, 0);

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
const listChildNotes = vi.fn(async (_id: string, _limit = 100, _offset = 0): Promise<{
  baths: any[]; milestones: any[]; notes: any[]; pageCount?: number; oldestTime?: number; lastId?: number;
}> => ({ baths: [], milestones: [], notes: [] }));
const listChildMilestones = vi.fn(async (_id: string, _limit = 100, _offset = 0): Promise<{
  milestones: any[]; pageCount: number; lastId?: number;
}> => ({ milestones: [], pageCount: 0 }));
const listChildTreatments = vi.fn(async () => [] as any[]);
const listGenders = vi.fn(async () => new Map<number, string>());
const setChildGender = vi.fn(async () => undefined);
const listBathRhythms = vi.fn(async () => new Map<number, { fullEveryDays?: number; quickEveryDays?: number }>());
const setChildBathRhythm = vi.fn(async () => undefined);
const listMeasurements = vi.fn(async () => []);
const listTimers = vi.fn(async () => [] as any[]);
const createTimer = vi.fn(async () => 11);
const updateTimer = vi.fn(async () => undefined);
const deleteTimer = vi.fn(async () => undefined);
// Only the client class is stubbed; `ApiError` stays the real one, because
// `loadFromServer` reads its `status` to tell a 404 (an ANSWER: this server has
// no such endpoint) from any other failure (an absent answer).
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
    listChildMilestones,
    listChildTreatments,
    listGenders,
    setChildGender,
    listBathRhythms,
    setChildBathRhythm,
    listMeasurements,
    listTimers,
    createTimer,
    updateTimer,
    deleteTimer,
  })),
  normalizeServerUrl: (s: string) => s,
}));

const sleepEntry = (start: number) => ({ id: `s-${start}`, type: 'sleep', childId: 'c1', start, end: start + 3600000, nap: false, tags: [] });

describe('date-based timeline loading', () => {
  const conn = { mode: 'server', serverUrl: 'x', token: 'y' } as const;
  const feed = (start: number) => ({
    id: `f-${start}`, type: 'feeding' as const, childId: '7', start, end: start + 1000,
    feedType: 'breast' as const, method: 'left' as const, amount: null, tags: [],
  });

  const reset = () => {
    listChildren.mockReset().mockResolvedValue([{ id: '7', serverId: 7, first: 'Mira', birth: 0 }]);
    for (const fn of [listSleep, listFeedings, listChanges, listPumping, listTummy, listTemperature, listMedication, listChildTreatments, listMeasurements]) {
      fn.mockReset().mockResolvedValue([]);
    }
    listChildNotes.mockReset().mockResolvedValue({ baths: [], milestones: [], notes: [], pageCount: 0 });
    listChildMilestones.mockReset().mockResolvedValue({ milestones: [], pageCount: 0 });
    listTimers.mockReset().mockResolvedValue([]);
  };

  it('finishes the cutoff day across pages for busy activity types', async () => {
    reset();
    const cutoff = recentHistorySince(Date.now());
    const first = Array.from({ length: 100 }, (_, i) => feed(Date.now() - i * 60_000));
    listFeedings.mockImplementation(async (_id: string, _limit: number, offset: number) =>
      offset === 0 ? first : [feed(cutoff + 3600000), feed(cutoff - 3600000)],
    );
    const result = await loadFromServerActual(conn, undefined, cutoff);

    expect(result.entries.filter((e) => e.type === 'feeding')).toHaveLength(101);
    expect(result.entries.some((e) => e.id === `f-${cutoff - 3600000}`)).toBe(false);
    expect(listFeedings).toHaveBeenCalledWith('7', 100, 100);
    expect(result.historySinceMs).toBe(cutoff);
    expect(result.historyHasOlder).toBe(true);
  });

  it('uses raw note page size when excluded metadata notes fill a page', async () => {
    reset();
    const cutoff = recentHistorySince(Date.now());
    listChildNotes.mockImplementation(async (_id: string, _limit: number, offset: number) =>
      offset === 0
        ? { baths: [], milestones: [], notes: [], pageCount: 100, oldestTime: cutoff + 1 }
        : { baths: [], milestones: [], notes: [], pageCount: 1, oldestTime: cutoff - 1 },
    );
    const result = await loadFromServerActual(conn, undefined, cutoff);
    expect(listChildNotes).toHaveBeenCalledWith('7', 100, 100);
    expect(result.historyHasOlder).toBe(true);
  });

  it('loads milestones older than the history window and scans raw notes until an ordinary page is full', async () => {
    reset();
    const cutoff = recentHistorySince(Date.now());
    const oldMilestone = { id: 'milestone-1', type: 'milestone', childId: '7', time: cutoff - DAY, key: 'smile', tags: [] };
    listChildMilestones.mockResolvedValueOnce({ milestones: [oldMilestone], pageCount: 1 });
    listChildNotes.mockImplementation(async (_id: string, _limit: number, offset: number) =>
      offset === 0
        ? { baths: [], milestones: [], notes: [], pageCount: 100, oldestTime: cutoff - 1, lastId: 100 }
        : { baths: [], milestones: [], notes: Array.from({ length: 20 }, (_, i) => ({
            id: `note-${i}`, type: 'note', childId: '7', time: cutoff - DAY - i, text: 'old', tags: [],
          })), pageCount: 20, oldestTime: cutoff - DAY, lastId: 120 },
    );
    const result = await loadFromServerActual(conn, undefined, cutoff);
    expect(result.entries).toContainEqual(oldMilestone);
    expect(result.entries.filter((e) => e.type === 'note')).toHaveLength(20);
    expect(listChildNotes).toHaveBeenCalledWith('7', 100, 100);
    expect(result.notesHasOlder?.['7']).toBe(false);
  });

  it('follows every filtered milestone page regardless of age', async () => {
    reset();
    const cutoff = recentHistorySince(Date.now());
    const milestone = (i: number) => ({
      id: `milestone-${i}`, type: 'milestone', childId: '7', time: cutoff - (i + 1) * DAY, key: `key-${i}`, tags: [],
    });
    listChildMilestones.mockImplementation(async (_id: string, _limit: number, offset: number) =>
      offset === 0
        ? { milestones: Array.from({ length: 100 }, (_, i) => milestone(i)), pageCount: 100, lastId: 100 }
        : { milestones: [milestone(100)], pageCount: 1, lastId: 101 },
    );
    const result = await loadFromServerActual(conn, undefined, cutoff);
    expect(result.entries.filter((e) => e.type === 'milestone')).toHaveLength(101);
    expect(listChildMilestones).toHaveBeenCalledWith('7', 100, 100);
  });

  it('keeps the last feeding prefill when the newest feeding predates the visible range', async () => {
    reset();
    const cutoff = recentHistorySince(Date.now());
    listFeedings.mockResolvedValueOnce([feed(cutoff - DAY)]);
    const result = await loadFromServerActual(conn, undefined, cutoff);
    expect(result.entries).toEqual([]);
    expect(result.lastFeed['7']).toEqual({ feedType: 'breast', method: 'left' });
    expect(result.historyHasOlder).toBe(true);
  });

  it('does not advance the complete-day boundary when a later page fails', async () => {
    reset();
    const cutoff = recentHistorySince(Date.now());
    const first = Array.from({ length: 100 }, (_, i) => feed(Date.now() - i * 60_000));
    listFeedings.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('second page failed'));
    const result = await loadFromServerActual(conn, undefined, cutoff);
    expect(result.incompleteSlices?.['7']).toContain('feeding');
    expect(result.historySinceMs).toBeUndefined();
    expect(result.historyHasOlder).toBe(true);
  });
});

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

describe('loadFromServer fans out to every child', () => {
  const conn = { mode: 'server', serverUrl: 'x', token: 'y' } as const;
  const serverChildren = [
    { id: '7', serverId: 7, first: 'Mira', last: '', birth: 0, color: '#fff' },
    { id: '9', serverId: 9, first: 'Theo', last: '', birth: 0, color: '#fff' },
  ];
  const feeding = (childId: string, start: number, feedType = 'breast', method = 'left') => ({
    id: `f-${childId}-${start}`,
    serverId: start,
    type: 'feeding',
    childId,
    start,
    end: start + 1000,
    feedType,
    method,
    amount: null,
    tags: [],
  });

  const resetLists = () => {
    listFeedings.mockReset().mockResolvedValue([]);
    listSleep.mockReset().mockResolvedValue([]);
    listChanges.mockReset().mockResolvedValue([]);
    listPumping.mockReset().mockResolvedValue([]);
    listTummy.mockReset().mockResolvedValue([]);
    listChildNotes.mockReset().mockResolvedValue({ baths: [], milestones: [], notes: [] });
    listChildMilestones.mockReset().mockResolvedValue({ milestones: [], pageCount: 0 });
    listTemperature.mockReset().mockResolvedValue([]);
    listMedication.mockReset().mockResolvedValue([]);
    listChildTreatments.mockReset().mockResolvedValue([]);
    listMeasurements.mockReset().mockResolvedValue([]);
    listTimers.mockReset().mockResolvedValue([]);
  };

  it("fetches the SIBLING's records too, not just the selected child's", async () => {
    // Fetching only the selection leaves a sibling's History empty until a refresh
    // lands on them, and (through `applyServerLoad`, which replaces `entries`
    // wholesale) deletes the previous child's month chunks from disk on the way.
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();

    await loadFromServer(conn, 9);

    for (const id of ['7', '9']) {
      expect(listFeedings).toHaveBeenCalledWith(id, 100, 0);
      expect(listSleep).toHaveBeenCalledWith(id, 100, 0);
      expect(listChanges).toHaveBeenCalledWith(id, 100, 0);
      expect(listPumping).toHaveBeenCalledWith(id, 100, 0);
      expect(listTummy).toHaveBeenCalledWith(id, 100, 0);
      expect(listChildNotes).toHaveBeenCalledWith(id, 100, 0);
      expect(listTemperature).toHaveBeenCalledWith(id, 100, 0);
      expect(listMedication).toHaveBeenCalledWith(id, 100, 0);
      expect(listChildTreatments).toHaveBeenCalledWith(id);
      for (const kind of ['weight', 'height', 'head', 'bmi']) expect(listMeasurements).toHaveBeenCalledWith(kind, id);
    }
  });

  it('returns both children’s entries in one flat array', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();
    listFeedings.mockImplementation(async (id: string) => [feeding(id, id === '7' ? 1000 : 2000)] as any);

    const result = await loadFromServer(conn, 9);

    expect(result.entries.map((e) => e.childId).sort()).toEqual(['7', '9']);
  });

  it('nominates the preferred child as the selection without that steering the fetch', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();

    const result = await loadFromServer(conn, 9);

    // `preferredChildServerId` only seeds `selectedChildId`: the records of BOTH
    // children come back either way (asserted above).
    expect(result.selectedChildId).toBe('9');
  });

  it('falls back to the first child when no preferred id is given', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();

    const result = await loadFromServer(conn);

    expect(result.selectedChildId).toBe('7');
  });

  it('falls back to the first child when the preferred id is not on the server', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();

    // 42 was deleted server-side, or belongs to an expecting child never pushed.
    const result = await loadFromServer(conn, 42);

    expect(result.selectedChildId).toBe('7');
  });

  it('carries a feeding prefill for EACH child that has been fed', async () => {
    // `mergeLastFeed` merges rather than replaces, and every child answered for
    // has to land under its own key.
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();
    listFeedings.mockImplementation(async (id: string) =>
      id === '7'
        ? ([feeding('7', 1000, 'solid', 'self'), feeding('7', 500)] as any)
        : ([feeding('9', 2000, 'formula', 'bottle')] as any),
    );

    const result = await loadFromServer(conn, 9);

    // The LATEST feed per child, not the first row the server happened to send.
    expect(result.lastFeed).toEqual({
      '7': { feedType: 'solid', method: 'self' },
      '9': { feedType: 'formula', method: 'bottle' },
    });
  });

  it('leaves a child with no feeds out of lastFeed rather than defaulting them', async () => {
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();
    listFeedings.mockImplementation(async (id: string) => (id === '7' ? ([feeding('7', 1000)] as any) : []));

    const result = await loadFromServer(conn, 9);

    // No opinion, so whatever the device already knew about Theo stands.
    expect(result.lastFeed).toEqual({ '7': { feedType: 'breast', method: 'left' } });
  });

  it("files a failure against the child whose request failed, not the selection", async () => {
    // With siblings' requests interleaved, a shared `degraded` list would blame the
    // selected child and freeze the WRONG child's rows through `carryOverIncomplete`,
    // while silently deleting the failing child's.
    listChildren.mockReset().mockResolvedValueOnce(serverChildren);
    resetLists();
    listChildNotes.mockImplementation((async (id: string) =>
      id === '7' ? Promise.reject(new Error('timeout')) : { baths: [], milestones: [], notes: [] }) as any);

    const result = await loadFromServer(conn, 9);

    expect(result.incompleteSlices).toEqual({ '7': ['bath', 'note'] });
  });

  it('holds concurrency at 8 across the whole load, not 8 per child', async () => {
    // 3 children is 39 per-child requests. The cap keeps a multi-child load off a
    // self-hosted gunicorn's worker pool; uncapped it would peak at 13N.
    listChildren.mockReset().mockResolvedValueOnce([
      ...serverChildren,
      { id: '11', serverId: 11, first: 'Ivo', last: '', birth: 0, color: '#fff' },
    ]);
    resetLists();
    let inFlight = 0;
    let peak = 0;
    const gate = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      return [];
    };
    for (const m of [listFeedings, listSleep, listChanges, listPumping, listTummy, listTemperature, listMedication, listChildTreatments, listMeasurements]) {
      m.mockImplementation(gate as any);
    }
    listChildNotes.mockImplementation((async () => {
      await gate();
      return { baths: [], milestones: [], notes: [] };
    }) as any);
    listChildMilestones.mockImplementation((async () => {
      await gate();
      return { milestones: [], pageCount: 0 };
    }) as any);

    await loadFromServer(conn);

    expect(peak).toBe(8);
    // And it really did run all of them: 14 requests per child, 3 children.
    expect(
      [listFeedings, listSleep, listChanges, listPumping, listTummy, listChildNotes, listChildMilestones, listTemperature, listMedication, listChildTreatments].reduce(
        (n, m) => n + m.mock.calls.length,
        0,
      ) + listMeasurements.mock.calls.length,
    ).toBe(42);

    // Put the shared mocks back to plain answers: the describes below reuse them
    // without resetting every one, so a timer-backed implementation would leak in.
    resetLists();
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
    listChildMilestones.mockReset().mockResolvedValue({ milestones: [], pageCount: 0 });
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
    // A timed-out raw notes scan affects bath and ordinary notes. The separate
    // milestone scan can still answer.
    listChildNotes.mockRejectedValueOnce(new Error('timeout'));
    listFeedings.mockResolvedValueOnce([
      { id: 'f-1', type: 'feeding', childId: '7', start: 1000, end: 2000, feedType: 'breast', method: 'left', tags: [] },
    ] as any);

    const result = await loadFromServer(conn);

    expect(result.incompleteSlices).toEqual({ '7': ['bath', 'note'] });
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
    // /api/medication/ postdates several Baby Buddy releases, so an older instance
    // 404s on it forever. Counting that as a degrade would freeze the slice on
    // every load for good, the one outcome carry-over exists to avoid.
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

  // Fail-closed coverage. `orEmpty` is the only thing that reports a failed fetch,
  // and an unreported failure is read as a real answer, so its rows are DELETED
  // rather than preserved. Every slice must therefore be reachable from a fetch
  // that routes through it. `Record<Union, true>` so a new activity type or
  // measurement kind fails to typecheck here until listed, then fails the test
  // below until some fetch reports it.
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
    // Named one by one on purpose: this list IS the set of fetches whose failures
    // have to be reported, so a new fetch without a line here shows as an
    // uncovered slice.
    listFeedings.mockRejectedValueOnce(new Error('down'));
    listSleep.mockRejectedValueOnce(new Error('down'));
    listChanges.mockRejectedValueOnce(new Error('down'));
    listPumping.mockRejectedValueOnce(new Error('down'));
    listTummy.mockRejectedValueOnce(new Error('down'));
    listChildNotes.mockRejectedValueOnce(new Error('down'));
    listChildMilestones.mockRejectedValueOnce(new Error('down'));
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

  describe('bath rhythms', () => {
    it('keys the answer by SERVER child id, as a string', async () => {
      answerEverything();
      listBathRhythms.mockResolvedValueOnce(new Map([[7, { fullEveryDays: 5, quickEveryDays: 1 }]]));

      const result = await loadFromServer(conn);

      expect(result.bathRhythms).toEqual({ '7': { fullEveryDays: 5, quickEveryDays: 1 } });
    });

    it('answers {} when the account has no rhythm notes at all', async () => {
      answerEverything();

      const result = await loadFromServer(conn);

      expect(result.bathRhythms).toEqual({});
    });

    // Not {}: an empty answer makes the local rhythms eligible for the seed-the-server
    // upload, and doing that on a timeout would push a stale value over a newer one.
    it('degrades to null (unknown), not to an empty answer, when the fetch fails', async () => {
      answerEverything();
      listBathRhythms.mockRejectedValueOnce(new Error('down'));

      const result = await loadFromServer(conn);

      expect(result.bathRhythms).toBeNull();
    });

    // Account-wide like `listGenders`, so it belongs to no single child's slice.
    it('does not report its failure as a degraded slice', async () => {
      answerEverything();
      listBathRhythms.mockRejectedValueOnce(new Error('down'));

      const result = await loadFromServer(conn);

      expect(result.incompleteSlices).toEqual({});
    });
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
