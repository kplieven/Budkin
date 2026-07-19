import { describe, expect, it } from 'vitest';

import type { Child, Entry } from '@/types/models';
import { buildWidgetSnapshot } from '@/widgets/snapshot';

const child: Child = { id: 'c1', first: 'Ada', last: 'L', birth: 0, color: '#ffffff' };
const baseState = { children: [child], selectedChildId: 'c1', entries: [], timers: [] };

describe('buildWidgetSnapshot child + queue fields', () => {
  it('passes through selectedChildId', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { mode: 'server', serverUrl: 'http://x', token: 't' } });
    expect(s.selectedChildId).toBe('c1');
  });

  it('canQueueNap is true for a real connection', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { mode: 'server', serverUrl: 'http://x', token: 't' } });
    expect(s.canQueueNap).toBe(true);
  });

  it('canQueueNap is false in demo mode', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { mode: 'local' } });
    expect(s.canQueueNap).toBe(false);
  });

  it('canQueueNap is false with no connection', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: null });
    expect(s.canQueueNap).toBe(false);
  });
});

describe('buildWidgetSnapshot child scoping', () => {
  const NOW = Date.now();
  const sibling: Child = { id: 'c2', first: 'Theo', last: 'L', birth: 0, color: '#000000' };
  // Every record below belongs to the SIBLING, never to the selected child.
  const siblingEntries: Entry[] = [
    { id: 'f1', childId: 'c2', type: 'feeding', start: NOW - 3600000, end: NOW - 3000000, feedType: 'breast', method: 'left', amount: null, tags: [] },
    { id: 'd1', childId: 'c2', type: 'diaper', time: NOW - 1800000, solid: true, wet: false, color: null, tags: [] },
    { id: 's1', childId: 'c2', type: 'sleep', start: NOW - 7200000, end: NOW - 5400000, nap: true, tags: [] },
  ];

  it("ignores a sibling child's records when that child is not selected", () => {
    const s = buildWidgetSnapshot({
      children: [child, sibling],
      selectedChildId: 'c1',
      entries: siblingEntries,
      timers: [],
      connection: null,
    });
    expect(s.lastFeedStart).toBeNull();
    expect(s.lastDiaper).toBeNull();
    expect(s.lastDiaperSolid).toBe(false);
    expect(s.feedsToday).toBe(0);
    expect(s.diapersToday).toBe(0);
    expect(s.sleepTodayMin).toBe(0);
  });

  it("still reports the selected child's own records", () => {
    const s = buildWidgetSnapshot({
      children: [child, sibling],
      selectedChildId: 'c2',
      entries: siblingEntries,
      timers: [],
      connection: null,
    });
    expect(s.childName).toBe('Theo');
    expect(s.lastFeedStart).toBe(NOW - 3600000);
    expect(s.lastDiaper).toBe(NOW - 1800000);
    expect(s.lastDiaperSolid).toBe(true);
  });

  it('shows nothing for an expecting child whose sibling owns all the records', () => {
    const expecting: Child = { id: 'c3', first: 'Bean', last: 'L', birth: NOW + 86400000, color: '#111111', expected: true };
    const s = buildWidgetSnapshot({
      children: [sibling, expecting],
      selectedChildId: 'c3',
      entries: siblingEntries,
      timers: [],
      connection: null,
    });
    expect(s.expected).toBe(true);
    expect(s.lastFeedStart).toBeNull();
    expect(s.lastDiaper).toBeNull();
    expect(s.feedsToday).toBe(0);
  });
});
