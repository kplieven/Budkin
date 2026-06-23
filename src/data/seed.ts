/**
 * Demo seed data, ported from the design handoff reference. Used in demo mode
 * (no server) so the app is fully explorable. Timestamps are relative to `now`.
 */

import type { Child, Entry, FeedMethod, FeedType, Measurement, Timer } from '@/types/models';

const M = 60000;
const DAY = 86400000;

export interface SeedData {
  children: Child[];
  entries: Entry[];
  timers: Timer[];
  selectedChildId: string;
  lastFeed: { feedType: FeedType; method: FeedMethod };
  measurements: Measurement[];
}

export function makeSeed(now: number): SeedData {
  const c1 = 'c1';
  return {
    selectedChildId: c1,
    lastFeed: { feedType: 'breast', method: 'left' },
    children: [
      { id: 'c1', first: 'Mira', last: 'Okafor', birth: now - 86 * DAY, color: '#EBA06A' },
      { id: 'c2', first: 'Theo', last: 'Okafor', birth: now - 86 * DAY, color: '#9F94D4' },
    ],
    timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: now - 27 * M, saveAs: 'sleep' }],
    entries: [
      { id: 'e1', childId: c1, type: 'feeding', start: now - 96 * M, end: now - 78 * M, feedType: 'breast', method: 'right', amount: null, tags: [] },
      { id: 'e2', childId: c1, type: 'diaper', time: now - 41 * M, wet: true, solid: false, color: null, tags: [] },
      { id: 'e3', childId: c1, type: 'pumping', start: now - 150 * M, end: now - 133 * M, amount: 90, tags: [] },
      { id: 'e4', childId: c1, type: 'feeding', start: now - 235 * M, end: now - 220 * M, feedType: 'formula', method: 'bottle', amount: 120, tags: [] },
      { id: 'e5', childId: c1, type: 'sleep', start: now - 300 * M, end: now - 182 * M, nap: true, tags: [] },
      { id: 'e6', childId: c1, type: 'diaper', time: now - 250 * M, wet: true, solid: true, color: 'yellow', tags: [] },
      { id: 'e7', childId: c1, type: 'tummy', start: now - 330 * M, end: now - 322 * M, milestone: 'Lifted head', tags: [] },
    ],
    measurements: [
      { id: 'm1', childId: c1, kind: 'weight', value: 5.2, date: now - 2 * DAY },
      { id: 'm2', childId: c1, kind: 'height', value: 58, date: now - 10 * DAY },
      { id: 'm3', childId: c1, kind: 'head', value: 39, date: now - 10 * DAY },
      { id: 'm4', childId: c1, kind: 'bmi', value: 15.4, date: now - 2 * DAY },
    ],
  };
}
