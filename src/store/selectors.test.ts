import { describe, expect, it } from 'vitest';

import { lastDiaperMinAgo, lastFeedEndMinAgo, lastFeedStartMinAgo, lastWakeMinAgo, nextStartSide, nextWashKind, overruleLasted, teDurationMin, teEnd, teStart } from '@/store/selectors';
import type { Entry } from '@/types/models';
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
  it('lastDiaperMinAgo picks the most recent change', () => {
    expect(lastDiaperMinAgo(entries, NOW)).toBe(45);
    expect(lastDiaperMinAgo([], NOW)).toBeNull();
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

  it('defaults to small with no bath history', () => {
    expect(nextWashKind([])).toBe('small');
  });
  it('is small with fewer than three washes', () => {
    expect(nextWashKind([bath(NOW - 2 * M, 'small'), bath(NOW - M, 'small')])).toBe('small');
  });
  it('the three most recent all small => big is due', () => {
    const entries: Entry[] = [
      bath(NOW - 3 * M, 'small'),
      bath(NOW - 2 * M, 'small'),
      bath(NOW - M, 'small'),
    ];
    expect(nextWashKind(entries)).toBe('big');
  });
  it('a big as the most recent wash => back to small', () => {
    const entries: Entry[] = [
      bath(NOW - 3 * M, 'small'),
      bath(NOW - 2 * M, 'small'),
      bath(NOW - M, 'big'),
    ];
    expect(nextWashKind(entries)).toBe('small');
  });
  it('looks only at the three most recent, ignoring older washes', () => {
    // three recent smalls => big, even though an older big precedes them
    const entries: Entry[] = [
      bath(NOW - 4 * M, 'big'),
      bath(NOW - 3 * M, 'small'),
      bath(NOW - 2 * M, 'small'),
      bath(NOW - M, 'small'),
    ];
    expect(nextWashKind(entries)).toBe('big');
  });
  it('ignores non-bath entries when reading the rhythm', () => {
    const entries: Entry[] = [
      { id: 'f', childId: 'c1', type: 'feeding', start: NOW - M, end: NOW, feedType: 'breast', method: 'left', amount: null, tags: [] },
      bath(NOW - 3 * M, 'small'),
      bath(NOW - 2 * M, 'small'),
      bath(NOW - M, 'small'),
    ];
    expect(nextWashKind(entries)).toBe('big');
  });
});
