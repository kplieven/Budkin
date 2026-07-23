import { describe, expect, it } from 'vitest';

import { activeCuresForChildToday, bathGivenToday, clampMinuteOfDay, clampSmallWashesPerBig, endAnchorVisible, entriesForChild, fmtMinuteOfDay, isCureActiveToday, isNapStart, lastDiaperMinAgo, lastFeedEndMinAgo, lastFeedStartMinAgo, lastSleepStartMinAgo, lastWakeMinAgo, minuteOfDayIsNap, nextStartSide, measurementsForChild, nextWashKind, overruleLasted, parseMinuteOfDay, SMALL_WASHES_PER_BIG_DEFAULT, startOfDay, teDurationMin, teEnd, teStart, timersForChild } from '@/store/selectors';
import type { Cure, Entry, Measurement, Timer } from '@/types/models';
import type { TimeEntryState } from '@/types/timeEntry';

const NOW = 1_700_000_000_000;
const M = 60000;

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

describe('nextWashKind', () => {
  const bath = (time: number, wash: 'small' | 'big'): Entry => ({
    id: `b-${time}`,
    childId: 'c1',
    type: 'bath',
    time,
    wash,
    tags: [],
  });

  /** `n` consecutive small washes, oldest first, ending one minute ago. */
  const smalls = (n: number): Entry[] => Array.from({ length: n }, (_, i) => bath(NOW - (n - i) * M, 'small'));

  it('defaults to small with no bath history', () => {
    expect(nextWashKind([])).toBe('small');
  });
  it('an omitted interval means three smalls, matching the historical rule', () => {
    expect(nextWashKind(smalls(2))).toBe('small');
    expect(nextWashKind(smalls(3))).toBe('big');
  });
  it('is small with fewer washes on record than the interval', () => {
    expect(nextWashKind(smalls(2), 3)).toBe('small');
    expect(nextWashKind(smalls(6), 7)).toBe('small');
  });
  it('flips to big exactly on the configured number of smalls', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 30]) {
      expect(nextWashKind(smalls(n - 1), n)).toBe('small');
      expect(nextWashKind(smalls(n), n)).toBe('big');
    }
  });
  it('an interval of 1 alternates small, big, small, big', () => {
    expect(nextWashKind([], 1)).toBe('small');
    expect(nextWashKind([bath(NOW - M, 'small')], 1)).toBe('big');
    expect(nextWashKind([bath(NOW - 2 * M, 'small'), bath(NOW - M, 'big')], 1)).toBe('small');
  });
  it('an interval of 7 needs seven smalls before a big is due', () => {
    expect(nextWashKind(smalls(7), 7)).toBe('big');
    expect(nextWashKind([bath(NOW - 8 * M, 'big'), ...smalls(6)], 7)).toBe('small');
  });
  it('raising the interval takes a big wash back off the schedule', () => {
    // The same history reads differently under a different rhythm: derived from
    // history every time, never from a stored counter.
    const history = smalls(3);
    expect(nextWashKind(history, 3)).toBe('big');
    expect(nextWashKind(history, 5)).toBe('small');
  });
  it('a big as the most recent wash => back to small', () => {
    const entries: Entry[] = [
      bath(NOW - 3 * M, 'small'),
      bath(NOW - 2 * M, 'small'),
      bath(NOW - M, 'big'),
    ];
    expect(nextWashKind(entries, 3)).toBe('small');
  });
  it('looks only at the most recent interval, ignoring older washes', () => {
    // three recent smalls => big, even though an older big precedes them
    const entries: Entry[] = [bath(NOW - 4 * M, 'big'), ...smalls(3)];
    expect(nextWashKind(entries, 3)).toBe('big');
  });
  it('ignores non-bath entries when reading the rhythm', () => {
    const entries: Entry[] = [
      { id: 'f', childId: 'c1', type: 'feeding', start: NOW - M, end: NOW, feedType: 'breast', method: 'left', amount: null, tags: [] },
      ...smalls(3),
    ];
    expect(nextWashKind(entries, 3)).toBe('big');
  });
  it('clamps a nonsense interval rather than reading an empty window as due', () => {
    // slice(0, 0) would be an empty array, and [].every() is vacuously true —
    // i.e. "big wash due" forever. 0 must clamp up to the 1 minimum instead.
    expect(nextWashKind([], 0)).toBe('small');
    expect(nextWashKind([bath(NOW - M, 'small')], 0)).toBe('big');
    expect(nextWashKind(smalls(29), 99)).toBe('small'); // 99 clamps to the 30 maximum
    expect(nextWashKind(smalls(30), 99)).toBe('big');
    expect(nextWashKind(smalls(3), Number.NaN)).toBe('big'); // falls back to the default 3
  });
});

describe('bathGivenToday', () => {
  const NOON = new Date(2026, 0, 15, 12, 0, 0).getTime(); // 2026-01-15, local noon
  const bath = (time: number, childId = 'c1'): Entry => ({
    id: `b-${time}`,
    childId,
    type: 'bath',
    time,
    wash: 'small',
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

describe('clampSmallWashesPerBig', () => {
  it('passes every supported rhythm through untouched', () => {
    for (let n = 1; n <= 30; n++) expect(clampSmallWashesPerBig(n)).toBe(n);
  });
  it('clamps to the 1..30 range', () => {
    expect(clampSmallWashesPerBig(0)).toBe(1);
    expect(clampSmallWashesPerBig(-4)).toBe(1);
    expect(clampSmallWashesPerBig(31)).toBe(30);
    expect(clampSmallWashesPerBig(1000)).toBe(30);
  });
  it('rounds a fractional rhythm', () => {
    expect(clampSmallWashesPerBig(2.4)).toBe(2);
    expect(clampSmallWashesPerBig(2.6)).toBe(3);
  });
  it('falls back to the default for a non-finite value', () => {
    expect(clampSmallWashesPerBig(Number.NaN)).toBe(SMALL_WASHES_PER_BIG_DEFAULT);
    expect(clampSmallWashesPerBig(Number.POSITIVE_INFINITY)).toBe(SMALL_WASHES_PER_BIG_DEFAULT);
  });
  it('the default is 3 smalls between bigs, preserving the original rhythm', () => {
    expect(SMALL_WASHES_PER_BIG_DEFAULT).toBe(3);
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

describe('isCureActiveToday / activeCuresForChildToday', () => {
  // Local-midnight day anchors so the numeric range compare is exact.
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const TODAY = day(2026, 3, 4);

  const base: Cure = {
    id: 'cure-1',
    childId: 'c1',
    name: 'Paracetamol',
    scheduleMode: 'everyHours',
    everyHours: 6,
    fromDate: day(2026, 3, 1),
    toDate: day(2026, 3, 10),
    active: true,
  };

  it('is active inside the range for the matching child', () => {
    expect(isCureActiveToday(base, TODAY, 'c1')).toBe(true);
  });
  it('is inactive when paused', () => {
    expect(isCureActiveToday({ ...base, active: false }, TODAY, 'c1')).toBe(false);
  });
  it('is inactive for a different child (per-child scoping)', () => {
    expect(isCureActiveToday(base, TODAY, 'c2')).toBe(false);
    expect(isCureActiveToday({ ...base, childId: 'c2' }, TODAY, 'c1')).toBe(false);
  });
  it('is inactive before the from date and active exactly on it', () => {
    expect(isCureActiveToday({ ...base, fromDate: day(2026, 3, 5) }, TODAY, 'c1')).toBe(false);
    expect(isCureActiveToday({ ...base, fromDate: TODAY }, TODAY, 'c1')).toBe(true);
  });
  it('is inactive after the to date and active exactly on it (inclusive boundary)', () => {
    expect(isCureActiveToday({ ...base, toDate: day(2026, 3, 3) }, TODAY, 'c1')).toBe(false);
    expect(isCureActiveToday({ ...base, toDate: TODAY }, TODAY, 'c1')).toBe(true);
  });
  it('treats an undefined to date as open-ended', () => {
    expect(isCureActiveToday({ ...base, toDate: undefined }, TODAY, 'c1')).toBe(true);
  });

  it('activeCuresForChildToday keeps only this child\'s active-today cures', () => {
    const cures: Cure[] = [
      base, // active, c1
      { ...base, id: 'cure-2', childId: 'c2' }, // other child
      { ...base, id: 'cure-3', active: false }, // paused
      { ...base, id: 'cure-4', toDate: day(2026, 3, 3) }, // ended yesterday
      { ...base, id: 'cure-5', toDate: undefined }, // open-ended, active
    ];
    expect(activeCuresForChildToday(cures, 'c1', TODAY).map((c) => c.id)).toEqual(['cure-1', 'cure-5']);
  });
  it('activeCuresForChildToday returns [] when no child is selected', () => {
    expect(activeCuresForChildToday([base], '', TODAY)).toEqual([]);
  });
});
