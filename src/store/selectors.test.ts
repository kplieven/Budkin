import { describe, expect, it } from 'vitest';

import type { Connection } from '@/data/repository';
import { activeTreatmentsForChildToday, bathGivenToday, BATH_RHYTHM_DEFAULT, clampBathInterval, clampMinuteOfDay, treatmentDoseScalars, treatmentDueHint, treatmentDueList, treatmentDueState, treatmentsAllGiven, endAnchorVisible, entriesForChild, fmtDayStartHour, fmtMinuteOfDay, isTreatmentActiveToday, isNapStart, lastDiaperMinAgo, lastFeedEndMinAgo, lastFeedStartMinAgo, lastSleepStartMinAgo, lastWakeMinAgo, legacyBathRhythm, minuteOfDayIsNap, nextStartSide, measurementsForChild, overruleLasted, parseMinuteOfDay, rhythmForChild, runningTimer, selectServerMode, startOfDay, teDurationMin, teEnd, teStart, timersForChild, washDueState } from '@/store/selectors';
import type { BathRhythm, Treatment, Entry, Measurement, Timer } from '@/types/models';
import type { TimeEntryState } from '@/types/timeEntry';

const NOW = 1_700_000_000_000;
const M = 60000;

describe('selectServerMode', () => {
  it('is true for a server connection, false for local mode and for no connection', () => {
    expect(selectServerMode({ connection: { mode: 'server', serverUrl: 'https://bb.example', token: 'tok' } })).toBe(true);
    expect(selectServerMode({ connection: { mode: 'local' } })).toBe(false);
    expect(selectServerMode({ connection: null })).toBe(false);
  });

  it('answers with a boolean, never the connection or a wrapper around it', () => {
    // This goes straight into `useAppStore(selectServerMode)`, where a fresh
    // reference per call is the zustand v5 render loop: the store compares
    // snapshots with Object.is, so a new object every call never settles and the
    // web build renders a blank screen.
    const s: { connection: Connection | null } = {
      connection: { mode: 'server', serverUrl: 'https://bb.example', token: 'tok' },
    };
    expect(typeof selectServerMode(s)).toBe('boolean');
    expect(Object.is(selectServerMode(s), selectServerMode(s))).toBe(true);
  });
});

describe('teEnd / teStart / teDurationMin', () => {
  it('point shape derives from agoMin; absTime takes precedence', () => {
    const te: TimeEntryState = { shape: 'point', agoMin: 15, tags: [] };
    expect(teEnd(te, NOW)).toBe(NOW - 15 * M);
    expect(teEnd({ ...te, absTime: NOW - 47 * M }, NOW)).toBe(NOW - 47 * M);
    expect(teStart(te, NOW)).toBeNull();
  });
  it('interval default: end + lasted, start derived', () => {
    const te: TimeEntryState = { shape: 'interval', order: ['end', 'lasted', 'start'], endAgoMin: 0, durationMin: 20, tags: [] };
    expect(teEnd(te, NOW)).toBe(NOW);
    expect(teStart(te, NOW)).toBe(NOW - 20 * M);
    expect(teDurationMin(te, NOW)).toBe(20);
  });
  it('interval: start + lasted, end derived', () => {
    const te: TimeEntryState = { shape: 'interval', order: ['start', 'lasted', 'end'], startAbs: NOW - 30 * M, durationMin: 20, tags: [] };
    expect(teStart(te, NOW)).toBe(NOW - 30 * M);
    expect(teEnd(te, NOW)).toBe(NOW - 10 * M);
  });
  it('interval: absolute end + lasted, start derived', () => {
    const te: TimeEntryState = { shape: 'interval', order: ['end', 'lasted', 'start'], endAbs: NOW - 13 * M, durationMin: 37, tags: [] };
    expect(teEnd(te, NOW)).toBe(NOW - 13 * M);
    expect(teStart(te, NOW)).toBe(NOW - 50 * M);
    expect(teDurationMin(te, NOW)).toBe(37);
  });
  it('ongoing ends at now (live), duration grows from start', () => {
    const te: TimeEntryState = { shape: 'interval', ongoing: true, order: ['end', 'start', 'lasted'], startAbs: NOW - 30 * M, tags: [] };
    expect(teEnd(te, NOW)).toBe(NOW);
    expect(teStart(te, NOW)).toBe(NOW - 30 * M);
    expect(teDurationMin(te, NOW)).toBe(30);
  });
  it('start set via startAgoMin resolves live and slides with now (mirrors endAgoMin)', () => {
    const te: TimeEntryState = { shape: 'interval', order: ['start', 'end', 'lasted'], startAgoMin: 10, endAgoMin: 0, tags: [] };
    expect(teStart(te, NOW)).toBe(NOW - 10 * M);
    expect(teDurationMin(te, NOW)).toBe(10);
    // still 10 minutes before "now" at a later now (sliding, not frozen)
    expect(teStart(te, NOW + 5 * M)).toBe(NOW + 5 * M - 10 * M);
  });
});

describe('overruleLasted', () => {
  it('returns null when lasted is already derived (both endpoints pinned)', () => {
    const te: TimeEntryState = { shape: 'interval', order: ['end', 'start', 'lasted'], endAbs: NOW - 10 * M, startAbs: NOW - 40 * M, tags: [] };
    expect(overruleLasted(te, NOW, 'start')).toBeNull();
    expect(overruleLasted(te, NOW, 'end')).toBeNull();
  });
  it('returns null while ongoing (end must stay live, not freeze)', () => {
    const te: TimeEntryState = { shape: 'interval', ongoing: true, order: ['end', 'lasted', 'start'], endAgoMin: 0, durationMin: 20, tags: [] };
    expect(overruleLasted(te, NOW, 'start')).toBeNull();
  });
  it('nudging start freezes the resolved end and demotes lasted to derived', () => {
    // lasted + end active: end = now, duration 20, start derived (= now-20)
    const te: TimeEntryState = { shape: 'interval', order: ['lasted', 'end', 'start'], endAgoMin: 0, durationMin: 20, tags: [] };
    expect(overruleLasted(te, NOW, 'start')).toEqual({ frozen: NOW, order: ['start', 'end', 'lasted'] });
  });
  it('nudging end freezes the resolved start and demotes lasted to derived', () => {
    // lasted + start active: start = now-40, duration 20, end derived (= now-20)
    const te: TimeEntryState = { shape: 'interval', order: ['lasted', 'start', 'end'], startAbs: NOW - 40 * M, durationMin: 20, tags: [] };
    expect(overruleLasted(te, NOW, 'end')).toEqual({ frozen: NOW - 40 * M, order: ['end', 'start', 'lasted'] });
  });
});

describe('anchors', () => {
  const entries: Entry[] = [
    { id: 'f', childId: 'c1', type: 'feeding', start: NOW - 90 * M, end: NOW - 60 * M, feedType: 'breast', method: 'left', amount: null, tags: [] },
    { id: 's', childId: 'c1', type: 'sleep', start: NOW - 240 * M, end: NOW - 120 * M, nap: true, tags: [] },
    { id: 'd0', childId: 'c1', type: 'diaper', time: NOW - 200 * M, wet: true, solid: false, color: null, tags: [] },
    { id: 'd1', childId: 'c1', type: 'diaper', time: NOW - 45 * M, wet: true, solid: true, color: 'yellow', tags: [] },
  ];
  it('lastFeedEndMinAgo', () => {
    expect(lastFeedEndMinAgo(entries, NOW)).toBe(60);
    expect(lastFeedEndMinAgo([], NOW)).toBeNull();
  });
  it('lastFeedStartMinAgo counts from the feeding start, not end', () => {
    expect(lastFeedStartMinAgo(entries, NOW)).toBe(90);
    expect(lastFeedStartMinAgo([], NOW)).toBeNull();
  });
  it('lastWakeMinAgo', () => {
    expect(lastWakeMinAgo(entries, NOW)).toBe(120);
  });
  it('lastSleepStartMinAgo counts from the sleep start, not the wake', () => {
    expect(lastSleepStartMinAgo(entries, NOW)).toBe(240);
    expect(lastSleepStartMinAgo([], NOW)).toBeNull();
  });
  it('lastDiaperMinAgo picks the most recent change', () => {
    expect(lastDiaperMinAgo(entries, NOW)).toBe(45);
    expect(lastDiaperMinAgo([], NOW)).toBeNull();
  });
});

describe('endAnchorVisible', () => {
  it('is visible when the anchor is after the start and not in the future', () => {
    expect(endAnchorVisible(NOW - 30 * M, NOW - 60 * M, NOW)).toBe(true);
    expect(endAnchorVisible(NOW, NOW - 60 * M, NOW)).toBe(true);
  });
  it('is hidden when the anchor is at or before the start', () => {
    expect(endAnchorVisible(NOW - 60 * M, NOW - 60 * M, NOW)).toBe(false);
    expect(endAnchorVisible(NOW - 90 * M, NOW - 60 * M, NOW)).toBe(false);
  });
  it('is hidden when the anchor is in the future', () => {
    expect(endAnchorVisible(NOW + 5 * M, NOW - 60 * M, NOW)).toBe(false);
  });
});

describe('nextStartSide', () => {
  const feed = (method: 'left' | 'right' | 'both', tags: string[]): Entry => ({
    id: 'f', childId: 'c1', type: 'feeding', start: NOW, end: NOW + 1, feedType: 'breast', method, amount: null, tags,
  });
  it('defaults to left with no history', () => {
    expect(nextStartSide([])).toBe('left');
  });
  it('alternates from the last feed (both + side tag)', () => {
    expect(nextStartSide([feed('both', ['left'])])).toBe('right');
    expect(nextStartSide([feed('both', ['right'])])).toBe('left');
  });
  it('alternates from a single-side method', () => {
    expect(nextStartSide([feed('left', [])])).toBe('right');
  });
});

describe('washDueState', () => {
  const DAY = 86400000;
  // Midday, so adding whole days never lands on a DST boundary edge.
  const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();

  const bath = (daysAgo: number, wash: 'quick' | 'full'): Entry => ({
    id: `b-${daysAgo}-${wash}`,
    childId: 'c1',
    type: 'bath',
    time: NOON - daysAgo * DAY,
    wash,
    tags: [],
  });

  const R = (fullEveryDays: number, quickEveryDays: number) => ({ fullEveryDays, quickEveryDays });

  it('reads both kinds as due with no bath history at all', () => {
    const s = washDueState([], R(3, 1), NOON);
    expect(s.full).toBe(true);
    expect(s.quick).toBe(true);
    expect(s.nextKind).toBe('full');
  });

  it('is not due on the day of the bath', () => {
    const s = washDueState([bath(0, 'full')], R(3, 1), NOON);
    expect(s.full).toBe(false);
    expect(s.quick).toBe(false);
  });

  it('brings a quick wash due the next day', () => {
    const s = washDueState([bath(1, 'full')], R(3, 1), NOON);
    expect(s.quick).toBe(true);
    expect(s.full).toBe(false);
    expect(s.nextKind).toBe('quick');
  });

  it('brings a full bath due exactly on its interval', () => {
    expect(washDueState([bath(2, 'full')], R(3, 1), NOON).full).toBe(false);
    expect(washDueState([bath(3, 'full')], R(3, 1), NOON).full).toBe(true);
    expect(washDueState([bath(9, 'full')], R(3, 1), NOON).full).toBe(true);
  });

  it('prefers the full bath when both are due', () => {
    expect(washDueState([bath(5, 'full')], R(3, 1), NOON).nextKind).toBe('full');
  });

  // The asymmetry that makes the model survive the child growing up.
  it('lets any bath satisfy the quick-wash clock', () => {
    const s = washDueState([bath(4, 'full'), bath(0, 'quick')], R(3, 1), NOON);
    expect(s.quick).toBe(false);
    expect(s.full).toBe(true);
  });

  it('does not let a quick wash satisfy the full-bath clock', () => {
    const entries = [bath(3, 'full'), bath(2, 'quick'), bath(1, 'quick'), bath(0, 'quick')];
    expect(washDueState(entries, R(3, 1), NOON).full).toBe(true);
  });

  it('never surfaces a quick wash of its own once full baths are daily', () => {
    const s = washDueState([bath(1, 'full')], R(1, 1), NOON);
    expect(s.full).toBe(true);
    expect(s.nextKind).toBe('full');
  });

  it('treats 0 as off, per axis, independently', () => {
    expect(washDueState([bath(9, 'quick')], R(0, 1), NOON).full).toBe(false);
    expect(washDueState([bath(9, 'quick')], R(3, 0), NOON).quick).toBe(false);
    const off = washDueState([], R(0, 0), NOON);
    expect(off.full).toBe(false);
    expect(off.quick).toBe(false);
    expect(off.upcoming).toBeNull();
  });

  it('reports the sooner upcoming wash when nothing is due', () => {
    expect(washDueState([bath(1, 'full')], R(4, 3), NOON).upcoming).toEqual({ kind: 'quick', inDays: 2 });
    expect(washDueState([bath(1, 'full')], R(3, 5), NOON).upcoming).toEqual({ kind: 'full', inDays: 2 });
  });

  it('reports no upcoming wash while one is already due', () => {
    expect(washDueState([bath(5, 'quick')], R(3, 1), NOON).upcoming).toBeNull();
  });

  it('skips an axis that is off when choosing the upcoming wash', () => {
    expect(washDueState([bath(1, 'full')], R(4, 0), NOON).upcoming).toEqual({ kind: 'full', inDays: 3 });
  });

  it('counts calendar days, not 24-hour periods', () => {
    // Bathed at 19:00 yesterday, asked at 08:00 today: one calendar day, so a
    // daily quick wash is due even though only 13 hours have passed.
    const evening = new Date(2026, 5, 14, 19, 0, 0).getTime();
    const morning = new Date(2026, 5, 15, 8, 0, 0).getTime();
    const entry: Entry = { id: 'b', childId: 'c1', type: 'bath', time: evening, wash: 'full', tags: [] };
    expect(washDueState([entry], R(3, 1), morning).quick).toBe(true);
  });

  it('ignores non-bath entries entirely', () => {
    const sleep: Entry = { id: 's1', childId: 'c1', type: 'sleep', start: NOON - DAY, end: NOON, nap: true, tags: [] };
    expect(washDueState([sleep, bath(0, 'full')], R(3, 1), NOON).full).toBe(false);
    expect(washDueState([sleep], R(3, 1), NOON).full).toBe(true);
  });

  it('treats a legacy big wash value as a full bath, so it resets the full-bath clock', () => {
    // A bath still sitting in the offline queue or pending-ops log from before
    // the 2026-08 rename carries the literal legacy 'big', reachable here only
    // via an untyped JSON.parse (reproduced with the cast, since `wash` is
    // typed as `WashKind` post-rename).
    const legacy: Entry = { id: 'b-legacy', childId: 'c1', type: 'bath', time: NOON, wash: 'big', tags: [] } as unknown as Entry;
    const s = washDueState([legacy], R(3, 1), NOON);
    expect(s.full).toBe(false);
  });
});

describe('bath rhythm values', () => {
  it('clamps an interval into 0..30 and rounds', () => {
    expect(clampBathInterval(-4, 3)).toBe(0);
    expect(clampBathInterval(0, 3)).toBe(0);
    expect(clampBathInterval(2.4, 3)).toBe(2);
    expect(clampBathInterval(500, 3)).toBe(30);
  });

  it('falls back rather than inventing a value for a non-number', () => {
    expect(clampBathInterval(NaN, 3)).toBe(3);
    expect(clampBathInterval(Infinity, 3)).toBe(3);
  });

  it('translates the legacy count rhythm to days, plus one', () => {
    expect(legacyBathRhythm(3)).toEqual({ fullEveryDays: 4, quickEveryDays: 1 });
    expect(legacyBathRhythm(1)).toEqual({ fullEveryDays: 2, quickEveryDays: 1 });
  });

  it('uses the built-in default when no legacy value was ever stored', () => {
    expect(legacyBathRhythm(undefined)).toEqual(BATH_RHYTHM_DEFAULT);
    expect(BATH_RHYTHM_DEFAULT).toEqual({ fullEveryDays: 3, quickEveryDays: 1 });
  });

  it('prefers a stored per-child rhythm over the fallback', () => {
    const map = { c1: { fullEveryDays: 1, quickEveryDays: 0 } };
    expect(rhythmForChild(map, 'c1', BATH_RHYTHM_DEFAULT)).toEqual({ fullEveryDays: 1, quickEveryDays: 0 });
    expect(rhythmForChild(map, 'c2', BATH_RHYTHM_DEFAULT)).toEqual(BATH_RHYTHM_DEFAULT);
    expect(rhythmForChild(map, null, BATH_RHYTHM_DEFAULT)).toEqual(BATH_RHYTHM_DEFAULT);
  });

  it('clamps a stored rhythm on the way out, so a bad write cannot poison it', () => {
    const map = { c1: { fullEveryDays: 999, quickEveryDays: -2 } } as Record<string, BathRhythm>;
    expect(rhythmForChild(map, 'c1', BATH_RHYTHM_DEFAULT)).toEqual({ fullEveryDays: 30, quickEveryDays: 0 });
  });
});

describe('bathGivenToday', () => {
  const NOON = new Date(2026, 0, 15, 12, 0, 0).getTime(); // 2026-01-15, local noon
  const bath = (time: number, childId = 'c1'): Entry => ({
    id: `b-${time}`,
    childId,
    type: 'bath',
    time,
    wash: 'quick',
    tags: [],
  });

  it('is true when a wash is logged earlier the same local day', () => {
    const morning = new Date(2026, 0, 15, 7, 30, 0).getTime();
    expect(bathGivenToday([bath(morning)], NOON)).toBe(true);
  });

  it('is true even for a wash logged later the same day than now', () => {
    // Same wall-clock day is what counts, not whether it is before `now`.
    const evening = new Date(2026, 0, 15, 20, 0, 0).getTime();
    expect(bathGivenToday([bath(evening)], NOON)).toBe(true);
  });

  it('is false with no washes at all', () => {
    expect(bathGivenToday([], NOON)).toBe(false);
  });

  it('is false when the only wash was yesterday', () => {
    const yesterday = new Date(2026, 0, 14, 8, 0, 0).getTime();
    expect(bathGivenToday([bath(yesterday)], NOON)).toBe(false);
  });

  it('resets at local midnight: a wash one minute before midnight is not today', () => {
    const justBeforeMidnight = new Date(2026, 0, 14, 23, 59, 0).getTime();
    const justAfterMidnight = new Date(2026, 0, 15, 0, 1, 0).getTime();
    expect(bathGivenToday([bath(justBeforeMidnight)], NOON)).toBe(false);
    expect(bathGivenToday([bath(justAfterMidnight)], NOON)).toBe(true);
  });

  it('ignores non-bath entries logged today', () => {
    const feed: Entry = { id: 'f', childId: 'c1', type: 'feeding', start: NOON, end: NOON + 1, feedType: 'breast', method: 'left', amount: null, tags: [] };
    const diaper: Entry = { id: 'd', childId: 'c1', type: 'diaper', time: NOON, wet: true, solid: false, color: null, tags: [] };
    expect(bathGivenToday([feed, diaper], NOON)).toBe(false);
  });

  it('respects child scoping when composed with entriesForChild', () => {
    // The helper reads already-scoped entries; a sibling's wash today must not
    // leak in once scoping is applied upstream.
    const mine = bath(new Date(2026, 0, 15, 9, 0, 0).getTime(), 'c1');
    const sibling = bath(new Date(2026, 0, 15, 9, 0, 0).getTime(), 'c2');
    expect(bathGivenToday(entriesForChild([mine, sibling], 'c1'), NOON)).toBe(true);
    expect(bathGivenToday(entriesForChild([sibling], 'c1'), NOON)).toBe(false);
  });
});

describe('entriesForChild / measurementsForChild', () => {
  const mine: Entry = { id: 'a', childId: 'c1', type: 'diaper', time: NOW, solid: false, wet: true, color: null, tags: [] };
  const sibling: Entry = { id: 'b', childId: 'c2', type: 'diaper', time: NOW, solid: false, wet: true, color: null, tags: [] };

  it('keeps only the entries owned by the given child', () => {
    expect(entriesForChild([mine, sibling], 'c1')).toEqual([mine]);
    expect(entriesForChild([mine, sibling], 'c2')).toEqual([sibling]);
  });

  it('returns nothing when no child is selected, rather than everything', () => {
    expect(entriesForChild([mine, sibling], '')).toEqual([]);
    expect(entriesForChild([mine, sibling], undefined)).toEqual([]);
  });

  it('returns nothing for a child that owns no entries (the expecting case)', () => {
    expect(entriesForChild([mine, sibling], 'c3')).toEqual([]);
  });

  const w1: Measurement = { id: 'm1', childId: 'c1', kind: 'weight', value: 4, date: NOW };
  const w2: Measurement = { id: 'm2', childId: 'c2', kind: 'weight', value: 5, date: NOW };

  it('scopes measurements the same way', () => {
    expect(measurementsForChild([w1, w2], 'c1')).toEqual([w1]);
    expect(measurementsForChild([w1, w2], '')).toEqual([]);
    expect(measurementsForChild([w1, w2], undefined)).toEqual([]);
  });
});

describe('timersForChild', () => {
  const timer = (id: string, childId?: string): Timer => ({
    id,
    childId,
    activity: 'sleep',
    saveAs: 'sleep',
    name: id,
    start: NOW - 20 * M,
  });

  it('keeps only the timers owned by the given child', () => {
    const mine = timer('t1', 'c1');
    const sibling = timer('t2', 'c2');
    expect(timersForChild([mine, sibling], 'c1')).toEqual([mine]);
    expect(timersForChild([mine, sibling], 'c2')).toEqual([sibling]);
  });

  it('adopts an unowned timer, which the rest of the app already reads as the current child', () => {
    const unowned = timer('t3');
    const sibling = timer('t2', 'c2');
    expect(timersForChild([unowned, sibling], 'c1')).toEqual([unowned]);
  });

  it('returns nothing when no child is selected, rather than everything', () => {
    const mine = timer('t1', 'c1');
    const unowned = timer('t3');
    expect(timersForChild([mine, unowned], '')).toEqual([]);
    expect(timersForChild([mine, unowned], undefined)).toEqual([]);
  });

  it('returns nothing but the unowned ones for a child running no timer', () => {
    expect(timersForChild([timer('t1', 'c1'), timer('t2', 'c2')], 'c3')).toEqual([]);
  });
});

describe('runningTimer', () => {
  // Override factory rather than positional args: the interesting cases vary
  // `activity` against `saveAs` and `childId` independently.
  const timer = (over: Partial<Timer> = {}): Timer => ({
    id: 't1',
    childId: 'c1',
    activity: 'sleep',
    saveAs: 'sleep',
    name: 'Sleep',
    start: NOW - 20 * M,
    ...over,
  });

  it('keys on saveAs, so a quick timer repointed to sleep counts as a sleep timer', () => {
    const repointed = timer({ activity: 'feeding', saveAs: 'sleep', name: 'Sleep' });
    expect(runningTimer([repointed], 'sleep', 'c1', 'c1')).toBe(repointed);
  });

  it('ignores activity, so a timer started as sleep but repointed to feeding is a feeding timer', () => {
    const repointed = timer({ activity: 'sleep', saveAs: 'feeding' });
    expect(runningTimer([repointed], 'sleep', 'c1', 'c1')).toBeUndefined();
    expect(runningTimer([repointed], 'feeding', 'c1', 'c1')).toBe(repointed);
  });

  it('finds an owned timer for its own child and not for a sibling', () => {
    const mine = timer({ childId: 'c1' });
    expect(runningTimer([mine], 'sleep', 'c1', 'c1')).toBe(mine);
    expect(runningTimer([mine], 'sleep', 'c2', 'c2')).toBeUndefined();
  });

  it('resolves an unowned timer to the selected child only, never to a sibling', () => {
    // The distinction napReminders depends on: an unowned timer means the
    // SELECTED child is asleep, so it must not silence another child's nudge.
    const unowned = timer({ childId: undefined });
    expect(runningTimer([unowned], 'sleep', 'c1', 'c1')).toBe(unowned);
    expect(runningTimer([unowned], 'sleep', 'c2', 'c1')).toBeUndefined();
  });

  it('treats an empty-string childId as owned, not unowned', () => {
    // Pins the choice of `??` over `||`: an empty string is a (nonsense) owner,
    // so it must not be adopted by the selected child the way a missing id is.
    // `||` would coalesce it and silently diverge from the old timersForChild rule.
    expect(runningTimer([timer({ childId: '' })], 'sleep', 'c1', 'c1')).toBeUndefined();
  });

  it('reads a persisted null childId as unowned, like a missing one', () => {
    const unowned = { ...timer(), childId: null } as unknown as Timer;
    expect(runningTimer([unowned], 'sleep', 'c1', 'c1')).toBe(unowned);
    expect(runningTimer([unowned], 'sleep', 'c2', 'c1')).toBeUndefined();
  });

  it('finds nothing with no child to scope to, rather than adopting an unowned timer', () => {
    const unowned = timer({ childId: undefined });
    expect(runningTimer([unowned], 'sleep', undefined, undefined)).toBeUndefined();
    expect(runningTimer([unowned], 'sleep', '', '')).toBeUndefined();
  });

  it('leaves an unowned timer unadopted when no child is selected to adopt it', () => {
    const unowned = timer({ childId: undefined });
    expect(runningTimer([unowned], 'sleep', 'c1', undefined)).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(runningTimer([], 'sleep', 'c1', 'c1')).toBeUndefined();
  });

  it('returns the first match when two timers of one kind run at once', () => {
    const first = timer({ id: 't1', start: NOW - 20 * M });
    const second = timer({ id: 't2', start: NOW - 5 * M });
    expect(runningTimer([first, second], 'sleep', 'c1', 'c1')).toBe(first);
  });

  it('applies the same adoption rule as timersForChild for the selected child', () => {
    // timersForChild is the special case childId === selectedChildId, so the
    // two must agree for every child. One rule, two shapes.
    const all = [timer({ id: 't1', childId: 'c1' }), timer({ id: 't2', childId: undefined }), timer({ id: 't3', childId: 'c2' })];
    for (const c of ['c1', 'c2', 'c3', '']) {
      expect(runningTimer(all, 'sleep', c, c)).toBe(timersForChild(all, c)[0]);
    }
  });
});

describe('minuteOfDayIsNap', () => {
  const W = { startMin: 420, endMin: 1140 }; // 07:00 to 19:00, the default

  it('matches the old hardcoded 07:00-19:00 rule across the whole day', () => {
    for (let m = 0; m < 1440; m++) {
      expect(minuteOfDayIsNap(m, W)).toBe(m >= 420 && m < 1140);
    }
  });

  it('treats start as inclusive and end as exclusive', () => {
    expect(minuteOfDayIsNap(419, W)).toBe(false);
    expect(minuteOfDayIsNap(420, W)).toBe(true); // start: in
    expect(minuteOfDayIsNap(1139, W)).toBe(true);
    expect(minuteOfDayIsNap(1140, W)).toBe(false); // end: out
  });

  it('wraps around midnight when start is later than end', () => {
    // A night-shift household: "naps" run 20:00 to 04:00.
    const w = { startMin: 1200, endMin: 240 };
    expect(minuteOfDayIsNap(1200, w)).toBe(true); // 20:00, start inclusive
    expect(minuteOfDayIsNap(1439, w)).toBe(true); // 23:59
    expect(minuteOfDayIsNap(0, w)).toBe(true); // midnight, inside the wrap
    expect(minuteOfDayIsNap(239, w)).toBe(true); // 03:59
    expect(minuteOfDayIsNap(240, w)).toBe(false); // 04:00, end exclusive
    expect(minuteOfDayIsNap(720, w)).toBe(false); // noon, outside
    expect(minuteOfDayIsNap(1199, w)).toBe(false); // 19:59
  });

  it('reads start === end as an empty window, so nothing is a nap', () => {
    // Half-open [s, s) is empty. That is the consistent reading of an
    // inclusive start and an exclusive end, and it gives a usable state:
    // an older child who no longer naps, so every sleep is night sleep.
    const w = { startMin: 420, endMin: 420 };
    for (let m = 0; m < 1440; m += 7) expect(minuteOfDayIsNap(m, w)).toBe(false);
    expect(minuteOfDayIsNap(420, w)).toBe(false);
  });

  it('handles a full-day-minus-one-minute window', () => {
    const w = { startMin: 0, endMin: 1439 };
    expect(minuteOfDayIsNap(0, w)).toBe(true);
    expect(minuteOfDayIsNap(1438, w)).toBe(true);
    expect(minuteOfDayIsNap(1439, w)).toBe(false);
  });

  it('defaults to the 07:00-19:00 window when none is passed', () => {
    expect(minuteOfDayIsNap(720)).toBe(true);
    expect(minuteOfDayIsNap(120)).toBe(false);
  });
});

describe('isNapStart', () => {
  it('classifies on the local wall clock of the given instant', () => {
    const noon = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const night = new Date(2026, 0, 1, 2, 0, 0).getTime();
    expect(isNapStart(noon)).toBe(true);
    expect(isNapStart(night)).toBe(false);
  });

  it('honours a custom window', () => {
    const nine = new Date(2026, 0, 1, 9, 0, 0).getTime();
    expect(isNapStart(nine, { startMin: 600, endMin: 1140 })).toBe(false); // window opens at 10:00
    expect(isNapStart(nine, { startMin: 480, endMin: 1140 })).toBe(true); // window opens at 08:00
  });

  it('respects the minute, not just the hour', () => {
    const w = { startMin: 450, endMin: 1140 }; // 07:30
    expect(isNapStart(new Date(2026, 0, 1, 7, 29, 0).getTime(), w)).toBe(false);
    expect(isNapStart(new Date(2026, 0, 1, 7, 30, 0).getTime(), w)).toBe(true);
  });
});

describe('clampMinuteOfDay', () => {
  it('keeps in-range values, including 0', () => {
    expect(clampMinuteOfDay(0, 420)).toBe(0);
    expect(clampMinuteOfDay(1439, 420)).toBe(1439);
    expect(clampMinuteOfDay(630, 420)).toBe(630);
  });

  it('falls back for non-finite input rather than producing NaN', () => {
    expect(clampMinuteOfDay(NaN, 420)).toBe(420);
    expect(clampMinuteOfDay(Infinity, 1140)).toBe(1140);
  });

  it('clamps out-of-range values into the day', () => {
    expect(clampMinuteOfDay(-30, 420)).toBe(0);
    expect(clampMinuteOfDay(5000, 420)).toBe(1439);
  });

  it('rounds a fractional minute', () => {
    expect(clampMinuteOfDay(420.6, 0)).toBe(421);
  });
});

describe('fmtMinuteOfDay', () => {
  it('renders a zero-padded 24-hour clock', () => {
    expect(fmtMinuteOfDay(0)).toBe('00:00');
    expect(fmtMinuteOfDay(420)).toBe('07:00');
    expect(fmtMinuteOfDay(1140)).toBe('19:00');
    expect(fmtMinuteOfDay(1230)).toBe('20:30');
    expect(fmtMinuteOfDay(1439)).toBe('23:59');
  });
});

describe('fmtDayStartHour', () => {
  it('renders a 24-hour day-boundary label with word forms for noon/midnight', () => {
    expect(fmtDayStartHour(0)).toBe('midnight');
    expect(fmtDayStartHour(7)).toBe('7:00');
    expect(fmtDayStartHour(12)).toBe('noon');
    expect(fmtDayStartHour(19)).toBe('19:00');
    expect(fmtDayStartHour(23)).toBe('23:00');
  });

  it('coerces out-of-range hours before labelling', () => {
    expect(fmtDayStartHour(24)).toBe('23:00');
    expect(fmtDayStartHour(-3)).toBe('midnight');
    expect(fmtDayStartHour(NaN)).toBe('noon'); // falls back to RHYTHM_ORIGIN_DEFAULT (12)
  });
});

describe('parseMinuteOfDay', () => {
  it('parses a full clock string', () => {
    expect(parseMinuteOfDay('07:00')).toBe(420);
    expect(parseMinuteOfDay('19:00')).toBe(1140);
    expect(parseMinuteOfDay('00:00')).toBe(0);
    expect(parseMinuteOfDay('23:59')).toBe(1439);
  });

  it('parses digits-first shorthand', () => {
    expect(parseMinuteOfDay('7')).toBe(420);
    expect(parseMinuteOfDay('19')).toBe(1140);
    expect(parseMinuteOfDay('730')).toBe(450);
    expect(parseMinuteOfDay('1930')).toBe(1170);
  });

  it('reaches minute granularity the old half-hour grid could not', () => {
    expect(parseMinuteOfDay('715')).toBe(435);
    expect(parseMinuteOfDay('7:15')).toBe(435);
  });

  it('rejects text that is not a 24-hour time', () => {
    expect(parseMinuteOfDay('')).toBeNull();
    expect(parseMinuteOfDay('   ')).toBeNull();
    expect(parseMinuteOfDay('7pm')).toBeNull();
    expect(parseMinuteOfDay('24:00')).toBeNull();
    expect(parseMinuteOfDay('7:75')).toBeNull();
    expect(parseMinuteOfDay('99999')).toBeNull();
  });

  it('round-trips with fmtMinuteOfDay', () => {
    for (const min of [0, 1, 435, 420, 1140, 1439]) {
      expect(parseMinuteOfDay(fmtMinuteOfDay(min))).toBe(min);
    }
  });
});

describe('startOfDay', () => {
  it('floors a timestamp to local midnight of its own day', () => {
    const noonish = new Date(2026, 2, 4, 13, 45, 12, 500).getTime();
    const midnight = new Date(2026, 2, 4, 0, 0, 0, 0).getTime();
    expect(startOfDay(noonish)).toBe(midnight);
  });
  it('is idempotent on a value already at midnight', () => {
    const midnight = new Date(2026, 2, 4, 0, 0, 0, 0).getTime();
    expect(startOfDay(midnight)).toBe(midnight);
  });
});

describe('isTreatmentActiveToday / activeTreatmentsForChildToday', () => {
  // Local-midnight day anchors so the numeric range compare is exact.
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const TODAY = day(2026, 3, 4);

  const base: Treatment = {
    id: 'treatment-1',
    childId: 'c1',
    name: 'Paracetamol',
    scheduleMode: 'everyHours',
    everyHours: 6,
    fromDate: day(2026, 3, 1),
    toDate: day(2026, 3, 10),
    active: true,
  };

  it('is active inside the range for the matching child', () => {
    expect(isTreatmentActiveToday(base, TODAY, 'c1')).toBe(true);
  });
  it('is inactive when paused', () => {
    expect(isTreatmentActiveToday({ ...base, active: false }, TODAY, 'c1')).toBe(false);
  });
  it('is inactive for a different child (per-child scoping)', () => {
    expect(isTreatmentActiveToday(base, TODAY, 'c2')).toBe(false);
    expect(isTreatmentActiveToday({ ...base, childId: 'c2' }, TODAY, 'c1')).toBe(false);
  });
  it('is inactive before the from date and active exactly on it', () => {
    expect(isTreatmentActiveToday({ ...base, fromDate: day(2026, 3, 5) }, TODAY, 'c1')).toBe(false);
    expect(isTreatmentActiveToday({ ...base, fromDate: TODAY }, TODAY, 'c1')).toBe(true);
  });
  it('is inactive after the to date and active exactly on it (inclusive boundary)', () => {
    expect(isTreatmentActiveToday({ ...base, toDate: day(2026, 3, 3) }, TODAY, 'c1')).toBe(false);
    expect(isTreatmentActiveToday({ ...base, toDate: TODAY }, TODAY, 'c1')).toBe(true);
  });
  it('treats an undefined to date as open-ended', () => {
    expect(isTreatmentActiveToday({ ...base, toDate: undefined }, TODAY, 'c1')).toBe(true);
  });

  it('activeTreatmentsForChildToday keeps only this child\'s active-today treatments', () => {
    const treatments: Treatment[] = [
      base, // active, c1
      { ...base, id: 'treatment-2', childId: 'c2' }, // other child
      { ...base, id: 'treatment-3', active: false }, // paused
      { ...base, id: 'treatment-4', toDate: day(2026, 3, 3) }, // ended yesterday
      { ...base, id: 'treatment-5', toDate: undefined }, // open-ended, active
    ];
    expect(activeTreatmentsForChildToday(treatments, 'c1', TODAY).map((c) => c.id)).toEqual(['treatment-1', 'treatment-5']);
  });
  it('activeTreatmentsForChildToday returns [] when no child is selected', () => {
    expect(activeTreatmentsForChildToday([base], '', TODAY)).toEqual([]);
  });
});

describe('treatmentDueState / treatmentDueList / treatmentDueHint / treatmentsAllGiven', () => {
  // A fixed local day so every slot hour is exact.
  const at = (h: number, min = 0) => new Date(2026, 2, 4, h, min, 0, 0).getTime();
  const dayAt = (d: number, h: number) => new Date(2026, 2, d, h, 0, 0, 0).getTime();
  const FROM = new Date(2026, 2, 1, 0, 0, 0, 0).getTime();

  const treatment = (over: Partial<Treatment> = {}): Treatment => ({
    id: 'treatment-1',
    childId: 'c1',
    name: 'Omeprazol',
    scheduleMode: 'timesOfDay',
    timesOfDay: ['morning', 'evening'],
    fromDate: FROM,
    active: true,
    ...over,
  });

  const dose = (time: number, name = 'Omeprazol', childId = 'c1'): Entry => ({
    id: `m-${time}-${name}`,
    childId,
    type: 'medication',
    time,
    name,
    tags: [],
  });

  describe('times-of-day treatments', () => {
    it('owes nothing before the first slot is reached', () => {
      // 07:00, ahead of the 08:00 morning slot: nothing is late yet.
      expect(treatmentDueState(treatment(), [], at(7))).toMatchObject({ due: 0, expected: 0 });
    });

    it('owes a dose once a slot is reached, exactly on the hour', () => {
      expect(treatmentDueState(treatment(), [], at(8))).toMatchObject({ due: 1, expected: 1 });
      expect(treatmentDueState(treatment(), [], at(7, 59))).toMatchObject({ due: 0, expected: 0 });
    });

    it('is settled by a dose logged for that slot', () => {
      expect(treatmentDueState(treatment(), [dose(at(8, 30))], at(9))).toMatchObject({ due: 0, expected: 1 });
    });

    it('owes the second slot once evening arrives', () => {
      const doses = [dose(at(8, 30))];
      expect(treatmentDueState(treatment(), doses, at(17))).toMatchObject({ due: 0, expected: 1 });
      expect(treatmentDueState(treatment(), doses, at(18, 1))).toMatchObject({ due: 1, expected: 2 });
    });

    it('a single late dose settles ONE owed slot, not every earlier one', () => {
      // Morning skipped, one dose at 19:00. Counting (not per-slot clearing) is
      // what keeps the skipped morning dose owed.
      expect(treatmentDueState(treatment(), [dose(at(19))], at(19, 30))).toMatchObject({ due: 1, expected: 2 });
    });

    it('counts every slot of a four-times-a-day treatment', () => {
      const c = treatment({ timesOfDay: ['morning', 'noon', 'evening', 'night'] });
      expect(treatmentDueState(c, [], at(23))).toMatchObject({ due: 4, expected: 4 });
      expect(treatmentDueState(c, [dose(at(8)), dose(at(12))], at(23))).toMatchObject({ due: 2, expected: 4 });
    });

    it('never goes negative when more doses are logged than slots called for', () => {
      expect(treatmentDueState(treatment(), [dose(at(8)), dose(at(9)), dose(at(10))], at(11))).toMatchObject({ due: 0 });
    });

    it('ignores yesterday\'s doses and yesterday\'s slots', () => {
      // A dose given yesterday evening does not settle this morning's slot.
      expect(treatmentDueState(treatment(), [dose(dayAt(3, 19))], at(9))).toMatchObject({ due: 1, expected: 1 });
    });

    it('ignores a dose logged later today than now', () => {
      // `now` is the clock; a future-stamped dose cannot settle a slot yet.
      expect(treatmentDueState(treatment(), [dose(at(20))], at(9))).toMatchObject({ due: 1, expected: 1 });
    });

    it('owes nothing when no times of day are chosen', () => {
      expect(treatmentDueState(treatment({ timesOfDay: undefined }), [], at(23))).toMatchObject({ due: 0, expected: 0 });
    });
  });

  describe('dose-to-treatment matching is by name', () => {
    it('matches case-insensitively and ignores surrounding space', () => {
      expect(treatmentDueState(treatment(), [dose(at(8, 5), '  omeprazol ')], at(9))).toMatchObject({ due: 0 });
    });
    it('does not match a different medication', () => {
      expect(treatmentDueState(treatment(), [dose(at(8, 5), 'Nurofen')], at(9))).toMatchObject({ due: 1 });
    });
    it('reads already-scoped entries, so a sibling\'s dose cannot settle this treatment', () => {
      const mine = dose(at(8, 5));
      const sibling = dose(at(8, 5), 'Omeprazol', 'c2');
      expect(treatmentDueState(treatment(), entriesForChild([sibling], 'c1'), at(9))).toMatchObject({ due: 1 });
      expect(treatmentDueState(treatment(), entriesForChild([mine, sibling], 'c1'), at(9))).toMatchObject({ due: 0 });
    });
    it('ignores non-medication entries', () => {
      const bath: Entry = { id: 'b', childId: 'c1', type: 'bath', time: at(8, 5), wash: 'quick', tags: [] };
      expect(treatmentDueState(treatment(), [bath], at(9))).toMatchObject({ due: 1 });
    });
  });

  describe('interval treatments', () => {
    const every6 = treatment({ scheduleMode: 'everyHours', everyHours: 6, timesOfDay: undefined });

    it('owes a dose immediately when none was ever logged', () => {
      // fromDate has already passed, so the regimen has started and dose one is late.
      expect(treatmentDueState(every6, [], at(1))).toMatchObject({ due: 1 });
    });

    it('is settled until the interval elapses, then owes again', () => {
      const doses = [dose(at(8))];
      expect(treatmentDueState(every6, doses, at(13, 59))).toMatchObject({ due: 0, expected: 1 });
      expect(treatmentDueState(every6, doses, at(14))).toMatchObject({ due: 1, expected: 2 });
    });

    it('counts from the LATEST dose, not the first', () => {
      expect(treatmentDueState(every6, [dose(at(8)), dose(at(11))], at(16))).toMatchObject({ due: 0 });
      expect(treatmentDueState(every6, [dose(at(8)), dose(at(11))], at(17, 1))).toMatchObject({ due: 1 });
    });

    it('owes at most one dose no matter how many intervals were missed', () => {
      // 08:00 yesterday, now 23:00 today: many intervals lapsed, still one state.
      expect(treatmentDueState(every6, [dose(dayAt(3, 8))], at(23))).toMatchObject({ due: 1 });
    });

    it('owes nothing when the interval has not been set', () => {
      expect(treatmentDueState(treatment({ scheduleMode: 'everyHours', everyHours: undefined, timesOfDay: undefined }), [], at(12)))
        .toMatchObject({ due: 0, expected: 0 });
    });
  });

  describe('treatmentDueList', () => {
    const owed = treatment({ id: 'owed', name: 'Omeprazol', timesOfDay: ['morning'] });
    const settled = treatment({ id: 'settled', name: 'Nurofen', timesOfDay: ['morning'] });

    it('sorts owed treatments first, keeping stored order within each group', () => {
      const treatments = [settled, owed, treatment({ id: 'later', name: 'Vitamin D', timesOfDay: ['night'] })];
      const list = treatmentDueList(treatments, 'c1', [dose(at(8, 5), 'Nurofen')], at(9));
      expect(list.map((d) => d.treatment.id)).toEqual(['owed', 'settled', 'later']);
      expect(list.map((d) => d.due)).toEqual([1, 0, 0]);
    });

    it('drops treatments that are not active for this child today', () => {
      const treatments = [owed, treatment({ id: 'paused', active: false }), treatment({ id: 'other', childId: 'c2' })];
      expect(treatmentDueList(treatments, 'c1', [], at(9)).map((d) => d.treatment.id)).toEqual(['owed']);
    });

    it('returns [] when no child is selected', () => {
      expect(treatmentDueList([owed], undefined, [], at(9))).toEqual([]);
    });
  });

  describe('treatmentDueHint / treatmentsAllGiven', () => {
    const morning = treatment({ id: 'a', name: 'Omeprazol', timesOfDay: ['morning'] });
    const noon = treatment({ id: 'b', name: 'Nurofen', timesOfDay: ['noon'] });

    it('names the treatment when exactly one dose is owed', () => {
      expect(treatmentDueHint(treatmentDueList([morning], 'c1', [], at(9)))).toBe('Omeprazol due');
    });

    it('trims the name it puts in the hint', () => {
      const padded = treatment({ id: 'a', name: '  Omeprazol  ', timesOfDay: ['morning'] });
      expect(treatmentDueHint(treatmentDueList([padded], 'c1', [], at(9)))).toBe('Omeprazol due');
    });

    it('counts instead of naming once more than one dose is owed', () => {
      expect(treatmentDueHint(treatmentDueList([morning, noon], 'c1', [], at(13)))).toBe('2 doses due');
    });

    it('counts multiple owed doses of the SAME treatment', () => {
      const twice = treatment({ timesOfDay: ['morning', 'noon'] });
      expect(treatmentDueHint(treatmentDueList([twice], 'c1', [], at(13)))).toBe('2 doses due');
    });

    it('reports all given once every owed dose is logged, and shows the check', () => {
      const list = treatmentDueList([morning], 'c1', [dose(at(8, 10))], at(9));
      expect(treatmentDueHint(list)).toBe('All doses given');
      expect(treatmentsAllGiven(list)).toBe(true);
    });

    it('says nothing is due before the first slot, with no check', () => {
      // Doses were never called for today yet, so "all given" would be a lie.
      const list = treatmentDueList([morning], 'c1', [], at(7));
      expect(treatmentDueHint(list)).toBe('Nothing due');
      expect(treatmentsAllGiven(list)).toBe(false);
    });

    it('gives no hint and no check when the child has no active treatments', () => {
      expect(treatmentDueHint([])).toBeNull();
      expect(treatmentsAllGiven([])).toBe(false);
    });

    it('shows no check while a dose is still owed', () => {
      expect(treatmentsAllGiven(treatmentDueList([morning], 'c1', [], at(9)))).toBe(false);
    });
  });

  describe('treatmentDoseScalars', () => {
    it("counts today's doses and reports the latest dose instant", () => {
      const out = treatmentDoseScalars([treatment()], [dayAt(3, 8), at(8), at(12)].map((t) => dose(t)), at(14));
      expect(out['treatment-1']).toEqual({ today: 2, lastAt: at(12) });
    });

    it('matches a dose to its treatment by trimmed, case-insensitive name', () => {
      const out = treatmentDoseScalars([treatment()], [dose(at(8), '  omeprazol ')], at(14));
      expect(out['treatment-1'].today).toBe(1);
    });

    it('ignores a dose for a different medication', () => {
      const out = treatmentDoseScalars([treatment()], [dose(at(8), 'Paracetamol')], at(14));
      expect(out['treatment-1']).toEqual({ today: 0, lastAt: null });
    });

    it('reports a treatment with no doses at all rather than omitting it', () => {
      expect(treatmentDoseScalars([treatment()], [], at(14))['treatment-1']).toEqual({ today: 0, lastAt: null });
    });

    it('ignores a dose stamped in the future, matching treatmentDueState', () => {
      const out = treatmentDoseScalars([treatment()], [dose(at(20))], at(14));
      expect(out['treatment-1']).toEqual({ today: 0, lastAt: null });
    });

    it('keys every treatment it is given', () => {
      const out = treatmentDoseScalars([treatment(), treatment({ id: 'treatment-2', name: 'Amoxicilline' })], [dose(at(8))], at(14));
      expect(Object.keys(out).sort()).toEqual(['treatment-1', 'treatment-2']);
      expect(out['treatment-2']).toEqual({ today: 0, lastAt: null });
    });
  });
});
